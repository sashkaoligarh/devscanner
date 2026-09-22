const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { pathToFileURL } = require('url')
const { app, safeStorage } = require('electron')
const { loadSettings, saveSettings } = require('./settings-store')
const { getSSHClient, connectSSH, getServerPassword, sshExec, sshExecSudo } = require('./ssh-pool')
const { detectDeploySetup, readProjectFile, shellQuote: q } = require('./deploy-setup')
const { checkDeploy, remotePath } = require('./deploy-provision')
const { codexOptions } = require('./deploy-codex')
const { envSecrets } = require('./deploy-output')

const CHECKS = ['nginx', 'containers', 'certbot', 'system', 'projectLogs']
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'findings', 'checks', 'changes'],
  properties: {
    summary: { type: 'string' }, findings: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'string', enum: CHECKS } },
    changes: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['field', 'key', 'value', 'reason'],
      properties: { field: { type: 'string', enum: ['port', 'nginxConfig', 'tlsMode', 'domain', 'remoteBase'] }, key: { type: 'string' }, value: { type: 'string' }, reason: { type: 'string' } }
    } }
  }
}

function redact(text, secrets = []) {
  let result = String(text || '').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[private key removed]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[token removed]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[credentials removed]@')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[redacted]')
    .replace(/((?:[\w.-]*(?:password|passwd|secret|token|api[_-]?key|authorization)[\w.-]*)["']?\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[redacted]')
  for (const value of [...new Set(secrets.filter(v => typeof v === 'string' && v.length >= 4))].sort((a, b) => b.length - a.length)) result = result.split(value).join('[redacted]')
  return result.slice(0, 40000)
}
const caseId = payload => crypto.createHash('sha256').update(JSON.stringify([path.resolve(payload.projectPath), payload.serverId, payload.targetId || '', payload.mode || ''])).digest('hex')

function settingsStatus() {
  const stored = loadSettings().deployAssistant || {}
  return { apiKeySaved: !!stored.apiKey, model: stored.model || '' }
}
function configureAssistant({ apiKey, model = '', clearApiKey = false }) {
  if (typeof model !== 'string' || model.length > 100 || (model && !/^[A-Za-z0-9._:/-]+$/.test(model))) throw new Error('Invalid Codex model name')
  const config = { ...(loadSettings().deployAssistant || {}), model }
  if (clearApiKey) delete config.apiKey
  if (apiKey) {
    if (typeof apiKey !== 'string' || apiKey.length > 1000) throw new Error('Invalid API key')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable. Use your existing Codex login instead of saving an API key.')
    config.apiKey = safeStorage.encryptString(apiKey).toString('base64')
  }
  saveSettings({ deployAssistant: config })
  return settingsStatus()
}

async function loadCodexSdk() {
  if (app.isPackaged) return import(pathToFileURL(path.join(process.resourcesPath, 'app.asar.unpacked/node_modules/@openai/codex-sdk/dist/index.js')).href)
  return import('@openai/codex-sdk')
}
function createDeployAssistant({ loadSdk = loadCodexSdk, check = checkDeploy } = {}) {
  const active = new Map()
  function history(payload) {
    const id = caseId(payload)
    return (loadSettings().deployAssistantHistory || []).filter(record => record.caseId === id).slice(-10)
  }
  function remember(record) {
    saveSettings({ deployAssistantHistory: [...(loadSettings().deployAssistantHistory || []), record].slice(-100) })
  }
  async function diagnose(payload, emit = () => {}) {
    const id = caseId(payload)
    if (active.has(payload.serverId)) throw new Error('Codex is already diagnosing this server')
    const controller = new AbortController()
    active.set(payload.serverId, controller)
    const timeout = setTimeout(() => controller.abort(), 180000)
    let directory
    const secretValues = [payload.privateKey, payload.sslKey, ...envSecrets(payload.envValues)]
    try {
      const settings = loadSettings(), config = settings.deployAssistant || {}
      const server = (settings.remoteServers || []).find(s => s.id === payload.serverId)
      if (!server) throw new Error('Choose a saved SSH server')
      const setup = detectDeploySetup(payload.projectPath)
      let apiKey
      if (config.apiKey) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Unlock secure storage to use the saved API key')
        apiKey = safeStorage.decryptString(Buffer.from(config.apiKey, 'base64'))
        secretValues.push(apiKey)
      }
      const clean = value => redact(value, secretValues)
      emit({ message: 'Checking current deployment inputs…' })
      let preflight
      try { preflight = await check(payload) } catch (err) { preflight = { error: clean(err.message) } }
      const client = getSSHClient(server.id) || await connectSSH(server)
      const password = getServerPassword(server.id)
      if (password) secretValues.push(password)
      const runRead = async command => {
        if (controller.signal.aborted) throw new Error('Diagnosis cancelled')
        const result = server.username === 'root'
          ? await sshExec(client, 'bash -c ' + q(command), 20000)
          : await sshExecSudo(client, command, password, 20000)
        return { code: result.code, output: clean((result.stdout || '') + '\n' + (result.stderr || '')) }
      }
      // Read known secret values only for masking; never include the env file in model context.
      const base = remotePath(payload.remoteBase || setup.remoteBase)
      if (/^\/[a-zA-Z0-9/_.-]+$/.test(base) && !base.split('/').includes('..')) {
        const command = 'if [ -f ' + q(base + '/env/server.env') + ' ]; then cat ' + q(base + '/env/server.env') + '; fi'
        const result = server.username === 'root' ? await sshExec(client, command, 10000) : await sshExecSudo(client, command, password, 10000)
        const { parseEnv } = require('./deploy-setup')
        try { secretValues.push(...envSecrets(parseEnv(result.stdout || ''))) } catch { /* No raw env reaches the prompt. */ }
      }
      const context = { project: setup.projectName, mode: payload.mode, remoteBase: base, domain: payload.domain, tlsMode: payload.tlsMode || 'existing', preflight, error: clean(payload.error), question: clean(payload.question), history: history(payload) }
      for (const file of [setup.composeFile, setup.nginxFile, setup.targets.find(t => t.id === payload.targetId)?.playbook].filter(Boolean)) {
        // Send config with env assignments removed; don't read .env files, keys or Vault data.
        let content = readProjectFile(payload.projectPath, file)
        if (/^\$ANSIBLE_VAULT/.test(content)) continue
        if (/\.ya?ml$/.test(file)) {
          const yaml = require('js-yaml')
          const scrub = value => {
            if (Array.isArray(value)) return value.map(scrub)
            if (!value || typeof value !== 'object') return value
            return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /^(environment|env|vars|vars_files|include_vars|stringData|data)$/i.test(key) || /password|secret|token|private.?key/i.test(key) ? '[redacted]' : scrub(child)]))
          }
          try { content = yaml.dump(scrub(yaml.load(content))) } catch { content = '[Configuration could not be parsed safely]' }
        }
        context[file] = clean(content)
      }
      if (payload.nginxConfig) context.nginxOverride = clean(payload.nginxConfig)
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devscanner-codex-'))
      const { Codex } = await loadSdk()
      const codex = new Codex(codexOptions(directory, apiKey))
      const options = { workingDirectory: directory, skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled', ...(config.model ? { model: config.model } : {}) }
      const thread = codex.startThread(options)
      let prompt = clean(JSON.stringify(context)), plan, usage = null
      const performed = new Set()
      for (let round = 0; round < 4; round++) {
        if (controller.signal.aborted) throw new Error('Diagnosis cancelled')
        emit({ message: round ? 'Analyzing additional diagnostics…' : 'Codex is analyzing the deployment…' })
        const stream = await thread.runStreamed(prompt, { outputSchema: PLAN_SCHEMA, signal: controller.signal })
        let answer = '', completed = false
        for await (const event of stream.events) {
          if (event.type === 'turn.failed' || event.type === 'error') throw new Error(clean(event.error?.message || event.message))
          if (event.type === 'item.completed' && event.item.type === 'agent_message') answer = event.item.text
          if (event.type === 'turn.completed') { completed = true; usage = event.usage }
        }
        if (!completed || !answer) throw new Error('Codex did not complete the diagnosis')
        plan = JSON.parse(answer)
        if (typeof plan.summary !== 'string' || !Array.isArray(plan.findings) || !Array.isArray(plan.checks) || !Array.isArray(plan.changes)) throw new Error('Codex returned an invalid diagnosis')
        const requested = [...new Set(plan.checks)].filter(name => CHECKS.includes(name) && !performed.has(name))
        if (!requested.length || round === 3) break
        const diagnostics = {}
        for (const name of requested) {
          performed.add(name); emit({ message: 'Reading ' + name + ' diagnostics…' })
          const commands = {
            nginx: 'if command -v nginx >/dev/null; then nginx -t 2>&1; else echo "nginx is not installed"; fi',
            containers: 'if command -v docker >/dev/null; then docker ps -a --format "{{.Names}}\\t{{.Status}}\\t{{.Ports}}"; else echo "Docker is not installed"; fi',
            certbot: 'if command -v certbot >/dev/null; then certbot certificates 2>&1; else echo "Certbot is not installed"; fi\nsystemctl list-timers --all --no-pager "devscanner-*.timer" "certbot.timer" 2>&1',
            system: 'cat /etc/os-release\ndf -h / /var\ncommand -v docker nginx certbot ss\nsystemctl is-active docker nginx 2>&1',
            projectLogs: 'for logfile in ' + q(base + '/run/first-deploy.log') + ' ' + q(base + '/run/autodeploy.log') + '; do if [ -f "$logfile" ]; then printf "Log: %s\\n" "$logfile"; tail -n 80 "$logfile"; fi; done\nif command -v docker >/dev/null; then for container in $(docker ps -aq --filter ' + q('label=com.docker.compose.project.config_files=' + base + '/stack/stack.yml') + ' | head -n 3); do docker logs --tail 60 "$container" 2>&1; done; fi'
          }
          diagnostics[name] = await runRead(commands[name])
        }
        prompt = JSON.stringify({ diagnostics, instruction: 'Use these fresh results to finish the diagnosis. Request other checks only if necessary.' })
      }
      plan = sanitizePlan(plan, clean)
      const record = { id: crypto.randomUUID(), caseId: id, createdAt: new Date().toISOString(), summary: plan.summary, findings: plan.findings, changes: plan.changes, status: 'proposed' }
      remember(record)
      return { ...plan, id: record.id, usage, portOverrides: preflight.portOverrides || {} }
    } catch (err) {
      if (controller.signal.aborted) throw new Error('Codex diagnosis cancelled or timed out. You can retry; server configuration was not changed.')
      throw new Error(redact(err.message, secretValues) + '\nIf authentication failed, run codex login or save an OpenAI API key in Assistant settings.')
    } finally {
      clearTimeout(timeout); active.delete(payload.serverId)
      if (directory) fs.rmSync(directory, { recursive: true, force: true })
    }
  }
  function cancel(serverId) { active.get(serverId)?.abort() }
  function cancelAll() { for (const controller of active.values()) controller.abort() }
  function recordOutcome(payload, status) {
    if (!['prepared', 'failed'].includes(status)) return
    const records = loadSettings().deployAssistantHistory || []
    saveSettings({ deployAssistantHistory: records.map(record => record.id === payload.assistantProposalId && record.caseId === caseId(payload) ? { ...record, status, checkedAt: new Date().toISOString() } : record) })
  }
  return { diagnose, history, cancel, cancelAll, recordOutcome }
}

function sanitizePlan(plan, clean = redact) {
  const changes = []
  for (const item of plan.changes.slice(0, 20)) {
    if (!['port', 'nginxConfig', 'tlsMode', 'domain', 'remoteBase'].includes(item.field) || typeof item.value !== 'string') continue
    if (item.field === 'port' && (!/^[a-zA-Z0-9_.-]+:\d+$/.test(item.key || '') || !/^\d+$/.test(item.value) || +item.value < 1 || +item.value > 65535)) continue
    if (item.field === 'tlsMode' && !['existing', 'manual', 'certbot', 'none'].includes(item.value)) continue
    const value = clean(item.value)
    if (value !== item.value || value.length > 30000) continue
    changes.push({ field: item.field, key: String(item.key || '').slice(0, 100), value, reason: clean(item.reason).slice(0, 1000) })
  }
  return { summary: clean(plan.summary).slice(0, 6000), findings: plan.findings.filter(v => typeof v === 'string').slice(0, 20).map(v => clean(v).slice(0, 2000)), changes }
}

const assistant = createDeployAssistant()
module.exports = { assistant, createDeployAssistant, settingsStatus, configureAssistant, redact, sanitizePlan, PLAN_SCHEMA }
