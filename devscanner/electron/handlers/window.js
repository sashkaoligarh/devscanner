function registerWindowHandlers(ipcMain, ctx) {
  ipcMain.handle('window-minimize', () => ctx.mainWindow()?.minimize())
  ipcMain.handle('window-maximize', () => {
    if (ctx.mainWindow()?.isMaximized()) ctx.mainWindow().unmaximize()
    else ctx.mainWindow()?.maximize()
  })
  ipcMain.handle('window-close', () => ctx.mainWindow()?.close())
  ipcMain.handle('window-is-maximized', () => ctx.mainWindow()?.isMaximized() ?? false)
}

module.exports = { registerWindowHandlers }
