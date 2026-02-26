const { getSSHClient, sshExec, sshExecSudo, getServerPassword } = require('../utils/ssh-pool')

/** Try command, if it fails for ANY reason — retry with sudo */
async function execThenSudo(client, cmd, password, timeout = 15000) {
  const result = await sshExec(client, `${cmd} 2>&1`, timeout)
  if (result.code === 0) return result
  if (!password) return result
  return sshExecSudo(client, `${cmd} 2>&1`, password, timeout)
}

function registerSshServiceHandlers(ipcMain) {
  // PM2 actions: restart, stop, delete
  ipcMain.handle('ssh-pm2-action', async (_, { serverId, name, action }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)
      const allowed = ['restart', 'stop', 'delete']
      if (!allowed.includes(action)) return { success: false, error: 'Invalid action' }
      const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '')
      const result = await execThenSudo(client, `pm2 ${action} ${safeName}`, password, 15000)
      if (result.code !== 0) return { success: false, error: result.stderr || result.stdout || 'Command failed' }
      return { success: true, data: result.stdout }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // PM2 logs
  ipcMain.handle('ssh-pm2-logs', async (_, { serverId, name, lines }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)
      const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '')
      const n = Math.min(parseInt(lines, 10) || 50, 200)
      const result = await execThenSudo(client, `pm2 logs ${safeName} --nostream --lines ${n}`, password, 10000)
      return { success: true, data: result.stdout || result.stderr || 'No logs' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Docker actions: start, stop, restart
  ipcMain.handle('ssh-docker-action', async (_, { serverId, name, action }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)
      const allowed = ['start', 'stop', 'restart']
      if (!allowed.includes(action)) return { success: false, error: 'Invalid action' }
      const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '')
      const result = await execThenSudo(client, `docker ${action} ${safeName}`, password, 30000)
      if (result.code !== 0) return { success: false, error: result.stderr || result.stdout || 'Command failed' }
      return { success: true, data: result.stdout }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Docker logs
  ipcMain.handle('ssh-docker-logs', async (_, { serverId, name, lines }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)
      const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '')
      const n = Math.min(parseInt(lines, 10) || 50, 200)
      const result = await execThenSudo(client, `docker logs --tail ${n} ${safeName}`, password, 10000)
      return { success: true, data: result.stdout || result.stderr || 'No logs' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Systemd actions: start, stop, restart
  ipcMain.handle('ssh-systemd-action', async (_, { serverId, unit, action }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)
      const allowed = ['start', 'stop', 'restart']
      if (!allowed.includes(action)) return { success: false, error: 'Invalid action' }
      const safeUnit = unit.replace(/[^a-zA-Z0-9_@.-]/g, '')
      const result = await sshExecSudo(client, `systemctl ${action} ${safeUnit} 2>&1`, password, 15000)
      if (result.code !== 0) return { success: false, error: result.stderr || result.stdout || 'Command failed' }
      return { success: true, data: result.stdout }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Systemd logs (journalctl)
  ipcMain.handle('ssh-systemd-logs', async (_, { serverId, unit, lines }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const safeUnit = unit.replace(/[^a-zA-Z0-9_@.-]/g, '')
      const n = Math.min(parseInt(lines, 10) || 50, 200)
      const result = await sshExec(client, `journalctl -u ${safeUnit} --no-pager -n ${n} 2>&1`, 10000)
      return { success: true, data: result.stdout || 'No logs' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerSshServiceHandlers }
