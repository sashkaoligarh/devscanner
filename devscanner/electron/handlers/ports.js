const { execSync } = require('child_process')
const { scanListeningPorts, probePort } = require('../utils/port-utils')
const { COMMON_DEV_PORTS } = require('../constants')
const { runningProcesses } = require('../utils/process')

function registerPortsHandlers(ipcMain, ctx) {
  ipcMain.handle('scan-ports', async (event, { mode }) => {
    try {
      // First try OS-level scan for process info
      const osResults = scanListeningPorts()

      if (mode === 'common') {
        // Filter to common dev ports, or probe them if OS scan returned nothing
        if (osResults.length > 0) {
          const commonSet = new Set(COMMON_DEV_PORTS)
          const filtered = osResults.filter(r => commonSet.has(r.port))
          // Also include any running process ports we manage
          for (const [, instances] of runningProcesses) {
            for (const [, entry] of instances) {
              if (!filtered.find(r => r.port === entry.port)) {
                filtered.push({
                  port: entry.port,
                  pid: entry.pid,
                  processName: 'devscanner-managed',
                  address: '0.0.0.0'
                })
              }
            }
          }
          return { success: true, data: filtered.sort((a, b) => a.port - b.port) }
        }

        // Fallback: probe common ports
        const results = []
        const probes = COMMON_DEV_PORTS.map(async port => {
          const open = await probePort(port)
          if (open) results.push({ port, pid: null, processName: null, address: '127.0.0.1' })
        })
        await Promise.all(probes)
        return { success: true, data: results.sort((a, b) => a.port - b.port) }
      }

      // Full scan: return all OS results
      if (osResults.length > 0) {
        return { success: true, data: osResults.sort((a, b) => a.port - b.port) }
      }

      // Fallback: probe common ports only (full probe of 65k ports would be too slow)
      const results = []
      const probes = COMMON_DEV_PORTS.map(async port => {
        const open = await probePort(port)
        if (open) results.push({ port, pid: null, processName: null, address: '127.0.0.1' })
      })
      await Promise.all(probes)
      return { success: true, data: results.sort((a, b) => a.port - b.port) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('kill-port-process', async (event, { pid, signal }) => {
    try {
      if (!pid || typeof pid !== 'number') {
        return { success: false, error: 'Invalid PID' }
      }

      // Don't kill our own process or system processes
      if (pid === process.pid || pid <= 1) {
        return { success: false, error: 'Cannot kill this process' }
      }

      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /F /T`, { timeout: 5000 })
      } else {
        const sig = signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
        process.kill(pid, sig)
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerPortsHandlers }
