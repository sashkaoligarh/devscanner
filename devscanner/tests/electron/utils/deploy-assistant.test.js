// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'
import { privateProject, write } from '../../fixtures/deploy-project'

const mocks = { loadSettings: vi.fn(), saveSettings: vi.fn(), getSSHClient: vi.fn(), connectSSH: vi.fn(), getServerPassword: vi.fn(), sshExec: vi.fn(), sshExecSudo: vi.fn(), checkDeploy: vi.fn(), encryption: vi.fn() }
let root, settings, sdkOptions, threadOptions, prompts, responses
const originalLoad = Module._load
Module._load = function (request, parent) {
  if (parent?.filename.endsWith('deploy-assistant.js')) {
    if (request === './deploy-provision') return { ...mocks, remotePath: value => value }
    if (['./settings-store', './ssh-pool'].includes(request)) return mocks
    if (request === 'electron') return { app: { isPackaged: false, getPath: () => root }, safeStorage: { isEncryptionAvailable: mocks.encryption, encryptString: v => Buffer.from('encrypted:' + v), decryptString: b => b.toString().replace(/^encrypted:/, '') } }
  }
  return originalLoad.apply(this, arguments)
}
const { createDeployAssistant, redact, sanitizePlan, configureAssistant, settingsStatus } = require('../../../electron/utils/deploy-assistant')
Module._load = originalLoad

const finalPlan = { summary: 'The CMS host port is busy.', findings: ['Another project is using 1337.'], checks: [], changes: [{ field: 'port', key: 'cms:0', value: '1338', reason: 'Choose a free host port.' }] }
const payload = extra => ({ serverId: 's1', projectPath: root, mode: 'private-vpn', remoteBase: '/opt/app', envValues: { POSTGRES_PASSWORD: 'local-secret', PUBLIC_SITE_URL: 'https://app.test' }, ...extra })
function makeAssistant() {
  class Codex {
    constructor(options) { sdkOptions = options }
    startThread(options) { threadOptions = options; return this.thread() }
    resumeThread(id, options) { threadOptions = options; return this.thread() }
    thread() { return { runStreamed: async (prompt, options) => {
      prompts.push(prompt)
      const answer = responses.shift() || finalPlan
      return { events: (async function* () {
        yield { type: 'thread.started', thread_id: 'fixture-thread' }
        if (answer.wait) {
          await new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) })
        }
        if (answer.error) { yield { type: 'turn.failed', error: { message: answer.error } }; return }
        yield { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(answer) } }
        yield { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 } }
      })() }
    } } }
  }
  return createDeployAssistant({ loadSdk: async () => ({ Codex }), check: mocks.checkDeploy })
}

beforeEach(() => {
  vi.clearAllMocks()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-assistant-test-'))
  privateProject(root)
  vi.stubEnv('CODEX_HOME', root)
  fs.writeFileSync(path.join(root, 'auth.json'), '{"OPENAI_API_KEY":"fixture-login"}', { mode: 0o600 })
  settings = { remoteServers: [{ id: 's1', username: 'ubuntu' }] }
  sdkOptions = null; threadOptions = null; prompts = []; responses = []
  mocks.encryption.mockReturnValue(true)
  mocks.loadSettings.mockImplementation(() => settings)
  mocks.saveSettings.mockImplementation(value => { settings = { ...settings, ...value } })
  mocks.getSSHClient.mockReturnValue({})
  mocks.getServerPassword.mockReturnValue('ssh-secret')
  mocks.sshExecSudo.mockImplementation(async (_, command) => ({ code: 0, stdout: command.includes('then cat') ? 'POSTGRES_PASSWORD=remote-secret\nPUBLIC_SITE_URL=https://app.test\n' : 'status ok', stderr: '' }))
  mocks.checkDeploy.mockResolvedValue({ ports: [{ id: 'cms:0', port: 1337 }], portOverrides: { 'frontend:0': 4322 } })
})
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }) })

it('requests additional diagnostics, masks credentials and returns reviewed form changes with bounded history', async () => {
  responses = [{ ...finalPlan, checks: ['nginx', 'system', 'projectLogs'], changes: [] }, finalPlan]
  write(root, 'deploy/nginx.conf', 'server { listen 80; server_name app.test; proxy_set_header Authorization "Bearer super-secret-token"; }')
  const assistant = makeAssistant(), progress = []
  const result = await assistant.diagnose(payload({ error: 'failed with remote-secret and local-secret', privateKey: '-----BEGIN PRIVATE KEY-----\nprivate-bytes\n-----END PRIVATE KEY-----' }), event => progress.push(event.message))
  expect(prompts).toHaveLength(2)
  expect(prompts.join()).not.toMatch(/remote-secret|local-secret|private-bytes|super-secret-token|ssh-secret/)
  expect(prompts.join()).toContain('app.test')
  expect(sdkOptions.config.features.shell_tool).toBe(false)
  expect(sdkOptions.env.CODEX_HOME).toBe(path.join(threadOptions.workingDirectory, 'codex'))
  expect(fs.readFileSync(path.join(root, 'auth.json'), 'utf8')).toContain('fixture-login')
  expect(threadOptions).toMatchObject({ sandboxMode: 'read-only', networkAccessEnabled: false })
  expect(threadOptions.workingDirectory).not.toBe(root)
  expect(fs.existsSync(threadOptions.workingDirectory)).toBe(false)
  expect(result.changes).toEqual(finalPlan.changes)
  expect(result.portOverrides).toEqual({ 'frontend:0': 4322 })
  expect(progress).toContain('Reading nginx diagnostics…')
  expect(mocks.sshExecSudo.mock.calls.some(c => c[1].includes('/run/first-deploy.log'))).toBe(true)
  expect(assistant.history(payload())[0].status).toBe('proposed')
  expect(assistant.history(payload({ serverId: 'other' }))).toEqual([])
  assistant.recordOutcome(payload({ assistantProposalId: result.id }), 'prepared')
  expect(assistant.history(payload())[0].status).toBe('prepared')
  expect(JSON.stringify(settings)).not.toMatch(/remote-secret|local-secret|private-bytes/)
  expect(mocks.sshExecSudo.mock.calls.some(c => /apt-get|reload|restart/.test(c[1]))).toBe(false)
})

it('cancels a running model turn, releases the server and does not save a successful diagnosis', async () => {
  responses = [{ wait: true }]
  const assistant = makeAssistant()
  const promise = assistant.diagnose(payload())
  await vi.waitFor(() => expect(prompts).toHaveLength(1))
  await expect(assistant.diagnose(payload())).rejects.toThrow('already diagnosing')
  assistant.cancel('s1')
  await expect(promise).rejects.toThrow('cancelled')
  expect(assistant.history(payload())).toEqual([])
  expect((await assistant.diagnose(payload())).summary).toBe(finalPlan.summary)
})

it('stores API keys encrypted and sends only a key-presence flag to the renderer', async () => {
  configureAssistant({ apiKey: 'sk-fixture-123456789012345', model: 'selected-model' })
  expect(settingsStatus()).toEqual({ apiKeySaved: true, model: 'selected-model' })
  expect(JSON.stringify(settings)).not.toContain('sk-fixture-123456789012345')
  await makeAssistant().diagnose(payload())
  expect(sdkOptions.apiKey).toBe('sk-fixture-123456789012345')
  expect(sdkOptions.env.CODEX_HOME).toBe(path.join(threadOptions.workingDirectory, 'codex'))
  expect(threadOptions.model).toBe('selected-model')
  configureAssistant({ clearApiKey: true })
  expect(settingsStatus().apiKeySaved).toBe(false)
  mocks.encryption.mockReturnValue(false)
  expect(() => configureAssistant({ apiKey: 'fixture-key' })).toThrow('Secure storage')
})

it('does not treat provider failures or unsafe/malformed suggestions as completed fixes', async () => {
  responses = [{ error: 'Provider unavailable' }]
  const assistant = makeAssistant()
  await expect(assistant.diagnose(payload())).rejects.toThrow('Provider unavailable')
  expect(assistant.history(payload())).toEqual([])
  const result = sanitizePlan({ ...finalPlan, changes: [
    { field: 'command', value: 'rm -rf /', reason: 'bad' },
    { field: 'port', key: 'cms:0', value: '99999', reason: 'bad' },
    { field: 'tlsMode', value: 'disabled', reason: 'bad' },
    { field: 'nginxConfig', value: 'password=very-secret', reason: 'bad' },
    ...finalPlan.changes
  ] })
  expect(result.changes).toEqual(finalPlan.changes)
  expect(redact('Authorization: Bearer token-value\nhttps://user:password@example.com\nTOKEN=foo')).not.toMatch(/token-value|user:password|TOKEN=foo/)
})
