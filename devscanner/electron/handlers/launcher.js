const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
const { isWslPath, parseWslPath, spawnInContext } = require('../utils/context')
const { getDockerComposeCmdInContext } = require('../utils/docker-detect')
const {
  runningProcesses,
  getProcessEntry,
  setProcessEntry,
  deleteProcessEntry,
  attachProcessListeners,
  stripAnsi,
  updateBadgeCount,
  devNotify
} = require('../utils/process')
const { isRunningInsideWsl } = require('../globals')

function registerLauncherHandlers(ipcMain, ctx) {
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

          const mainWindow = ctx.mainWindow()

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
}

module.exports = { registerLauncherHandlers }
