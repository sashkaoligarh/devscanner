// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'
import { execFileSync } from 'child_process'
import { privateProject, directProject, write } from '../../fixtures/deploy-project'
const mocks = { sshExec: vi.fn(), sshExecSudo: vi.fn(), getSSHClient: vi.fn(), connectSSH: vi.fn(), getServerPassword: vi.fn(), getSFTPClient: vi.fn(), loadSettings: vi.fn(), saveSettings: vi.fn(), encryption: vi.fn() }
const originalLoad = Module._load
Module._load = function (request, parent) {
  if (parent?.filename.endsWith('deploy-provision.js') || parent?.filename.endsWith('deploy-state.js')) {
    if (request === './ssh-pool' || request === './sftp-utils' || request === './settings-store') return mocks
    if (request === 'electron') return { app: { getPath: () => stateDirectory }, safeStorage: { isEncryptionAvailable: mocks.encryption, encryptString: value => Buffer.from('encrypted:' + value), decryptString: value => value.toString().replace(/^encrypted:/, '') } }
  }
  return originalLoad.apply(this, arguments)
}
const { provisionDeploy, checkDeploy, genericUpdater, remotePath, existingNginxSite, DOCKER_SETUP } = require('../../../electron/utils/deploy-provision')
const { getDeployState } = require('../../../electron/utils/deploy-state')
Module._load = originalLoad
const { detectDeploySetup, parseEnv, serializeEnv } = require('../../../electron/utils/deploy-setup')
const dirs = []
let settings, uploads, existingEnv, root, failCommand, logs, portProbe, tlsStatus, stateDirectory
function makeProject(recipe) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-test-')); dirs.push(folder); recipe(folder); return folder
}
function payload(extra = {}) { return { serverId: 'srv1', projectPath: root, remoteBase: '/opt/custom-app', deployUser: 'deploy-app', ...extra } }

beforeEach(() => {
  vi.clearAllMocks()
  stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-state-test-')); dirs.push(stateDirectory)
  settings = { remoteServers: [{ id: 'srv1', host: '10.0.0.7', port: 2222 }] }
  uploads = new Map(); existingEnv = ''; failCommand = null; logs = []
  portProbe = '\nDEVSCANNER_CONTAINERS\nDEVSCANNER_PORTS_END\n'; tlsStatus = 'ok'
  mocks.getSSHClient.mockReturnValue({})
  mocks.getServerPassword.mockReturnValue('')
  mocks.loadSettings.mockImplementation(() => settings)
  mocks.saveSettings.mockImplementation(value => { settings = { ...settings, ...value } })
  mocks.encryption.mockReturnValue(true)
  mocks.getSFTPClient.mockResolvedValue({ writeFile(file, data, opts, callback) { uploads.set(path.posix.basename(file), { content: data.toString(), mode: opts.mode }); callback() }, end: vi.fn() })
  mocks.sshExec.mockImplementation(async cmdOrClient => ({ code: 0, stdout: '/tmp/devscanner-setup-abc123\n', stderr: '' }))
  mocks.sshExecSudo.mockImplementation(async (client, command) => {
    if (failCommand?.(command)) return { code: 1, stdout: 'sensitive-value', stderr: 'password-from-process' }
    let stdout = ''
    if (command.includes('then cat') && command.includes('/env/server.env')) stdout = existingEnv
    if (command.includes('ssh_host_*_key.pub')) stdout = 'ssh-ed25519 AAAAtesthost server\n'
    if (command.includes('devscanner-port-probe')) stdout = portProbe
    if (command.includes('devscanner-tls-check')) stdout = tlsStatus
    return { code: 0, stdout, stderr: '' }
  })
})
afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { force: true, recursive: true })))

describe('VPN server preparation', () => {
  it('discards a malformed generated SSH key before saving or installing it', async () => {
    root = makeProject(privateProject)
    const generator = vi.spyOn(require('ssh2').utils, 'generateKeyPairSync').mockReturnValueOnce({ private: 'invalid-generated-key' })
    try {
      const result = await provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'valid' } }))
      expect(generator.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(result.serverAccess.privateKey).toContain('PRIVATE KEY')
      expect(JSON.stringify(settings)).not.toContain('invalid-generated-key')
    } finally { generator.mockRestore() }
  })
  it('installs the complete layout, preserves existing secrets, remaps base, validates then enables cron', async () => {
    root = makeProject(privateProject)
    existingEnv = "POSTGRES_PASSWORD='server-password'\n"
    const result = await provisionDeploy(payload({ mode: 'private-vpn', envValues: { POSTGRES_PASSWORD: 'local-password', PUBLIC_SITE_URL: 'https://app.test' } }), line => logs.push(line))
    expect(result.assets.cronInstalled).toBe(true)
    expect(result.firstDeploy).toBe('not-requested')
    expect(result.serverAccess.username).toBe('deploy-app')
    expect(result.serverAccess.privateKey).toContain('PRIVATE KEY')
    expect(uploads.has('authorized-key')).toBe(true)
    const env = parseEnv(uploads.get('server-env').content)
    expect(env.POSTGRES_PASSWORD).toBe('server-password')
    expect(env.APP_BASE_DIR).toBe('/opt/custom-app')
    expect(env.PUBLIC_SITE_URL).toBe('https://app.test')
    expect(uploads.get('server-env').mode).toBe(0o600)
    expect(uploads.get('launcher').content).toContain('export APP_BASE_DIR=')
    expect(uploads.get('launcher').content).toContain('devscanner-config.hash')
    expect(uploads.get('cron').content).toContain('root /opt/custom-app/bin/devscanner-deploy')
    expect(uploads.get('cron').content.endsWith('\n')).toBe(true)
    const commands = mocks.sshExecSudo.mock.calls.map(c => c[1])
    expect(commands.findIndex(c => c.includes('config --quiet'))).toBeLessThan(commands.findIndex(c => c.includes("'/etc/cron.d/devscanner-") && c.includes('install -o')))
    expect(commands.some(c => c.includes('-autodeploy.devscanner-backup'))).toBe(true)
    expect(commands.some(c => c.includes('local-password') || c.includes('server-password'))).toBe(false)
    expect(JSON.stringify(settings)).not.toContain('server-password')
    expect(logs.join()).not.toContain('server-password')
    expect(result.secrets.map(s => s.name)).not.toContain('SSH_PRIVATE_KEY_PROD')
    expect(commands.at(-1)).toContain('rm -rf --')
    expect(commands.some(c => c.includes('flock -w 120 8'))).toBe(true)
    for (const command of commands) execFileSync('bash', ['-n'], { input: command })
    execFileSync('bash', ['-n'], { input: uploads.get('launcher').content })
  })
  it('requires an explicit override before changing existing server values', async () => {
    root = makeProject(privateProject); existingEnv = 'POSTGRES_PASSWORD=old\n'
    await provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'replacement' }, overwriteEnv: true }))
    expect(parseEnv(uploads.get('server-env').content).POSTGRES_PASSWORD).toBe('replacement')
  })
  it('fails missing env before creating users, installing Docker or uploading anything', async () => {
    root = makeProject(privateProject)
    await expect(provisionDeploy(payload())).rejects.toThrow('POSTGRES_PASSWORD')
    expect(uploads.size).toBe(0)
    expect(mocks.sshExecSudo.mock.calls.some(c => c[1].includes('useradd') || c[1].includes('apt-get'))).toBe(false)
  })
  it('does not enable cron or return success when remote validation exits nonzero', async () => {
    root = makeProject(privateProject)
    failCommand = c => c.includes('config --quiet')
    await expect(provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'valid' } }), line => logs.push(line))).rejects.toThrow('exit 1')
    expect(uploads.has('cron')).toBe(false)
    expect(settings.deploySetups[0].status).toBe('failed')
    expect(logs.join()).not.toContain('sensitive-value')
    expect(mocks.sshExecSudo.mock.calls.at(-1)[1]).toContain('rm -rf')
  })
  it('installs nginx and restores its previous config if validation fails', async () => {
    root = makeProject(privateProject)
    write(root, 'deploy/nginx.conf', 'server { listen 80; server_name your-domain.com; }')
    failCommand = c => c.includes('nginx -t')
    await expect(provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'valid' }, configureNginx: true, domain: 'app.test' }))).rejects.toThrow('nginx')
    expect(uploads.get('nginx').content).toContain('server_name app.test')
    expect(mocks.sshExecSudo.mock.calls.some(c => c[1].includes('previous-nginx'))).toBe(true)
    expect(uploads.has('cron')).toBe(false)
  })
  it('does not report first deploy complete or enable cron on a failed first run', async () => {
    root = makeProject(privateProject)
    failCommand = c => c.includes("if '/opt/custom-app/bin/devscanner-deploy' >")
    await expect(provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'valid' }, runNow: true }))).rejects.toThrow('Run first deployment')
    expect(uploads.has('cron')).toBe(false)
  })
  it('surfaces sanitized first-run output and points to the saved log', async () => {
    root = makeProject(privateProject)
    const original = mocks.sshExecSudo.getMockImplementation()
    mocks.sshExecSudo.mockImplementation(async (client, command) => command.includes("if '/opt/custom-app/bin/devscanner-deploy' >")
      ? { code: 1, stdout: 'pull access denied: ghcr.io/example/cms\nPOSTGRES_PASSWORD=fixture-password', stderr: '' }
      : original(client, command))
    const error = await provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'fixture-password' }, runNow: true })).catch(error => error)
    expect(error.message).toContain('pull access denied')
    expect(error.message).toContain('/opt/custom-app/run/first-deploy.log')
    expect(error.message).not.toContain('fixture-password')
    expect(uploads.has('cron')).toBe(false)
  })
  it('collects readiness responses and project container logs on failure without hiding names or exposing secrets', async () => {
    root = makeProject(privateProject)
    const original = mocks.sshExecSudo.getMockImplementation()
    mocks.sshExecSudo.mockImplementation(async (client, command) => {
      if (command.includes("if '/opt/custom-app/bin/devscanner-deploy' >")) return { code: 1, stdout: 'frontend healthcheck failed: http://127.0.0.1:4321/readyz\nImage ghcr.io/example/cms pulled', stderr: '' }
      if (command.includes('Health endpoint:')) return { code: 0, stdout: 'HTTP 503 {"cms":"unavailable"}\nContainer /app-cms-1: health=healthy\nfixture-password', stderr: '' }
      return original(client, command)
    })
    const error = await provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'fixture-password', FRONTEND_HEALTHCHECK_URL: 'http://127.0.0.1:4321/readyz' }, runNow: true })).catch(error => error)
    expect(error.message).toContain('http://127.0.0.1:4321/readyz')
    expect(error.message).toContain('ghcr.io/example/cms')
    expect(error.message).toContain('Deployment diagnostics:')
    expect(error.message).toContain('HTTP 503 {"cms":"unavailable"}')
    expect(error.message).toContain('/app-cms-1: health=healthy')
    expect(error.message).not.toContain('fixture-password')
    expect(uploads.has('cron')).toBe(false)
  })
  it('preserves the first-run failure if additional diagnostics fail', async () => {
    root = makeProject(privateProject)
    failCommand = command => command.includes("if '/opt/custom-app/bin/devscanner-deploy' >") || command.includes('docker logs --tail 20')
    await expect(provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'valid' }, runNow: true }))).rejects.toThrow('Additional container diagnostics could not be read; the deployment error above is preserved.')
    expect(uploads.has('cron')).toBe(false)
  })
  it('rejects server placeholders before writes and replaces them with supplied real values without an override', async () => {
    root = makeProject(privateProject)
    existingEnv = 'POSTGRES_PASSWORD=replace_with_a_long_random_value\n'
    expect((await checkDeploy(payload())).missingEnv).toContain('POSTGRES_PASSWORD')
    await expect(provisionDeploy(payload())).rejects.toThrow('Fill required server env values: POSTGRES_PASSWORD')
    expect(uploads.size).toBe(0)
    await provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'real-fixture-password' } }))
    expect(parseEnv(uploads.get('server-env').content).POSTGRES_PASSWORD).toBe('real-fixture-password')
  })
  it('blocks unsupported GHCR fine-grained credentials during preflight instead of first deployment', async () => {
    root = makeProject(privateProject)
    const script = path.join(root, 'deploy/app-autodeploy.sh')
    fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replace('required_vars=(POSTGRES_PASSWORD CMS_IMAGE_REPO)', 'required_vars=(POSTGRES_PASSWORD CMS_IMAGE_REPO GHCR_TOKEN)'))
    const input = payload({ envValues: { POSTGRES_PASSWORD: 'valid', GHCR_TOKEN: 'github_pat_fixtureNotARealCredential' } })
    const report = await checkDeploy(input)
    expect(report.blocked).toBe(true)
    expect(report.issues.join()).toContain('personal access token (classic)')
    await expect(provisionDeploy(input)).rejects.toThrow('read:packages')
    expect(uploads.size).toBe(0)
  })
  it('supports Docker Hub image pull without a project updater and explains root registry login', async () => {
    root = makeProject(r => write(r, 'compose.yaml', 'services:\n  web:\n    image: owner/web:latest\n'))
    const result = await provisionDeploy(payload({ mode: 'private-vpn' }))
    expect(uploads.get('updater').content).toContain('docker compose')
    expect(result.nextSteps.join()).toContain('sudo docker login')
    expect(result.assets.cronInstalled).toBe(true)
  })
})

describe('direct GitHub preparation', () => {
  it('recovers credentials and completed steps after renewal fails, then retries with the same persisted key', async () => {
    root = makeProject(directProject)
    write(root, 'deploy/nginx.conf', 'server { listen 80; server_name app.test; location / { proxy_pass http://127.0.0.1:4321; } }')
    const input = payload({ targetId: detectDeploySetup(root).targets[0].id, configureNginx: true, tlsMode: 'certbot', domain: 'app.test', certbotEmail: 'admin@app.test', certbotAgree: true })
    failCommand = command => command.includes('certbot renew')
    const error = await provisionDeploy(input).catch(error => error)
    expect(error.state.profile).toMatchObject({ status: 'failed', certificateIssued: true, renewalVerified: false, nginxInstalled: false, automation: 'workflow-required' })
    expect(error.state.result.completed).toContain('Read SSH host keys')
    const saved = getDeployState({ ...input, mode: 'github-direct' })
    const key = saved.result.secrets.find(s => s.name === 'SSH_PRIVATE_KEY_PROD').value
    expect(key).toContain('PRIVATE KEY')
    expect(saved.result.secrets.find(s => s.name === 'INVENTORY_PROD_UA').value).toContain('ansible_user=deploy-app')
    expect(saved.result.secrets.find(s => s.name === 'KNOWN_HOSTS_PROD_UA').value).toContain('ssh-ed25519')
    expect(saved.input.certbotEmail).toBe('admin@app.test')
    expect(JSON.stringify(settings)).not.toContain(key)
    failCommand = command => command.includes('useradd')
    const earlyFailure = await provisionDeploy(input).catch(error => error)
    expect(earlyFailure.state.result.serverAccess.privateKey).toBe(key)
    expect(earlyFailure.state.result.serverAccess.knownHosts).toContain('ssh-ed25519')
    failCommand = null
    const result = await provisionDeploy(input)
    expect(result.serverAccess.privateKey).toBe(key)
    expect(result.profile).toMatchObject({ status: 'prepared', renewalVerified: true, nginxInstalled: true, automation: 'workflow-required' })
    expect(settings.deploySetups).toHaveLength(1)
    expect(getDeployState({ ...input, mode: 'github-direct' }).result.serverAccess.privateKey).toBe(key)
  })
  it('uses target-specific names and reuses the shared encrypted key across servers', async () => {
    root = makeProject(directProject)
    const targets = detectDeploySetup(root).targets
    const first = await provisionDeploy(payload({ targetId: targets[0].id }))
    const key = first.secrets.find(s => s.name === 'SSH_PRIVATE_KEY_PROD').value
    expect(key).toContain('PRIVATE KEY')
    expect(first.secrets.find(s => s.name === 'ANSIBLE_VAULT_PROD').value).toBe('')
    expect(first.secrets.find(s => s.name === 'KNOWN_HOSTS_PROD_UA').value).toBe('[10.0.0.7]:2222 ssh-ed25519 AAAAtesthost\n')
    expect(first.secrets.map(s => s.name)).not.toContain('INVENTORY_PROD_NL')
    expect(first.assets.cronInstalled).toBe(false)
    expect(uploads.has('server-env')).toBe(false)
    const second = await provisionDeploy(payload({ targetId: targets[1].id }))
    expect(second.secrets.find(s => s.name === 'SSH_PRIVATE_KEY_PROD').value).toBe(key)
    expect(Object.keys(settings.deploySetupKeys)).toHaveLength(1)
    expect(settings.deploySetups).toHaveLength(2)
  })
  it('provisions root SSH connections without depending on sudo being installed', async () => {
    root = makeProject(directProject)
    settings.remoteServers[0].username = 'root'
    mocks.sshExec.mockImplementation(async (client, command) => ({ code: 0, stderr: '', stdout: command.includes('mktemp') ? '/tmp/devscanner-setup-abc123\n' : command.includes('ssh_host_*_key.pub') ? 'ssh-ed25519 AAAAtesthost server\n' : command.includes('devscanner-port-probe') ? portProbe : '' }))
    const result = await provisionDeploy(payload({ targetId: detectDeploySetup(root).targets[0].id }))
    expect(result.profile.mode).toBe('github-direct')
    expect(mocks.sshExecSudo).not.toHaveBeenCalled()
  })
  it('returns copyable credentials even if secure key storage is unavailable', async () => {
    root = makeProject(directProject); mocks.encryption.mockReturnValue(false)
    const result = await provisionDeploy(payload({ targetId: detectDeploySetup(root).targets[0].id }))
    expect(result.keySaved).toBe(true)
    expect(result.publicKey).toContain('ssh-ed25519')
    expect(settings.deploySetupKeys).toBeUndefined()
    expect(JSON.stringify(settings)).not.toContain('PRIVATE KEY')
    const next = await provisionDeploy(payload({ targetId: detectDeploySetup(root).targets[1].id }))
    expect(next.publicKey).toBe(result.publicKey)
  })
  it('never substitutes a comment for a missing known_hosts entry', async () => {
    root = makeProject(directProject)
    failCommand = c => c.includes('ssh_host_*_key.pub')
    await expect(provisionDeploy(payload({ targetId: detectDeploySetup(root).targets[0].id }))).rejects.toThrow('Read SSH host keys')
    expect(settings.deploySetups[0]).toMatchObject({ status: 'failed', automation: 'workflow-required' })
  })
})

describe('Certbot deployment', () => {
  function options() {
    root = makeProject(privateProject)
    write(root, 'deploy/nginx.conf', 'upstream app { server 127.0.0.1:1337; }\nserver { listen 80; server_name app.test; return 301 https://$host$request_uri; }\nserver { listen 443 ssl; server_name app.test; ssl_certificate /etc/nginx/certs/app.crt; ssl_certificate_key /etc/nginx/certs/app.key; location / { proxy_pass http://app; } }')
    return payload({ configureNginx: true, tlsMode: 'certbot', certbotEmail: 'admin@app.test', certbotAgree: true, envValues: { POSTGRES_PASSWORD: 'fixture-password' } })
  }
  it('does not require existing cert files and issues through HTTP before installing HTTPS and renewal', async () => {
    const input = options(); tlsStatus = 'missing'
    const report = await checkDeploy(input)
    expect(report.tlsIssues).toEqual([])
    expect(report.tlsNotice).toContain('automatic renewal')
    expect(uploads.size).toBe(0)
    const result = await provisionDeploy(input)
    expect(uploads.get('nginx').content).not.toContain('ssl_certificate')
    expect(uploads.get('nginx').content).toContain('acme-challenge')
    expect(uploads.get('nginx-final').content).toContain('/etc/letsencrypt/live/')
    expect(uploads.get('nginx-final').content).toContain('proxy_pass http://app')
    expect(uploads.get('certbot-timer').content).toContain('OnCalendar=')
    const commands = mocks.sshExecSudo.mock.calls.map(c => c[1])
    expect(commands.some(c => c.includes('devscanner-tls-check'))).toBe(false)
    expect(commands.findIndex(c => c.includes('nginx -t'))).toBeLessThan(commands.findIndex(c => c.includes('certbot certonly')))
    expect(commands.findIndex(c => c.includes('certbot certonly'))).toBeLessThan(commands.findIndex(c => c.includes('certbot renew')))
    expect(result.nextSteps.join()).toContain('dry-run passed')
    expect(settings.deploySetups[0].tlsMode).toBe('certbot')
    for (const command of commands) execFileSync('bash', ['-n'], { input: command })
  })
  it.each(['certbot certonly', 'certbot renew'])('restores nginx and avoids enabling application updates when %s fails', async failing => {
    const input = options()
    failCommand = command => command.includes(failing)
    await expect(provisionDeploy(input)).rejects.toThrow(failing === 'certbot certonly' ? 'could not issue' : 'renewal test failed')
    expect(uploads.has('cron')).toBe(false)
    expect(mocks.sshExecSudo.mock.calls.some(c => c[1].includes("'/previous-nginx'") || c[1].includes('/previous-nginx'))).toBe(true)
    expect(mocks.sshExecSudo.mock.calls.some(c => c[1].includes('systemctl disable --now'))).toBe(true)
    expect(settings.deploySetups[0]).toMatchObject({ status: 'failed', nginxInstalled: false, renewalVerified: false, automation: 'disabled' })
  })
  it.each(['certbot certonly', 'certbot renew'])('preserves sanitized diagnostics for %s and reports the actual rollback result', async failing => {
    const input = options(), original = mocks.sshExecSudo.getMockImplementation()
    mocks.sshExecSudo.mockImplementation(async (client, command) => command.includes(failing)
      ? { code: 1, stdout: 'Requesting a certificate for app.test', stderr: 'Domain: app.test\nDetail: Invalid response from http://app.test/.well-known/acme-challenge/test: 404\nPOSTGRES_PASSWORD=fixture-password' }
      : original(client, command))
    const error = await provisionDeploy(input).catch(error => error)
    expect(error.message).toContain('Domain: app.test')
    expect(error.message).toContain('Invalid response')
    expect(error.message).toContain('another site or proxy')
    expect(error.message).toContain('restored and reloaded')
    expect(error.message).not.toContain('fixture-password')
    expect(uploads.has('cron')).toBe(false)
  })
  it('keeps the original Certbot error if restoring nginx also fails', async () => {
    const input = options(), original = mocks.sshExecSudo.getMockImplementation()
    mocks.sshExecSudo.mockImplementation(async (client, command) => {
      if (command.includes('certbot certonly')) return { code: 1, stdout: '', stderr: 'DNS problem: NXDOMAIN for app.test' }
      if (command.includes('previous-nginx') && !command.includes('install -o')) return { code: 1, stdout: '', stderr: '' }
      return original(client, command)
    })
    const error = await provisionDeploy(input).catch(error => error)
    expect(error.message).toContain('NXDOMAIN')
    expect(error.message).toContain('rollback could not be fully completed')
    expect(error.message).not.toContain('was restored and reloaded')
    expect(mocks.sshExecSudo.mock.calls.some(c => c[1].includes('daemon-reload\nnginx -t'))).toBe(true)
  })
  it('preserves SSH timeouts during Certbot issuance instead of replacing them with a DNS error', async () => {
    const input = options(), original = mocks.sshExecSudo.getMockImplementation()
    mocks.sshExecSudo.mockImplementation(async (client, command) => {
      if (command.includes('certbot certonly')) throw new Error('SSH sudo timeout')
      return original(client, command)
    })
    await expect(provisionDeploy(input)).rejects.toThrow('SSH sudo timeout')
    expect(uploads.has('cron')).toBe(false)
  })
  it('requires PEM inputs for manual install and still checks host port 80 for Certbot', async () => {
    const input = options()
    expect((await checkDeploy({ ...input, tlsMode: 'manual' })).tlsIssues.join()).toContain('Paste both')
    portProbe = 'tcp LISTEN 0 100 *:80 *:* users:(("node",pid=12,fd=1))\n' + portProbe
    await expect(provisionDeploy(input)).rejects.toThrow('80/tcp is used')
    expect(uploads.size).toBe(0)
  })
  it('prepares an HTTP deployment without certificates, preserving secrets and updating same-site URLs', async () => {
    const input = { ...options(), tlsMode: 'none', certbotEmail: '', certbotAgree: false, sslCert: 'stale input', sslKey: 'stale input' }
    existingEnv = 'POSTGRES_PASSWORD=server-secret\nPUBLIC_SITE_URL=https://app.test\nCORS_ORIGINS=https://app.test,https://external.test\nOPENAI_BASE_URL=https://api.openai.com/v1\n'
    tlsStatus = 'missing'
    const original = fs.readFileSync(path.join(root, 'deploy/nginx.conf'), 'utf8')
    const report = await checkDeploy(input)
    expect(report.tlsIssues).toEqual([])
    expect(report.tlsNotice).toContain('http://10.0.0.7')
    expect(report.ports.filter(p => p.kind === 'nginx').map(p => p.port)).toEqual([80])
    const result = await provisionDeploy(input)
    expect(result.profile.tlsMode).toBe('none')
    expect(result.nextSteps.join()).toContain('install a certificate later')
    expect(uploads.get('nginx').content).not.toMatch(/ssl_certificate|listen 443|return 301/)
    expect(uploads.get('nginx').content).toContain('proxy_pass http://app;')
    const env = parseEnv(uploads.get('server-env').content)
    expect(env).toMatchObject({ POSTGRES_PASSWORD: 'server-secret', PUBLIC_SITE_URL: 'http://10.0.0.7', CORS_ORIGINS: 'http://10.0.0.7,https://external.test', OPENAI_BASE_URL: 'https://api.openai.com/v1' })
    expect(mocks.sshExecSudo.mock.calls.some(c => /certbot|devscanner-tls-check/.test(c[1]))).toBe(false)
    expect(uploads.has('cron')).toBe(true)
    expect(fs.readFileSync(path.join(root, 'deploy/nginx.conf'), 'utf8')).toBe(original)
    expect((await checkDeploy({ ...input, tlsMode: 'existing', sslCert: '', sslKey: '' })).tlsIssues).toHaveLength(2)
  })
  it('allows HTTP setup without public DNS, but still blocks a busy host port 80', async () => {
    const input = { ...options(), tlsMode: 'none', nginxConfig: 'server { listen 80; server_name your-domain.com; location / { proxy_pass http://app; } }' }
    expect((await checkDeploy(input)).tlsNotice).toContain('http://10.0.0.7')
    portProbe = 'tcp LISTEN 0 100 *:80 *:* users:(("node",pid=12,fd=1))\n' + portProbe
    await expect(provisionDeploy(input)).rejects.toThrow('80/tcp is used')
    expect(uploads.size).toBe(0)
  })
})

describe('deployment preflight', () => {
  it('checks occupied ports and missing TLS together without installing anything or requiring env secrets', async () => {
    root = makeProject(privateProject)
    write(root, 'deploy/nginx.conf', 'upstream cms { server 127.0.0.1:1337; } server { listen 443 ssl; ssl_certificate /etc/nginx/certs/app.crt; ssl_certificate_key /etc/nginx/certs/app.key; }')
    portProbe = 'tcp LISTEN 0 100 0.0.0.0:1337 0.0.0.0:* users:(("node",pid=12,fd=1))\n' + portProbe
    tlsStatus = 'missing'
    const report = await checkDeploy(payload({ configureNginx: true }))
    expect(report.blocked).toBe(true)
    expect(report.ports[0]).toMatchObject({ port: 1337, suggestedPort: 1338 })
    expect(report.tlsIssues).toHaveLength(2)
    expect(report.tlsIssues[0]).toContain('/etc/nginx/certs/app.crt')
    expect(report.missingEnv).toContain('POSTGRES_PASSWORD')
    expect(uploads.size).toBe(0)
    expect(mocks.sshExec).not.toHaveBeenCalled()
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })
  it('rechecks ports on Prepare and fails before writes if another process has claimed the suggested port', async () => {
    root = makeProject(privateProject)
    const choices = { 'cms:0': 1338 }
    expect((await checkDeploy(payload({ portOverrides: choices }))).blocked).toBe(false)
    portProbe = 'tcp LISTEN 0 100 *:1338 *:* users:(("node",pid=12,fd=1))\n' + portProbe
    await expect(provisionDeploy(payload({ portOverrides: choices, envValues: { POSTGRES_PASSWORD: 'valid' } }))).rejects.toMatchObject({ preflight: { blocked: true } })
    expect(uploads.size).toBe(0)
    expect(mocks.sshExec).not.toHaveBeenCalled()
  })
  it('installs and remembers host-port choices, including nginx and existing server health-check URLs', async () => {
    root = makeProject(privateProject)
    write(root, 'deploy/nginx.conf', 'upstream cms { server 127.0.0.1:1337; } server { listen 80; server_name app.test; }')
    fs.appendFileSync(path.join(root, 'deploy/app-autodeploy.sh'), 'CMS_HEALTHCHECK_URL="${CMS_HEALTHCHECK_URL:-http://127.0.0.1:1337/health}"\n')
    existingEnv = 'POSTGRES_PASSWORD=server-password\nCMS_HEALTHCHECK_URL=http://127.0.0.1:1337/health\n'
    const options = payload({ portOverrides: { 'cms:0': 1338 }, configureNginx: true })
    await provisionDeploy(options)
    expect(uploads.get('compose').content).toContain('127.0.0.1:1338:1337/tcp')
    expect(uploads.get('nginx').content).toContain('server 127.0.0.1:1338;')
    expect(uploads.get('updater').content).toContain('http://127.0.0.1:1338/health')
    expect(parseEnv(uploads.get('server-env').content).CMS_HEALTHCHECK_URL).toBe('http://127.0.0.1:1338/health')
    expect(settings.deploySetups[0].portOverrides).toEqual({ 'cms:0': 1338 })
    expect((await checkDeploy(payload({ configureNginx: true }))).ports[0].port).toBe(1338)
    existingEnv = uploads.get('server-env').content
    await provisionDeploy({ ...options, portOverrides: { 'cms:0': 1340 } })
    expect(parseEnv(uploads.get('server-env').content).CMS_HEALTHCHECK_URL).toBe('http://127.0.0.1:1340/health')
    existingEnv = uploads.get('server-env').content
    await provisionDeploy({ ...options, portOverrides: { 'cms:0': 1337 } })
    expect(parseEnv(uploads.get('server-env').content).CMS_HEALTHCHECK_URL).toBe('http://127.0.0.1:1337/health')
    expect(fs.readFileSync(path.join(root, 'deploy/stack.yml'), 'utf8')).toContain('127.0.0.1:1337:1337')
  })
  it('reports TLS file failure with the path and preserves env inputs, before any installation', async () => {
    root = makeProject(privateProject)
    write(root, 'deploy/nginx.conf', 'server { listen 443 ssl; ssl_certificate /etc/nginx/certs/app.crt; ssl_certificate_key /etc/nginx/certs/app.key; }')
    tlsStatus = 'empty'
    await expect(provisionDeploy(payload({ configureNginx: true, envValues: { POSTGRES_PASSWORD: 'keep-me' } }))).rejects.toMatchObject({ message: expect.stringContaining('/etc/nginx/certs/app.crt: file is empty'), completed: ['Validate server environment'] })
    expect(uploads.size).toBe(0)
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })
  it('blocks a failed probe instead of assuming all ports are free', async () => {
    root = makeProject(privateProject)
    failCommand = command => command.includes('devscanner-port-probe')
    await expect(provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'valid' } }))).rejects.toThrow('Could not inspect server ports')
    expect(uploads.size).toBe(0)
  })
  it.each(['root', 'ubuntu'])('reports the probe exit and sanitized server error for %s without installing anything', async username => {
    root = makeProject(directProject)
    settings.remoteServers[0].username = username
    mocks.getServerPassword.mockReturnValue('ssh-password-value')
    const executor = username === 'root' ? mocks.sshExec : mocks.sshExecSudo
    executor.mockResolvedValueOnce({ code: 1, stdout: 'socket metadata must not flood the error', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.\nssh-password-value registry-secret-value token=process-secret\n' })
    const error = await checkDeploy(payload({ targetId: detectDeploySetup(root).targets[0].id, envValues: { GHCR_TOKEN: 'registry-secret-value' } })).catch(error => error)
    expect(error.message).toContain('Check server ports and TLS: Could not inspect server ports')
    expect(error.message).toContain('Port probe failed (exit 1)')
    expect(error.message).toContain('Cannot connect to the Docker daemon at unix:///var/run/docker.sock.')
    expect(error.message).not.toMatch(/ssh-password-value|registry-secret-value|process-secret|socket metadata/)
    expect(uploads.size).toBe(0)
    expect(mocks.saveSettings).not.toHaveBeenCalled()
    expect(executor).toHaveBeenCalledTimes(1)
  })
  it('distinguishes an SSH timeout from malformed port metadata', async () => {
    root = makeProject(directProject)
    const options = payload({ targetId: detectDeploySetup(root).targets[0].id })
    mocks.sshExecSudo.mockRejectedValueOnce(new Error('SSH sudo timeout'))
    await expect(checkDeploy(options)).rejects.toThrow('SSH sudo timeout')
    portProbe = '\nDEVSCANNER_CONTAINERS\ninvalid metadata\nDEVSCANNER_PORTS_END\n'
    await expect(checkDeploy(options)).rejects.toThrow('Could not parse Docker port metadata')
    expect(uploads.size).toBe(0)
  })
  it('checks inline Ansible host ports and requires repository changes for conflicting GitHub deployments', async () => {
    root = makeProject(directProject)
    portProbe = 'tcp LISTEN 0 100 *:4321 *:* users:(("node",pid=12,fd=1))\n' + portProbe
    const options = payload({ targetId: detectDeploySetup(root).targets[0].id })
    const report = await checkDeploy(options)
    expect(report.ports[0]).toMatchObject({ service: 'frontend', port: 4321, editable: false })
    expect(report.issues.join()).toContain('commit/push')
    await expect(provisionDeploy(options)).rejects.toThrow('4321')
    expect(uploads.size).toBe(0)
  })
})

describe('generated shell behavior', () => {
  it('runs the generic updater with the intended env and only starts after a successful pull', () => {
    root = makeProject(() => {})
    fs.mkdirSync(path.join(root, 'env')); fs.mkdirSync(path.join(root, 'run')); fs.mkdirSync(path.join(root, 'stack')); fs.mkdirSync(path.join(root, 'bin'))
    fs.writeFileSync(path.join(root, 'env/server.env'), serializeEnv({ PASSWORD: "p'a$$word" }))
    fs.writeFileSync(path.join(root, 'bin/docker'), '#!/bin/bash\nprintf "%s|%s\\n" "$*" "$PASSWORD" >> "$CALLS"\nif [[ "$*" == *" pull" && "$FAIL_PULL" == 1 ]]; then exit 1; fi\n', { mode: 0o700 })
    const script = genericUpdater(root, 'example')
    const env = { ...process.env, PATH: path.join(root, 'bin') + ':' + process.env.PATH, CALLS: path.join(root, 'calls'), FAIL_PULL: '0' }
    execFileSync('bash', [], { input: script, env })
    const calls = fs.readFileSync(env.CALLS, 'utf8')
    expect(calls).toContain("up -d --remove-orphans --wait --wait-timeout 120|p'a$$word")
    fs.writeFileSync(env.CALLS, '')
    expect(() => execFileSync('bash', [], { input: script, env: { ...env, FAIL_PULL: '1' } })).toThrow()
    expect(fs.readFileSync(env.CALLS, 'utf8')).not.toContain('up -d')
  })
  it('reapplies changed configuration when an existing updater skips unchanged releases', async () => {
    root = makeProject(privateProject)
    write(root, 'deploy/app-autodeploy.sh', `#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="\${APP_BASE_DIR:-/opt/example}"
STATE_FILE="\${STATE_FILE:-$BASE_DIR/run/current-release.env}"
required_vars=(POSTGRES_PASSWORD CMS_IMAGE_REPO)
CMS_IMAGE_REF="image:latest"
if [ -f "$STATE_FILE" ]; then exit 0; fi
printf 'deploy\\n' >> "$BASE_DIR/run/deploys"
touch "$STATE_FILE"
`)
    const remote = makeProject(() => {})
    await provisionDeploy(payload({ remoteBase: remote, envValues: { POSTGRES_PASSWORD: 'fixture-password' } }))
    for (const dir of ['bin', 'env', 'run', 'stack']) fs.mkdirSync(path.join(remote, dir))
    fs.writeFileSync(path.join(remote, 'bin/app-autodeploy.sh'), uploads.get('updater').content)
    fs.writeFileSync(path.join(remote, 'env/server.env'), uploads.get('server-env').content)
    fs.writeFileSync(path.join(remote, 'stack/stack.yml'), uploads.get('compose').content)
    const launcher = uploads.get('launcher').content
    execFileSync('bash', [], { input: launcher })
    execFileSync('bash', [], { input: launcher })
    expect(fs.readFileSync(path.join(remote, 'run/deploys'), 'utf8')).toBe('deploy\n')
    fs.appendFileSync(path.join(remote, 'stack/stack.yml'), '# updated config\n')
    execFileSync('bash', [], { input: launcher })
    expect(fs.readFileSync(path.join(remote, 'run/deploys'), 'utf8')).toBe('deploy\ndeploy\n')
  })
  it('reuses an existing dedicated nginx site without overwriting unrelated domains', () => {
    const dump = '# configuration file /etc/nginx/nginx.conf:\nhttp { include sites-enabled/*; }\n# configuration file /etc/nginx/sites-enabled/app:\nserver { server_name app.test; }\n'
    expect(existingNginxSite(dump, 'server { server_name app.test; }', '/etc/nginx/conf.d/devscanner-app.conf')).toBe('/etc/nginx/sites-enabled/app')
    expect(() => existingNginxSite(dump.replace('app.test;', 'app.test other.test;'), 'server { server_name app.test; }', '/etc/nginx/conf.d/devscanner-app.conf')).toThrow('other domains')
  })
  it('rejects dangerous remote bases and validates the dependency installer shell', () => {
    for (const value of ['/opt', '/etc', '/opt/app; touch /tmp/pwn', '/opt/app/../other', '/', '/opt/app%date']) expect(() => remotePath(value)).toThrow()
    expect(remotePath('/opt/project-prod')).toBe('/opt/project-prod')
    execFileSync('bash', ['-n'], { input: DOCKER_SETUP })
  })
})
