const fs = require('fs')
const os = require('os')
const path = require('path')
const { app } = require('electron')

const MAX_LOG_BYTES = 2 * 1024 * 1024

function getLogPath() {
  try {
    return path.join(app.getPath('userData'), 'devscanner.log')
  } catch {
    return path.join(os.tmpdir(), 'devscanner.log')
  }
}

function serialize(data) {
  if (!data) return ''
  try {
    return ` ${JSON.stringify(data)}`
  } catch {
    return ' [unserializable]'
  }
}

function rotateIfNeeded(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size < MAX_LOG_BYTES) return
    const rotatedPath = `${filePath}.1`
    try { fs.rmSync(rotatedPath, { force: true }) } catch {}
    fs.renameSync(filePath, rotatedPath)
  } catch {
    // Missing log file is expected on first run.
  }
}

function log(message, data) {
  try {
    const filePath = getLogPath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    rotateIfNeeded(filePath)
    fs.appendFileSync(filePath, `[${new Date().toISOString()}] ${message}${serialize(data)}\n`, 'utf-8')
  } catch {
    // Diagnostics must never affect app startup.
  }
}

function logError(message, err, data = {}) {
  log(message, {
    ...data,
    error: err?.message || String(err),
    stack: err?.stack
  })
}

function startTimer(message, data) {
  const startedAt = Date.now()
  log(`${message}:start`, data)
  return (endData = {}) => {
    log(`${message}:end`, {
      ...endData,
      durationMs: Date.now() - startedAt
    })
  }
}

module.exports = {
  getLogPath,
  log,
  logError,
  startTimer
}
