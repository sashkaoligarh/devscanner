const path = require('path')
const crypto = require('crypto')
const { safeStorage } = require('electron')
const { utils: sshUtils } = require('ssh2')
const yaml = require('js-yaml')
const { getSSHClient, connectSSH, getServerPassword, sshExec, sshExecSudo } = require('./ssh-pool')
const { getSFTPClient } = require('./sftp-utils')
const { loadSettings, saveSettings } = require('./settings-store')
const { detectDeploySetup, selectTarget, buildInventory, buildSecretBundle, sanitizeLinuxUser, parseEnv, serializeEnv, shellQuote: q, readProjectFile, isPlaceholder } = require('./deploy-setup')
const { PORT_PROBE, parseProbe, planPorts, applyPorts, rewriteHostEndpoints, checkTLS } = require('./deploy-preflight')
const { prepareCertbot, prepareManual, prepareHttp, httpSiteUrls, certbotFailure } = require('./deploy-tls')
const { envSecrets, redactDeployOutput, firstDeployCommand, deploymentDiagnosticsCommand, deploymentFailure } = require('./deploy-output')
const { getDeployState, saveDeployState, readPrivate, writePrivate } = require('./deploy-state')

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
function generateDeployPrivateKey() {
  // ssh2 can occasionally emit malformed Ed25519 encodings. Validate before saving/uploading.
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = sshUtils.generateKeyPairSync('ed25519').private
    try { publicKeyFromPrivate(key); return key } catch (err) { if (attempt === 4) throw err }
  }
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

async function provisionDeploy(payload, onLog = () => {}, { checkOnly = false } = {}) {
  const { serverId, projectPath } = payload
  if (!serverId) throw new Error('Server is required')
  if (activeServers.has(serverId)) throw new Error('A deploy setup is already running for this server')
  activeServers.add(serverId)
  let stage = ''
  let sudo
  let sftp
  let phase = 'Validate project'
  const completed = []
  const logs = []
  const log = line => { logs.push(line); onLog(line) }
  let checkpoint
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
    const tlsMode = payload.tlsMode || 'existing'
    if (!['existing', 'manual', 'certbot', 'none'].includes(tlsMode)) throw new Error('Invalid TLS mode')
    let nginxContent = payload.configureNginx ? (payload.nginxConfig || (setup.nginxFile ? readProjectFile(projectPath, setup.nginxFile) : '')) : ''
    if (payload.configureNginx && !nginxContent.trim()) throw new Error('Provide an nginx config or use the detected project config')
    if (nginxContent.includes('your-domain.com')) {
      const domain = payload.domain || (tlsMode === 'none' ? server.host : '')
      if (tlsMode !== 'none' && !checkOnly && !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(domain)) throw new Error('Enter the public domain for nginx')
      if (domain) nginxContent = nginxContent.replaceAll('your-domain.com', domain)
    }
    const http = nginxContent && tlsMode === 'none' ? prepareHttp(nginxContent, payload.domain || server.host) : null
    if (http) nginxContent = http.content
    if (nginxContent && tlsMode === 'manual') nginxContent = prepareManual(nginxContent, setup.slug)
    const certbot = nginxContent && tlsMode === 'certbot' ? prepareCertbot(nginxContent, payload, base, setup.slug) : null
    if (certbot) nginxContent = certbot.finalConfig
    const certPaths = [...new Map([...nginxContent.replace(/#.*$/gm, '').matchAll(/\bssl_certificate(_key)?\s+([^;\s]+);/g)]
      .map(m => [m[1] + ':' + m[2], { key: !!m[1], path: m[2] }])).values()]
    const tlsFiles = []
    for (const cert of certPaths) {
      if (!/^\/etc\/(?:nginx|ssl|letsencrypt)\/[a-zA-Z0-9/_.-]+$/.test(cert.path) || cert.path.split('/').includes('..')) throw new Error('Unsupported certificate path in nginx config')
      const content = certbot ? '' : cert.key ? payload.sslKey : payload.sslCert
      if (content) tlsFiles.push({ name: 'tls-' + tlsFiles.length, destination: cert.path, content, mode: cert.key ? '600' : '644' })
    }
    // Reuse a shared workflow key across targets and repeated runs. Never save plaintext secrets.
    const keyId = crypto.createHash('sha256').update(path.resolve(projectPath) + ':' + (target?.bindings.privateKey || deployUser)).digest('hex')
    let privateKey = payload.privateKey || sessionKeys.get(keyId) || (!checkOnly ? readPrivate('key-' + keyId) : '') || ''
    let keySaved = false
    const encryptedKey = settings.deploySetupKeys?.[keyId]
    if (!checkOnly && !privateKey && encryptedKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('The saved deploy key cannot be unlocked. Supply its existing private key or unlock secure storage before preparing another target.')
      privateKey = safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'))
    }
    if (!checkOnly && privateKey) publicKeyFromPrivate(privateKey)

    phase = 'Connect to server'
    log('> ' + phase)
    const client = getSSHClient(serverId) || await connectSSH(server)
    const password = getServerPassword(serverId)
    const run = async (command, timeout = 30000) => {
      const result = await sshExec(client, command, timeout)
      if (result.code !== 0) throw new Error('Remote command failed (exit ' + result.code + ')')
      return result.stdout || ''
    }
    sudo = async (command, timeout = 30000, describeFailure) => {
      let result
      try {
        result = server.username === 'root'
          ? await sshExec(client, 'bash -c ' + q('set -e\n' + command), timeout)
          : await sshExecSudo(client, 'set -e\n' + command, password, timeout)
      } catch (err) {
        if (describeFailure) throw new Error(describeFailure({ error: err.message }))
        throw err
      }
      // Remote output can contain env values, registry tokens, or private keys.
      if (result.code !== 0) throw new Error(describeFailure ? describeFailure(result) : 'Remote command failed (exit ' + result.code + '). Check server permissions and service logs.')
      if (command === 'nginx -t' && /conflicting server name/i.test(result.stderr)) throw new Error('nginx reports a conflicting server name.')
      return result.stdout || ''
    }
    async function step(label, operation) {
      phase = label
      log('> ' + label)
      const result = await operation()
      phase = label
      completed.push(label)
      log('✓ ' + label)
      checkpoint?.()
      return result
    }
    const httpEnvKeys = [], envIssues = []
    const envValues = mode === 'private-vpn' ? await step('Validate server environment', async () => {
      const old = await sudo('if [ -f ' + q(base + '/env/server.env') + ' ]; then cat ' + q(base + '/env/server.env') + '; fi')
      const existing = parseEnv(old)
      const defaults = Object.fromEntries(setup.envFields.filter(f => f.value).map(f => [f.key, f.value]))
      const merged = { ...defaults, ...existing }
      for (const [key, value] of Object.entries(envInput)) {
        if (value && (!existing[key] || isPlaceholder(existing[key]) || payload.overwriteEnv)) merged[key] = value
      }
      if (setup.baseVariable) merged[setup.baseVariable] = base
      if (http) {
        for (const key of Object.keys(merged).filter(key => /(?:URLS?|ORIGINS?)$/i.test(key))) {
          const value = httpSiteUrls(merged[key], http.domains, http.host)
          if (value !== merged[key]) { merged[key] = value; httpEnvKeys.push(key) }
        }
      }
      const missing = setup.requiredKeys.filter(key => !merged[key] || isPlaceholder(merged[key]))
      if (!checkOnly && missing.length) throw new Error('Fill required server env values: ' + missing.join(', '))
      if (setup.requiredKeys.includes('GHCR_TOKEN') && merged.GHCR_TOKEN?.startsWith('github_pat_') && !isPlaceholder(merged.GHCR_TOKEN)) envIssues.push('GHCR_TOKEN is a fine-grained PAT. Use a personal access token (classic) with read:packages and package access. To replace an existing valid-looking server value, enable Replace existing server values with non-empty form values in Environment.')
      validateEnv(merged)
      return merged
    }) : {}
    // All checks run again immediately before setup, before any remote writes.
    const preflight = await step('Check server ports and TLS', async () => {
      let compose, composeProject
      const sourceIssues = []
      if (mode === 'private-vpn') compose = yaml.load(files.find(f => f.name === 'compose').content)
      else {
        const definitions = []
        const visit = node => {
          if (!node || typeof node !== 'object') return
          for (const [key, value] of Object.entries(node)) {
            if (/(?:^|\.)docker_compose(?:_v2)?$/.test(key)) definitions.push(value)
            else visit(value)
          }
        }
        visit(yaml.load(readProjectFile(projectPath, target.playbook)))
        if (definitions.length === 1 && definitions[0].definition) {
          compose = definitions[0].definition
          composeProject = definitions[0].project_name
        } else sourceIssues.push('Cannot inspect published ports in ' + target.playbook + ': use a single inline Docker Compose definition for automatic checks.')
      }
      const saved = (settings.deploySetups || []).find(p => p.projectPath === projectPath && p.serverId === serverId && p.targetId === target?.id && p.mode === mode && p.remoteBase === base)
      const overrides = payload.portOverrides ?? saved?.portOverrides ?? {}
      const projectName = mode === 'private-vpn'
        ? (setup.autodeployScript ? envValues.STACK_NAME || envValues.COMPOSE_PROJECT_NAME || compose?.name || 'stack' : setup.slug)
        : composeProject
      let metadata
      const probeSecrets = [password, privateKey, payload.sslKey, ...envSecrets(envValues), ...envSecrets(envInput)]
      try {
        const output = await sudo(PORT_PROBE, 30000, result => {
          const detail = redactDeployOutput([result.stderr, result.error].filter(Boolean).join('\n'), probeSecrets).trim().slice(-4000)
          return 'Port probe failed' + (Number.isInteger(result.code) ? ' (exit ' + result.code + ')' : '') + '.\n' +
            (detail || 'No error output was returned. Verify sudo access, ss (iproute2) and the Docker daemon.')
        })
        metadata = parseProbe(output, base, projectName)
      } catch (err) {
        throw new Error('Could not inspect server ports; deployment has not started.\n\n' + redactDeployOutput(err.message, probeSecrets))
      }
      const report = planPorts({ compose, nginx: nginxContent, env: envValues, overrides, occupied: metadata.occupied, editable: mode === 'private-vpn' })
      report.issues.push(...metadata.issues, ...sourceIssues, ...envIssues)
      report.source = mode === 'private-vpn' ? setup.composeFile : target.playbook
      report.tlsIssues = certbot || http ? [] : nginxContent && tlsMode === 'manual' && (!payload.sslCert || !payload.sslKey)
        ? ['Paste both certificate and private key PEM in Advanced → TLS.'] : nginxContent ? await checkTLS(sudo, certPaths, payload) : []
      report.tlsMode = tlsMode
      if (certbot) report.tlsNotice = 'Certbot will issue a certificate for ' + certbot.domains.join(', ') + ' and enable automatic renewal. Public DNS and inbound port 80 must reach this server.'
      if (http) report.tlsNotice = 'HTTP only — no certificate or Certbot required.' + (http.host ? ' Address: http://' + http.host + '.' : '') + (httpEnvKeys.length ? ' HTTP addresses will be applied to: ' + httpEnvKeys.join(', ') + '.' : '')
      report.missingEnv = mode === 'private-vpn' ? setup.requiredKeys.filter(key => !envValues[key] || isPlaceholder(envValues[key])) : []
      if (mode === 'github-direct' && report.ports.some(p => p.conflicts.length)) report.issues.push('Change the published host ports and matching nginx upstreams in ' + target.playbook + ', then commit/push before running GitHub Actions. Server-only overrides would be overwritten by the workflow.')
      report.blocked ||= report.issues.length > 0 || report.tlsIssues.length > 0
      report.portOverrides = Object.fromEntries(report.ports.filter(p => p.kind === 'container' && p.port !== p.originalPort).map(p => [p.id, p.port]))
      if (mode === 'private-vpn' && !nginxContent && setup.nginxFile && (Object.keys(report.portOverrides).length || Object.keys(saved?.portOverrides || {}).length)) {
        report.issues.push('Enable Install nginx configuration to update its upstreams together with the container ports.')
        report.blocked = true
      }
      if (!checkOnly && report.blocked) {
        const conflicts = report.ports.filter(p => p.conflicts.length).map(p => p.service + ' ' + p.address + ':' + p.port + '/' + p.protocol + ' is used by ' + p.conflicts.join(', '))
        const error = new Error([...report.tlsIssues, ...report.issues, ...conflicts].join(' '))
        error.preflight = report
        throw error
      }
      if (!checkOnly && mode === 'private-vpn' && (Object.keys(report.portOverrides).length || Object.keys(saved?.portOverrides || {}).length)) {
        files.find(f => f.name === 'compose').content = applyPorts(compose, report)
        nginxContent = rewriteHostEndpoints(nginxContent, report.ports)
        const updater = files.find(f => f.name === 'updater')
        updater.content = rewriteHostEndpoints(updater.content, report.ports, true)
        const healthPorts = [...report.ports, ...report.ports.map(p => ({ ...p, originalPort: saved?.portOverrides?.[p.id] ?? p.originalPort }))]
        for (const key of Object.keys(envValues).filter(k => /HEALTHCHECK_URL$/.test(k))) envValues[key] = rewriteHostEndpoints(envValues[key], healthPorts, true)
      }
      return report
    })
    if (checkOnly) return preflight
    let publicKey = '', knownHosts = '', firstDeploy = 'not-requested'
    const previous = getDeployState({ projectPath, serverId, targetId: target?.id, mode })
    const priorAccess = previous?.result?.serverAccess
    const reusedAccess = !!privateKey && priorAccess?.privateKey === privateKey && priorAccess.username === deployUser && priorAccess.host === server.host
    if (reusedAccess) { publicKey = previous.result.publicKey; knownHosts = priorAccess.knownHosts; keySaved = true }
    let automation = mode === 'github-direct' ? 'workflow-required' : previous?.profile.automation || 'not-checked'
    const profile = { projectPath, projectName: setup.projectName, serverId, targetId: target?.id, mode, deployUser, remoteBase: base, portOverrides: preflight.portOverrides, tlsMode,
      ...(certbot ? { certName: certbot.certName, certbotEmail: payload.certbotEmail } : {}) }
    checkpoint = (status = 'preparing', error = '', result) => {
      const keyInstalled = completed.includes('Install deploy SSH key') || reusedAccess
      const partial = result || {
        setup: { ...setup, mode }, target, publicKey,
        serverAccess: keyInstalled ? { host: server.host, port: server.port || 22, username: deployUser, privateKey, knownHosts } : null,
        secrets: buildSecretBundle({ target, detectedSecrets: target?.secrets || [], mode, privateKey: keyInstalled ? privateKey : '', inventory, knownHosts, envValues }),
        variables: [], nextSteps: ['Review the completed steps and saved credentials. Correct the reported error, then retry preparation with the same key.'],
        completed: [...completed], firstDeploy, keySaved,
        assets: { installed: completed.includes('Install Compose, updater and server env'), files: [], cronInstalled: completed.includes('Enable automatic image updates') }
      }
      const record = saveDeployState({ profile: { ...profile, status, completed: [...completed], phase, error: redactDeployOutput(error, [privateKey, payload.sslKey, ...envSecrets(envValues), ...envSecrets(envInput)]),
        nginxInstalled: completed.includes('Install and validate nginx configuration'),
        certificateIssued: completed.includes('Issue Let’s Encrypt certificate'),
        renewalVerified: completed.includes('Enable and test certificate renewal'),
        automation,
        lastSuccessfulAt: status === 'prepared' ? new Date().toISOString() : previous?.profile.lastSuccessfulAt
      }, input: { ...payload, mode, targetId: target?.id, deployUser, remoteBase: base }, result: partial, logs: [...logs] })
      return record
    }
    checkpoint()
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
    {
      await step('Install deploy SSH key', async () => {
        if (!privateKey) {
          privateKey = generateDeployPrivateKey()
        }
        publicKey = publicKeyFromPrivate(privateKey)
        // Persist before installing the public key, including systems without a keyring.
        writePrivate('key-' + keyId, privateKey)
        keySaved = true
        await upload('authorized-key', publicKey + '\n')
        await sudo('user_home=$(getent passwd ' + q(deployUser) + ' | cut -d: -f6)\n' +
          'touch "$user_home/.ssh/authorized_keys"\n' +
          'if ! grep -qF ' + q(publicKey.split(' ')[1]) + ' "$user_home/.ssh/authorized_keys"; then cat ' + q(stage + '/authorized-key') + ' >> "$user_home/.ssh/authorized_keys"; fi\n' +
          'chown ' + q(deployUser) + ':"$(id -gn ' + q(deployUser) + ')" "$user_home/.ssh/authorized_keys"\nchmod 600 "$user_home/.ssh/authorized_keys"')
        sessionKeys.set(keyId, privateKey)
        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(privateKey).toString('base64')
          saveSettings({ deploySetupKeys: { ...(loadSettings().deploySetupKeys || {}), [keyId]: encrypted } })
        }
      })
      knownHosts = await step('Read SSH host keys', async () => {
        const keys = await sudo('for key in /etc/ssh/ssh_host_*_key.pub; do [ ! -f "$key" ] || cat "$key"; done')
        const host = Number(server.port || 22) === 22 ? server.host : '[' + server.host + ']:' + server.port
        const lines = keys.trim().split('\n').filter(line => /^(ssh-|ecdsa-)/.test(line)).map(line => host + ' ' + line.split(/\s+/).slice(0, 2).join(' '))
        if (!lines.length) throw new Error('No SSH host keys found')
        return lines.join('\n') + '\n'
      })
      checkpoint()
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
        automation = 'disabled'
        checkpoint()
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
        let previousTimerEnabled = false
        try {
          if (certbot) {
            await step('Prepare Certbot and HTTP challenge', async () => {
              previousTimerEnabled = (await sudo('if systemctl is-enabled --quiet ' + q(certbot.certName + '.timer') + ' 2>/dev/null; then printf enabled; fi')).trim() === 'enabled'
              await sudo('if ! command -v certbot >/dev/null; then apt-get update -qq; apt-get install -y -qq certbot; fi\ninstall -d -m 755 ' + q(certbot.webroot), 120000)
              const ready = (await sudo('if [ -s ' + q(certbot.certificate) + ' ] && [ -s ' + q(certbot.key) + ' ]; then printf ready; fi')).trim() === 'ready'
              const bootstrap = { name: 'nginx', destination, content: ready ? nginxContent : certbot.bootstrapConfig, mode: '644' }
              await install(bootstrap); installed.push(bootstrap)
              await sudo('nginx -t')
              await sudo('systemctl enable --now nginx\nsystemctl reload nginx')
            })
            await step('Issue Let’s Encrypt certificate', async () => {
              await sudo(certbot.issueCommand, 240000, result => certbotFailure(result, { secrets: [password, privateKey, payload.sslKey, ...envSecrets(envValues), ...envSecrets(envInput)] }))
              await sudo('test -s ' + q(certbot.certificate) + '\ntest -s ' + q(certbot.key))
            })
            // Keep the original site's backup; replacing the bootstrap must not overwrite it.
            await upload('nginx-final', nginxContent)
            await sudo('install -o root -g root -m 644 ' + q(stage + '/nginx-final') + ' ' + q(destination))
            await sudo('nginx -t')
            await sudo('systemctl reload nginx')
            await step('Enable and test certificate renewal', async () => {
              for (const file of [certbot.service, certbot.timer]) { await install(file); installed.push(file) }
              await sudo(certbot.enableCommand)
              await sudo(certbot.testCommand, 240000, result => certbotFailure(result, { renewal: true, secrets: [password, privateKey, payload.sslKey, ...envSecrets(envValues), ...envSecrets(envInput)] }))
            })
          } else {
            for (const file of replacements) { await install(file); installed.push(file) }
            await sudo('nginx -t')
            await sudo('systemctl enable --now nginx\nsystemctl reload nginx')
          }
        } catch (err) {
          let rollbackFailed = false
          const rollback = async operation => { try { await operation() } catch { rollbackFailed = true } }
          if (certbot) await rollback(() => sudo('if systemctl cat ' + q(certbot.certName + '.timer') + ' >/dev/null 2>&1; then systemctl disable --now ' + q(certbot.certName + '.timer') + '; fi'))
          for (const file of installed.reverse()) await rollback(() => restore(file))
          await rollback(() => sudo('systemctl daemon-reload\nnginx -t && systemctl reload nginx'))
          if (previousTimerEnabled) await rollback(() => sudo(certbot.enableCommand))
          err.message += rollbackFailed
            ? '\n\nAutomatic rollback could not be fully completed. Check nginx and the certificate renewal timer on the server before retrying.'
            : '\n\nThe previous nginx configuration was restored and reloaded.'
          throw err
        }
        files.push({ destination })
        if (certbot) files.push({ destination: certbot.certificate }, { destination: certbot.key }, certbot.service, certbot.timer)
      })
    }
    if (mode === 'private-vpn' && payload.runNow) {
      await step('Run first deployment', async () => {
        const secrets = [password, privateKey, payload.sslKey, ...envSecrets(envValues), ...envSecrets(envInput)]
        try {
          const output = await sudo(firstDeployCommand(base), 300000, result => deploymentFailure(result, { secrets, ghcr: setup.requiredKeys.includes('GHCR_TOKEN'), logPath: base + '/run/first-deploy.log' }))
          const clean = redactDeployOutput(output, secrets).trim().slice(-8000)
          if (clean) log(clean)
        } catch (err) {
          log('> Reading deployment health and container logs')
          try {
            const output = await sudo(deploymentDiagnosticsCommand(base, envValues), 45000)
            const clean = redactDeployOutput(output, secrets).trim().slice(0, 16000)
            if (clean) err.message += '\n\nDeployment diagnostics:\n' + clean
          } catch { err.message += '\n\nAdditional container diagnostics could not be read; the deployment error above is preserved.' }
          throw err
        }
      })
      firstDeploy = 'completed'
    }
    if (mode === 'private-vpn' && payload.installCron !== false) {
      await step('Enable automatic image updates', async () => {
        await sudo('if ! command -v cron >/dev/null; then apt-get update -qq; apt-get install -y -qq cron; fi', 120000)
        const cron = 'SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n\n* * * * * root ' + base + '/bin/devscanner-deploy >> ' + base + '/run/autodeploy.log 2>&1\n'
        await install({ name: 'cron', destination: '/etc/cron.d/devscanner-' + setup.slug, content: cron, mode: '644' })
        await sudo('touch ' + q(base + '/run/autodeploy.log') + '\nchmod 600 ' + q(base + '/run/autodeploy.log') + '\nsystemctl enable --now cron\nsystemctl is-active --quiet cron')
        automation = 'enabled'
      })
    }
    const secrets = buildSecretBundle({ target, detectedSecrets: target?.secrets || [], mode, privateKey, inventory, knownHosts, envValues })
    const variables = (target?.variables || []).map(name => ({ name, value: envValues[name] || '', description: 'GitHub Actions variable used by the selected workflow.' }))
    const nextSteps = []
    if (http) nextSteps.push('HTTP is configured without a certificate' + (http.host ? ': http://' + http.host : '') + '. You can install a certificate later in Nginx Manager or select Manual PEM / Let’s Encrypt in this wizard. Update public URLs and CORS origins to HTTPS when enabling TLS. The project’s original nginx config is unchanged.')
    if (certbot) nextSteps.push('Let’s Encrypt certificate installed for ' + certbot.domains.join(', ') + '. Automatic renewal is enabled and its dry-run passed. Keep public DNS and port 80 reachable. Check: systemctl status ' + certbot.certName + '.timer')
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
    return checkpoint('prepared', '', { setup: { ...setup, mode }, target, publicKey, serverAccess: { host: server.host, port: server.port || 22, username: deployUser, privateKey, knownHosts }, secrets, variables, nextSteps, completed, firstDeploy, assets: { installed: mode === 'private-vpn', files: files.map(f => f.destination), cronInstalled: mode === 'private-vpn' && payload.installCron !== false }, keySaved }).result
  } catch (err) {
    const error = new Error(phase + ': ' + err.message)
    error.completed = completed
    if (err.preflight) error.preflight = err.preflight
    if (checkpoint) {
      try { error.state = checkpoint('failed', error.message) }
      catch (saveError) { error.message += '\nCould not save deployment progress: ' + saveError.message }
    }
    throw error
  } finally {
    if (stage && sudo) {
      try { await sudo('rm -rf -- ' + q(stage)) } catch { log('Temporary setup files could not be removed: ' + stage) }
    }
    sftp?.end?.()
    activeServers.delete(serverId)
  }
}
const checkDeploy = payload => provisionDeploy(payload, () => {}, { checkOnly: true })
module.exports = { provisionDeploy, checkDeploy, collectAssets, genericUpdater, remotePath, existingNginxSite, DOCKER_SETUP }
