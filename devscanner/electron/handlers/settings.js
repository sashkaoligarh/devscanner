const { shell } = require('electron')
const { loadSettings, saveSettings } = require('../utils/settings-store')
const { isRunningInsideWsl, wslHostIpReady } = require('../globals')
const { getLogPath, log, startTimer } = require('../utils/app-log')

function registerSettingsHandlers(ipcMain, ctx) {
  ipcMain.handle('get-settings', async () => {
    const end = startTimer('ipc:get-settings')
    const settings = loadSettings()
    end({ keys: Object.keys(settings || {}).length, hasLastFolder: !!settings?.lastFolder })
    return settings
  })

  ipcMain.handle('save-settings', async (event, settings) => {
    log('ipc:save-settings', { keys: Object.keys(settings || {}) })
    saveSettings(settings)
    return { success: true }
  })

  ipcMain.handle('get-diagnostics', async () => {
    return { logPath: getLogPath() }
  })

  ipcMain.handle('diagnostic-log', async (event, message, data) => {
    log(`renderer:${message}`, data)
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
    const end = startTimer('ipc:get-host-info')
    const wslIp = await wslHostIpReady
    end({ isWsl: isRunningInsideWsl, hasWslIp: !!wslIp })
    return {
      isWsl: isRunningInsideWsl,
      wslIp
    }
  })
}

module.exports = { registerSettingsHandlers }
