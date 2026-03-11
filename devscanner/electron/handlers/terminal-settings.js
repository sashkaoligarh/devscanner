const { loadSettings, saveSettings } = require('../utils/settings-store')

const DEFAULT_SETTINGS = {
  activeThemeId: 'dark',
  scrollbackLimit: 5000,
  commandHistoryLimit: 1000,
  fontSize: 14,
  cursorBlink: true,
  cursorStyle: 'block'
}

const DEFAULT_SHORTCUTS = {
  copy: 'Ctrl+Shift+C',
  paste: 'Ctrl+Shift+V',
  clear: 'Ctrl+L',
  search: 'Ctrl+Shift+F',
  scrollUp: 'Shift+PageUp',
  scrollDown: 'Shift+PageDown',
  scrollToTop: 'Ctrl+Home',
  scrollToBottom: 'Ctrl+End',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0'
}

function registerTerminalSettingsHandlers(ipcMain) {
  ipcMain.handle('terminal-settings:get', async () => {
    try {
      const settings = loadSettings()
      return {
        success: true,
        data: {
          settings: { ...DEFAULT_SETTINGS, ...(settings.terminalSettings || {}) },
          customThemes: settings.terminalThemes || [],
          shortcuts: { ...DEFAULT_SHORTCUTS, ...(settings.terminalShortcuts || {}) }
        }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('terminal-settings:save', async (_, { settings, customThemes, shortcuts }) => {
    try {
      const updates = {}
      if (settings) {
        const current = loadSettings()
        updates.terminalSettings = { ...(current.terminalSettings || {}), ...settings }
      }
      if (customThemes !== undefined) {
        updates.terminalThemes = customThemes
      }
      if (shortcuts) {
        const current = loadSettings()
        updates.terminalShortcuts = { ...(current.terminalShortcuts || {}), ...shortcuts }
      }
      saveSettings(updates)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerTerminalSettingsHandlers }
