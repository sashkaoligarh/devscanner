const fs = require('fs')
const { safeStorage } = require('electron')
const { Client: SSHClient } = require('ssh2')

const sshConnections = new Map() // serverId -> { client, ready, password }

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
      let password = serverConfig.password || ''
      if (serverConfig.encryptedPassword && safeStorage.isEncryptionAvailable()) {
        try {
          password = safeStorage.decryptString(Buffer.from(serverConfig.encryptedPassword, 'base64'))
        } catch { /* use raw password */ }
      }
      connectOpts.password = password
    }

    client.on('ready', () => {
      sshConnections.set(serverConfig.id, { client, ready: true, password: connectOpts.password || '' })
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

function sshExecSudo(client, cmd, password, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSH sudo timeout')), timeout)
    client.exec(`sudo -S bash -c '${cmd.replace(/'/g, "'\\''")}'`, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err) }
      let stdout = '', stderr = ''
      stream.write(password + '\n')
      stream.on('data', (d) => { stdout += d.toString() })
      stream.stderr.on('data', (d) => { stderr += d.toString() })
      stream.on('close', (code) => {
        clearTimeout(timer)
        stderr = stderr.replace(/\[sudo\].*?:\s*/g, '')
        resolve({ stdout, stderr, code })
      })
    })
  })
}

function getServerPassword(serverId) {
  const conn = sshConnections.get(serverId)
  return conn?.password || ''
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

async function discoverPM2Processes(client, password) {
  try {
    // Try as current user first
    const { stdout, code } = await sshExec(client, 'pm2 jlist 2>/dev/null')
    if (code === 0 && stdout.trim()) {
      try {
        const list = JSON.parse(stdout)
        if (list.length > 0) return list
      } catch { /* try sudo */ }
    }
    // Fallback: try as root (PM2 processes started via sudo)
    if (password) {
      const sudo = await sshExecSudo(client, 'pm2 jlist 2>/dev/null', password, 10000)
      if (sudo.code === 0 && sudo.stdout.trim()) {
        try { return JSON.parse(sudo.stdout) } catch { return [] }
      }
    }
    return []
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
    const filter = 'nginx|apache|httpd|php-fpm|mysql|mariadb|postgres|redis|mongodb|mongod|nodejs|node-|pm2|docker|supervisord|gunicorn|uvicorn|memcached|rabbitmq|elasticsearch'
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
    const lines = stdout.split('\n').slice(1)
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
  if (systemd.some(s => /nodejs|node-/i.test(s.unit))) tags.push('Node.js')
  const projects = discovery.projects || []
  if (projects.some(p => p.manifests.includes('package.json')) && !tags.includes('Node.js')) tags.push('Node.js')
  if (projects.some(p => p.manifests.includes('requirements.txt'))) tags.push('Python')
  if (projects.some(p => p.manifests.includes('composer.json')) && !tags.includes('PHP')) tags.push('PHP')
  if (projects.some(p => p.manifests.includes('go.mod'))) tags.push('Go')
  return tags
}

async function analyzeRemoteProject(client, projectPath) {
  const result = { name: projectPath.split('/').pop(), language: null, framework: null, scripts: {}, hasDocker: false }

  // Check package.json (Node.js)
  try {
    const { stdout, code } = await sshExec(client, `cat ${projectPath}/package.json 2>/dev/null`)
    if (code === 0 && stdout.trim()) {
      const pkg = JSON.parse(stdout)
      result.name = pkg.name || result.name
      result.language = 'JavaScript'
      result.scripts = pkg.scripts || {}
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps.typescript) result.language = 'TypeScript'
      if (deps.next) result.framework = 'Next.js'
      else if (deps.nuxt) result.framework = 'Nuxt'
      else if (deps.vue) result.framework = 'Vue'
      else if (deps['@nestjs/core']) result.framework = 'NestJS'
      else if (deps.express) result.framework = 'Express'
      else if (deps.fastify) result.framework = 'Fastify'
      else if (deps.react) result.framework = 'React'
      else if (deps.vite) result.framework = 'Vite'
    }
  } catch { /* not a node project */ }

  // Check requirements.txt (Python)
  if (!result.language) {
    try {
      const { stdout, code } = await sshExec(client, `cat ${projectPath}/requirements.txt 2>/dev/null`)
      if (code === 0 && stdout.trim()) {
        result.language = 'Python'
        const lower = stdout.toLowerCase()
        if (lower.includes('django')) result.framework = 'Django'
        else if (lower.includes('flask')) result.framework = 'Flask'
        else if (lower.includes('fastapi')) result.framework = 'FastAPI'
      }
    } catch {}
  }

  // Check go.mod
  if (!result.language) {
    try {
      const { code } = await sshExec(client, `test -f ${projectPath}/go.mod`)
      if (code === 0) result.language = 'Go'
    } catch {}
  }

  // Check Cargo.toml
  if (!result.language) {
    try {
      const { code } = await sshExec(client, `test -f ${projectPath}/Cargo.toml`)
      if (code === 0) result.language = 'Rust'
    } catch {}
  }

  // Check docker
  try {
    const { code } = await sshExec(client, `test -f ${projectPath}/docker-compose.yml -o -f ${projectPath}/docker-compose.yaml -o -f ${projectPath}/Dockerfile`)
    if (code === 0) result.hasDocker = true
  } catch {}

  return result
}

module.exports = {
  sshConnections,
  sshExec,
  sshExecSudo,
  connectSSH,
  disconnectSSH,
  getSSHClient,
  getServerPassword,
  discoverServerOS,
  discoverDockerContainers,
  discoverPM2Processes,
  discoverScreenSessions,
  discoverSystemdServices,
  discoverNginxSites,
  discoverListeningPorts,
  discoverProjectRoots,
  generateServerTags,
  analyzeRemoteProject
}
