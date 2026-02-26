const fs = require('fs')
const path = require('path')
const { validateEnvFileName, validateEnvPath } = require('../utils/settings-store')
const { detectEnvFiles } = require('../utils/analysis')

function registerEnvHandlers(ipcMain, ctx) {
  ipcMain.handle('read-env-file', async (_, { projectPath, fileName }) => {
    try {
      if (!validateEnvFileName(fileName) || !validateEnvPath(projectPath, fileName)) {
        return { success: false, error: 'Invalid file name' }
      }
      const filePath = path.join(projectPath, fileName)
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' }
      }
      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, data: { content, fileName } }
    } catch (err) { return { success: false, error: err.message } }
  })

  ipcMain.handle('save-env-file', async (_, { projectPath, fileName, content }) => {
    try {
      if (!validateEnvFileName(fileName) || !validateEnvPath(projectPath, fileName)) {
        return { success: false, error: 'Invalid file name' }
      }
      const filePath = path.join(projectPath, fileName)
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true }
    } catch (err) { return { success: false, error: err.message } }
  })

  ipcMain.handle('list-env-files', async (_, { projectPath }) => {
    try {
      const files = detectEnvFiles(projectPath)
      return { success: true, data: files }
    } catch (err) { return { success: false, error: err.message } }
  })
}

module.exports = { registerEnvHandlers }
