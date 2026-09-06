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
  if (parent?.filename.endsWith('deploy-provision.js')) {
    if (request === './ssh-pool' || request === './sftp-utils' || request === './settings-store') return mocks
    if (request === 'electron') return { safeStorage: { isEncryptionAvailable: mocks.encryption, encryptString: value => Buffer.from('encrypted:' + value), decryptString: value => value.toString().replace(/^encrypted:/, '') } }
  }
  return originalLoad.apply(this, arguments)
}
const { provisionDeploy, genericUpdater, remotePath, existingNginxSite, DOCKER_SETUP } = require('../../../electron/utils/deploy-provision')
Module._load = originalLoad
const { detectDeploySetup, parseEnv, serializeEnv } = require('../../../electron/utils/deploy-setup')
const dirs = []
let settings, uploads, existingEnv, root, failCommand, logs
function makeProject(recipe) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-test-')); dirs.push(folder); recipe(folder); return folder
}
function payload(extra = {}) { return { serverId: 'srv1', projectPath: root, remoteBase: '/opt/custom-app', deployUser: 'deploy-app', ...extra } }

beforeEach(() => {
  vi.clearAllMocks()
  settings = { remoteServers: [{ id: 'srv1', host: '10.0.0.7', port: 2222 }] }
  uploads = new Map(); existingEnv = ''; failCommand = null; logs = []
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
    return { code: 0, stdout, stderr: '' }
  })
})
afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { force: true, recursive: true })))

describe('VPN server preparation', () => {
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
    expect(settings.deploySetups).toBeUndefined()
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
    failCommand = c => c === "set -e\n'/opt/custom-app/bin/devscanner-deploy'"
    await expect(provisionDeploy(payload({ envValues: { POSTGRES_PASSWORD: 'valid' }, runNow: true }))).rejects.toThrow('Run first deployment')
    expect(uploads.has('cron')).toBe(false)
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
    mocks.sshExec.mockImplementation(async (client, command) => ({ code: 0, stderr: '', stdout: command.includes('mktemp') ? '/tmp/devscanner-setup-abc123\n' : command.includes('ssh_host_*_key.pub') ? 'ssh-ed25519 AAAAtesthost server\n' : '' }))
    const result = await provisionDeploy(payload({ targetId: detectDeploySetup(root).targets[0].id }))
    expect(result.profile.mode).toBe('github-direct')
    expect(mocks.sshExecSudo).not.toHaveBeenCalled()
  })
  it('returns copyable credentials even if secure key storage is unavailable', async () => {
    root = makeProject(directProject); mocks.encryption.mockReturnValue(false)
    const result = await provisionDeploy(payload({ targetId: detectDeploySetup(root).targets[0].id }))
    expect(result.keySaved).toBe(false)
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
    expect(settings.deploySetups).toBeUndefined()
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
