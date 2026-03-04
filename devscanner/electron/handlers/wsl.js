const fs = require('fs')
const { execSync } = require('child_process')
const { dialog } = require('electron')
const { isRunningInsideWsl } = require('../globals')
const { saveSettings } = require('../utils/settings-store')

function normalizeLinuxPath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') return '/'
  const normalized = inputPath
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .trim()

  if (normalized === '/') return '/'

  const parts = normalized.split('/').filter(Boolean)
  return '/' + parts.join('/')
}

function getLinuxParentPath(linuxPath) {
  const normalized = normalizeLinuxPath(linuxPath)
  if (normalized === '/') return null
  const parts = normalized.split('/').filter(Boolean)
  parts.pop()
  return parts.length > 0 ? '/' + parts.join('/') : '/'
}

function joinLinuxPath(basePath, segment) {
  const base = normalizeLinuxPath(basePath)
  if (!segment) return base
  if (base === '/') return `/${segment}`
  return `${base}/${segment}`
}

function linuxToWindowsWslPath(distro, linuxPath) {
  const normalized = normalizeLinuxPath(linuxPath)
  const suffix = normalized === '/' ? '' : normalized.replace(/\//g, '\\')
  return `\\\\wsl$\\${distro}${suffix}`
}

function getDefaultLinuxPath(distro) {
  const homeRoot = linuxToWindowsWslPath(distro, '/home')
  try {
    const homeEntries = fs.readdirSync(homeRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))

    if (homeEntries.length > 0) return `/home/${homeEntries[0]}`
    return '/home'
  } catch {
    return '/'
  }
}

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
      const defaultLinuxPath = getDefaultLinuxPath(distro)
      const defaultPath = linuxToWindowsWslPath(distro, defaultLinuxPath)

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

  ipcMain.handle('list-wsl-directories', async (event, payload = {}) => {
    if (process.platform !== 'win32') {
      return { success: false, error: 'WSL browsing is available only on Windows' }
    }

    const distro = typeof payload.distro === 'string' ? payload.distro.trim() : ''
    if (!distro) {
      return { success: false, error: 'WSL distro is required' }
    }

    try {
      const requestedPath = typeof payload.path === 'string' && payload.path.trim() !== ''
        ? payload.path
        : getDefaultLinuxPath(distro)
      const linuxPath = normalizeLinuxPath(requestedPath)
      const windowsPath = linuxToWindowsWslPath(distro, linuxPath)

      if (!fs.existsSync(windowsPath)) {
        return { success: false, error: `Directory not found: ${linuxPath}` }
      }

      const stat = fs.statSync(windowsPath)
      if (!stat.isDirectory()) {
        return { success: false, error: `Not a directory: ${linuxPath}` }
      }

      const directories = fs.readdirSync(windowsPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b))
        .map(name => ({
          name,
          linuxPath: joinLinuxPath(linuxPath, name)
        }))

      return {
        success: true,
        data: {
          distro,
          linuxPath,
          windowsPath,
          parentPath: getLinuxParentPath(linuxPath),
          directories
        }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('resolve-wsl-folder', async (event, payload = {}) => {
    if (process.platform !== 'win32') {
      return { success: false, error: 'WSL browsing is available only on Windows' }
    }

    const distro = typeof payload.distro === 'string' ? payload.distro.trim() : ''
    if (!distro) {
      return { success: false, error: 'WSL distro is required' }
    }

    const linuxPath = normalizeLinuxPath(payload.path)
    const windowsPath = linuxToWindowsWslPath(distro, linuxPath)

    try {
      if (!fs.existsSync(windowsPath)) {
        return { success: false, error: `Directory not found: ${linuxPath}` }
      }

      const stat = fs.statSync(windowsPath)
      if (!stat.isDirectory()) {
        return { success: false, error: `Not a directory: ${linuxPath}` }
      }

      saveSettings({ lastFolder: windowsPath })
      return {
        success: true,
        data: { distro, linuxPath, windowsPath }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerWslHandlers }
