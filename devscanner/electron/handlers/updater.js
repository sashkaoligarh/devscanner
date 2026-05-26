const { autoUpdater } = require('electron-updater')
const { log, logError, startTimer } = require('../utils/app-log')

function setupAutoUpdater(ctx) {
  if (!ctx.app.isPackaged) {
    log('updater:setup-skipped-dev')
    return
  }

  autoUpdater.autoDownload = false
  log('updater:setup')

  autoUpdater.on('update-available', (info) => {
    log('updater:update-available', { version: info?.version })
    const mainWindow = ctx.mainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', info)
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    log('updater:download-progress', { percent: progress?.percent })
    const mainWindow = ctx.mainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', progress)
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    log('updater:update-downloaded', { version: info?.version })
    const mainWindow = ctx.mainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', info)
    }
  })

  autoUpdater.on('error', (err) => {
    logError('updater:error', err)
  })

  setTimeout(() => {
    const end = startTimer('updater:check-for-updates')
    autoUpdater.checkForUpdates()
      .then(result => end({ success: true, updateInfo: result?.updateInfo?.version }))
      .catch(err => {
        end({ success: false, error: err.message })
        logError('updater:check-for-updates:error', err)
      })
  }, 5000)
}

function registerUpdaterHandlers(ipcMain, ctx) {
  ipcMain.handle('update-download', async () => {
    const end = startTimer('ipc:update-download')
    try {
      await autoUpdater.downloadUpdate()
      end({ success: true })
      return { success: true }
    } catch (err) {
      end({ success: false, error: err.message })
      logError('ipc:update-download:error', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('update-install', () => {
    log('ipc:update-install')
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('update-check', async () => {
    const end = startTimer('ipc:update-check')
    try {
      const result = await autoUpdater.checkForUpdates()
      end({ success: true, updateInfo: result?.updateInfo?.version })
      return { success: true, data: result }
    } catch (err) {
      end({ success: false, error: err.message })
      logError('ipc:update-check:error', err)
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerUpdaterHandlers, setupAutoUpdater }
