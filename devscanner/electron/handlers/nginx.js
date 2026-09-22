const { getSSHClient, sshExec, sshExecSudo, getServerPassword } = require('../utils/ssh-pool')
const { parseNginxConfig } = require('../utils/nginx-utils')
const { shellQuote: q } = require('../utils/deploy-setup')

function siteFiles(siteName, source = 'sites-available') {
  if (typeof siteName !== 'string' || !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(siteName) || siteName.length > 255) throw new Error('Invalid site name')
  if (!['sites-available', 'conf.d'].includes(source)) throw new Error('Invalid nginx config directory')
  if (source === 'conf.d' && !siteName.endsWith('.conf')) throw new Error('conf.d files must end in .conf')
  const file = '/etc/nginx/' + source + '/' + siteName
  return { name: siteName, source, file, enabled: source === 'conf.d' ? file : '/etc/nginx/sites-enabled/' + siteName, disabled: file + '.disabled' }
}

function selectSiteFile(site) {
  return site.source === 'conf.d'
    ? 'site_file=' + q(site.file) + '\nif [ ! -e "$site_file" ] && [ -f ' + q(site.disabled) + ' ]; then site_file=' + q(site.disabled) + '; fi\n'
    : 'site_file=' + q(site.file) + '\nif [ -f ' + q(site.enabled) + ' ]; then site_file=' + q(site.enabled) + '; fi\n'
}

async function sudoChecked(client, command, password) {
  const result = await sshExecSudo(client, command, password, 10000)
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || 'Remote nginx command failed').trim())
  return result
}

function registerNginxHandlers(ipcMain, ctx) {
  // Include deploy configs installed in conf.d, keeping same-named files distinct.
  ipcMain.handle('ssh-nginx-list', async (_, { serverId }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }

      // Check if nginx is installed
      const whichResult = await sshExec(client, 'which nginx 2>/dev/null').catch(() => ({ stdout: '' }))
      if (!whichResult.stdout.trim()) {
        return { success: false, error: 'nginx_not_installed' }
      }

      const [available, enabled, confFiles] = await Promise.all([
        sshExec(client, 'ls /etc/nginx/sites-available/ 2>/dev/null').then(r => r.stdout.trim().split('\n').filter(Boolean)).catch(() => []),
        sshExec(client, 'ls /etc/nginx/sites-enabled/ 2>/dev/null').then(r => r.stdout.trim().split('\n').filter(Boolean)).catch(() => []),
        sshExec(client, 'ls /etc/nginx/conf.d/ 2>/dev/null').then(r => r.stdout.trim().split('\n').filter(Boolean)).catch(() => [])
      ])

      const sites = [...new Set([...available, ...enabled])].sort().map(name => ({
        name,
        source: 'sites-available',
        path: '/etc/nginx/' + (enabled.includes(name) ? 'sites-enabled/' : 'sites-available/') + name,
        enabled: enabled.includes(name)
      }))
      for (const name of [...new Set(confFiles.filter(name => /\.conf(?:\.disabled)?$/.test(name)).map(name => name.replace(/\.disabled$/, '')))].sort()) {
        const active = confFiles.includes(name)
        sites.push({ name, source: 'conf.d', path: '/etc/nginx/conf.d/' + name + (active ? '' : '.disabled'), enabled: active })
      }

      return { success: true, data: sites }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Read a specific site config
  ipcMain.handle('ssh-nginx-read', async (_, { serverId, siteName, source }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }

      const site = siteFiles(siteName, source)
      const result = await sudoChecked(client, selectSiteFile(site) + 'printf "%s\\n" "$site_file"\ncat -- "$site_file"', getServerPassword(serverId))
      const newline = result.stdout.indexOf('\n')
      const file = result.stdout.slice(0, newline), raw = result.stdout.slice(newline + 1)
      return { success: true, data: { raw, parsed: parseNginxConfig(raw), name: site.name, source: site.source, path: file } }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Save/create a site config
  ipcMain.handle('ssh-nginx-save', async (_, { serverId, siteName, source, content }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const site = siteFiles(siteName, source)
      if (typeof content !== 'string' || content.includes('\0') || content.length > 2 * 1024 * 1024) throw new Error('Invalid nginx config content')
      await sudoChecked(client, selectSiteFile(site) + 'printf "%s" ' + q(content) + ' > "$site_file"', password)

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Enable a site (symlink)
  ipcMain.handle('ssh-nginx-enable', async (_, { serverId, siteName, source }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const site = siteFiles(siteName, source)
      await sudoChecked(client, site.source === 'conf.d'
        ? 'test ! -e ' + q(site.file) + ' && test ! -L ' + q(site.file) + ' && mv -- ' + q(site.disabled) + ' ' + q(site.file)
        : 'test -f ' + q(site.file) + ' && ln -sf -- ' + q(site.file) + ' ' + q(site.enabled), password)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Disable a site (remove symlink)
  ipcMain.handle('ssh-nginx-disable', async (_, { serverId, siteName, source }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const site = siteFiles(siteName, source)
      await sudoChecked(client, site.source === 'conf.d'
        ? 'test ! -e ' + q(site.disabled) + ' && test ! -L ' + q(site.disabled) + ' && mv -- ' + q(site.file) + ' ' + q(site.disabled)
        : 'if [ -L ' + q(site.enabled) + ' ]; then rm -- ' + q(site.enabled) + ';\n' +
          'elif [ -f ' + q(site.enabled) + ' ]; then\n' +
          '  test ! -e ' + q(site.file) + ' && test ! -L ' + q(site.file) + ' && mv -- ' + q(site.enabled) + ' ' + q(site.file) + ';\nfi', password)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Delete a site config (remove from sites-enabled + sites-available, reload nginx)
  ipcMain.handle('ssh-nginx-delete', async (_, { serverId, siteName, source }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const site = siteFiles(siteName, source)
      await sudoChecked(client, 'rm -f -- ' + (site.source === 'conf.d' ? [site.file, site.disabled] : [site.enabled, site.file]).map(q).join(' '), password)

      // Test & reload
      await sudoChecked(client, 'nginx -t 2>&1', password)
      await sudoChecked(client, 'systemctl reload nginx', password)

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
      const ok = result.code === 0
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

      await sudoChecked(client, 'systemctl reload nginx', password)
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

  // Get listening ports on the remote server (with sudo for full process info)
  ipcMain.handle('ssh-listening-ports', async (_, { serverId }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      // Try with sudo first to get process names, fall back to without
      let stdout = ''
      try {
        const res = await sshExecSudo(client, 'ss -tlnp 2>/dev/null', password, 10000)
        stdout = res.stdout || ''
      } catch {
        const res = await sshExec(client, 'ss -tlnp 2>/dev/null')
        stdout = res.stdout || ''
      }

      if (!stdout.trim()) return { success: true, data: [] }
      const results = []
      const lines = stdout.split('\n').slice(1)
      for (const line of lines) {
        if (!line.trim()) continue
        const parts = line.trim().split(/\s+/)
        if (parts.length < 5) continue
        const localAddr = parts[3]
        const lastColon = localAddr.lastIndexOf(':')
        if (lastColon === -1) continue
        const address = localAddr.substring(0, lastColon)
        const port = parseInt(localAddr.substring(lastColon + 1), 10)
        if (isNaN(port)) continue
        let processName = '', pid = null
        const processCol = parts.slice(5).join(' ')
        const pidMatch = processCol.match(/pid=(\d+)/)
        const nameMatch = processCol.match(/\("([^"]+)"/)
        if (pidMatch) pid = parseInt(pidMatch[1], 10)
        if (nameMatch) processName = nameMatch[1]
        results.push({ port, address, processName, pid })
      }
      return { success: true, data: results }
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

      // Check if certbot is installed
      const whichResult = await sshExec(client, 'which certbot 2>/dev/null').catch(() => ({ stdout: '' }))
      if (!whichResult.stdout.trim()) {
        return { success: false, error: 'certbot_not_installed' }
      }

      const result = await sshExecSudo(client,
        `certbot --nginx -d ${safeDomain} --non-interactive --agree-tos --register-unsafely-without-email 2>&1`,
        password, 120000
      )
      const output = (result.stdout || '') + (result.stderr || '')
      const ok = result.code === 0
      return { success: ok, data: { output }, error: ok ? undefined : (output || 'Certbot failed') }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerNginxHandlers }
