const { dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { loadSettings, saveSettings } = require('../utils/settings-store')
const { analyzeProject } = require('../utils/analysis')

function registerProjectsHandlers(ipcMain, ctx) {
  ipcMain.handle('select-folder', async () => {
    try {
      const settings = loadSettings()
      const result = await dialog.showOpenDialog(ctx.mainWindow(), {
        properties: ['openDirectory'],
        defaultPath: settings.lastFolder || undefined
      })
      console.log('Dialog result:', result)
      if (result.canceled || result.filePaths.length === 0) return null
      const selected = result.filePaths[0]
      saveSettings({ lastFolder: selected })
      return selected
    } catch (err) {
      console.error('select-folder error:', err)
      return null
    }
  })

  ipcMain.handle('scan-folder', async (event, folderPath) => {
    try {
      if (!fs.existsSync(folderPath)) {
        return { success: false, error: 'Folder not found or inaccessible' }
      }

      const entries = fs.readdirSync(folderPath)
      const projects = []

      for (const entry of entries) {
        const childPath = path.join(folderPath, entry)
        try {
          const stat = fs.statSync(childPath)
          if (!stat.isDirectory()) continue
          const project = analyzeProject(childPath)
          if (project) projects.push(project)
        } catch {
          // skip inaccessible entries
        }
      }

      return { success: true, data: projects }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerProjectsHandlers }
