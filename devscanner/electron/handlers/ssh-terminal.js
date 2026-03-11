const { loadSettings } = require('../utils/settings-store')
const { createSession, destroySession, writeToSession, resizeSession } = require('../utils/terminal-sessions')

function registerSshTerminalHandlers(ipcMain, ctx) {
  ipcMain.handle('terminal:open', async (_, { serverId }) => {
    try {
      const settings = loadSettings()
      const servers = settings.remoteServers || []
      const serverConfig = servers.find(s => s.id === serverId)
      if (!serverConfig) {
        return { success: false, error: 'Server not found' }
      }

      const mainWindow = ctx.mainWindow()
      if (!mainWindow) {
        return { success: false, error: 'Application window not available' }
      }

      const result = await createSession(serverId, serverConfig, mainWindow)
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: `Connection failed: ${err.message}` }
    }
  })

  ipcMain.on('terminal:input', (_, sessionId, data) => {
    writeToSession(sessionId, data)
  })

  ipcMain.on('terminal:resize', (_, sessionId, cols, rows) => {
    resizeSession(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:close', async (_, { sessionId }) => {
    try {
      destroySession(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerSshTerminalHandlers }
