const { shell } = require('electron')
const { loadSettings, saveSettings } = require('../utils/settings-store')
const { isRunningInsideWsl, wslHostIp } = require('../globals')

function registerSettingsHandlers(ipcMain, ctx) {
  ipcMain.handle('get-settings', async () => {
    return loadSettings()
  })

  ipcMain.handle('save-settings', async (event, settings) => {
    saveSettings(settings)
    return { success: true }
  })

  ipcMain.handle('open-browser', async (event, url) => {
    try {
      await shell.openExternal(url)
    } catch {
      // silently fail
    }
  })

  ipcMain.handle('get-host-info', async () => {
    return {
      isWsl: isRunningInsideWsl,
      wslIp: wslHostIp
    }
  })
}

module.exports = { registerSettingsHandlers }
