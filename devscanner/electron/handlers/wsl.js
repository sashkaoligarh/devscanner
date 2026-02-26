const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { dialog } = require('electron')
const { isRunningInsideWsl } = require('../globals')
const { loadSettings, saveSettings } = require('../utils/settings-store')

function getWslConfigPath() {
  // Get Windows USERPROFILE path and convert to WSL-accessible path
  const winProfile = execSync('cmd.exe /c "echo %USERPROFILE%"', { encoding: 'utf-8', timeout: 3000 }).trim()
  const wslPath = execSync(`wslpath -u "${winProfile.replace(/\\/g, '\\\\')}"`, { encoding: 'utf-8', timeout: 3000 }).trim()
  return `${wslPath}/.wslconfig`
}

function registerWslHandlers(ipcMain, ctx) {
  ipcMain.handle('check-wsl-localhost', async () => {
    if (!isRunningInsideWsl) return { available: false }
    try {
      const wslconfigPath = getWslConfigPath()
      let content = ''
      try { content = fs.readFileSync(wslconfigPath, 'utf-8') } catch { /* file doesn't exist */ }
      const match = content.match(/^\s*localhostForwarding\s*=\s*(\w+)/im)
      const forwarding = match ? match[1].toLowerCase() === 'true' : null
      return { available: true, forwarding, wslconfigPath }
    } catch (err) {
      return { available: false, error: err.message }
    }
  })

  ipcMain.handle('fix-wsl-localhost', async () => {
    if (!isRunningInsideWsl) return { success: false, error: 'Not running in WSL' }
    try {
      const wslconfigPath = getWslConfigPath()
      let content = ''
      try { content = fs.readFileSync(wslconfigPath, 'utf-8') } catch { /* will create */ }

      if (/^\[wsl2\]/im.test(content)) {
        if (/^\s*localhostForwarding\s*=/im.test(content)) {
          content = content.replace(/^\s*localhostForwarding\s*=.*/im, 'localhostForwarding=true')
        } else {
          content = content.replace(/(\[wsl2\])/i, '$1\nlocalhostForwarding=true')
        }
      } else {
        content = content.trimEnd() + (content.length > 0 ? '\n\n' : '') + '[wsl2]\nlocalhostForwarding=true\n'
      }

      fs.writeFileSync(wslconfigPath, content, 'utf-8')
      return { success: true, wslconfigPath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-wsl-distros', async () => {
    if (process.platform !== 'win32') return []
    try {
      const output = execSync('wsl.exe -l -q', { encoding: 'utf-8', timeout: 5000 })
      return output.replace(/\0/g, '').split('\n').map(l => l.trim()).filter(Boolean)
    } catch {
      return []
    }
  })

  ipcMain.handle('select-wsl-folder', async (event, distro) => {
    if (process.platform !== 'win32' || !distro) return null
    try {
      const wslRoot = `\\\\wsl$\\${distro}\\home`
      // Try to find user home dirs inside /home
      let defaultPath = `\\\\wsl$\\${distro}`
      try {
        const homeEntries = fs.readdirSync(wslRoot)
        if (homeEntries.length > 0) {
          defaultPath = path.join(wslRoot, homeEntries[0])
        }
      } catch { /* use distro root */ }

      const result = await dialog.showOpenDialog(ctx.mainWindow(), {
        properties: ['openDirectory'],
        defaultPath
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const selected = result.filePaths[0]
      saveSettings({ lastFolder: selected })
      return selected
    } catch (err) {
      console.error('select-wsl-folder error:', err)
      return null
    }
  })
}

module.exports = { registerWslHandlers }
