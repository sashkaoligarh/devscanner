const { loadSettings, saveSettings } = require('../utils/settings-store')

function registerCommandHistoryHandlers(ipcMain) {
  ipcMain.handle('command-history:get', async (_, { serverId }) => {
    try {
      const settings = loadSettings()
      const history = (settings.commandHistory || {})[serverId] || []
      // Return sorted by timestamp descending (newest first)
      const sorted = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      return { success: true, data: sorted }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('command-history:add', async (_, { serverId, command }) => {
    try {
      if (!command || !command.trim()) return { success: true }

      const settings = loadSettings()
      const commandHistory = settings.commandHistory || {}
      const history = commandHistory[serverId] || []
      const trimmed = command.trim()

      // Deduplicate consecutive identical commands
      if (history.length > 0 && history[history.length - 1].command === trimmed) {
        return { success: true }
      }

      history.push({
        command: trimmed,
        timestamp: new Date().toISOString()
      })

      // Enforce FIFO eviction
      const limit = (settings.terminalSettings || {}).commandHistoryLimit || 1000
      while (history.length > limit) {
        history.shift()
      }

      commandHistory[serverId] = history
      saveSettings({ commandHistory })
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('command-history:clear', async (_, { serverId }) => {
    try {
      const settings = loadSettings()
      const commandHistory = settings.commandHistory || {}
      delete commandHistory[serverId]
      saveSettings({ commandHistory })
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerCommandHistoryHandlers }
