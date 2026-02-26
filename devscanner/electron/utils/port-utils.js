const net = require('net')
const { execSync } = require('child_process')

function parseSSOutput(stdout) {
  const lines = stdout.split('\n').filter(l => l.trim())
  const results = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue

    const localAddr = parts[3]
    const lastColon = localAddr.lastIndexOf(':')
    if (lastColon === -1) continue

    const address = localAddr.substring(0, lastColon)
    const port = parseInt(localAddr.substring(lastColon + 1), 10)
    if (isNaN(port)) continue

    let pid = null
    let processName = null

    const processCol = parts.slice(5).join(' ')
    const pidMatch = processCol.match(/pid=(\d+)/)
    const nameMatch = processCol.match(/\("([^"]+)"/)
    if (pidMatch) pid = parseInt(pidMatch[1], 10)
    if (nameMatch) processName = nameMatch[1]

    results.push({ port, pid, processName, address })
  }
  return results
}

function parseLsofOutput(stdout) {
  const lines = stdout.split('\n').filter(l => l.trim())
  const results = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/)
    if (parts.length < 9) continue
    const processName = parts[0]
    const pid = parseInt(parts[1], 10)
    const nameCol = parts[8]
    const lastColon = nameCol.lastIndexOf(':')
    if (lastColon === -1) continue
    const port = parseInt(nameCol.substring(lastColon + 1), 10)
    if (isNaN(port)) continue
    const address = nameCol.substring(0, lastColon)
    results.push({ port, pid, processName, address })
  }
  return results
}

function parseNetstatOutput(stdout) {
  const lines = stdout.split('\n').filter(l => l.includes('LISTENING'))
  const results = []
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    const localAddr = parts[1]
    const lastColon = localAddr.lastIndexOf(':')
    if (lastColon === -1) continue
    const port = parseInt(localAddr.substring(lastColon + 1), 10)
    const address = localAddr.substring(0, lastColon)
    const pid = parseInt(parts[parts.length - 1], 10)
    let processName = null
    if (!isNaN(pid)) {
      try {
        const tasklist = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
          encoding: 'utf-8', timeout: 3000
        }).trim()
        const match = tasklist.match(/"([^"]+)"/)
        if (match) processName = match[1]
      } catch { /* skip */ }
    }
    results.push({ port, pid: isNaN(pid) ? null : pid, processName, address })
  }
  return results
}

function scanListeningPorts() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf-8', timeout: 10000 })
      return parseNetstatOutput(out)
    } else if (process.platform === 'darwin') {
      const out = execSync('lsof -iTCP -sTCP:LISTEN -n -P', { encoding: 'utf-8', timeout: 10000 })
      return parseLsofOutput(out)
    } else {
      const out = execSync('ss -tlnp', { encoding: 'utf-8', timeout: 10000 })
      return parseSSOutput(out)
    }
  } catch {
    return []
  }
}

function probePort(port, timeout = 200) {
  return new Promise(resolve => {
    const sock = new net.Socket()
    sock.setTimeout(timeout)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('timeout', () => {
      sock.destroy()
      resolve(false)
    })
    sock.once('error', () => {
      sock.destroy()
      resolve(false)
    })
    sock.connect(port, '127.0.0.1')
  })
}

module.exports = {
  parseSSOutput,
  parseLsofOutput,
  parseNetstatOutput,
  scanListeningPorts,
  probePort
}
