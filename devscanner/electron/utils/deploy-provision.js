const path = require('path')
const crypto = require('crypto')
const { safeStorage } = require('electron')
const { utils: sshUtils } = require('ssh2')
const yaml = require('js-yaml')
const { getSSHClient, connectSSH, getServerPassword, sshExec, sshExecSudo } = require('./ssh-pool')
const { getSFTPClient } = require('./sftp-utils')
const { loadSettings, saveSettings } = require('./settings-store')
const { detectDeploySetup, selectTarget, buildInventory, buildSecretBundle, sanitizeLinuxUser, parseEnv, serializeEnv, shellQuote: q, readProjectFile, isPlaceholder } = require('./deploy-setup')

const activeServers = new Set()
const sessionKeys = new Map()
const DOCKER_SETUP = `set -eu
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  . /etc/os-release
  case "$ID" in ubuntu|debian) ;; *) echo 'Automatic Docker installation supports Ubuntu/Debian'; exit 1;; esac
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl
  if command -v docker >/dev/null && dpkg-query -W -f='\${Status}' docker.io 2>/dev/null | grep -q 'install ok installed'; then
    apt-get install -y -qq docker-compose-v2
  else
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/devscanner-docker.asc
    chmod a+r /etc/apt/keyrings/devscanner-docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/devscanner-docker.asc] https://download.docker.com/linux/%s %s stable\\n' "$(dpkg --print-architecture)" "$ID" "\${UBUNTU_CODENAME:-$VERSION_CODENAME}" > /etc/apt/sources.list.d/devscanner-docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi
systemctl enable --now docker
docker info >/dev/null
docker compose version >/dev/null
for dependency in python3 curl flock ssh-keygen; do
  if ! command -v "$dependency" >/dev/null; then
    command -v apt-get >/dev/null
    apt-get update -qq
    apt-get install -y -qq python3 curl util-linux openssh-client
    break
  fi
done`

function remotePath(value) {
  if (typeof value !== 'string' || !/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(value) || value.split('/').some(p => p === '..') || ['/etc', '/usr', '/var', '/home', '/root', '/opt', '/bin', '/tmp'].includes(value)) throw new Error('Use a project directory such as /opt/my-app for the remote base')
  return value
}
function validateEnv(values) { serializeEnv(values); return values }
function publicKeyFromPrivate(privateKey) {
  const key = sshUtils.parseKey(privateKey)
  if (key instanceof Error || Array.isArray(key) || !key.isPrivateKey()) throw new Error('Invalid unencrypted deploy private key')
  return key.type + ' ' + key.getPublicSSH().toString('base64') + ' devscanner'
}
function collectAssets(setup, projectPath, base) {
  if (!setup.composeFile) throw new Error('A Docker Compose file is required for server pull')
  const content = readProjectFile(projectPath, setup.composeFile)
  const compose = yaml.load(content)
  if (!compose?.services || !Object.keys(compose.services).length) throw new Error('Compose has no services')
  for (const [name, service] of Object.entries(compose.services)) {
    if (!service.image || service.build) throw new Error('Server pull needs a published image and no local build for service ' + name)
    if (service.env_file || (service.volumes || []).some(v => typeof v === 'string' ? /^\.{1,2}\//.test(v) : v.type === 'bind' && !path.posix.isAbsolute(v.source || ''))) {
      throw new Error('Move relative bind mounts/env_file into the deploy layout or inline environment before server pull: ' + name)
    }
  }
  if (setup.autodeployScript && !setup.baseVariable && base !== setup.remoteBase) throw new Error('This updater has a fixed base directory; use ' + setup.remoteBase)
  const script = setup.autodeployScript ? readProjectFile(projectPath, 'deploy/' + setup.autodeployScript) : genericUpdater(base, setup.slug)
  return [
    { name: 'compose', destination: base + '/stack/stack.yml', content, mode: '644' },
    { name: 'updater', destination: base + '/bin/' + (setup.autodeployScript || 'autodeploy.sh'), content: script, mode: '700' }
  ]
}
function genericUpdater(base, slug) {
  return '#!/usr/bin/env bash\nset -euo pipefail\n' +
    'cd ' + q(base) + '\nexec 9>run/autodeploy.lock\nflock -n 9 || exit 0\nset -a\nsource env/server.env\nset +a\n' +
    'docker compose -p ' + q(slug) + ' -f stack/stack.yml config --quiet\n' +
    'docker compose -p ' + q(slug) + ' -f stack/stack.yml pull\n' +
    'docker compose -p ' + q(slug) + ' -f stack/stack.yml up -d --remove-orphans --wait --wait-timeout 120\n'
}

function existingNginxSite(dump, content, managedPath) {
  const names = value => [...value.replace(/#.*$/gm, '').matchAll(/\bserver_name\s+([^;]+);/g)].flatMap(m => m[1].trim().split(/\s+/))
  const requested = names(content)
  const matches = []
  const sections = dump.split(/^# configuration file (.+):\s*$/m)
  for (let index = 1; index < sections.length; index += 2) {
    const file = sections[index]
    const domains = names(sections[index + 1] || '')
    if (!domains.some(name => requested.includes(name))) continue
    if (file !== managedPath && domains.some(name => !requested.includes(name))) throw new Error('The existing nginx file also serves other domains: ' + file + '. Separate that site in Nginx Manager before replacing it.')
    matches.push(file)
  }
  if (matches.length > 1) throw new Error('Several nginx files serve this domain: ' + matches.join(', ') + '. Resolve the duplicate sites in Nginx Manager first.')
  return matches[0] || managedPath
}

async function provisionDeploy(payload, log = () => {}) {
  const { serverId, projectPath } = payload
  if (!serverId) throw new Error('Server is required')
  if (activeServers.has(serverId)) throw new Error('A deploy setup is already running for this server')
  activeServers.add(serverId)
  let stage = ''
  let sudo
  let sftp
  let phase = 'Validate project'
  const completed = []
  try {
    const settings = loadSettings()
    const server = (settings.remoteServers || []).find(s => s.id === serverId)
    if (!server) throw new Error('Server not found')
    const setup = detectDeploySetup(projectPath)
    const mode = payload.mode || setup.mode
    if (!['private-vpn', 'github-direct'].includes(mode)) throw new Error('Invalid deployment profile')
    const target = selectTarget(setup, payload.targetId)
    if (mode === 'github-direct' && target?.type !== 'ansible') throw new Error('No supported direct deployment target selected. Choose an Ansible target, or use server pull for a build-and-publish workflow.')
    const deployUser = payload.deployUser || setup.deployUser
    if (sanitizeLinuxUser(deployUser) !== deployUser || deployUser === 'root') throw new Error('Use a non-root Linux deploy username')
    const base = remotePath(payload.remoteBase || setup.remoteBase)
    const inventory = buildInventory({ host: server.host, port: server.port, deployUser })
    const envInput = validateEnv(payload.envValues || {})
    const files = mode === 'private-vpn' ? collectAssets(setup, projectPath, base) : []
    let nginxContent = payload.configureNginx ? (payload.nginxConfig || (setup.nginxFile ? readProjectFile(projectPath, setup.nginxFile) : '')) : ''
    if (payload.configureNginx && !nginxContent.trim()) throw new Error('Provide an nginx config or use the detected project config')
    if (nginxContent.includes('your-domain.com')) {
      if (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(payload.domain || '')) throw new Error('Enter the public domain for nginx')
      nginxContent = nginxContent.replaceAll('your-domain.com', payload.domain)
    }
    const certPaths = [...nginxContent.matchAll(/ssl_certificate(_key)?\s+([^;\s]+);/g)].map(m => ({ key: !!m[1], path: m[2] }))
    const tlsFiles = []
    for (const cert of certPaths) {
      if (!/^\/etc\/(?:nginx|ssl|letsencrypt)\/[a-zA-Z0-9/_.-]+$/.test(cert.path) || cert.path.split('/').includes('..')) throw new Error('Unsupported certificate path in nginx config')
      const content = cert.key ? payload.sslKey : payload.sslCert
      if (content) tlsFiles.push({ name: 'tls-' + tlsFiles.length, destination: cert.path, content, mode: cert.key ? '600' : '644' })
    }
    // Reuse a shared workflow key across targets and repeated runs. Never save plaintext secrets.
    const keyId = crypto.createHash('sha256').update(path.resolve(projectPath) + ':' + (target?.bindings.privateKey || deployUser)).digest('hex')
    let privateKey = payload.privateKey || sessionKeys.get(keyId) || ''
    let keySaved = false
    const encryptedKey = settings.deploySetupKeys?.[keyId]
    if (!privateKey && encryptedKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('The saved deploy key cannot be unlocked. Supply its existing private key or unlock secure storage before preparing another target.')
      privateKey = safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'))
    }
    if (privateKey) publicKeyFromPrivate(privateKey)

    phase = 'Connect to server'
    log('> ' + phase)
    const client = getSSHClient(serverId) || await connectSSH(server)
    const password = getServerPassword(serverId)
    const run = async (command, timeout = 30000) => {
      const result = await sshExec(client, command, timeout)
      if (result.code !== 0) throw new Error('Remote command failed (exit ' + result.code + ')')
      return result.stdout || ''
    }
    sudo = async (command, timeout = 30000) => {
      const result = server.username === 'root'
        ? await sshExec(client, 'bash -c ' + q('set -e\n' + command), timeout)
        : await sshExecSudo(client, 'set -e\n' + command, password, timeout)
      // Remote output can contain env values, registry tokens, or private keys.
      if (result.code !== 0) throw new Error('Remote command failed (exit ' + result.code + '). Check server permissions and service logs.')
      if (command === 'nginx -t' && /conflicting server name/i.test(result.stderr)) throw new Error('nginx reports a conflicting server name; the previous configuration has been restored.')
      return result.stdout || ''
    }
    async function step(label, operation) {
      phase = label
      log('> ' + label)
      const result = await operation()
      completed.push(label)
      log('✓ ' + label)
      return result
    }
    const envValues = mode === 'private-vpn' ? await step('Validate server environment', async () => {
      const old = await sudo('if [ -f ' + q(base + '/env/server.env') + ' ]; then cat ' + q(base + '/env/server.env') + '; fi')
      const existing = parseEnv(old)
      const defaults = Object.fromEntries(setup.envFields.filter(f => f.value).map(f => [f.key, f.value]))
      const merged = { ...defaults, ...existing }
      for (const [key, value] of Object.entries(envInput)) {
        if (value && (!existing[key] || isPlaceholder(existing[key]) || payload.overwriteEnv)) merged[key] = value
      }
      if (setup.baseVariable) merged[setup.baseVariable] = base
      const missing = setup.requiredKeys.filter(key => !merged[key] || isPlaceholder(merged[key]))
      if (missing.length) throw new Error('Fill required server env values: ' + missing.join(', '))
      validateEnv(merged)
      return merged
    }) : {}
    if (nginxContent) {
      await step('Validate TLS inputs', async () => {
        if (!!payload.sslCert !== !!payload.sslKey) throw new Error('Provide both certificate and private key')
        if (payload.sslCert) {
          try {
            const cert = new crypto.X509Certificate(payload.sslCert)
            if (!cert.checkPrivateKey(crypto.createPrivateKey(payload.sslKey))) throw new Error('mismatch')
          } catch { throw new Error('TLS certificate and private key must be valid and match') }
        }
        for (const cert of certPaths.filter(c => !(c.key ? payload.sslKey : payload.sslCert))) await sudo('test -s ' + q(cert.path))
      })
    }
    stage = (await run('mktemp -d /tmp/devscanner-setup-XXXXXXXXXX')).trim()
    if (!/^\/tmp\/devscanner-setup-[a-zA-Z0-9]+$/.test(stage)) throw new Error('Could not create secure staging directory')
    sftp = await getSFTPClient(client)
    const upload = (name, content) => new Promise((resolve, reject) => sftp.writeFile(stage + '/' + name, Buffer.from(content), { mode: 0o600 }, err => err ? reject(new Error('Could not upload ' + name)) : resolve()))
    function installCommand(file) {
      const destination = q(file.destination)
      return 'mkdir -p ' + q(path.posix.dirname(file.destination)) + '\n' +
        'if [ -f ' + destination + ' ]; then cp -p ' + destination + ' ' + q(file.destination + '.devscanner-backup') + '; touch ' + q(stage + '/previous-' + file.name) + '; fi\n' +
        'install -o root -g root -m ' + file.mode + ' ' + q(stage + '/' + file.name) + ' ' + q(file.destination + '.devscanner-new') + '\n' +
        'mv -f ' + q(file.destination + '.devscanner-new') + ' ' + destination
    }
    async function install(file) {
      await upload(file.name, file.content)
      await sudo(installCommand(file))
    }
    async function restore(file) {
      await sudo('if [ -f ' + q(stage + '/previous-' + file.name) + ' ]; then cp -p ' + q(file.destination + '.devscanner-backup') + ' ' + q(file.destination) + '; else rm -f ' + q(file.destination) + '; fi')
    }
    await step('Prepare Docker Engine, Compose and runtime tools', () => sudo(DOCKER_SETUP, 240000))
    await step('Prepare deploy user and permissions', async () => {
      await sudo('id -u ' + q(deployUser) + ' >/dev/null 2>&1 || useradd -m -s /bin/bash ' + q(deployUser))
      await sudo('usermod -aG docker ' + q(deployUser) + '\n' +
        'user_home=$(getent passwd ' + q(deployUser) + ' | cut -d: -f6)\n' +
        'test -n "$user_home"\ninstall -d -m 700 -o ' + q(deployUser) + ' -g "$(id -gn ' + q(deployUser) + ')" "$user_home/.ssh"')
      if (payload.sudoAccess) {
        await upload('sudoers', deployUser + ' ALL=(ALL) NOPASSWD:ALL\n')
        await sudo('visudo -cf ' + q(stage + '/sudoers') + '\ninstall -o root -g root -m 440 ' + q(stage + '/sudoers') + ' ' + q('/etc/sudoers.d/devscanner-' + deployUser))
      }
      await sudo('install -d -m 755 ' + q(base))
    })
    let publicKey = ''
    let knownHosts = ''
    {
      await step('Install deploy SSH key', async () => {
        if (!privateKey) {
          privateKey = sshUtils.generateKeyPairSync('ed25519').private
        }
        publicKey = publicKeyFromPrivate(privateKey)
        await upload('authorized-key', publicKey + '\n')
        await sudo('user_home=$(getent passwd ' + q(deployUser) + ' | cut -d: -f6)\n' +
          'touch "$user_home/.ssh/authorized_keys"\n' +
          'if ! grep -qF ' + q(publicKey.split(' ')[1]) + ' "$user_home/.ssh/authorized_keys"; then cat ' + q(stage + '/authorized-key') + ' >> "$user_home/.ssh/authorized_keys"; fi\n' +
          'chown ' + q(deployUser) + ':"$(id -gn ' + q(deployUser) + ')" "$user_home/.ssh/authorized_keys"\nchmod 600 "$user_home/.ssh/authorized_keys"')
        sessionKeys.set(keyId, privateKey)
        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(privateKey).toString('base64')
          saveSettings({ deploySetupKeys: { ...(loadSettings().deploySetupKeys || {}), [keyId]: encrypted } })
          keySaved = loadSettings().deploySetupKeys?.[keyId] === encrypted
        }
      })
      knownHosts = await step('Read SSH host keys', async () => {
        const keys = await sudo('for key in /etc/ssh/ssh_host_*_key.pub; do [ ! -f "$key" ] || cat "$key"; done')
        const host = Number(server.port || 22) === 22 ? server.host : '[' + server.host + ']:' + server.port
        const lines = keys.trim().split('\n').filter(line => /^(ssh-|ecdsa-)/.test(line)).map(line => host + ' ' + line.split(/\s+/).slice(0, 2).join(' '))
        if (!lines.length) throw new Error('No SSH host keys found')
        return lines.join('\n') + '\n'
      })
    }
    if (mode === 'private-vpn') {
      files.push({ name: 'server-env', destination: base + '/env/server.env', content: serializeEnv(envValues), mode: '600' })
      const scriptPath = base + '/bin/' + (setup.autodeployScript || 'autodeploy.sh')
      const wrapper = '#!/usr/bin/env bash\nset -euo pipefail\n' +
        'cd ' + q(base) + '\nexec 8>run/devscanner.lock\nflock -n 8 || exit 0\n' +
        (setup.baseVariable ? 'export ' + setup.baseVariable + '=' + q(base) + '\n' : '') +
        (setup.managesReleaseState ?
          'export STATE_FILE=' + q(base + '/run/devscanner-release.env') + '\n' +
          'config_hash=$(sha256sum stack/stack.yml env/server.env ' + q(scriptPath) + ' | sha256sum)\n' +
          'if [ ! -f run/devscanner-config.hash ] || [ "$(cat run/devscanner-config.hash)" != "$config_hash" ]; then rm -f "$STATE_FILE"; fi\n' +
          'bash ' + q(scriptPath) + '\nprintf \'%s\\n\' "$config_hash" > run/devscanner-config.hash\n'
          : 'exec bash ' + q(scriptPath) + '\n')
      files.push({ name: 'launcher', destination: base + '/bin/devscanner-deploy', content: wrapper, mode: '700' })
      await step('Install Compose, updater and server env', async () => {
        // Pause only this managed schedule during file replacement. Leave it paused if validation fails.
        await sudo('rm -f ' + q('/etc/cron.d/devscanner-' + setup.slug) + '\n' +
          'if [ -f ' + q('/etc/cron.d/' + setup.slug + '-autodeploy') + ' ] && grep -qF ' + q(scriptPath) + ' ' + q('/etc/cron.d/' + setup.slug + '-autodeploy') + '; then mv ' + q('/etc/cron.d/' + setup.slug + '-autodeploy') + ' ' + q('/etc/cron.d/' + setup.slug + '-autodeploy.devscanner-backup') + '; fi\ninstall -d -m 700 ' + q(base + '/env') + ' ' + q(base + '/run') + ' ' + q(base + '/bin'))
        for (const file of files) await upload(file.name, file.content)
        const dummyRefs = setup.autodeployScript ? Object.keys(envValues).filter(k => /_IMAGE_REPO$/.test(k)).map(k => 'export ' + k.replace(/_REPO$/, '_REF') + '=' + q(envValues[k] + ':' + (envValues.KPCEP_IMAGE_TAG || 'latest'))).join('\n') : ''
        const locks = 'exec 8>' + q(base + '/run/devscanner.lock') + '\nflock -w 120 8\n' +
          (setup.updaterLock ? 'exec 9>' + q(base + '/' + setup.updaterLock) + '\nflock -w 120 9\n' : '')
        await sudo(locks + files.map(installCommand).join('\n') + '\n' +
          'bash -n ' + q(scriptPath) + '\nbash -n ' + q(base + '/bin/devscanner-deploy') + '\n' +
          'set -a\nsource ' + q(base + '/env/server.env') + '\nset +a\n' + dummyRefs + '\ndocker compose -f ' + q(base + '/stack/stack.yml') + ' config --quiet', 270000)
      })
    }
    if (nginxContent) {
      await step('Install and validate nginx configuration', async () => {
        await sudo('if ! command -v nginx >/dev/null; then apt-get update -qq; apt-get install -y -qq nginx; fi', 120000)
        const managedPath = '/etc/nginx/conf.d/devscanner-' + setup.slug + '.conf'
        const activeConfig = await sudo('nginx -T')
        let destination = existingNginxSite(activeConfig, nginxContent, managedPath)
        if (destination !== managedPath) destination = (await sudo('readlink -f -- ' + q(destination))).trim()
        if (!destination.startsWith('/etc/nginx/conf.d/') && !destination.startsWith('/etc/nginx/sites-available/') && !destination.startsWith(base + '/nginx/')) throw new Error('The active nginx site is not a standalone project config: ' + destination)
        // Keep the full project config (upstreams, maps, rate limits and locations).
        const replacements = [...tlsFiles, { name: 'nginx', destination, content: nginxContent, mode: '644' }]
        const installed = []
        try {
          for (const file of replacements) { await install(file); installed.push(file) }
          await sudo('nginx -t')
          await sudo('systemctl enable --now nginx\nsystemctl reload nginx')
        } catch (err) {
          for (const file of installed.reverse()) await restore(file)
          throw err
        }
        files.push({ destination })
      })
    }
    let firstDeploy = 'not-requested'
    if (mode === 'private-vpn' && payload.runNow) {
      await step('Run first deployment', () => sudo(q(base + '/bin/devscanner-deploy'), 300000))
      firstDeploy = 'completed'
    }
    if (mode === 'private-vpn' && payload.installCron !== false) {
      await step('Enable automatic image updates', async () => {
        await sudo('if ! command -v cron >/dev/null; then apt-get update -qq; apt-get install -y -qq cron; fi', 120000)
        const cron = 'SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n\n* * * * * root ' + base + '/bin/devscanner-deploy >> ' + base + '/run/autodeploy.log 2>&1\n'
        await install({ name: 'cron', destination: '/etc/cron.d/devscanner-' + setup.slug, content: cron, mode: '644' })
        await sudo('touch ' + q(base + '/run/autodeploy.log') + '\nchmod 600 ' + q(base + '/run/autodeploy.log') + '\nsystemctl enable --now cron\nsystemctl is-active --quiet cron')
      })
    }
    const secrets = buildSecretBundle({ target, detectedSecrets: target?.secrets || [], mode, privateKey, inventory, knownHosts, envValues })
    const variables = (target?.variables || []).map(name => ({ name, value: envValues[name] || '', description: 'GitHub Actions variable used by the selected workflow.' }))
    const nextSteps = []
    if (secrets.length) nextSteps.push('GitHub → repository Settings → Secrets and variables → Actions: add the values listed below for ' + target.label + '. Fill entries marked manual with the existing project credentials.')
    if (variables.length) nextSteps.push('Add the listed GitHub Actions variables; supplied server env values are included where names match.')
    if (mode === 'github-direct') {
      if (target?.bindings.vault) nextSteps.push('Set ' + target.bindings.vault + ' to the existing password for ' + (target.vaultFiles?.join(', ') || 'the encrypted repository vars') + '. No new Vault password was generated.')
      if (target?.siblingTargets > 1) nextSteps.push('This workflow deploys to ' + target.siblingTargets + ' servers. Prepare each target before running it; keep the same value for shared SSH key secrets.')
      if (target?.externalDatabase) nextSteps.push('The production playbook uses an external MySQL/MariaDB database. Keep its existing host, database and credentials in the encrypted vars; the playbook does not create that database.')
      nextSteps.push('Run ' + target.file + ' in GitHub Actions. Its existing playbook deploys the images and application env from the repository.')
    } else {
      if (!setup.requiredKeys.includes('GHCR_TOKEN')) nextSteps.push('For private images, authorize the updater account on the server: sudo docker login (Docker Hub), or sudo docker login ghcr.io (GHCR). The updater runs as root.')
      else if (setup.requiredKeys.includes('GHCR_TOKEN')) nextSteps.push('The updater uses GHCR_USERNAME/GHCR_TOKEN from the installed server env to access GHCR. A separate Docker Hub login is not needed for this project.')
      if (payload.installCron !== false) nextSteps.push('After publishing images' + (!setup.requiredKeys.includes('GHCR_TOKEN') ? ' and registry login' : '') + ', cron pulls them every minute. Check: sudo tail -n 50 ' + base + '/run/autodeploy.log')
      else nextSteps.push('Automatic updates are disabled. Run manually: sudo ' + base + '/bin/devscanner-deploy')
    }
    const profile = { id: crypto.createHash('sha256').update(projectPath + serverId + (target?.id || '')).digest('hex').slice(0, 24), projectPath, projectName: setup.projectName, serverId, targetId: target?.id, mode, deployUser, remoteBase: base, updatedAt: new Date().toISOString() }
    const current = loadSettings()
    saveSettings({ deploySetups: [...(current.deploySetups || []).filter(p => p.id !== profile.id), profile] })
    return { profile, setup: { ...setup, mode }, target, publicKey, serverAccess: { host: server.host, port: server.port || 22, username: deployUser, privateKey, knownHosts }, secrets, variables, nextSteps, completed, firstDeploy, assets: { installed: mode === 'private-vpn', files: files.map(f => f.destination), cronInstalled: mode === 'private-vpn' && payload.installCron !== false }, keySaved }
  } catch (err) {
    const error = new Error(phase + ': ' + err.message)
    error.completed = completed
    throw error
  } finally {
    if (stage && sudo) {
      try { await sudo('rm -rf -- ' + q(stage)) } catch { log('Temporary setup files could not be removed: ' + stage) }
    }
    sftp?.end?.()
    activeServers.delete(serverId)
  }
}
module.exports = { provisionDeploy, collectAssets, genericUpdater, remotePath, existingNginxSite, DOCKER_SETUP }
