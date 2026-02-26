const { execSync, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { isWslPath, parseWslPath, execInContext } = require('../utils/context')
const { isDockerAvailable, isDockerAvailableInContext, getDockerComposeCmd, getDockerComposeCmdInContext } = require('../utils/docker-detect')
const {
  SERVICE_CATALOG,
  sanitizeProjectName,
  generateComposeFile,
  generateConnectionString,
  startHealthPolling,
  stopHealthPolling
} = require('../utils/docker-services')
const { stripAnsi } = require('../utils/process')
const { probePort } = require('../utils/port-utils')
const { loadSettings, saveSettings, validateEnvFileName, validateEnvPath } = require('../utils/settings-store')

const containerLogProcesses = new Map() // containerId -> process

function registerDockerHandlers(ipcMain, ctx) {
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
        const mainWindow = ctx.mainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('docker-log', { containerId, data: stripAnsi(chunk.toString()) })
        }
      }
      proc.stdout.on('data', send)
      proc.stderr.on('data', send)
      proc.on('close', () => {
        containerLogProcesses.delete(containerId)
        const mainWindow = ctx.mainWindow()
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

  // --- Docker Services Handlers ---

  ipcMain.handle('docker-services-catalog', async () => {
    return { success: true, data: SERVICE_CATALOG }
  })

  ipcMain.handle('docker-services-config', async (_, { projectPath }) => {
    try {
      const settings = loadSettings()
      const config = settings.dockerServices?.[projectPath] || null
      return { success: true, data: config }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('docker-services-save', async (_, { projectPath, services }) => {
    try {
      const settings = loadSettings()
      if (!settings.dockerServices) settings.dockerServices = {}
      settings.dockerServices[projectPath] = {
        services,
        lastStarted: settings.dockerServices[projectPath]?.lastStarted || null
      }
      saveSettings(settings)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('docker-services-start', async (_, { projectPath }) => {
    try {
      // Check docker available
      if (!isDockerAvailableInContext(projectPath)) {
        return { success: false, error: 'Docker is not available. Please install Docker to use this feature.' }
      }

      const settings = loadSettings()
      const config = settings.dockerServices?.[projectPath]
      if (!config?.services) {
        return { success: false, error: 'No services configured. Select services first.' }
      }

      const enabledServices = Object.entries(config.services).filter(([, v]) => v.enabled)
      if (enabledServices.length === 0) {
        return { success: false, error: 'No services enabled.' }
      }

      // Check for port conflicts
      for (const [key, svcConfig] of enabledServices) {
        const catalogEntry = SERVICE_CATALOG[key]
        if (!catalogEntry) continue
        const port = svcConfig.port || catalogEntry.defaultPort
        const inUse = await probePort(port)
        if (inUse) {
          return { success: false, error: `Port ${port} is already in use (service: ${catalogEntry.label}). Change the port or stop the conflicting process.` }
        }
      }

      // Generate compose file
      generateComposeFile(projectPath, config.services)

      // Start services
      execInContext(
        'docker compose -f docker-compose.devscanner.yml up -d',
        { cwd: projectPath, encoding: 'utf-8', timeout: 120000, stdio: 'pipe' }
      )

      // Update lastStarted
      settings.dockerServices[projectPath].lastStarted = new Date().toISOString()
      saveSettings(settings)

      // Start health polling
      startHealthPolling(projectPath, config.services)

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('docker-services-stop', async (_, { projectPath }) => {
    try {
      stopHealthPolling(projectPath)
      execInContext(
        'docker compose -f docker-compose.devscanner.yml down',
        { cwd: projectPath, encoding: 'utf-8', timeout: 60000, stdio: 'pipe' }
      )
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('docker-services-status', async (_, { projectPath }) => {
    try {
      const settings = loadSettings()
      const config = settings.dockerServices?.[projectPath]
      if (!config?.services) return { success: true, data: {} }

      const name = sanitizeProjectName(projectPath)
      const status = {}
      for (const [key, svcConfig] of Object.entries(config.services)) {
        if (!svcConfig.enabled) continue
        const containerName = `devscanner-${name}-${key}`
        try {
          const out = execInContext(
            `docker inspect --format='{{json .State}}' ${containerName}`,
            { cwd: projectPath, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
          )
          const state = JSON.parse(out.trim().replace(/^'|'$/g, ''))
          status[key] = {
            running: state.Running || false,
            health: state.Health?.Status || (state.Running ? 'running' : 'stopped')
          }
        } catch {
          status[key] = { running: false, health: 'stopped' }
        }
      }
      return { success: true, data: status }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('docker-services-inject-env', async (_, { projectPath, envFileName, entries }) => {
    try {
      const fileName = envFileName || '.env'
      if (!validateEnvFileName(fileName) || !validateEnvPath(projectPath, fileName)) {
        return { success: false, error: 'Invalid file name' }
      }
      const filePath = path.join(projectPath, fileName)
      let content = ''
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf-8')
      }

      for (const { key, value } of entries) {
        const regex = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm')
        if (regex.test(content)) {
          content = content.replace(regex, `${key}=${value}`)
        } else {
          if (content.length > 0 && !content.endsWith('\n')) content += '\n'
          content += `${key}=${value}\n`
        }
      }

      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerDockerHandlers, containerLogProcesses }
