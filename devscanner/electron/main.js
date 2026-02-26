const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('path')
const { execSync, spawn } = require('child_process')

const { setMainWindow, getMainWindow } = require('./globals')
const { isWslPath, parseWslPath } = require('./utils/context')
const { runningProcesses } = require('./utils/process')
const { sshConnections } = require('./utils/ssh-pool')
const { dockerHealthPollingTimers } = require('./utils/docker-services')

// --- Handler registrations ---
const { registerWindowHandlers } = require('./handlers/window')
const { registerProjectsHandlers } = require('./handlers/projects')
const { registerLauncherHandlers } = require('./handlers/launcher')
const { registerSettingsHandlers } = require('./handlers/settings')
const { registerWslHandlers } = require('./handlers/wsl')
const { registerPortsHandlers } = require('./handlers/ports')
const { registerDockerHandlers, containerLogProcesses } = require('./handlers/docker')
const { registerVcsHandlers } = require('./handlers/vcs')
const { registerEnvHandlers } = require('./handlers/env')
const { registerSshHandlers } = require('./handlers/ssh')
const { registerSshProjectsHandlers, remoteRunningProcesses } = require('./handlers/ssh-projects')
const { registerNginxHandlers } = require('./handlers/nginx')
const { registerDeployHandlers } = require('./handlers/deploy')
const { registerSshServiceHandlers } = require('./handlers/ssh-services')
const { registerUpdaterHandlers, setupAutoUpdater } = require('./handlers/updater')

// --- App configuration ---
app.commandLine.appendSwitch('no-sandbox')
app.disableHardwareAcceleration()
Menu.setApplicationMenu(null)

// --- Window creation ---

function createWindow() {
  console.log('Creating BrowserWindow...')
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  setMainWindow(mainWindow)

  mainWindow.on('maximize', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window-maximized', true)
  })
  mainWindow.on('unmaximize', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window-maximized', false)
  })

  const isDev = !app.isPackaged
  const devPort = process.env.PORT || '5173'
  if (isDev) {
    console.log(`Dev mode: loading http://localhost:${devPort}`)
    mainWindow.loadURL(`http://localhost:${devPort}`)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    console.log('Window ready-to-show, focusing...')
    mainWindow.show()
    mainWindow.focus()
  })
}

// --- App Lifecycle ---

app.whenReady().then(() => {
  createWindow()

  const ctx = { mainWindow: () => getMainWindow(), app }

  registerWindowHandlers(ipcMain, ctx)
  registerProjectsHandlers(ipcMain, ctx)
  registerLauncherHandlers(ipcMain, ctx)
  registerSettingsHandlers(ipcMain, ctx)
  registerWslHandlers(ipcMain, ctx)
  registerPortsHandlers(ipcMain, ctx)
  registerDockerHandlers(ipcMain, ctx)
  registerVcsHandlers(ipcMain, ctx)
  registerEnvHandlers(ipcMain, ctx)
  registerSshHandlers(ipcMain, ctx)
  registerSshProjectsHandlers(ipcMain, ctx)
  registerNginxHandlers(ipcMain, ctx)
  registerDeployHandlers(ipcMain, ctx)
  registerSshServiceHandlers(ipcMain)
  registerUpdaterHandlers(ipcMain, ctx)

  setupAutoUpdater(ctx)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  // Kill all running project processes
  for (const [, instances] of runningProcesses) {
    for (const [, entry] of instances) {
      try {
        const wsl = entry.cwd && isWslPath(entry.cwd)
        if (wsl) {
          const parsed = parseWslPath(entry.cwd)
          if (parsed && entry.port) {
            try {
              execSync(
                `wsl.exe -d ${parsed.distro} -- bash -lic "fuser -k ${entry.port}/tcp 2>/dev/null; exit 0"`,
                { timeout: 3000 }
              )
            } catch { /* best effort */ }
          }
          spawn('taskkill', ['/pid', String(entry.pid), '/f', '/t'])
        } else if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(entry.pid), '/f', '/t'])
        } else {
          try { process.kill(-entry.pid, 'SIGTERM') } catch { /* not group leader */ }
          try { process.kill(entry.pid, 'SIGTERM') } catch { /* already exited */ }
          if (entry.port) {
            try { execSync(`fuser -k ${entry.port}/tcp 2>/dev/null`, { timeout: 2000 }) } catch { /* ok */ }
          }
        }
      } catch {
        // process may have already exited
      }
    }
  }
  runningProcesses.clear()

  // Kill all container log streaming processes
  for (const [, proc] of containerLogProcesses) {
    try { proc.kill() } catch { /* already exited */ }
  }
  containerLogProcesses.clear()

  // Stop all docker services health polling
  for (const [, timerId] of dockerHealthPollingTimers) {
    clearInterval(timerId)
  }
  dockerHealthPollingTimers.clear()

  // Close all SSH connections
  for (const [, conn] of sshConnections) {
    try { conn.client.end() } catch { /* already closed */ }
  }
  sshConnections.clear()

  // Close all remote project streams
  for (const [, instances] of remoteRunningProcesses) {
    for (const [, entry] of instances) {
      try { entry.stream.close() } catch {}
    }
  }
  remoteRunningProcesses.clear()
})
