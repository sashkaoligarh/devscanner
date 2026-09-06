const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const yaml = require('js-yaml')

function unique(values) { return [...new Set(values.filter(Boolean))] }
function safeList(dir) { try { return fs.readdirSync(dir).sort() } catch { return [] } }
function sanitizeSlug(value, fallback = 'app') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback
}
function sanitizeLinuxUser(value, fallback = 'deploy') {
  const user = sanitizeSlug(value, fallback).slice(0, 31)
  return /^[a-z_]/.test(user) ? user : fallback
}
function projectFile(projectPath, relative) {
  const root = fs.realpathSync(projectPath)
  const resolved = fs.realpathSync(path.resolve(root, relative))
  if (!resolved.startsWith(root + path.sep) || !fs.statSync(resolved).isFile()) throw new Error('File must be inside the project')
  if (fs.statSync(resolved).size > 2 * 1024 * 1024) throw new Error('Deploy file is too large (maximum 2 MB)')
  return resolved
}
function readProjectFile(projectPath, relative) { return fs.readFileSync(projectFile(projectPath, relative), 'utf8') }
function refs(value, kind) {
  const content = typeof value === 'string' ? value : JSON.stringify(value)
  return unique([...String(content || '').matchAll(new RegExp('\\b' + kind + '(?:\\.([A-Za-z_][A-Za-z0-9_]*)|\\[["\']([A-Za-z_][A-Za-z0-9_]*)["\']\\])', 'g'))].map(m => m[1] || m[2]))
}
function secretRef(value) { return refs(value, 'secrets')[0] || null }
function parseYaml(content, file) {
  try { return yaml.load(content) || {} } catch { throw new Error('Invalid YAML: ' + file) }
}

// Parse data, never source a local or imported env as executable shell code.
function parseEnv(content) {
  const result = {}
  for (const [index, raw] of String(content).split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) throw new Error('Invalid env assignment on line ' + (index + 1))
    let value = match[2]
    if (value.startsWith("'")) {
      // Also accepts our POSIX quote encoding when re-reading installed envs.
      if (!value.endsWith("'")) throw new Error('Unclosed env quote on line ' + (index + 1))
      value = value.slice(1, -1).replace(/'\\''/g, "'")
    } else if (value.startsWith('"')) {
      if (!value.endsWith('"')) throw new Error('Unclosed env quote on line ' + (index + 1))
      value = value.slice(1, -1).replace(/\\(["\\$`])/g, '$1')
    } else value = value.replace(/\s+#.*$/, '').trim()
    result[match[1]] = value
  }
  return result
}
function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'" }
function serializeEnv(values) {
  return Object.entries(values).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || /[\0\r\n]/.test(value)) throw new Error('Invalid env field: ' + key)
    return key + '=' + shellQuote(value)
  }).join('\n') + '\n'
}
function isPlaceholder(value) {
  return /your[-_ ]|generate[_-]?me|change[_-]?me|secure_password_here|github_pat_x+|base64_encoded_|^key1,key2$|^12345$|example\.com/i.test(value || '')
}
function isSensitive(key) { return /PASSWORD|SECRET|TOKEN|(?:^|_)KEYS?$|PRIVATE|SALT|BASIC_AUTH/i.test(key) }

function detectDeploySetup(projectPath) {
  if (!projectPath || !fs.statSync(projectPath).isDirectory()) throw new Error('Project folder not found')
  const projectName = path.basename(projectPath)
  const slug = sanitizeSlug(projectName)
  const targets = []
  const workflowFiles = []
  for (const name of safeList(path.join(projectPath, '.github/workflows')).filter(n => /\.ya?ml$/.test(n))) {
    const file = '.github/workflows/' + name
    const doc = parseYaml(readProjectFile(projectPath, file), file)
    const jobs = doc.jobs || {}
    const workflow = { file, name: doc.name || name, secrets: refs(doc, 'secrets').filter(n => n !== 'GITHUB_TOKEN'), variables: refs(doc, 'vars') }
    workflowFiles.push(workflow)
    for (const [jobId, job] of Object.entries(jobs)) {
      const dependencyJobs = new Set()
      function addNeeds(id) {
        for (const need of [].concat(jobs[id]?.needs || [])) {
          if (dependencyJobs.has(need)) continue
          dependencyJobs.add(need)
          addNeeds(need)
        }
      }
      addNeeds(jobId)
      const steps = job.steps || []
      steps.forEach((step, index) => {
        if (!String(step.uses || '').includes('action-ansible-playbook')) return
        const input = step.with || {}
        const context = { env: doc.env, job: { ...job, steps: undefined }, steps: steps.filter(s => s === step || !String(s.uses || '').includes('action-ansible-playbook')), dependencies: [...dependencyJobs].map(id => jobs[id]) }
        const directory = input.directory || '.'
        const playbook = path.posix.join(directory, input.playbook || '')
        const playbookContent = readProjectFile(projectPath, playbook)
        const referencedVars = []
        function findVars(value) {
          if (!value || typeof value !== 'object') return
          for (const [key, child] of Object.entries(value)) {
            if (key === 'vars_files') referencedVars.push(...[].concat(child).flat().filter(v => typeof v === 'string'))
            if (key === 'include_vars' || key === 'ansible.builtin.include_vars') {
              const file = typeof child === 'string' ? child : child?.file
              if (file) referencedVars.push(file)
            }
            findVars(child)
          }
        }
        if (!playbookContent.startsWith('$ANSIBLE_VAULT')) findVars(parseYaml(playbookContent, playbook))
        const vaultFiles = playbookContent.startsWith('$ANSIBLE_VAULT') ? [playbook] : unique(referencedVars)
          .filter(n => !n.includes('{{'))
          .map(n => path.posix.join(directory, n))
          .filter(file => readProjectFile(projectPath, file).includes('$ANSIBLE_VAULT'))
        targets.push({
          id: file + ':' + jobId + ':' + index, label: workflow.name + ' / ' + (step.name || jobId), file,
          type: 'ansible', directory, playbook, vaultFiles,
          secrets: refs(context, 'secrets').filter(n => n !== 'GITHUB_TOKEN'), variables: refs(context, 'vars'),
          bindings: { privateKey: secretRef(input.key), inventory: secretRef(input.inventory), knownHosts: secretRef(input.known_hosts), vault: secretRef(input.vault_password) },
          externalDatabase: /DATABASE_CLIENT:\s*mysql/.test(playbookContent),
          siblingTargets: steps.filter(s => String(s.uses || '').includes('action-ansible-playbook')).length
        })
      })
    }
    if (!targets.some(t => t.file === file)) targets.push({ id: file, label: workflow.name, file, type: 'workflow', secrets: workflow.secrets, variables: workflow.variables, bindings: {} })
  }
  const deployFiles = safeList(path.join(projectPath, 'deploy'))
  const autodeployScript = deployFiles.find(n => /autodeploy.*\.sh$|.*-autodeploy\.sh$/i.test(n)) || ''
  const scriptContent = autodeployScript ? readProjectFile(projectPath, 'deploy/' + autodeployScript) : ''
  const composeFile = ['deploy/stack.yml', 'deploy/compose.yml', 'deploy/compose.yaml', 'compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].find(n => fs.existsSync(path.join(projectPath, n))) || ''
  const composeContent = composeFile ? readProjectFile(projectPath, composeFile) : ''
  const compose = composeFile ? parseYaml(composeContent, composeFile) : {}
  const envTemplate = ['deploy/server.env.example', 'deploy/.env.example', '.env.example'].find(n => fs.existsSync(path.join(projectPath, n))) || ''
  const envDefaults = envTemplate ? parseEnv(readProjectFile(projectPath, envTemplate)) : {}
  const scriptRequired = (scriptContent.match(/required_vars=\(([\s\S]*?)\)/)?.[1] || '').replace(/#.*$/gm, '').match(/\b[A-Z][A-Z0-9_]+\b/g) || []
  const generatedKeys = unique([...scriptContent.matchAll(/^([A-Z][A-Z0-9_]+)=(?!.*:-)(.+)$/gm)].filter(m => !Object.hasOwn(envDefaults, m[1])).map(m => m[1]))
  const composeKeys = [...composeContent.matchAll(/(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}/g)]
  const requiredKeys = unique([...scriptRequired, ...composeKeys.filter(m => (scriptRequired.length ? /^:?\?/.test(m[2]) : !/^:-|^-/.test(m[2])) && !generatedKeys.includes(m[1])).map(m => m[1])])
  const serverEnvKeys = unique([...Object.keys(envDefaults), ...scriptRequired, ...composeKeys.map(m => m[1]).filter(n => !generatedKeys.includes(n))])
  const envFields = serverEnvKeys.map(key => ({ key, value: isPlaceholder(envDefaults[key]) ? '' : envDefaults[key] || '', required: requiredKeys.includes(key), sensitive: isSensitive(key), placeholder: isPlaceholder(envDefaults[key]) ? envDefaults[key] : '' }))
  const envSources = []
  for (const dir of ['', 'deploy', 'deployment', 'cms', 'backend', 'frontend']) {
    for (const name of safeList(path.join(projectPath, dir))) {
      if (/^(?:\.env(?:\.[\w.-]+)?|server\.env(?:\.example)?)$/.test(name)) {
        const file = path.posix.join(dir, name)
        try { projectFile(projectPath, file); envSources.push(file) } catch { /* exclude outside symlinks */ }
      }
    }
  }
  const baseVar = scriptContent.match(/BASE_DIR="\$\{([A-Z0-9_]+):-([^}]+)\}"/)
  const remoteBase = baseVar?.[2] || '/opt/' + slug
  const nginxFile = deployFiles.includes('nginx.conf') ? 'deploy/nginx.conf' : ''
  const nginxContent = nginxFile ? readProjectFile(projectPath, nginxFile) : ''
  const mode = autodeployScript ? 'private-vpn' : 'github-direct'
  const recommendations = [autodeployScript ? 'Server pulls published images; GitHub does not need SSH access through the VPN.' : 'Choose the workflow and deployment target whose server you are preparing.']
  if (composeFile) recommendations.push('Compose: ' + composeFile)
  if (autodeployScript) recommendations.push('Existing updater: deploy/' + autodeployScript)
  if (targets.some(t => t.vaultFiles?.length)) recommendations.push('Existing Ansible Vault files detected. Use their existing password in GitHub; the app does not rotate it.')
  return {
    projectName, slug, mode, deployUser: sanitizeLinuxUser('deploy-' + slug), remoteBase,
    hasDeployDir: !!deployFiles.length, hasDeploymentDir: fs.existsSync(path.join(projectPath, 'deployment')),
    deployFiles, autodeployScript, composeFile, envTemplate, envFields, serverEnvKeys, requiredKeys, envSources,
    baseVariable: baseVar?.[1] || null, updaterLock: scriptContent.match(/LOCK_FILE="\$\{LOCK_FILE:-\$BASE_DIR\/(run\/[a-zA-Z0-9_.-]+)\}/)?.[1] || null, managesReleaseState: /STATE_FILE="\$\{STATE_FILE:-/.test(scriptContent), nginxFile,
    certificates: unique([...nginxContent.matchAll(/ssl_certificate(?:_key)?\s+([^;\s]+);/g)].map(m => m[1])),
    workflowFiles, targets, secrets: unique(workflowFiles.flatMap(w => w.secrets)), variables: unique(workflowFiles.flatMap(w => w.variables)), recommendations,
    services: Object.keys(compose.services || {}),
    envAliases: Object.fromEntries(Object.entries(compose.services || {}).map(([service, config]) => {
      const entries = Array.isArray(config.environment)
        ? config.environment.map(line => [line.split('=')[0], line.slice(line.indexOf('=') + 1)])
        : Object.entries(config.environment || {})
      return [service, Object.fromEntries(entries.map(([local, value]) => [local, String(value).match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[-?][^}]*)?\}$/)?.[1]]).filter(([, key]) => serverEnvKeys.includes(key)))]
    }))
  }
}

function importProjectEnv(projectPath, file) {
  const setup = detectDeploySetup(projectPath)
  if (!setup.envSources.includes(file)) throw new Error('Choose a detected env file inside the project')
  const values = parseEnv(readProjectFile(projectPath, file))
  const aliases = setup.envAliases[file.split('/')[0]] || {}
  const imported = {}
  for (const [key, value] of Object.entries(values)) {
    const target = aliases[key] || key
    if (setup.serverEnvKeys.includes(target)) imported[target] = value
  }
  return imported
}

function selectTarget(setup, targetId) {
  const target = setup.targets.find(t => t.id === targetId) || (!targetId && setup.targets.length === 1 ? setup.targets[0] : null)
  if (!target && setup.targets.length) throw new Error('Choose a workflow deployment target')
  return target
}
function buildInventory({ host, port, deployUser }) {
  if (!/^[a-zA-Z0-9.:[\]_-]+$/.test(host || '')) throw new Error('Invalid server host')
  const number = Number(port || 22)
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('Invalid SSH port')
  return '[prod]\nserver ansible_host=' + host + ' ansible_user=' + sanitizeLinuxUser(deployUser) + ' ansible_port=' + number + '\n'
}
function buildSecretBundle({ detectedSecrets = [], target, mode, privateKey, knownHosts, inventory, envValues = {} }) {
  const bindings = target?.bindings || {}
  const mapped = {}
  if (mode === 'github-direct') {
    if (bindings.privateKey) mapped[bindings.privateKey] = privateKey || ''
    if (bindings.knownHosts) mapped[bindings.knownHosts] = knownHosts || ''
    if (bindings.inventory) mapped[bindings.inventory] = inventory || ''
  }
  return unique(detectedSecrets).filter(n => n !== 'GITHUB_TOKEN').map(name => {
    const value = mapped[name] ?? envValues[name] ?? ''
    let description = 'Project secret used by the selected workflow.'
    if (name === bindings.vault || /^ANSIBLE_VAU?L[ET]*T?/.test(name)) description = 'Existing Ansible Vault password used to encrypt the repository vars. Do not replace it with a new password.'
    else if (name === bindings.privateKey) description = 'Deploy SSH private key. Install the same public key on every server that shares this GitHub secret.'
    else if (name === bindings.inventory) description = 'Inventory for this selected server only.'
    else if (name === bindings.knownHosts) description = 'SSH host keys from the selected server.'
    else if (/DOCKER_PASSWORD/.test(name)) description = 'Docker Hub access token with permissions needed by the build.'
    else if (/TELEGRAM/.test(name)) description = 'Notification credential; optional if the workflow skips empty values.'
    return { name, value, generated: Object.hasOwn(mapped, name), detected: true, description }
  })
}
function generateEnvSecrets(keys) {
  const result = {}
  for (const key of keys) {
    if (key === 'APP_KEYS') result[key] = Array.from({ length: 4 }, () => crypto.randomBytes(24).toString('base64')).join(',')
    else if (/^(?:POSTGRES_PASSWORD|API_TOKEN_SALT|ADMIN_JWT_SECRET|TRANSFER_TOKEN_SALT|JWT_SECRET|ENCRYPTION_KEY)$/.test(key)) result[key] = crypto.randomBytes(32).toString('hex')
  }
  return result
}
module.exports = { importProjectEnv, detectDeploySetup, selectTarget, buildInventory, buildSecretBundle, sanitizeSlug, sanitizeLinuxUser, parseEnv, serializeEnv, shellQuote, readProjectFile, projectFile, isPlaceholder, generateEnvSecrets }
