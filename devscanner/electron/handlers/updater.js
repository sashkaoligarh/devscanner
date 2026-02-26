const { autoUpdater } = require('electron-updater')

function setupAutoUpdater(ctx) {
  if (!ctx.app.isPackaged) return

  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', (info) => {
    const mainWindow = ctx.mainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', info)
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    const mainWindow = ctx.mainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', progress)
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    const mainWindow = ctx.mainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', info)
    }
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 5000)
}

function registerUpdaterHandlers(ipcMain, ctx) {
  ipcMain.handle('update-download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('update-install', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('update-check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerUpdaterHandlers, setupAutoUpdater }
