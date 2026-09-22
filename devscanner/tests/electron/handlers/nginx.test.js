// @vitest-environment node
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'
import { spawnSync } from 'child_process'

const mocks = { getSSHClient: vi.fn(), sshExec: vi.fn(), sshExecSudo: vi.fn(), getServerPassword: vi.fn() }
const originalLoad = Module._load
Module._load = function (request, parent) {
  if (parent?.filename.endsWith('/handlers/nginx.js') && request === '../utils/ssh-pool') return mocks
  return originalLoad.apply(this, arguments)
}
const { registerNginxHandlers } = require('../../../electron/handlers/nginx')
Module._load = originalLoad
let root, handlers
const file = name => path.join(root, name)
const write = (name, text = 'server { listen 80; }') => fs.writeFileSync(file(name), text)
const invoke = (action, options = {}) => handlers['ssh-nginx-' + action](null, { serverId: 'srv1', siteName: 'app.conf', source: 'conf.d', ...options })

beforeEach(() => {
  vi.resetAllMocks()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nginx-manager-'))
  for (const dir of ['sites-available', 'sites-enabled', 'conf.d']) fs.mkdirSync(file(dir))
  mocks.getSSHClient.mockReturnValue({})
  mocks.getServerPassword.mockReturnValue('fixture-password')
  const run = async (_, command) => {
    if (command.startsWith('which nginx')) return { code: 0, stdout: '/usr/sbin/nginx\n', stderr: '' }
    if (command === 'nginx -t 2>&1' || command === 'systemctl reload nginx') return { code: 0, stdout: 'successful', stderr: '' }
    const result = spawnSync('bash', ['-c', command.replaceAll('/etc/nginx/', root + '/')], { encoding: 'utf8' })
    return { code: result.status, stdout: result.stdout.replaceAll(root + '/', '/etc/nginx/'), stderr: result.stderr }
  }
  mocks.sshExec.mockImplementation(run)
  mocks.sshExecSudo.mockImplementation(run)
  handlers = {}
  registerNginxHandlers({ handle: (name, fn) => { handlers[name] = fn } }, {})
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

it('lists conf.d, disabled configs and enabled-only sites without merging equal filenames', async () => {
  write('sites-available/app.conf'); write('sites-enabled/standalone')
  write('conf.d/app.conf'); write('conf.d/stopped.conf.disabled'); write('conf.d/old.conf.backup')
  const result = await invoke('list')
  expect(result.success).toBe(true)
  expect(result.data).toEqual([
    { name: 'app.conf', source: 'sites-available', path: '/etc/nginx/sites-available/app.conf', enabled: false },
    { name: 'standalone', source: 'sites-available', path: '/etc/nginx/sites-enabled/standalone', enabled: true },
    { name: 'app.conf', source: 'conf.d', path: '/etc/nginx/conf.d/app.conf', enabled: true },
    { name: 'stopped.conf', source: 'conf.d', path: '/etc/nginx/conf.d/stopped.conf.disabled', enabled: false }
  ])
})

it('reads and saves the selected conf.d file literally, leaving a same-named site untouched', async () => {
  write('sites-available/app.conf', 'other site')
  write('conf.d/app.conf', 'upstream cms { server 127.0.0.1:1337; }\nserver { server_name app.test; }\n')
  const read = await invoke('read')
  expect(read.data.path).toBe('/etc/nginx/conf.d/app.conf')
  expect(read.data.raw).toContain('upstream cms')
  const content = read.data.raw + '# literal quotes \' and " and $host and $(uname) and \\n\n'
  expect((await invoke('save', { content })).success).toBe(true)
  expect(fs.readFileSync(file('conf.d/app.conf'), 'utf8')).toBe(content)
  expect(fs.readFileSync(file('sites-available/app.conf'), 'utf8')).toBe('other site')
})

it('disables, edits, enables and deletes a conf.d file within its own directory', async () => {
  write('conf.d/app.conf'); write('sites-available/app.conf', 'other site')
  expect((await invoke('disable')).success).toBe(true)
  expect(fs.existsSync(file('conf.d/app.conf'))).toBe(false)
  expect((await invoke('read')).data.path).toBe('/etc/nginx/conf.d/app.conf.disabled')
  expect((await invoke('save', { content: 'server { listen 8080; }' })).success).toBe(true)
  expect(fs.existsSync(file('conf.d/app.conf'))).toBe(false)
  expect((await invoke('enable')).success).toBe(true)
  expect(fs.readFileSync(file('conf.d/app.conf'), 'utf8')).toContain('8080')
  expect((await invoke('delete')).success).toBe(true)
  expect(fs.existsSync(file('conf.d/app.conf'))).toBe(false)
  expect(fs.readFileSync(file('sites-available/app.conf'), 'utf8')).toBe('other site')
  expect(mocks.sshExecSudo).toHaveBeenCalledWith(expect.anything(), 'systemctl reload nginx', 'fixture-password', 10000)
})

it('refuses to overwrite an existing disabled copy', async () => {
  write('conf.d/app.conf', 'active'); write('conf.d/app.conf.disabled', 'disabled')
  expect((await invoke('disable')).success).toBe(false)
  expect(fs.readFileSync(file('conf.d/app.conf'), 'utf8')).toBe('active')
  expect(fs.readFileSync(file('conf.d/app.conf.disabled'), 'utf8')).toBe('disabled')
})

it('preserves existing sites-enabled read and write behavior when the source is omitted', async () => {
  write('sites-available/app.conf', 'available'); write('sites-enabled/app.conf', 'active')
  expect((await invoke('read', { source: undefined })).data.raw).toBe('active')
  expect((await invoke('save', { source: undefined, content: 'updated active' })).success).toBe(true)
  expect(fs.readFileSync(file('sites-enabled/app.conf'), 'utf8')).toBe('updated active')
  expect(fs.readFileSync(file('sites-available/app.conf'), 'utf8')).toBe('available')
})

it('keeps an enabled-only regular config when disabling and enabling it', async () => {
  write('sites-enabled/app.conf', 'standalone config')
  expect((await invoke('disable', { source: 'sites-available' })).success).toBe(true)
  expect(fs.readFileSync(file('sites-available/app.conf'), 'utf8')).toBe('standalone config')
  expect((await invoke('enable', { source: 'sites-available' })).success).toBe(true)
  // The generated absolute symlink is mapped into this test's isolated directory.
  expect(fs.readFileSync(file('sites-enabled/app.conf'), 'utf8')).toBe('standalone config')
})

it.each([{ siteName: '../nginx.conf' }, { siteName: '..' }, { source: '../../tmp' }, { siteName: 'app;uname' }, { siteName: 'app.conf.disabled' }])('rejects invalid config paths before issuing commands: %j', async options => {
  expect((await invoke('save', { content: 'test', ...options })).success).toBe(false)
  expect(mocks.sshExecSudo).not.toHaveBeenCalled()
})

it('reports remote read, write and reload errors instead of success', async () => {
  mocks.sshExecSudo.mockResolvedValue({ code: 1, stdout: '', stderr: 'Permission denied' })
  for (const action of ['read', 'save', 'reload']) expect(await invoke(action, { content: 'test' })).toEqual({ success: false, error: 'Permission denied' })
  expect((await invoke('test')).data.ok).toBe(false)
})
