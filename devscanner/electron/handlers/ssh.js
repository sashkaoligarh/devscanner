const { safeStorage } = require('electron')
const {
  sshConnections,
  sshExec,
  connectSSH,
  disconnectSSH,
  getSSHClient,
  getServerPassword,
  discoverServerOS,
  discoverDockerContainers,
  discoverPM2Processes,
  discoverScreenSessions,
  discoverSystemdServices,
  discoverNginxSites,
  discoverListeningPorts,
  discoverProjectRoots,
  generateServerTags
} = require('../utils/ssh-pool')
const { loadSettings, saveSettings } = require('../utils/settings-store')

function registerSshHandlers(ipcMain, ctx) {
  ipcMain.handle('ssh-connect', async (_, { server }) => {
    try {
      if (getSSHClient(server.id)) return { success: true, data: { alreadyConnected: true } }
      await connectSSH(server)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-disconnect', async (_, { serverId }) => {
    try {
      disconnectSSH(serverId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-discover', async (_, { serverId }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)
      const [os, docker, pm2, screen, systemd, nginx, ports, projects] = await Promise.all([
        discoverServerOS(client),
        discoverDockerContainers(client),
        discoverPM2Processes(client, password),
        discoverScreenSessions(client),
        discoverSystemdServices(client),
        discoverNginxSites(client),
        discoverListeningPorts(client),
        discoverProjectRoots(client)
      ])
      const discovery = { os, docker, pm2, screen, systemd, nginx, ports, projects }
      const tags = generateServerTags(discovery)
      return { success: true, data: { ...discovery, tags } }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-exec', async (_, { serverId, command }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const result = await sshExec(client, command, 30000)
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-save-server', async (_, { server }) => {
    try {
      const settings = loadSettings()
      const servers = settings.remoteServers || []
      const toSave = { ...server }
      // Encrypt password
      if (toSave.password && safeStorage.isEncryptionAvailable()) {
        toSave.encryptedPassword = safeStorage.encryptString(toSave.password).toString('base64')
        delete toSave.password
      }
      const idx = servers.findIndex(s => s.id === toSave.id)
      if (idx >= 0) {
        servers[idx] = { ...servers[idx], ...toSave }
      } else {
        servers.push(toSave)
      }
      saveSettings({ remoteServers: servers })
      return { success: true, data: servers }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-delete-server', async (_, { serverId }) => {
    try {
      disconnectSSH(serverId)
      const settings = loadSettings()
      const servers = (settings.remoteServers || []).filter(s => s.id !== serverId)
      saveSettings({ remoteServers: servers })
      return { success: true, data: servers }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-get-servers', async () => {
    try {
      const settings = loadSettings()
      return { success: true, data: settings.remoteServers || [] }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerSshHandlers }
