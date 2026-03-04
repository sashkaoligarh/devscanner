const { loadSettings, saveSettings } = require('./settings-store')
const { PromptDetector } = require('./prompt-detector')
const { getSSHClient } = require('./ssh-pool')

const terminalSessions = new Map() // serverId -> SessionEntry

function createSession(serverId, serverConfig, mainWindow) {
  return new Promise((resolve, reject) => {
    if (terminalSessions.has(serverId)) {
      destroySession(serverId)
    }

    const cols = 80
    const rows = 24

    // Reuse existing SSH connection from the pool (server must be connected first)
    const existingClient = getSSHClient(serverId)
    if (existingClient) {
      return openShell(existingClient, serverId, cols, rows, mainWindow, false, resolve, reject)
    }

    // Fallback: create new connection using connectSSH from pool
    // This ensures consistent auth handling (same code path as "Connect" button)
    const { connectSSH } = require('./ssh-pool')
    connectSSH(serverConfig).then(client => {
      openShell(client, serverId, cols, rows, mainWindow, false, resolve, reject)
    }).catch(err => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:error', {
          sessionId: serverId,
          error: err.message
        })
      }
      reject(err)
    })
  })
}

function openShell(client, serverId, cols, rows, mainWindow, ownsClient, resolve, reject) {
  client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
    if (err) {
      if (ownsClient) client.end()
      return reject(err)
    }

    const promptDetector = new PromptDetector()
    const session = {
      serverId,
      client,
      stream,
      cols,
      rows,
      ownsClient, // only end client on destroy if we created it
      osc133Active: false,
      promptDetector
    }
    terminalSessions.set(serverId, session)

    // Inject OSC 133 shell integration after shell init
    setTimeout(() => {
      try {
        stream.write(promptDetector.getOSC133InitScript())
      } catch { /* stream may have closed */ }
    }, 200)

    stream.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', {
          sessionId: serverId,
          data: data.toString('binary')
        })
      }

      // Run prompt detection for command history
      try {
        const result = promptDetector.processData(data)
        session.osc133Active = result.osc133Active
        if (result.commands.length > 0) {
          for (const cmd of result.commands) {
            addCommandToHistory(serverId, cmd)
          }
        }
      } catch { /* ignore detection errors */ }
    })

    stream.on('close', () => {
      terminalSessions.delete(serverId)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:closed', {
          sessionId: serverId,
          reason: 'Session closed'
        })
      }
    })

    stream.stderr.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', {
          sessionId: serverId,
          data: data.toString('binary')
        })
      }
    })

    resolve({ sessionId: serverId })
  })
}

function addCommandToHistory(serverId, command) {
  try {
    if (!command || !command.trim()) return
    const settings = loadSettings()
    const commandHistory = settings.commandHistory || {}
    const history = commandHistory[serverId] || []
    const trimmed = command.trim()

    // Deduplicate consecutive identical commands
    if (history.length > 0 && history[history.length - 1].command === trimmed) return

    history.push({ command: trimmed, timestamp: new Date().toISOString() })

    const limit = (settings.terminalSettings || {}).commandHistoryLimit || 1000
    while (history.length > limit) history.shift()

    commandHistory[serverId] = history
    saveSettings({ commandHistory })
  } catch { /* ignore history errors */ }
}

function destroySession(serverId) {
  const session = terminalSessions.get(serverId)
  if (!session) return

  if (session.promptDetector) session.promptDetector.reset()
  try { session.stream.close() } catch { /* already closed */ }
  // Only end the SSH client if the terminal session created it (not reused from pool)
  if (session.ownsClient) {
    setTimeout(() => {
      try { session.client.end() } catch { /* already ended */ }
    }, 100)
  }
  terminalSessions.delete(serverId)
}

function getSession(serverId) {
  return terminalSessions.get(serverId) || null
}

function writeToSession(serverId, data) {
  const session = terminalSessions.get(serverId)
  if (session?.stream) {
    session.stream.write(data)
  }
}

function resizeSession(serverId, cols, rows) {
  const session = terminalSessions.get(serverId)
  if (session?.stream) {
    session.cols = cols
    session.rows = rows
    session.stream.setWindow(rows, cols, rows * 16, cols * 8)
  }
}

function destroyAllSessions() {
  for (const [serverId] of terminalSessions) {
    destroySession(serverId)
  }
}

module.exports = {
  terminalSessions,
  createSession,
  destroySession,
  getSession,
  writeToSession,
  resizeSession,
  destroyAllSessions
}
