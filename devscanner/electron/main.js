const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')
const net = require('net')
const yaml = require('js-yaml')
const { autoUpdater } = require('electron-updater')

app.commandLine.appendSwitch('no-sandbox')
app.disableHardwareAcceleration()

let mainWindow

// --- WSL Support ---

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

function execInContext(command, options) {
  if (options.cwd && isWslPath(options.cwd)) {
    const parsed = parseWslPath(options.cwd)
    if (parsed) {
      return execSync(
        `wsl.exe -d ${parsed.distro} --cd "${parsed.linuxPath}" -- ${command}`,
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
      const wslArgs = ['-d', parsed.distro, '--cd', parsed.linuxPath, '--']
      // Pass extra env vars via `env` command
      if (options.env) {
        const extras = []
        for (const [k, v] of Object.entries(options.env)) {
          if (process.env[k] !== v) extras.push(`${k}=${v}`)
        }
        if (extras.length > 0) wslArgs.push('env', ...extras)
      }
      wslArgs.push(command, ...args)
      return spawn('wsl.exe', wslArgs, {
        ...options, cwd: undefined, env: undefined, shell: false
      })
    }
  }
  return spawn(command, args, options)
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
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  const isDev = !app.isPackaged
  if (isDev) {
    console.log('Dev mode: loading http://localhost:5173')
    mainWindow.loadURL('http://localhost:5173')
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

    const branch = execInContext('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000
    }).trim()

    const commits = parseInt(
      execInContext('git rev-list --count HEAD', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000
      }).trim(),
      10
    )

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
      dockerServices
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

ipcMain.handle('launch-project', async (event, { projectPath, port, method, instanceId, subprojectPath, dockerServices: requestedServices }) => {
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
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(npmCwd, 'package.json'), 'utf-8')
        )
        const scripts = pkg.scripts || {}
        const priority = ['dev', 'start', 'serve']
        for (const s of priority) {
          if (scripts[s]) { scriptName = s; break }
        }
        if (!scriptName) {
          const keys = Object.keys(scripts)
          if (keys.length > 0) scriptName = keys[0]
        }
      } catch {
        return { success: false, error: 'Failed to read package.json scripts' }
      }

      if (!scriptName) {
        return { success: false, error: 'No npm scripts found in package.json' }
      }

      const useWsl = isWslPath(npmCwd)
      const npmCmd = process.platform === 'win32' && !useWsl ? 'npm.cmd' : 'npm'
      proc = spawnInContext(npmCmd, ['run', scriptName], {
        cwd: npmCwd,
        env: { ...process.env, PORT: String(portNum) },
        shell: process.platform === 'win32' && !useWsl
      })
    } else if (method === 'docker') {
      const hasCompose =
        fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
        fs.existsSync(path.join(projectPath, 'docker-compose.yaml'))

      if (hasCompose) {
        // Support launching specific services or all
        const args = ['up']
        if (requestedServices && requestedServices.length > 0) {
          args.push(...requestedServices)
        }
        proc = spawnInContext('docker-compose', args, {
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
              data: chunk.toString()
            })
          }
        })

        buildProc.stderr.on('data', (chunk) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('project-log', {
              projectPath,
              instanceId,
              data: chunk.toString()
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
              startedAt: Date.now()
            })

            resolve({ success: true, data: { pid: runProc.pid, port: portNum } })
          })
        })
      }
    } else {
      return { success: false, error: `Unknown launch method: ${method}` }
    }

    attachProcessListeners(proc, projectPath, instanceId)

    setProcessEntry(projectPath, instanceId, {
      process: proc,
      port: portNum,
      method,
      pid: proc.pid,
      startedAt: Date.now()
    })

    return { success: true, data: { pid: proc.pid, port: portNum } }
  } catch (err) {
    if (err.code === 'ENOENT') {
      const tool = method === 'docker' ? 'Docker' : 'npm'
      return { success: false, error: `${tool} not found. Install ${tool} to use this launch method.` }
    }
    return { success: false, error: err.message }
  }
})

function attachProcessListeners(proc, projectPath, instanceId) {
  proc.stdout.on('data', (chunk) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-log', {
        projectPath,
        instanceId,
        data: chunk.toString()
      })
    }
  })

  proc.stderr.on('data', (chunk) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-log', {
        projectPath,
        instanceId,
        data: chunk.toString()
      })
    }
  })

  proc.on('close', (code) => {
    deleteProcessEntry(projectPath, instanceId)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-stopped', { projectPath, instanceId, code })
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

    if (entry.method === 'docker') {
      const hasCompose =
        fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
        fs.existsSync(path.join(projectPath, 'docker-compose.yaml'))

      if (hasCompose) {
        spawnInContext('docker-compose', ['down'], {
          cwd: projectPath,
          shell: process.platform === 'win32' && !isWslPath(projectPath)
        })
      } else {
        const imageName = `devscanner-${path.basename(projectPath).toLowerCase()}`
        spawnInContext('docker', ['stop', imageName], {
          cwd: projectPath,
          shell: process.platform === 'win32' && !isWslPath(projectPath)
        })
      }
    }

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(entry.pid), '/f', '/t'])
      } else {
        process.kill(entry.pid, 'SIGTERM')
      }
    } catch {
      // process may have already exited
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

ipcMain.handle('get-wsl-distros', async () => {
  if (process.platform !== 'win32') return []
  try {
    const output = execSync('wsl.exe -l -q', { encoding: 'utf-8', timeout: 5000 })
    return output.replace(/\0/g, '').split('\n').map(l => l.trim()).filter(Boolean)
  } catch {
    return []
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
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(entry.pid), '/f', '/t'])
        } else {
          process.kill(entry.pid, 'SIGTERM')
        }
      } catch {
        // process may have already exited
      }
    }
  }
  runningProcesses.clear()
})
