const { assistant, settingsStatus, configureAssistant } = require('../utils/deploy-assistant')

function registerDeployAssistantHandlers(ipcMain, ctx) {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_, payload = {}) => {
    try { return { success: true, data: await fn(payload) } }
    catch (err) { return { success: false, error: err.message } }
  })
  handle('deploy-assistant-settings', payload => payload.save ? configureAssistant(payload) : settingsStatus())
  handle('deploy-assistant-history', payload => assistant.history(payload))
  handle('deploy-assistant-cancel', payload => { assistant.cancel(payload.serverId); return null })
  handle('deploy-assistant-run', payload => assistant.diagnose(payload, progress => {
    const window = ctx.mainWindow()
    if (window && !window.isDestroyed()) window.webContents.send('deploy-assistant-progress', { serverId: payload.serverId, projectPath: payload.projectPath, ...progress })
  }))
  ctx.app?.on?.('before-quit', () => assistant.cancelAll())
}

module.exports = { registerDeployAssistantHandlers }
