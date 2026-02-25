const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')
const net = require('net')
const yaml = require('js-yaml')
const { autoUpdater } = require('electron-updater')
const { Client: SSHClient } = require('ssh2')

app.commandLine.appendSwitch('no-sandbox')
app.disableHardwareAcceleration()
Menu.setApplicationMenu(null)

let mainWindow

// --- Docker Detection ---

function isDockerAvailable() {
  try {
    execSync('docker --version', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' })
    return true
  } catch { return false }
}

// Returns { cmd, prefixArgs } for docker compose prefix, or null if not available
function getDockerComposeCmd() {
  // Prefer docker compose plugin (no hyphen)
  try {
    execSync('docker compose version', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' })
    return { cmd: 'docker', prefixArgs: ['compose'] }
  } catch {}
  // Fallback to docker-compose standalone
  try {
    execSync('docker-compose --version', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' })
    return { cmd: 'docker-compose', prefixArgs: [] }
  } catch {}
  return null
}

// WSL-context-aware versions: if projectPath is a WSL path on Windows,
// run detection commands inside the WSL distro instead of on the host
function isDockerAvailableInContext(projectPath) {
  if (process.platform === 'win32' && isWslPath(projectPath)) {
    const parsed = parseWslPath(projectPath)
    if (!parsed) return false
    try {
      execSync(
        `wsl.exe -d ${parsed.distro} -- bash -lic "docker --version"`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      )
      return true
    } catch { return false }
  }
  return isDockerAvailable()
}

function getDockerComposeCmdInContext(projectPath) {
  if (process.platform === 'win32' && isWslPath(projectPath)) {
    const parsed = parseWslPath(projectPath)
    if (!parsed) return null
    try {
      execSync(
        `wsl.exe -d ${parsed.distro} -- bash -lic "docker compose version"`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      )
      return { cmd: 'docker', prefixArgs: ['compose'] }
    } catch {}
    try {
      execSync(
        `wsl.exe -d ${parsed.distro} -- bash -lic "docker-compose --version"`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      )
      return { cmd: 'docker-compose', prefixArgs: [] }
    } catch {}
    return null
  }
  return getDockerComposeCmd()
}

// --- WSL Support ---

const isRunningInsideWsl = (() => {
  try {
    if (process.platform !== 'linux') return false
    const version = fs.readFileSync('/proc/version', 'utf-8')
    return /microsoft|wsl/i.test(version)
  } catch { return false }
})()

let wslHostIp = null
if (isRunningInsideWsl) {
  try {
    wslHostIp = execSync('hostname -I', { encoding: 'utf-8', timeout: 2000 }).trim().split(' ')[0] || null
    console.log('[DevScanner] Running inside WSL, host IP:', wslHostIp)
  } catch { /* ok */ }
}

function isWslPath(p) {
  return process.platform === 'win32' && /^\\\\wsl/i.test(p)
}

function parseWslPath(p) {
  // \\wsl$\Ubuntu\home\user → { distro: 'Ubuntu', linuxPath: '/home/user' }
  // \\wsl.localhost\Ubuntu\home\user → same
  const match = p.match(/^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(.*)/i)
  if (!match) return null
  return {
    distro: match[1],
    linuxPath: match[2].replace(/\\/g, '/') || '/'
  }
}

function shellQuote(s) {
  if (/^[a-zA-Z0-9._\-\/=:@]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

function execInContext(command, options) {
  if (options.cwd && isWslPath(options.cwd)) {
    const parsed = parseWslPath(options.cwd)
    if (parsed) {
      // Use bash -lic to get login shell with proper PATH (nvm, etc.)
      const escaped = command.replace(/"/g, '\\"')
      return execSync(
        `wsl.exe -d ${parsed.distro} --cd "${parsed.linuxPath}" -- bash -lic "${escaped}"`,
        { ...options, cwd: undefined }
      )
    }
  }
  return execSync(command, options)
}

function spawnInContext(command, args, options) {
  if (options?.cwd && isWslPath(options.cwd)) {
    const parsed = parseWslPath(options.cwd)
    if (parsed) {
      // Build command string for bash -lic (login shell for proper PATH)
      const envPrefix = []
      if (options.env) {
        for (const [k, v] of Object.entries(options.env)) {
          if (process.env[k] !== v) envPrefix.push(`export ${k}=${shellQuote(v)}`)
        }
      }
      const cmdParts = [command, ...args.map(shellQuote)]
      const fullCmd = envPrefix.length > 0
        ? envPrefix.join(' && ') + ' && ' + cmdParts.join(' ')
        : cmdParts.join(' ')

      const wslArgs = ['-d', parsed.distro, '--cd', parsed.linuxPath, '--', 'bash', '-lic', fullCmd]
      return spawn('wsl.exe', wslArgs, {
        ...options, cwd: undefined, env: undefined, shell: false
      })
    }
  }
  return spawn(command, args, options)
}

// --- SSH Connection Pool ---

const sshConnections = new Map() // serverId -> { client, ready }

function sshExec(client, cmd, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSH command timeout')), timeout)
    client.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err) }
      let stdout = '', stderr = ''
      stream.on('data', (data) => { stdout += data.toString() })
      stream.stderr.on('data', (data) => { stderr += data.toString() })
      stream.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code })
      })
    })
  })
}

function connectSSH(serverConfig) {
  return new Promise((resolve, reject) => {
    const client = new SSHClient()
    const connectOpts = {
      host: serverConfig.host,
      port: serverConfig.port || 22,
      username: serverConfig.username,
      readyTimeout: 15000
    }

    if (serverConfig.authType === 'key') {
      if (serverConfig.privateKeyPath) {
        try {
          connectOpts.privateKey = fs.readFileSync(serverConfig.privateKeyPath)
        } catch (e) {
          return reject(new Error(`Cannot read private key: ${e.message}`))
        }
      } else if (serverConfig.privateKey) {
        connectOpts.privateKey = serverConfig.privateKey
      }
      if (serverConfig.passphrase) {
        connectOpts.passphrase = serverConfig.passphrase
      }
    } else {
      // Password auth
      let password = serverConfig.password || ''
      if (serverConfig.encryptedPassword && safeStorage.isEncryptionAvailable()) {
        try {
          password = safeStorage.decryptString(Buffer.from(serverConfig.encryptedPassword, 'base64'))
        } catch { /* use raw password */ }
      }
      connectOpts.password = password
    }

    client.on('ready', () => {
      sshConnections.set(serverConfig.id, { client, ready: true })
      resolve(client)
    })
    client.on('error', (err) => {
      sshConnections.delete(serverConfig.id)
      reject(err)
    })
    client.on('close', () => {
      sshConnections.delete(serverConfig.id)
    })
    client.connect(connectOpts)
  })
}

function disconnectSSH(serverId) {
  const conn = sshConnections.get(serverId)
  if (conn) {
    try { conn.client.end() } catch { /* already closed */ }
    sshConnections.delete(serverId)
  }
}

function getSSHClient(serverId) {
  const conn = sshConnections.get(serverId)
  return conn?.ready ? conn.client : null
}

// --- SSH Discovery Functions ---

async function discoverServerOS(client) {
  try {
    const { stdout } = await sshExec(client, 'cat /etc/os-release 2>/dev/null || echo "ID=unknown"')
    const info = { name: 'Unknown', id: 'unknown', version: '' }
    for (const line of stdout.split('\n')) {
      const [key, ...rest] = line.split('=')
      const val = rest.join('=').replace(/^"|"$/g, '')
      if (key === 'PRETTY_NAME') info.name = val
      else if (key === 'ID') info.id = val
      else if (key === 'VERSION_ID') info.version = val
    }
    return info
  } catch { return { name: 'Unknown', id: 'unknown', version: '' } }
}

async function discoverDockerContainers(client) {
  try {
    const { stdout, code } = await sshExec(client, 'docker ps -a --format \'{{json .}}\' 2>/dev/null')
    if (code !== 0 || !stdout.trim()) return []
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

async function discoverPM2Processes(client) {
  try {
    const { stdout, code } = await sshExec(client, 'pm2 jlist 2>/dev/null')
    if (code !== 0 || !stdout.trim()) return []
    try { return JSON.parse(stdout) } catch { return [] }
  } catch { return [] }
}

async function discoverScreenSessions(client) {
  try {
    const { stdout } = await sshExec(client, 'screen -ls 2>/dev/null')
    const sessions = []
    for (const line of stdout.split('\n')) {
      const m = line.match(/\t(\S+)\s+\((\w+)\)/)
      if (m) sessions.push({ name: m[1], state: m[2] })
    }
    return sessions
  } catch { return [] }
}

async function discoverSystemdServices(client) {
  try {
    const filter = 'nginx|apache|httpd|php-fpm|mysql|mariadb|postgres|redis|mongodb|mongod|node|pm2|docker|supervisord|gunicorn|uvicorn|memcached|rabbitmq|elasticsearch'
    const { stdout } = await sshExec(client,
      `systemctl list-units --type=service --no-pager --no-legend 2>/dev/null | grep -iE '${filter}'`
    )
    if (!stdout.trim()) return []
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/)
      return {
        unit: parts[0] || '',
        load: parts[1] || '',
        active: parts[2] || '',
        sub: parts[3] || '',
        description: parts.slice(4).join(' ')
      }
    })
  } catch { return [] }
}

async function discoverNginxSites(client) {
  try {
    const { stdout } = await sshExec(client,
      'cat /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null'
    )
    if (!stdout.trim()) return []
    const sites = []
    let current = null
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (/^server\s*\{/.test(trimmed)) {
        current = { serverName: '', root: '', proxyPass: '' }
      }
      if (current) {
        const snMatch = trimmed.match(/server_name\s+(.+);/)
        if (snMatch) current.serverName = snMatch[1]
        const rootMatch = trimmed.match(/root\s+(.+);/)
        if (rootMatch) current.root = rootMatch[1]
        const ppMatch = trimmed.match(/proxy_pass\s+(.+);/)
        if (ppMatch) current.proxyPass = ppMatch[1]
        if (trimmed === '}' && current.serverName) {
          sites.push({ ...current })
          current = null
        }
      }
    }
    return sites
  } catch { return [] }
}

async function discoverListeningPorts(client) {
  try {
    const { stdout } = await sshExec(client, 'ss -tlnp 2>/dev/null')
    if (!stdout.trim()) return []
    const results = []
    const lines = stdout.split('\n').slice(1) // skip header
    for (const line of lines) {
      if (!line.trim()) continue
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5) continue
      const localAddr = parts[3]
      const lastColon = localAddr.lastIndexOf(':')
      if (lastColon === -1) continue
      const address = localAddr.substring(0, lastColon)
      const port = parseInt(localAddr.substring(lastColon + 1), 10)
      if (isNaN(port)) continue
      let processName = '', pid = null
      const processCol = parts.slice(5).join(' ')
      const pidMatch = processCol.match(/pid=(\d+)/)
      const nameMatch = processCol.match(/\("([^"]+)"/)
      if (pidMatch) pid = parseInt(pidMatch[1], 10)
      if (nameMatch) processName = nameMatch[1]
      results.push({ port, address, processName, pid })
    }
    return results
  } catch { return [] }
}

async function discoverProjectRoots(client) {
  try {
    const { stdout } = await sshExec(client,
      'find /var/www /home /srv /opt -maxdepth 3 \\( ' +
      '-name package.json -o -name requirements.txt -o -name composer.json ' +
      '-o -name go.mod -o -name Cargo.toml -o -name Gemfile -o -name pom.xml ' +
      '\\) -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null',
      20000
    )
    if (!stdout.trim()) return []
    const dirMap = {}
    for (const filePath of stdout.trim().split('\n').filter(Boolean)) {
      const dir = filePath.substring(0, filePath.lastIndexOf('/'))
      const manifest = filePath.substring(filePath.lastIndexOf('/') + 1)
      if (!dirMap[dir]) dirMap[dir] = []
      dirMap[dir].push(manifest)
    }
    return Object.entries(dirMap).map(([p, manifests]) => ({ path: p, manifests }))
  } catch { return [] }
}

function generateServerTags(discovery) {
  const tags = []
  if (discovery.docker?.length > 0) tags.push('Docker')
  if (discovery.pm2?.length > 0) tags.push('PM2')
  if (discovery.screen?.length > 0) tags.push('screen')
  if (discovery.nginx?.length > 0) tags.push('nginx')
  const systemd = discovery.systemd || []
  if (systemd.some(s => /php-fpm/i.test(s.unit))) tags.push('PHP')
  if (systemd.some(s => /mysql|mariadb/i.test(s.unit))) tags.push('MySQL')
  if (systemd.some(s => /postgres/i.test(s.unit))) tags.push('PostgreSQL')
  if (systemd.some(s => /redis/i.test(s.unit))) tags.push('Redis')
  if (systemd.some(s => /mongodb|mongod/i.test(s.unit))) tags.push('MongoDB')
  if (systemd.some(s => /apache|httpd/i.test(s.unit))) tags.push('Apache')
  if (systemd.some(s => /node/i.test(s.unit))) tags.push('Node.js')
  const projects = discovery.projects || []
  if (projects.some(p => p.manifests.includes('package.json')) && !tags.includes('Node.js')) tags.push('Node.js')
  if (projects.some(p => p.manifests.includes('requirements.txt'))) tags.push('Python')
  if (projects.some(p => p.manifests.includes('composer.json')) && !tags.includes('PHP')) tags.push('PHP')
  if (projects.some(p => p.manifests.includes('go.mod'))) tags.push('Go')
  return tags
}

// --- Settings Persistence ---

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    const data = fs.readFileSync(getSettingsPath(), 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

function saveSettings(settings) {
  try {
    const current = loadSettings()
    const merged = { ...current, ...settings }
    fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8')
  } catch {
    // silently fail
  }
}
// --- Notifications & Badge ---

function updateBadgeCount() {
  let count = 0
  for (const [, instances] of runningProcesses) count += instances.size
  try { app.setBadgeCount(count) } catch { /* not supported on all platforms */ }
}

function devNotify(title, body, silent = false) {
  if (!Notification.isSupported()) return
  try { new Notification({ title, body, silent }).show() } catch { /* ignore */ }
}

// Map<projectPath, Map<instanceId, ProcessEntry>>
const runningProcesses = new Map()

function getProcessEntry(projectPath, instanceId) {
  const instances = runningProcesses.get(projectPath)
  return instances ? instances.get(instanceId) : undefined
}

function setProcessEntry(projectPath, instanceId, entry) {
  if (!runningProcesses.has(projectPath)) {
    runningProcesses.set(projectPath, new Map())
  }
  runningProcesses.get(projectPath).set(instanceId, entry)
}

function deleteProcessEntry(projectPath, instanceId) {
  const instances = runningProcesses.get(projectPath)
  if (!instances) return
  instances.delete(instanceId)
  if (instances.size === 0) runningProcesses.delete(projectPath)
}

function createWindow() {
  console.log('Creating BrowserWindow...')
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.on('maximize', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window-maximized', true)
  })
  mainWindow.on('unmaximize', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window-maximized', false)
  })

  const isDev = !app.isPackaged
  const devPort = process.env.PORT || '5173'
  if (isDev) {
    console.log(`Dev mode: loading http://localhost:${devPort}`)
    mainWindow.loadURL(`http://localhost:${devPort}`)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    console.log('Window ready-to-show, focusing...')
    mainWindow.show()
    mainWindow.focus()
  })
}

// --- Window Controls ---

ipcMain.handle('window-minimize', () => mainWindow?.minimize())
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window-close', () => mainWindow?.close())
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false)

// --- Project Analysis ---

const SOURCE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs',
  '.php', '.rb', '.java', '.kt', '.cs'
])

const EXCLUDED_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.git', '__pycache__',
  'venv', '.venv', 'env', '.env', '.tox', '.mypy_cache', '.pytest_cache',
  'target', '.next', '.nuxt', 'coverage', '.cache'
])

const FRAMEWORK_PORT_MAP = {
  'Next.js': 3000,
  'Vite': 5173,
  'Vue': 8080,
  'Nuxt': 8080,
  'Strapi': 1337,
  'Express': 3000,
  'NestJS': 3000,
  'Fastify': 3000,
  'Rails': 3000,
  'React': 3000,
  'Django': 8000,
  'FastAPI': 8000,
  'Flask': 5000,
  'Spring Boot': 8080,
  '.NET': 5000,
  'Laravel': 8000
}

const LANGUAGE_PORT_MAP = {
  'Go': 8080,
  'Java': 8080,
  'Kotlin': 8080,
  'PHP': 8000,
  'C#': 5000
}

function countSourceFiles(dir, depth = 0, maxDepth = 4) {
  if (depth >= maxDepth) return 0
  let count = 0
  try {
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry)) continue
      const fullPath = path.join(dir, entry)
      try {
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          count += countSourceFiles(fullPath, depth + 1, maxDepth)
        } else if (stat.isFile()) {
          const ext = path.extname(entry).toLowerCase()
          if (SOURCE_EXTENSIONS.has(ext)) count++
        }
      } catch {
        // skip inaccessible entries
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return count
}

function getGitInfo(projectPath) {
  try {
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) return null

    // Single command: branch on line 1, commit count on line 2
    const output = execInContext(
      'git rev-parse --abbrev-ref HEAD && git rev-list --count HEAD',
      { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
    ).trim()

    const lines = output.split('\n')
    const branch = lines[0]?.trim() || 'unknown'
    const commits = parseInt(lines[1]?.trim(), 10)

    return { branch, commits: isNaN(commits) ? 0 : commits }
  } catch {
    return null
  }
}

function detectLanguagesAndFrameworks(projectPath, entries) {
  const languages = []
  const frameworks = []

  // package.json detection
  if (entries.includes('package.json')) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8')
      )
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      }

      if (!languages.includes('JavaScript')) languages.push('JavaScript')

      // TypeScript detection
      if (
        allDeps.typescript ||
        entries.includes('tsconfig.json')
      ) {
        if (!languages.includes('TypeScript')) languages.push('TypeScript')
      }

      // Framework detection from deps
      if (allDeps.next) frameworks.push('Next.js')
      if (allDeps.vite) frameworks.push('Vite')
      if (allDeps['react-scripts']) frameworks.push('React')
      if (allDeps.vue) frameworks.push('Vue')
      if (allDeps.nuxt) frameworks.push('Nuxt')
      if (allDeps.express) frameworks.push('Express')
      if (allDeps.fastify) frameworks.push('Fastify')
      if (allDeps['@nestjs/core']) frameworks.push('NestJS')
      if (allDeps['@sveltejs/kit']) frameworks.push('SvelteKit')
      if (allDeps.svelte && !allDeps['@sveltejs/kit']) frameworks.push('Svelte')
      if (allDeps.strapi) frameworks.push('Strapi')
      if (allDeps.electron) frameworks.push('Electron')

      // React detection (if react present but no react-scripts/next/vite)
      if (
        allDeps.react &&
        !allDeps['react-scripts'] &&
        !allDeps.next &&
        !frameworks.includes('Vue') &&
        !frameworks.includes('Svelte') &&
        !frameworks.includes('SvelteKit')
      ) {
        if (!frameworks.includes('React')) frameworks.push('React')
      }
    } catch {
      // malformed package.json - skip
      if (!languages.includes('JavaScript')) languages.push('JavaScript')
    }
  }

  // requirements.txt detection
  if (entries.includes('requirements.txt')) {
    if (!languages.includes('Python')) languages.push('Python')
    try {
      const content = fs.readFileSync(
        path.join(projectPath, 'requirements.txt'),
        'utf-8'
      ).toLowerCase()
      if (content.includes('django')) frameworks.push('Django')
      if (content.includes('flask')) frameworks.push('Flask')
      if (content.includes('fastapi')) frameworks.push('FastAPI')
    } catch {
      // skip
    }
  }

  // pyproject.toml / setup.py
  if (entries.includes('pyproject.toml') || entries.includes('setup.py')) {
    if (!languages.includes('Python')) languages.push('Python')
  }

  // go.mod
  if (entries.includes('go.mod')) {
    if (!languages.includes('Go')) languages.push('Go')
  }

  // Cargo.toml
  if (entries.includes('Cargo.toml')) {
    if (!languages.includes('Rust')) languages.push('Rust')
  }

  // composer.json
  if (entries.includes('composer.json')) {
    if (!languages.includes('PHP')) languages.push('PHP')
    try {
      const composer = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'composer.json'), 'utf-8')
      )
      const require = composer.require || {}
      if (require['laravel/framework']) frameworks.push('Laravel')
    } catch {
      // skip
    }
  }

  // Gemfile
  if (entries.includes('Gemfile')) {
    if (!languages.includes('Ruby')) languages.push('Ruby')
    try {
      const content = fs.readFileSync(
        path.join(projectPath, 'Gemfile'),
        'utf-8'
      ).toLowerCase()
      if (content.includes('rails')) frameworks.push('Rails')
    } catch {
      // skip
    }
  }

  // pom.xml
  if (entries.includes('pom.xml')) {
    if (!languages.includes('Java')) languages.push('Java')
    frameworks.push('Spring Boot')
  }

  // build.gradle / build.gradle.kts
  if (entries.includes('build.gradle') || entries.includes('build.gradle.kts')) {
    if (!languages.includes('Java')) languages.push('Java')
    if (entries.includes('build.gradle.kts') && !languages.includes('Kotlin')) {
      languages.push('Kotlin')
    }
  }

  // *.csproj
  if (entries.some(e => e.endsWith('.csproj'))) {
    if (!languages.includes('C#')) languages.push('C#')
    if (!frameworks.includes('.NET')) frameworks.push('.NET')
  }

  return { languages, frameworks }
}

function getDefaultPort(frameworks, languages) {
  for (const fw of frameworks) {
    if (FRAMEWORK_PORT_MAP[fw] !== undefined) return FRAMEWORK_PORT_MAP[fw]
  }
  for (const lang of languages) {
    if (LANGUAGE_PORT_MAP[lang] !== undefined) return LANGUAGE_PORT_MAP[lang]
  }
  return 3000
}

const MANIFEST_FILES = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'setup.py',
  'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile',
  'pom.xml', 'build.gradle', 'build.gradle.kts'
]

function analyzeSubprojects(projectPath, entries, depth = 0, maxDepth = 2) {
  const subprojects = []
  const aggregatedLanguages = new Set()
  const aggregatedFrameworks = new Set()

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue
    const childPath = path.join(projectPath, entry)
    try {
      const stat = fs.statSync(childPath)
      if (!stat.isDirectory()) continue
      const childEntries = fs.readdirSync(childPath)

      const hasChildManifest =
        MANIFEST_FILES.some(m => childEntries.includes(m)) ||
        childEntries.some(e => e.endsWith('.csproj'))

      const hasChildDocker =
        childEntries.includes('Dockerfile') ||
        childEntries.includes('docker-compose.yml') ||
        childEntries.includes('docker-compose.yaml')

      if (hasChildManifest || hasChildDocker) {
        const { languages, frameworks } = detectLanguagesAndFrameworks(childPath, childEntries)
        languages.forEach(l => aggregatedLanguages.add(l))
        frameworks.forEach(f => aggregatedFrameworks.add(f))

        let hasNpm = false
        if (childEntries.includes('package.json')) {
          try {
            const pkg = JSON.parse(
              fs.readFileSync(path.join(childPath, 'package.json'), 'utf-8')
            )
            hasNpm = pkg.scripts && Object.keys(pkg.scripts).length > 0
          } catch {
            hasNpm = false
          }
        }

        // Relative name shows nesting: "admin/frontend" instead of just "frontend"
        const relativeName = depth > 0
          ? path.relative(path.dirname(projectPath), childPath).split(path.sep).slice(1).join('/')
          : entry

        subprojects.push({
          name: relativeName,
          path: childPath,
          languages,
          frameworks,
          hasNpm,
          hasDocker: hasChildDocker
        })
      }

      // Recurse deeper to find nested subprojects (e.g. admin/frontend/)
      if (depth < maxDepth - 1) {
        const nested = analyzeSubprojects(childPath, childEntries, depth + 1, maxDepth)
        nested.subprojects?.forEach(sp => {
          // Prefix name with parent dir
          const prefixedName = `${entry}/${sp.name}`
          sp.name = prefixedName
          subprojects.push(sp)
          sp.languages.forEach(l => aggregatedLanguages.add(l))
          sp.frameworks.forEach(f => aggregatedFrameworks.add(f))
        })
      }
    } catch {
      // skip inaccessible entries
    }
  }

  return {
    aggregatedLanguages: [...aggregatedLanguages],
    aggregatedFrameworks: [...aggregatedFrameworks],
    subprojects: subprojects.length > 0 ? subprojects : null
  }
}

function parseDockerCompose(projectPath) {
  const composeFile =
    fs.existsSync(path.join(projectPath, 'docker-compose.yml'))
      ? path.join(projectPath, 'docker-compose.yml')
      : fs.existsSync(path.join(projectPath, 'docker-compose.yaml'))
        ? path.join(projectPath, 'docker-compose.yaml')
        : null

  if (!composeFile) return null

  try {
    const content = fs.readFileSync(composeFile, 'utf-8')
    const doc = yaml.load(content)
    if (!doc) return null

    const services = doc.services || {}
    const result = []

    for (const [name, config] of Object.entries(services)) {
      const service = {
        name,
        image: config.image || null,
        build: null,
        ports: [],
        dependsOn: [],
        environment: [],
        volumes: []
      }

      // Parse build context
      if (config.build) {
        if (typeof config.build === 'string') {
          service.build = config.build
        } else if (config.build.context) {
          service.build = config.build.context
          if (config.build.dockerfile) {
            service.build += ` (${config.build.dockerfile})`
          }
        }
      }

      // Parse port mappings
      if (config.ports) {
        for (const portDef of config.ports) {
          const portStr = String(portDef)
          // Formats: "8080:8080", "8080:8080/tcp", "127.0.0.1:8080:8080", "8080"
          const parts = portStr.replace(/\/\w+$/, '').split(':')
          if (parts.length === 3) {
            service.ports.push({ host: parseInt(parts[1], 10), container: parseInt(parts[2], 10), bind: parts[0] })
          } else if (parts.length === 2) {
            service.ports.push({ host: parseInt(parts[0], 10), container: parseInt(parts[1], 10), bind: '0.0.0.0' })
          } else if (parts.length === 1) {
            const p = parseInt(parts[0], 10)
            service.ports.push({ host: p, container: p, bind: '0.0.0.0' })
          }
        }
      }

      // Parse environment
      if (config.environment) {
        if (Array.isArray(config.environment)) {
          service.environment = config.environment.map(e => {
            const idx = String(e).indexOf('=')
            if (idx === -1) return { key: String(e), value: '' }
            return { key: String(e).substring(0, idx), value: String(e).substring(idx + 1) }
          })
        } else if (typeof config.environment === 'object') {
          service.environment = Object.entries(config.environment).map(([k, v]) => ({ key: k, value: String(v ?? '') }))
        }
      }

      // Parse depends_on
      if (config.depends_on) {
        if (Array.isArray(config.depends_on)) {
          service.dependsOn = config.depends_on
        } else if (typeof config.depends_on === 'object') {
          service.dependsOn = Object.keys(config.depends_on)
        }
      }

      result.push(service)
    }

    return result.length > 0 ? result : null
  } catch {
    return null
  }
}

function detectEnvFiles(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath)
    const envFiles = entries.filter(e => {
      if (!e.startsWith('.env')) return false
      try {
        return fs.statSync(path.join(dirPath, e)).isFile()
      } catch { return false }
    })
    envFiles.sort((a, b) => {
      if (a === '.env') return -1
      if (b === '.env') return 1
      if (a === '.env.example') return -1
      if (b === '.env.example') return 1
      return a.localeCompare(b)
    })
    return envFiles
  } catch { return [] }
}

function analyzeProject(projectPath) {
  try {
    const entries = fs.readdirSync(projectPath)

    const hasManifest =
      MANIFEST_FILES.some(m => entries.includes(m)) ||
      entries.some(e => e.endsWith('.csproj'))

    const hasDocker =
      entries.includes('Dockerfile') ||
      entries.includes('docker-compose.yml') ||
      entries.includes('docker-compose.yaml')

    let hasNpm = false
    if (entries.includes('package.json')) {
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8')
        )
        hasNpm = pkg.scripts && Object.keys(pkg.scripts).length > 0
      } catch {
        hasNpm = false
      }
    }

    let languages = [], frameworks = [], subprojects = null

    if (hasManifest) {
      const detected = detectLanguagesAndFrameworks(projectPath, entries)
      languages = detected.languages
      frameworks = detected.frameworks
    }

    // Always scan for subprojects (monorepo support)
    const sub = analyzeSubprojects(projectPath, entries)
    subprojects = sub.subprojects

    // Skip if nothing found at all (no manifest, no docker, no subprojects)
    if (!hasManifest && !hasDocker && !subprojects) return null

    // Merge subproject languages/frameworks into root
    if (!hasManifest) {
      languages = sub.aggregatedLanguages
      frameworks = sub.aggregatedFrameworks
    } else if (subprojects) {
      const langSet = new Set(languages)
      const fwSet = new Set(frameworks)
      sub.aggregatedLanguages.forEach(l => langSet.add(l))
      sub.aggregatedFrameworks.forEach(f => fwSet.add(f))
      languages = [...langSet]
      frameworks = [...fwSet]
    }

    const launchMethods = []
    if (hasNpm) launchMethods.push('npm')
    if (subprojects && subprojects.some(s => s.hasNpm)) launchMethods.push('npm')
    if (hasDocker) launchMethods.push('docker')
    if (subprojects && subprojects.some(s => s.hasDocker)) launchMethods.push('docker')
    // Deduplicate
    const uniqueMethods = [...new Set(launchMethods)]

    let type = 'unknown'
    if (!hasManifest && !hasDocker && subprojects) type = 'monorepo'
    else if (!hasManifest && hasDocker) type = 'docker-compose'
    else if (entries.includes('package.json')) type = 'node'
    else if (entries.includes('requirements.txt') || entries.includes('pyproject.toml') || entries.includes('setup.py')) type = 'python'
    else if (entries.includes('go.mod')) type = 'go'
    else if (entries.includes('Cargo.toml')) type = 'rust'
    else if (entries.includes('composer.json')) type = 'php'
    else if (entries.includes('Gemfile')) type = 'ruby'
    else if (entries.includes('pom.xml') || entries.includes('build.gradle') || entries.includes('build.gradle.kts')) type = 'java'
    else if (entries.some(e => e.endsWith('.csproj'))) type = 'dotnet'

    const defaultPort = getDefaultPort(frameworks, languages)
    const git = getGitInfo(projectPath)
    const sourceFiles = countSourceFiles(projectPath)

    // Parse docker-compose services
    const dockerServices = hasDocker ? parseDockerCompose(projectPath) : null

    // Detect .env files in project root
    const envFiles = detectEnvFiles(projectPath)

    // Collect env files from subprojects
    let subprojectEnvFiles = null
    if (subprojects) {
      const collected = {}
      for (const sp of subprojects) {
        const spEnv = detectEnvFiles(sp.path)
        if (spEnv.length > 0) {
          collected[sp.name] = { path: sp.path, files: spEnv }
        }
      }
      if (Object.keys(collected).length > 0) subprojectEnvFiles = collected
    }

    return {
      name: path.basename(projectPath),
      path: projectPath,
      type,
      languages,
      frameworks,
      hasDocker,
      hasNpm,
      defaultPort,
      launchMethods: uniqueMethods,
      git,
      stats: { sourceFiles },
      subprojects,
      dockerServices,
      envFiles,
      subprojectEnvFiles
    }
  } catch {
    return null
  }
}

// --- IPC Handlers ---

ipcMain.handle('select-folder', async () => {
  try {
    const settings = loadSettings()
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath: settings.lastFolder || undefined
    })
    console.log('Dialog result:', result)
    if (result.canceled || result.filePaths.length === 0) return null
    const selected = result.filePaths[0]
    saveSettings({ lastFolder: selected })
    return selected
  } catch (err) {
    console.error('select-folder error:', err)
    return null
  }
})

ipcMain.handle('scan-folder', async (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) {
      return { success: false, error: 'Folder not found or inaccessible' }
    }

    const entries = fs.readdirSync(folderPath)
    const projects = []

    for (const entry of entries) {
      const childPath = path.join(folderPath, entry)
      try {
        const stat = fs.statSync(childPath)
        if (!stat.isDirectory()) continue
        const project = analyzeProject(childPath)
        if (project) projects.push(project)
      } catch {
        // skip inaccessible entries
      }
    }

    return { success: true, data: projects }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('launch-project', async (event, { projectPath, port, method, instanceId, subprojectPath, dockerServices: requestedServices, background }) => {
  try {
    const portNum = parseInt(port, 10)
    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      return { success: false, error: 'Port must be an integer between 1024 and 65535' }
    }

    if (getProcessEntry(projectPath, instanceId)) {
      return { success: false, error: `Instance "${instanceId}" is already running` }
    }

    let proc
    // For npm in monorepo, use subprojectPath as cwd
    const npmCwd = subprojectPath || projectPath

    if (method === 'npm') {
      let scriptName = null
      let scriptCmd = ''
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(npmCwd, 'package.json'), 'utf-8')
        )
        const scripts = pkg.scripts || {}
        const priority = ['dev', 'start', 'serve']
        for (const s of priority) {
          if (scripts[s]) { scriptName = s; scriptCmd = scripts[s]; break }
        }
        if (!scriptName) {
          const keys = Object.keys(scripts)
          if (keys.length > 0) { scriptName = keys[0]; scriptCmd = scripts[keys[0]] }
        }
      } catch {
        return { success: false, error: 'Failed to read package.json scripts' }
      }

      if (!scriptName) {
        return { success: false, error: 'No npm scripts found in package.json' }
      }

      // Detect tool to pass correct flags
      const isVite = /\bvite\b/.test(scriptCmd)
      const isNext = /\bnext\b/.test(scriptCmd)

      const useWsl = isWslPath(npmCwd)
      // When the project is in WSL (accessed from Windows), or DevScanner itself
      // runs inside WSL, add --host 0.0.0.0 so the dev server binds to all
      // interfaces — required for WSL2 port proxy to forward the port to Windows.
      const needsHost = isRunningInsideWsl || useWsl

      const npmCmd = process.platform === 'win32' && !useWsl ? 'npm.cmd' : 'npm'
      const npmArgs = ['run', scriptName, '--']
      if (isVite) {
        npmArgs.push('--port', String(portNum))
        if (needsHost) npmArgs.push('--host', '0.0.0.0')
      } else if (isNext) {
        npmArgs.push('-p', String(portNum))
        // Next.js uses -H for host
        if (needsHost) npmArgs.push('-H', '0.0.0.0')
      } else {
        npmArgs.push('--port', String(portNum))
        // Generic fallback — PORT env var below handles most other frameworks
      }
      console.log('[DevScanner] npm launch:', npmCmd, npmArgs.join(' '), '| cwd:', npmCwd, '| script:', scriptCmd)
      proc = spawnInContext(npmCmd, npmArgs, {
        cwd: npmCwd,
        env: {
          ...process.env,
          PORT: String(portNum),
          // HOST env var: used by many frameworks (Express, Fastify, etc.)
          // 0.0.0.0 = bind all interfaces so WSL2 port proxy can forward to Windows
          ...(needsHost ? { HOST: '0.0.0.0' } : {})
        },
        shell: process.platform === 'win32' && !useWsl
      })
    } else if (method === 'docker') {
      const hasCompose =
        fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
        fs.existsSync(path.join(projectPath, 'docker-compose.yaml'))

      if (hasCompose) {
        const composeCmd = getDockerComposeCmdInContext(projectPath)
        if (!composeCmd) {
          return { success: false, error: 'Docker Compose not found. Install docker compose plugin (docker compose) or standalone docker-compose.' }
        }
        // Support launching specific services or all; -d for background
        const args = [...composeCmd.prefixArgs, 'up']
        if (background) args.push('-d')
        if (requestedServices && requestedServices.length > 0) {
          args.push(...requestedServices)
        }
        proc = spawnInContext(composeCmd.cmd, args, {
          cwd: projectPath,
          shell: process.platform === 'win32' && !isWslPath(projectPath)
        })
      } else {
        const imageName = `devscanner-${path.basename(projectPath).toLowerCase()}`
        const buildProc = spawnInContext('docker', ['build', '-t', imageName, '.'], {
          cwd: projectPath,
          shell: process.platform === 'win32' && !isWslPath(projectPath)
        })

        buildProc.stdout.on('data', (chunk) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('project-log', {
              projectPath,
              instanceId,
              data: stripAnsi(chunk.toString())
            })
          }
        })

        buildProc.stderr.on('data', (chunk) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('project-log', {
              projectPath,
              instanceId,
              data: stripAnsi(chunk.toString())
            })
          }
        })

        return new Promise((resolve) => {
          buildProc.on('close', (code) => {
            if (code !== 0) {
              resolve({ success: false, error: `Docker build failed with exit code ${code}` })
              return
            }

            const runProc = spawnInContext('docker', [
              'run', '--rm', '-p', `${portNum}:${portNum}`, imageName
            ], {
              cwd: projectPath,
              shell: process.platform === 'win32' && !isWslPath(projectPath)
            })

            attachProcessListeners(runProc, projectPath, instanceId)

            setProcessEntry(projectPath, instanceId, {
              process: runProc,
              port: portNum,
              method: 'docker',
              pid: runProc.pid,
              cwd: projectPath,
              startedAt: Date.now()
            })

            resolve({ success: true, data: { pid: runProc.pid, port: portNum } })
          })
        })
      }
    } else {
      return { success: false, error: `Unknown launch method: ${method}` }
    }

    attachProcessListeners(proc, projectPath, instanceId, { background: !!background })

    setProcessEntry(projectPath, instanceId, {
      process: proc,
      port: portNum,
      method,
      pid: proc.pid,
      cwd: method === 'npm' ? npmCwd : projectPath,
      startedAt: Date.now(),
      background: !!background
    })
    updateBadgeCount()
    if (!background) {
      devNotify('DevScanner — Service Starting', `${instanceId} launched on port ${portNum}`, true)
    }

    return { success: true, data: { pid: proc.pid, port: portNum } }
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (method === 'docker') {
        return { success: false, error: 'Docker not found. Install Docker to use this launch method.' }
      }
      return { success: false, error: 'npm not found. Install Node.js/npm to use this launch method.' }
    }
    return { success: false, error: err.message }
  }
})

// eslint-disable-next-line no-control-regex
const ANSI_RE = /(?:\x1b\x5b|\x1b\(B|\x9b)[\x20-\x3f]*[\x40-\x7e]|\x1b[\x20-\x2f]*[\x30-\x7e]/g
// Orphaned bracket codes (ESC byte stripped by wsl.exe pipe): [32m, [1m, [0m, etc.
const ORPHAN_RE = /\[(?:\d{1,3}(?:;\d{0,3})*)?[mGKHJABCDEFsu]/g

function stripAnsi(str) {
  return str.replace(ANSI_RE, '').replace(ORPHAN_RE, '')
}

// Detect actual port from dev server output (Vite, Next, CRA, etc.)
const PORT_PATTERNS = [
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/,  // http://localhost:5175
  /Local:\s+https?:\/\/[^:]+:(\d+)/,                          // Local:   http://localhost:5175
  /listening (?:on|at) (?:port )?(\d+)/i,                      // listening on port 3000
  /started (?:on|at) (?:port )?(\d+)/i,                        // started on port 8000
  /ready on .*:(\d+)/i,                                        // ready on http://localhost:3000
]

function detectPort(text) {
  for (const re of PORT_PATTERNS) {
    const m = text.match(re)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

function attachProcessListeners(proc, projectPath, instanceId, options = {}) {
  const { background = false } = options
  let portDetected = false

  function handleOutput(chunk) {
    const clean = stripAnsi(chunk.toString())

    // Detect real port from output and update stored entry
    if (!portDetected) {
      const realPort = detectPort(clean)
      if (realPort) {
        portDetected = true
        const entry = getProcessEntry(projectPath, instanceId)
        if (entry && entry.port !== realPort) {
          console.log(`[DevScanner] Port change detected: ${entry.port} → ${realPort} (${instanceId})`)
          entry.port = realPort
          // Notify frontend about the real port
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('project-port-changed', {
              projectPath, instanceId, port: realPort
            })
          }
        }
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-log', {
        projectPath, instanceId, data: clean
      })
    }
  }

  proc.stdout.on('data', handleOutput)
  proc.stderr.on('data', handleOutput)

  proc.on('close', (code) => {
    deleteProcessEntry(projectPath, instanceId)
    updateBadgeCount()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-stopped', { projectPath, instanceId, code, background })
    }
    if (!background && code !== 0 && code !== null) {
      devNotify('DevScanner — Process Crashed', `${instanceId} exited with code ${code}`)
    }
  })

  proc.on('error', (err) => {
    deleteProcessEntry(projectPath, instanceId)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-log', {
        projectPath,
        instanceId,
        data: `Process error: ${err.message}\n`
      })
      mainWindow.webContents.send('project-stopped', { projectPath, instanceId, code: null })
    }
  })
}

ipcMain.handle('stop-project', async (event, { projectPath, instanceId }) => {
  try {
    const entry = getProcessEntry(projectPath, instanceId)
    if (!entry) {
      return { success: false, error: 'Instance not running' }
    }

    const effectiveCwd = entry.cwd || projectPath
    const wsl = isWslPath(effectiveCwd)

    if (entry.method === 'docker') {
      const hasCompose =
        fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
        fs.existsSync(path.join(projectPath, 'docker-compose.yaml'))

      if (hasCompose) {
        const composeCmd = getDockerComposeCmdInContext(projectPath)
        if (composeCmd) {
          spawnInContext(composeCmd.cmd, [...composeCmd.prefixArgs, 'down'], {
            cwd: projectPath,
            shell: process.platform === 'win32' && !wsl
          })
        }
      } else {
        const imageName = `devscanner-${path.basename(projectPath).toLowerCase()}`
        spawnInContext('docker', ['stop', imageName], {
          cwd: projectPath,
          shell: process.platform === 'win32' && !wsl
        })
      }
    }

    // Kill the process tree
    if (wsl) {
      // For WSL: kill the port listener inside WSL, then kill wsl.exe on Windows
      const parsed = parseWslPath(effectiveCwd)
      if (parsed && entry.port) {
        try {
          execSync(
            `wsl.exe -d ${parsed.distro} -- bash -lic "fuser -k ${entry.port}/tcp 2>/dev/null; exit 0"`,
            { timeout: 5000 }
          )
        } catch { /* best effort */ }
      }
      try {
        spawn('taskkill', ['/pid', String(entry.pid), '/f', '/t'])
      } catch { /* may have already exited */ }
    } else if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(entry.pid), '/f', '/t'])
      } catch { /* may have already exited */ }
    } else {
      // Linux/macOS: kill entire process group, then fuser as fallback
      try {
        process.kill(-entry.pid, 'SIGTERM')
      } catch { /* may not be group leader */ }
      try {
        process.kill(entry.pid, 'SIGTERM')
      } catch { /* may have already exited */ }
      // Fallback: kill whatever holds the port
      if (entry.port) {
        setTimeout(() => {
          try {
            execSync(`fuser -k ${entry.port}/tcp 2>/dev/null`, { timeout: 3000 })
          } catch { /* best effort */ }
        }, 500)
      }
    }

    deleteProcessEntry(projectPath, instanceId)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('get-running', async () => {
  const result = {}
  for (const [projectPath, instances] of runningProcesses) {
    result[projectPath] = {}
    for (const [instanceId, entry] of instances) {
      result[projectPath][instanceId] = {
        port: entry.port,
        method: entry.method,
        pid: entry.pid
      }
    }
  }
  return result
})

ipcMain.handle('open-browser', async (event, url) => {
  try {
    await shell.openExternal(url)
  } catch {
    // silently fail
  }
})

ipcMain.handle('get-settings', async () => {
  return loadSettings()
})

ipcMain.handle('save-settings', async (event, settings) => {
  saveSettings(settings)
  return { success: true }
})

ipcMain.handle('get-host-info', async () => {
  return {
    isWsl: isRunningInsideWsl,
    wslIp: wslHostIp
  }
})

function getWslConfigPath() {
  // Get Windows USERPROFILE path and convert to WSL-accessible path
  const winProfile = execSync('cmd.exe /c "echo %USERPROFILE%"', { encoding: 'utf-8', timeout: 3000 }).trim()
  const wslPath = execSync(`wslpath -u "${winProfile.replace(/\\/g, '\\\\')}"`, { encoding: 'utf-8', timeout: 3000 }).trim()
  return `${wslPath}/.wslconfig`
}

ipcMain.handle('check-wsl-localhost', async () => {
  if (!isRunningInsideWsl) return { available: false }
  try {
    const wslconfigPath = getWslConfigPath()
    let content = ''
    try { content = fs.readFileSync(wslconfigPath, 'utf-8') } catch { /* file doesn't exist */ }
    const match = content.match(/^\s*localhostForwarding\s*=\s*(\w+)/im)
    const forwarding = match ? match[1].toLowerCase() === 'true' : null
    return { available: true, forwarding, wslconfigPath }
  } catch (err) {
    return { available: false, error: err.message }
  }
})

ipcMain.handle('fix-wsl-localhost', async () => {
  if (!isRunningInsideWsl) return { success: false, error: 'Not running in WSL' }
  try {
    const wslconfigPath = getWslConfigPath()
    let content = ''
    try { content = fs.readFileSync(wslconfigPath, 'utf-8') } catch { /* will create */ }

    if (/^\[wsl2\]/im.test(content)) {
      if (/^\s*localhostForwarding\s*=/im.test(content)) {
        content = content.replace(/^\s*localhostForwarding\s*=.*/im, 'localhostForwarding=true')
      } else {
        content = content.replace(/(\[wsl2\])/i, '$1\nlocalhostForwarding=true')
      }
    } else {
      content = content.trimEnd() + (content.length > 0 ? '\n\n' : '') + '[wsl2]\nlocalhostForwarding=true\n'
    }

    fs.writeFileSync(wslconfigPath, content, 'utf-8')
    return { success: true, wslconfigPath }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('get-wsl-distros', async () => {
  if (process.platform !== 'win32') return []
  try {
    const output = execSync('wsl.exe -l -q', { encoding: 'utf-8', timeout: 5000 })
    return output.replace(/\0/g, '').split('\n').map(l => l.trim()).filter(Boolean)
  } catch {
    return []
  }
})

ipcMain.handle('select-wsl-folder', async (event, distro) => {
  if (process.platform !== 'win32' || !distro) return null
  try {
    const wslRoot = `\\\\wsl$\\${distro}\\home`
    // Try to find user home dirs inside /home
    let defaultPath = `\\\\wsl$\\${distro}`
    try {
      const homeEntries = fs.readdirSync(wslRoot)
      if (homeEntries.length > 0) {
        defaultPath = path.join(wslRoot, homeEntries[0])
      }
    } catch { /* use distro root */ }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selected = result.filePaths[0]
    saveSettings({ lastFolder: selected })
    return selected
  } catch (err) {
    console.error('select-wsl-folder error:', err)
    return null
  }
})

// --- Port Scanner ---

const COMMON_DEV_PORTS = [
  80, 443, 1337, 3000, 3001, 3002, 3003, 3333, 4000, 4200, 4321, 4433,
  5000, 5001, 5050, 5173, 5174, 5500, 5555, 6006, 6379, 8000, 8001,
  8080, 8081, 8443, 8888, 9000, 9090, 9229, 19006, 24678, 27017
]

function parseSSOutput(stdout) {
  const lines = stdout.split('\n').filter(l => l.trim())
  const results = []
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    // State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue

    const localAddr = parts[3]
    const lastColon = localAddr.lastIndexOf(':')
    if (lastColon === -1) continue

    const address = localAddr.substring(0, lastColon)
    const port = parseInt(localAddr.substring(lastColon + 1), 10)
    if (isNaN(port)) continue

    let pid = null
    let processName = null

    // Process info is in the last column: users:(("node",pid=1234,fd=20))
    const processCol = parts.slice(5).join(' ')
    const pidMatch = processCol.match(/pid=(\d+)/)
    const nameMatch = processCol.match(/\("([^"]+)"/)
    if (pidMatch) pid = parseInt(pidMatch[1], 10)
    if (nameMatch) processName = nameMatch[1]

    results.push({ port, pid, processName, address })
  }
  return results
}

function parseLsofOutput(stdout) {
  const lines = stdout.split('\n').filter(l => l.trim())
  const results = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/)
    if (parts.length < 9) continue
    const processName = parts[0]
    const pid = parseInt(parts[1], 10)
    const nameCol = parts[8]
    // Format: *:3000 or 127.0.0.1:3000
    const lastColon = nameCol.lastIndexOf(':')
    if (lastColon === -1) continue
    const port = parseInt(nameCol.substring(lastColon + 1), 10)
    if (isNaN(port)) continue
    const address = nameCol.substring(0, lastColon)
    results.push({ port, pid, processName, address })
  }
  return results
}

function parseNetstatOutput(stdout) {
  const lines = stdout.split('\n').filter(l => l.includes('LISTENING'))
  const results = []
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    // Proto Local Address Foreign Address State PID
    const localAddr = parts[1]
    const lastColon = localAddr.lastIndexOf(':')
    if (lastColon === -1) continue
    const port = parseInt(localAddr.substring(lastColon + 1), 10)
    const address = localAddr.substring(0, lastColon)
    const pid = parseInt(parts[parts.length - 1], 10)
    let processName = null
    if (!isNaN(pid)) {
      try {
        const tasklist = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
          encoding: 'utf-8', timeout: 3000
        }).trim()
        const match = tasklist.match(/"([^"]+)"/)
        if (match) processName = match[1]
      } catch { /* skip */ }
    }
    results.push({ port, pid: isNaN(pid) ? null : pid, processName, address })
  }
  return results
}

function scanListeningPorts() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf-8', timeout: 10000 })
      return parseNetstatOutput(out)
    } else if (process.platform === 'darwin') {
      const out = execSync('lsof -iTCP -sTCP:LISTEN -n -P', { encoding: 'utf-8', timeout: 10000 })
      return parseLsofOutput(out)
    } else {
      // Linux
      const out = execSync('ss -tlnp', { encoding: 'utf-8', timeout: 10000 })
      return parseSSOutput(out)
    }
  } catch {
    return []
  }
}

function probePort(port, timeout = 200) {
  return new Promise(resolve => {
    const sock = new net.Socket()
    sock.setTimeout(timeout)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('timeout', () => {
      sock.destroy()
      resolve(false)
    })
    sock.once('error', () => {
      sock.destroy()
      resolve(false)
    })
    sock.connect(port, '127.0.0.1')
  })
}

ipcMain.handle('scan-ports', async (event, { mode }) => {
  try {
    // First try OS-level scan for process info
    const osResults = scanListeningPorts()

    if (mode === 'common') {
      // Filter to common dev ports, or probe them if OS scan returned nothing
      if (osResults.length > 0) {
        const commonSet = new Set(COMMON_DEV_PORTS)
        const filtered = osResults.filter(r => commonSet.has(r.port))
        // Also include any running process ports we manage
        for (const [, instances] of runningProcesses) {
          for (const [, entry] of instances) {
            if (!filtered.find(r => r.port === entry.port)) {
              filtered.push({
                port: entry.port,
                pid: entry.pid,
                processName: 'devscanner-managed',
                address: '0.0.0.0'
              })
            }
          }
        }
        return { success: true, data: filtered.sort((a, b) => a.port - b.port) }
      }

      // Fallback: probe common ports
      const results = []
      const probes = COMMON_DEV_PORTS.map(async port => {
        const open = await probePort(port)
        if (open) results.push({ port, pid: null, processName: null, address: '127.0.0.1' })
      })
      await Promise.all(probes)
      return { success: true, data: results.sort((a, b) => a.port - b.port) }
    }

    // Full scan: return all OS results
    if (osResults.length > 0) {
      return { success: true, data: osResults.sort((a, b) => a.port - b.port) }
    }

    // Fallback: probe common ports only (full probe of 65k ports would be too slow)
    const results = []
    const probes = COMMON_DEV_PORTS.map(async port => {
      const open = await probePort(port)
      if (open) results.push({ port, pid: null, processName: null, address: '127.0.0.1' })
    })
    await Promise.all(probes)
    return { success: true, data: results.sort((a, b) => a.port - b.port) }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('kill-port-process', async (event, { pid, signal }) => {
  try {
    if (!pid || typeof pid !== 'number') {
      return { success: false, error: 'Invalid PID' }
    }

    // Don't kill our own process or system processes
    if (pid === process.pid || pid <= 1) {
      return { success: false, error: 'Cannot kill this process' }
    }

    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F /T`, { timeout: 5000 })
    } else {
      const sig = signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
      process.kill(pid, sig)
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// --- Docker Container Management ---

const containerLogProcesses = new Map() // containerId -> process

ipcMain.handle('check-docker', async (event, { projectPath } = {}) => {
  const docker = projectPath ? isDockerAvailableInContext(projectPath) : isDockerAvailable()
  const compose = docker
    ? (projectPath ? getDockerComposeCmdInContext(projectPath) : getDockerComposeCmd())
    : null
  return {
    docker,
    compose: compose ? `${compose.cmd}${compose.prefixArgs.length ? ' ' + compose.prefixArgs.join(' ') : ''}` : null
  }
})

ipcMain.handle('docker-list-containers', async (event, { projectPath } = {}) => {
  const useWslCtx = process.platform === 'win32' && projectPath && isWslPath(projectPath)
  const docker = projectPath ? isDockerAvailableInContext(projectPath) : isDockerAvailable()
  if (!docker) {
    return { success: false, error: 'Docker not found. Install Docker to manage containers.' }
  }
  try {
    let out
    if (useWslCtx) {
      const parsed = parseWslPath(projectPath)
      if (!parsed) return { success: false, error: 'Invalid WSL path' }
      out = execSync(
        `wsl.exe -d ${parsed.distro} -- docker ps -a --format "{{json .}}"`,
        { encoding: 'utf-8', timeout: 10000 }
      )
    } else {
      out = execSync("docker ps -a --format '{{json .}}'", { encoding: 'utf-8', timeout: 10000 })
    }
    const containers = out.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    return { success: true, data: containers }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('docker-container-action', async (event, { containerId, action, projectPath }) => {
  try {
    const allowed = ['start', 'stop', 'restart', 'rm']
    if (!allowed.includes(action)) return { success: false, error: 'Invalid action' }
    if (!/^[a-f0-9]{4,64}$/i.test(containerId)) return { success: false, error: 'Invalid container ID' }
    const args = action === 'rm' ? ['rm', '-f', containerId] : [action, containerId]
    const useWslCtx = process.platform === 'win32' && projectPath && isWslPath(projectPath)
    if (useWslCtx) {
      const parsed = parseWslPath(projectPath)
      if (!parsed) return { success: false, error: 'Invalid WSL path' }
      execSync(`wsl.exe -d ${parsed.distro} -- docker ${args.join(' ')}`, { encoding: 'utf-8', timeout: 15000 })
    } else {
      execSync(`docker ${args.join(' ')}`, { encoding: 'utf-8', timeout: 15000 })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('docker-stream-logs', async (event, { containerId, projectPath }) => {
  try {
    if (!/^[a-f0-9]{4,64}$/i.test(containerId)) return { success: false, error: 'Invalid container ID' }
    if (containerLogProcesses.has(containerId)) return { success: true }
    const useWslCtx = process.platform === 'win32' && projectPath && isWslPath(projectPath)
    let proc
    if (useWslCtx) {
      const parsed = parseWslPath(projectPath)
      if (!parsed) return { success: false, error: 'Invalid WSL path' }
      proc = spawn('wsl.exe', ['-d', parsed.distro, '--', 'docker', 'logs', '-f', '--tail', '200', containerId])
    } else {
      proc = spawn('docker', ['logs', '-f', '--tail', '200', containerId])
    }
    containerLogProcesses.set(containerId, proc)
    const send = (chunk) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('docker-log', { containerId, data: stripAnsi(chunk.toString()) })
      }
    }
    proc.stdout.on('data', send)
    proc.stderr.on('data', send)
    proc.on('close', () => {
      containerLogProcesses.delete(containerId)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('docker-log-end', { containerId })
      }
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('docker-stop-logs', async (event, { containerId }) => {
  const proc = containerLogProcesses.get(containerId)
  if (proc) {
    proc.kill()
    containerLogProcesses.delete(containerId)
  }
  return { success: true }
})

// --- Git Operations ---

ipcMain.handle('git-info', async (event, { projectPath }) => {
  try {
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) return null
    let branch = 'unknown', changed = 0, ahead = 0, behind = 0
    try {
      branch = execInContext('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: 'pipe'
      }).trim()
    } catch { /* ok */ }
    try {
      const status = execInContext('git status --porcelain', {
        cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: 'pipe'
      })
      changed = status.trim().split('\n').filter(Boolean).length
    } catch { /* ok */ }
    try {
      const upstream = execInContext('git rev-parse --abbrev-ref @{u}', {
        cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: 'pipe'
      }).trim()
      if (upstream) {
        const counts = execInContext(`git rev-list --left-right --count HEAD...${upstream}`, {
          cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: 'pipe'
        }).trim()
        const [a, b] = counts.split('\t').map(Number)
        ahead = a || 0; behind = b || 0
      }
    } catch { /* no upstream */ }
    return { branch, changed, ahead, behind }
  } catch { return null }
})

ipcMain.handle('git-fetch', async (event, { projectPath }) => {
  try {
    execInContext('git fetch', { cwd: projectPath, encoding: 'utf-8', timeout: 20000, stdio: 'pipe' })
    return { success: true }
  } catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('git-pull', async (event, { projectPath }) => {
  try {
    const out = execInContext('git pull', { cwd: projectPath, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' })
    return { success: true, output: out }
  } catch (err) { return { success: false, error: err.message } }
})

// --- npm Scripts ---

ipcMain.handle('get-npm-scripts', async (event, { projectPath }) => {
  try {
    const pkgPath = path.join(projectPath, 'package.json')
    if (!fs.existsSync(pkgPath)) return { success: false, error: 'No package.json' }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    const scripts = pkg.scripts || {}
    return { success: true, data: Object.entries(scripts).map(([name, cmd]) => ({ name, cmd })) }
  } catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('run-npm-script', async (event, { projectPath, scriptName, instanceId, port }) => {
  try {
    if (getProcessEntry(projectPath, instanceId)) {
      return { success: false, error: `Instance "${instanceId}" is already running` }
    }
    const useWsl = isWslPath(projectPath)
    const npmCmd = process.platform === 'win32' && !useWsl ? 'npm.cmd' : 'npm'
    const portNum = port ? parseInt(port, 10) : null
    const args = ['run', scriptName]
    const proc = spawnInContext(npmCmd, args, {
      cwd: projectPath,
      env: { ...process.env, ...(portNum ? { PORT: String(portNum) } : {}) },
      shell: process.platform === 'win32' && !useWsl
    })
    attachProcessListeners(proc, projectPath, instanceId)
    setProcessEntry(projectPath, instanceId, {
      process: proc, port: portNum, method: 'npm', pid: proc.pid,
      cwd: projectPath, startedAt: Date.now()
    })
    updateBadgeCount()
    return { success: true, data: { pid: proc.pid, port: portNum } }
  } catch (err) { return { success: false, error: err.message } }
})

// --- .env File Handlers ---

function validateEnvFileName(fileName) {
  if (typeof fileName !== 'string') return false
  if (!fileName.startsWith('.env')) return false
  if (fileName.includes('/') || fileName.includes('\\')) return false
  if (fileName.includes('..')) return false
  return true
}

function validateEnvPath(projectPath, fileName) {
  const resolved = path.resolve(projectPath, fileName)
  const normalizedProject = path.resolve(projectPath)
  if (!resolved.startsWith(normalizedProject + path.sep) && resolved !== normalizedProject) return false
  return true
}

ipcMain.handle('read-env-file', async (_, { projectPath, fileName }) => {
  try {
    if (!validateEnvFileName(fileName) || !validateEnvPath(projectPath, fileName)) {
      return { success: false, error: 'Invalid file name' }
    }
    const filePath = path.join(projectPath, fileName)
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' }
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return { success: true, data: { content, fileName } }
  } catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('save-env-file', async (_, { projectPath, fileName, content }) => {
  try {
    if (!validateEnvFileName(fileName) || !validateEnvPath(projectPath, fileName)) {
      return { success: false, error: 'Invalid file name' }
    }
    const filePath = path.join(projectPath, fileName)
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('list-env-files', async (_, { projectPath }) => {
  try {
    const files = detectEnvFiles(projectPath)
    return { success: true, data: files }
  } catch (err) { return { success: false, error: err.message } }
})

// --- SSH IPC Handlers ---

ipcMain.handle('ssh-connect', async (_, { server }) => {
  try {
    if (getSSHClient(server.id)) return { success: true, data: { alreadyConnected: true } }
    await connectSSH(server)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ssh-disconnect', async (_, { serverId }) => {
  try {
    disconnectSSH(serverId)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ssh-discover', async (_, { serverId }) => {
  try {
    const client = getSSHClient(serverId)
    if (!client) return { success: false, error: 'Not connected' }
    const [os, docker, pm2, screen, systemd, nginx, ports, projects] = await Promise.all([
      discoverServerOS(client),
      discoverDockerContainers(client),
      discoverPM2Processes(client),
      discoverScreenSessions(client),
      discoverSystemdServices(client),
      discoverNginxSites(client),
      discoverListeningPorts(client),
      discoverProjectRoots(client)
    ])
    const discovery = { os, docker, pm2, screen, systemd, nginx, ports, projects }
    const tags = generateServerTags(discovery)
    return { success: true, data: { ...discovery, tags } }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ssh-exec', async (_, { serverId, command }) => {
  try {
    const client = getSSHClient(serverId)
    if (!client) return { success: false, error: 'Not connected' }
    const result = await sshExec(client, command, 30000)
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ssh-save-server', async (_, { server }) => {
  try {
    const settings = loadSettings()
    const servers = settings.remoteServers || []
    const toSave = { ...server }
    // Encrypt password
    if (toSave.password && safeStorage.isEncryptionAvailable()) {
      toSave.encryptedPassword = safeStorage.encryptString(toSave.password).toString('base64')
      delete toSave.password
    }
    const idx = servers.findIndex(s => s.id === toSave.id)
    if (idx >= 0) {
      servers[idx] = { ...servers[idx], ...toSave }
    } else {
      servers.push(toSave)
    }
    saveSettings({ remoteServers: servers })
    return { success: true, data: servers }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ssh-delete-server', async (_, { serverId }) => {
  try {
    disconnectSSH(serverId)
    const settings = loadSettings()
    const servers = (settings.remoteServers || []).filter(s => s.id !== serverId)
    saveSettings({ remoteServers: servers })
    return { success: true, data: servers }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ssh-get-servers', async () => {
  try {
    const settings = loadSettings()
    return { success: true, data: settings.remoteServers || [] }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// --- Auto Updater ---

function setupAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', info)
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', progress)
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', info)
    }
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 5000)
}

ipcMain.handle('update-download', async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('update-install', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('update-check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// --- App Lifecycle ---

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  for (const [, instances] of runningProcesses) {
    for (const [, entry] of instances) {
      try {
        const wsl = entry.cwd && isWslPath(entry.cwd)
        if (wsl) {
          const parsed = parseWslPath(entry.cwd)
          if (parsed && entry.port) {
            try {
              execSync(
                `wsl.exe -d ${parsed.distro} -- bash -lic "fuser -k ${entry.port}/tcp 2>/dev/null; exit 0"`,
                { timeout: 3000 }
              )
            } catch { /* best effort */ }
          }
          spawn('taskkill', ['/pid', String(entry.pid), '/f', '/t'])
        } else if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(entry.pid), '/f', '/t'])
        } else {
          try { process.kill(-entry.pid, 'SIGTERM') } catch { /* not group leader */ }
          try { process.kill(entry.pid, 'SIGTERM') } catch { /* already exited */ }
          if (entry.port) {
            try { execSync(`fuser -k ${entry.port}/tcp 2>/dev/null`, { timeout: 2000 }) } catch { /* ok */ }
          }
        }
      } catch {
        // process may have already exited
      }
    }
  }
  runningProcesses.clear()
  for (const [, proc] of containerLogProcesses) {
    try { proc.kill() } catch { /* already exited */ }
  }
  containerLogProcesses.clear()
  // Close all SSH connections
  for (const [, conn] of sshConnections) {
    try { conn.client.end() } catch { /* already closed */ }
  }
  sshConnections.clear()
})
