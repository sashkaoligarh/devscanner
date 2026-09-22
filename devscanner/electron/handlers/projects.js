const { dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { loadSettings, saveSettings } = require('../utils/settings-store')
const { analyzeProject, findProjectRoots } = require('../utils/analysis')
const { logError, startTimer } = require('../utils/app-log')

function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve))
}

function registerProjectsHandlers(ipcMain, ctx) {
  ipcMain.handle('select-folder', async () => {
    const end = startTimer('ipc:select-folder')
    try {
      const settings = loadSettings()
      const result = await dialog.showOpenDialog(ctx.mainWindow(), {
        properties: ['openDirectory'],
        defaultPath: settings.lastFolder || undefined
      })
      console.log('Dialog result:', result)
      if (result.canceled || result.filePaths.length === 0) {
        end({ canceled: true })
        return null
      }
      const selected = result.filePaths[0]
      saveSettings({ lastFolder: selected })
      end({ canceled: false, selected })
      return selected
    } catch (err) {
      end({ error: err.message })
      logError('ipc:select-folder:error', err)
      console.error('select-folder error:', err)
      return null
    }
  })

  ipcMain.handle('scan-folder', async (event, folderPath) => {
    const end = startTimer('ipc:scan-folder', { folderPath })
    try {
      if (!fs.existsSync(folderPath)) {
        end({ success: false, error: 'Folder not found or inaccessible' })
        return { success: false, error: 'Folder not found or inaccessible' }
      }

      const projects = []
      const slowEntries = []

      let i = 0
      for await (const projectPath of findProjectRoots(path.resolve(folderPath))) {
        if (i > 0 && i % 10 === 0) await yieldToEventLoop()
        i++
        try {
          const startedAt = Date.now()
          const project = analyzeProject(projectPath)
          const relativePath = path.relative(folderPath, projectPath).split(path.sep).join('/') || path.basename(projectPath)
          if (project) projects.push({ ...project, relativePath })
          const durationMs = Date.now() - startedAt
          if (durationMs > 750) slowEntries.push({ entry: relativePath, durationMs })
        } catch {
          // skip inaccessible entries
        }
      }

      end({ success: true, projects: projects.length, slowEntries: slowEntries.slice(0, 10) })
      return { success: true, data: projects }
    } catch (err) {
      end({ success: false, error: err.message })
      logError('ipc:scan-folder:error', err, { folderPath })
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerProjectsHandlers }
