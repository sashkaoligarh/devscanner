const { app, Notification } = require('electron')
const { getMainWindow } = require('../globals')

// Map<projectPath, Map<instanceId, ProcessEntry>>
const runningProcesses = new Map()

function getProcessEntry(projectPath, instanceId) {
  const instances = runningProcesses.get(projectPath)
  return instances ? instances.get(instanceId) : undefined
}

function setProcessEntry(projectPath, instanceId, entry) {
  if (!runningProcesses.has(projectPath)) {
    runningProcesses.set(projectPath, new Map())
  }
  runningProcesses.get(projectPath).set(instanceId, entry)
}

function deleteProcessEntry(projectPath, instanceId) {
  const instances = runningProcesses.get(projectPath)
  if (!instances) return
  instances.delete(instanceId)
  if (instances.size === 0) runningProcesses.delete(projectPath)
}

function updateBadgeCount() {
  let count = 0
  for (const [, instances] of runningProcesses) count += instances.size
  try { app.setBadgeCount(count) } catch { /* not supported on all platforms */ }
}

function devNotify(title, body, silent = false) {
  if (!Notification.isSupported()) return
  try { new Notification({ title, body, silent }).show() } catch { /* ignore */ }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /(?:\x1b\x5b|\x1b\(B|\x9b)[\x20-\x3f]*[\x40-\x7e]|\x1b[\x20-\x2f]*[\x30-\x7e]/g
// Orphaned bracket codes (ESC byte stripped by wsl.exe pipe): [32m, [1m, [0m, etc.
const ORPHAN_RE = /\[(?:\d{1,3}(?:;\d{0,3})*)?[mGKHJABCDEFsu]/g

function stripAnsi(str) {
  return str.replace(ANSI_RE, '').replace(ORPHAN_RE, '')
}

// Detect actual port from dev server output (Vite, Next, CRA, etc.)
const PORT_PATTERNS = [
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/,  // http://localhost:5175
  /Local:\s+https?:\/\/[^:]+:(\d+)/,                          // Local:   http://localhost:5175
  /listening (?:on|at) (?:port )?(\d+)/i,                      // listening on port 3000
  /started (?:on|at) (?:port )?(\d+)/i,                        // started on port 8000
  /ready on .*:(\d+)/i,                                        // ready on http://localhost:3000
]

function detectPort(text) {
  for (const re of PORT_PATTERNS) {
    const m = text.match(re)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

function attachProcessListeners(proc, projectPath, instanceId, options = {}) {
  const { background = false } = options
  let portDetected = false

  function handleOutput(chunk) {
    const clean = stripAnsi(chunk.toString())
    const mainWindow = getMainWindow()

    // Detect real port from output and update stored entry
    if (!portDetected) {
      const realPort = detectPort(clean)
      if (realPort) {
        portDetected = true
        const entry = getProcessEntry(projectPath, instanceId)
        if (entry && entry.port !== realPort) {
          console.log(`[DevScanner] Port change detected: ${entry.port} → ${realPort} (${instanceId})`)
          entry.port = realPort
          // Notify frontend about the real port
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('project-port-changed', {
              projectPath, instanceId, port: realPort
            })
          }
        }
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-log', {
        projectPath, instanceId, data: clean
      })
    }
  }

  proc.stdout.on('data', handleOutput)
  proc.stderr.on('data', handleOutput)

  proc.on('close', (code) => {
    deleteProcessEntry(projectPath, instanceId)
    updateBadgeCount()
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-stopped', { projectPath, instanceId, code, background })
    }
    if (!background && code !== 0 && code !== null) {
      devNotify('DevScanner — Process Crashed', `${instanceId} exited with code ${code}`)
    }
  })

  proc.on('error', (err) => {
    deleteProcessEntry(projectPath, instanceId)
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-log', {
        projectPath,
        instanceId,
        data: `Process error: ${err.message}\n`
      })
      mainWindow.webContents.send('project-stopped', { projectPath, instanceId, code: null })
    }
  })
}

module.exports = {
  runningProcesses,
  getProcessEntry,
  setProcessEntry,
  deleteProcessEntry,
  attachProcessListeners,
  stripAnsi,
  detectPort,
  updateBadgeCount,
  devNotify
}
