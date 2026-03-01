const { shell } = require('electron')
const { loadSettings, saveSettings } = require('../utils/settings-store')
const { isRunningInsideWsl, wslHostIpReady } = require('../globals')

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
    const wslIp = await wslHostIpReady
    return {
      isWsl: isRunningInsideWsl,
      wslIp
    }
  })
}

module.exports = { registerSettingsHandlers }
