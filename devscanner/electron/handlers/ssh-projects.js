const { getSSHClient, sshExec, analyzeRemoteProject } = require('../utils/ssh-pool')

// Track remote running processes: serverId -> { instanceId -> { projectPath, command, port, stream } }
const remoteRunningProcesses = new Map()

function registerSshProjectsHandlers(ipcMain, ctx) {
  ipcMain.handle('ssh-analyze-project', async (_, { serverId, projectPath }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const analysis = await analyzeRemoteProject(client, projectPath)
      return { success: true, data: analysis }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-launch-project', async (_, { serverId, projectPath, command, port }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }

      const instanceId = `remote_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const cmd = command || 'npm start'
      const fullCmd = `cd ${projectPath} && ${cmd}`

      // Execute via SSH exec channel (streaming)
      client.exec(fullCmd, (err, stream) => {
        if (err) {
          const mw = ctx.mainWindow()
          if (mw && !mw.isDestroyed()) {
            mw.webContents.send('remote-project-log', {
              serverId, projectPath, instanceId,
              data: `[error] Failed to start: ${err.message}\n`
            })
          }
          return
        }

        // Store the running process
        if (!remoteRunningProcesses.has(serverId)) {
          remoteRunningProcesses.set(serverId, new Map())
        }
        remoteRunningProcesses.get(serverId).set(instanceId, {
          projectPath, command: cmd, port: port || null, stream
        })

        const send = (chunk) => {
          const mw = ctx.mainWindow()
          if (mw && !mw.isDestroyed()) {
            mw.webContents.send('remote-project-log', {
              serverId, projectPath, instanceId,
              data: chunk.toString()
            })
          }
        }

        stream.on('data', send)
        stream.stderr.on('data', send)
        stream.on('close', (code) => {
          const instances = remoteRunningProcesses.get(serverId)
          if (instances) {
            instances.delete(instanceId)
            if (instances.size === 0) remoteRunningProcesses.delete(serverId)
          }
          const mw = ctx.mainWindow()
          if (mw && !mw.isDestroyed()) {
            mw.webContents.send('remote-project-stopped', {
              serverId, projectPath, instanceId, code
            })
          }
        })
      })

      return { success: true, data: { instanceId, command: cmd, port } }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-stop-project', async (_, { serverId, projectPath, instanceId }) => {
    try {
      const instances = remoteRunningProcesses.get(serverId)
      const entry = instances?.get(instanceId)
      if (!entry) return { success: false, error: 'Process not found' }

      // Send Ctrl+C to the stream, then close
      try {
        entry.stream.write('\x03') // Ctrl+C
        setTimeout(() => {
          try { entry.stream.close() } catch {}
        }, 1000)
      } catch {}

      // Also try to kill the port if known
      if (entry.port) {
        const client = getSSHClient(serverId)
        if (client) {
          try {
            await sshExec(client, `fuser -k ${entry.port}/tcp 2>/dev/null`, 5000)
          } catch {}
        }
      }

      instances.delete(instanceId)
      if (instances.size === 0) remoteRunningProcesses.delete(serverId)

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-get-remote-running', async (_, { serverId }) => {
    try {
      const instances = remoteRunningProcesses.get(serverId)
      if (!instances || instances.size === 0) return { success: true, data: {} }

      const result = {}
      for (const [id, entry] of instances) {
        result[id] = {
          projectPath: entry.projectPath,
          command: entry.command,
          port: entry.port
        }
      }
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerSshProjectsHandlers, remoteRunningProcesses }
