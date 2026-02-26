const { getSSHClient, sshExec, sshExecSudo, getServerPassword } = require('../utils/ssh-pool')
const { parseNginxConfig, generateNginxConfig } = require('../utils/nginx-utils')

function registerNginxHandlers(ipcMain, ctx) {
  // List sites-available and sites-enabled
  ipcMain.handle('ssh-nginx-list', async (_, { serverId }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }

      const [available, enabled] = await Promise.all([
        sshExec(client, 'ls /etc/nginx/sites-available/ 2>/dev/null').then(r => r.stdout.trim().split('\n').filter(Boolean)).catch(() => []),
        sshExec(client, 'ls /etc/nginx/sites-enabled/ 2>/dev/null').then(r => r.stdout.trim().split('\n').filter(Boolean)).catch(() => [])
      ])

      const sites = available.map(name => ({
        name,
        enabled: enabled.includes(name)
      }))

      return { success: true, data: sites }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Read a specific site config
  ipcMain.handle('ssh-nginx-read', async (_, { serverId, siteName }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }

      const safeName = siteName.replace(/[^a-zA-Z0-9._-]/g, '')
      if (!safeName) return { success: false, error: 'Invalid site name' }

      const { stdout } = await sshExec(client, `cat /etc/nginx/sites-available/${safeName}`)
      const parsed = parseNginxConfig(stdout)

      return { success: true, data: { raw: stdout, parsed, name: safeName } }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Save/create a site config
  ipcMain.handle('ssh-nginx-save', async (_, { serverId, siteName, content }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const safeName = siteName.replace(/[^a-zA-Z0-9._-]/g, '')
      if (!safeName) return { success: false, error: 'Invalid site name' }

      const escaped = content.replace(/'/g, "'\\''")
      await sshExecSudo(client, `echo '${escaped}' | tee /etc/nginx/sites-available/${safeName} > /dev/null`, password, 10000)

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Enable a site (symlink)
  ipcMain.handle('ssh-nginx-enable', async (_, { serverId, siteName }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const safeName = siteName.replace(/[^a-zA-Z0-9._-]/g, '')
      if (!safeName) return { success: false, error: 'Invalid site name' }

      await sshExecSudo(client, `ln -sf /etc/nginx/sites-available/${safeName} /etc/nginx/sites-enabled/${safeName}`, password, 10000)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Disable a site (remove symlink)
  ipcMain.handle('ssh-nginx-disable', async (_, { serverId, siteName }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const safeName = siteName.replace(/[^a-zA-Z0-9._-]/g, '')
      if (!safeName) return { success: false, error: 'Invalid site name' }

      await sshExecSudo(client, `rm -f /etc/nginx/sites-enabled/${safeName}`, password, 10000)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Delete a site config (remove from sites-enabled + sites-available, reload nginx)
  ipcMain.handle('ssh-nginx-delete', async (_, { serverId, siteName }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const safeName = siteName.replace(/[^a-zA-Z0-9._-]/g, '')
      if (!safeName) return { success: false, error: 'Invalid site name' }

      // Remove symlink + config file
      await sshExecSudo(client, `rm -f /etc/nginx/sites-enabled/${safeName}`, password, 10000)
      await sshExecSudo(client, `rm -f /etc/nginx/sites-available/${safeName}`, password, 10000)

      // Test & reload
      const testResult = await sshExecSudo(client, 'nginx -t 2>&1', password, 10000)
      const testOk = (testResult.stdout + testResult.stderr).includes('successful')
      if (testOk) {
        await sshExecSudo(client, 'systemctl reload nginx', password, 10000)
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Test nginx config
  ipcMain.handle('ssh-nginx-test', async (_, { serverId }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const result = await sshExecSudo(client, 'nginx -t 2>&1', password, 10000)
      const ok = (result.stdout + result.stderr).includes('successful')
      return { success: true, data: { ok, output: result.stdout + result.stderr } }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Reload nginx
  ipcMain.handle('ssh-nginx-reload', async (_, { serverId }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      await sshExecSudo(client, 'systemctl reload nginx', password, 10000)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Install nginx
  ipcMain.handle('ssh-nginx-install', async (_, { serverId }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      await sshExecSudo(client, 'apt-get update -qq', password, 30000)
      const result = await sshExecSudo(client, 'apt-get install -y -qq nginx 2>&1', password, 120000)
      const ok = result.code === 0
      return { success: ok, data: { output: result.stdout + result.stderr }, error: ok ? undefined : 'Installation failed' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Install certbot
  ipcMain.handle('ssh-certbot-install', async (_, { serverId }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      await sshExecSudo(client, 'apt-get update -qq', password, 30000)
      const result = await sshExecSudo(client, 'apt-get install -y -qq certbot python3-certbot-nginx 2>&1', password, 120000)
      const ok = result.code === 0
      return { success: ok, data: { output: result.stdout + result.stderr }, error: ok ? undefined : 'Installation failed' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Run certbot for a domain
  ipcMain.handle('ssh-certbot-run', async (_, { serverId, domain }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '')
      if (!safeDomain) return { success: false, error: 'Invalid domain' }

      const result = await sshExecSudo(client,
        `certbot --nginx -d ${safeDomain} --non-interactive --agree-tos --register-unsafely-without-email 2>&1`,
        password, 120000
      )
      const ok = result.code === 0
      return { success: ok, data: { output: result.stdout + result.stderr }, error: ok ? undefined : 'Certbot failed' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerNginxHandlers }
