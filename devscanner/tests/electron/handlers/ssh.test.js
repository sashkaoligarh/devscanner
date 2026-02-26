// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import Module from 'module'

const mocks = vi.hoisted(() => ({
  // electron
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  // ssh-pool
  sshConnections: new Map(),
  sshExec: vi.fn(),
  connectSSH: vi.fn(),
  disconnectSSH: vi.fn(),
  getSSHClient: vi.fn(),
  discoverServerOS: vi.fn(),
  discoverDockerContainers: vi.fn(),
  discoverPM2Processes: vi.fn(),
  discoverScreenSessions: vi.fn(),
  discoverSystemdServices: vi.fn(),
  discoverNginxSites: vi.fn(),
  discoverListeningPorts: vi.fn(),
  discoverProjectRoots: vi.fn(),
  generateServerTags: vi.fn(),
  // settings-store
  loadSettings: vi.fn(),
  saveSettings: vi.fn()
}))

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      safeStorage: {
        isEncryptionAvailable: mocks.isEncryptionAvailable,
        encryptString: mocks.encryptString
      }
    }
  }
  const parentDir = parent?.filename ? path.dirname(parent.filename) : ''
  if (request.includes('utils/ssh-pool')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/ssh-pool')) {
      return {
        sshConnections: mocks.sshConnections,
        sshExec: mocks.sshExec,
        connectSSH: mocks.connectSSH,
        disconnectSSH: mocks.disconnectSSH,
        getSSHClient: mocks.getSSHClient,
        discoverServerOS: mocks.discoverServerOS,
        discoverDockerContainers: mocks.discoverDockerContainers,
        discoverPM2Processes: mocks.discoverPM2Processes,
        discoverScreenSessions: mocks.discoverScreenSessions,
        discoverSystemdServices: mocks.discoverSystemdServices,
        discoverNginxSites: mocks.discoverNginxSites,
        discoverListeningPorts: mocks.discoverListeningPorts,
        discoverProjectRoots: mocks.discoverProjectRoots,
        generateServerTags: mocks.generateServerTags
      }
    }
  }
  if (request.includes('utils/settings-store')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/settings-store')) {
      return {
        loadSettings: mocks.loadSettings,
        saveSettings: mocks.saveSettings
      }
    }
  }
  return originalLoad.apply(this, arguments)
}

const { registerSshHandlers } = require('../../../electron/handlers/ssh')

Module._load = originalLoad

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: (channel, fn) => { handlers[channel] = fn },
    invoke: (channel, ...args) => handlers[channel]?.(null, ...args),
    handlers
  }
}

describe('ssh handlers', () => {
  let ipcMain

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    // Reset all mock implementations to default (return undefined)
    Object.values(mocks).forEach(m => {
      if (typeof m?.mockReset === 'function') m.mockReset()
    })
    ipcMain = createMockIpcMain()
    registerSshHandlers(ipcMain, {})
  })

  describe('ssh-connect', () => {
    it('should return alreadyConnected if client exists', async () => {
      mocks.getSSHClient.mockReturnValue({ /* mock client */ })

      const result = await ipcMain.invoke('ssh-connect', {
        server: { id: 'srv-1', host: 'example.com' }
      })

      expect(result).toEqual({ success: true, data: { alreadyConnected: true } })
      expect(mocks.connectSSH).not.toHaveBeenCalled()
    })

    it('should connect successfully when not already connected', async () => {
      mocks.getSSHClient.mockReturnValue(null)
      mocks.connectSSH.mockResolvedValue(undefined)

      const server = { id: 'srv-1', host: 'example.com', username: 'admin' }
      const result = await ipcMain.invoke('ssh-connect', { server })

      expect(result).toEqual({ success: true })
      expect(mocks.connectSSH).toHaveBeenCalledWith(server)
    })

    it('should return error on connection failure', async () => {
      mocks.getSSHClient.mockReturnValue(null)
      mocks.connectSSH.mockRejectedValue(new Error('Connection refused'))

      const result = await ipcMain.invoke('ssh-connect', {
        server: { id: 'srv-1', host: 'unreachable.com' }
      })

      expect(result).toEqual({ success: false, error: 'Connection refused' })
    })
  })

  describe('ssh-disconnect', () => {
    it('should disconnect successfully', async () => {
      mocks.disconnectSSH.mockReturnValue(undefined)

      const result = await ipcMain.invoke('ssh-disconnect', { serverId: 'srv-1' })

      expect(result).toEqual({ success: true })
      expect(mocks.disconnectSSH).toHaveBeenCalledWith('srv-1')
    })

    it('should return error if disconnect throws', async () => {
      mocks.disconnectSSH.mockImplementation(() => { throw new Error('Client not found') })

      const result = await ipcMain.invoke('ssh-disconnect', { serverId: 'srv-bad' })

      expect(result).toEqual({ success: false, error: 'Client not found' })
    })
  })

  describe('ssh-discover', () => {
    it('should return not connected if no client', async () => {
      mocks.getSSHClient.mockReturnValue(null)

      const result = await ipcMain.invoke('ssh-discover', { serverId: 'srv-1' })

      expect(result).toEqual({ success: false, error: 'Not connected' })
    })

    it('should discover all server info and return with tags', async () => {
      const mockClient = {}
      mocks.getSSHClient.mockReturnValue(mockClient)

      const mockDiscovery = {
        os: { distro: 'Ubuntu', version: '22.04' },
        docker: [{ name: 'web', status: 'running' }],
        pm2: [],
        screen: [],
        systemd: ['nginx.service'],
        nginx: [{ domain: 'example.com' }],
        ports: [{ port: 80, process: 'nginx' }],
        projects: ['/var/www/app']
      }

      mocks.discoverServerOS.mockResolvedValue(mockDiscovery.os)
      mocks.discoverDockerContainers.mockResolvedValue(mockDiscovery.docker)
      mocks.discoverPM2Processes.mockResolvedValue(mockDiscovery.pm2)
      mocks.discoverScreenSessions.mockResolvedValue(mockDiscovery.screen)
      mocks.discoverSystemdServices.mockResolvedValue(mockDiscovery.systemd)
      mocks.discoverNginxSites.mockResolvedValue(mockDiscovery.nginx)
      mocks.discoverListeningPorts.mockResolvedValue(mockDiscovery.ports)
      mocks.discoverProjectRoots.mockResolvedValue(mockDiscovery.projects)
      mocks.generateServerTags.mockReturnValue(['docker', 'nginx', 'ubuntu'])

      const result = await ipcMain.invoke('ssh-discover', { serverId: 'srv-1' })

      expect(result.success).toBe(true)
      expect(result.data.os).toEqual(mockDiscovery.os)
      expect(result.data.docker).toEqual(mockDiscovery.docker)
      expect(result.data.tags).toEqual(['docker', 'nginx', 'ubuntu'])
      expect(mocks.discoverServerOS).toHaveBeenCalledWith(mockClient)
      expect(mocks.generateServerTags).toHaveBeenCalledWith(mockDiscovery)
    })

    it('should return error on discovery failure', async () => {
      mocks.getSSHClient.mockReturnValue({})
      mocks.discoverServerOS.mockRejectedValue(new Error('Timeout'))

      const result = await ipcMain.invoke('ssh-discover', { serverId: 'srv-1' })

      expect(result).toEqual({ success: false, error: 'Timeout' })
    })
  })

  describe('ssh-exec', () => {
    it('should return not connected if no client', async () => {
      mocks.getSSHClient.mockReturnValue(null)

      const result = await ipcMain.invoke('ssh-exec', {
        serverId: 'srv-1',
        command: 'ls -la'
      })

      expect(result).toEqual({ success: false, error: 'Not connected' })
    })

    it('should execute command and return result', async () => {
      const mockClient = {}
      mocks.getSSHClient.mockReturnValue(mockClient)
      mocks.sshExec.mockResolvedValue({ stdout: 'file1\nfile2', exitCode: 0 })

      const result = await ipcMain.invoke('ssh-exec', {
        serverId: 'srv-1',
        command: 'ls -la'
      })

      expect(result).toEqual({
        success: true,
        data: { stdout: 'file1\nfile2', exitCode: 0 }
      })
      expect(mocks.sshExec).toHaveBeenCalledWith(mockClient, 'ls -la', 30000)
    })

    it('should return error on exec failure', async () => {
      mocks.getSSHClient.mockReturnValue({})
      mocks.sshExec.mockRejectedValue(new Error('Command timed out'))

      const result = await ipcMain.invoke('ssh-exec', {
        serverId: 'srv-1',
        command: 'sleep 100'
      })

      expect(result).toEqual({ success: false, error: 'Command timed out' })
    })
  })

  describe('ssh-save-server', () => {
    it('should add a new server when none exists', async () => {
      mocks.loadSettings.mockReturnValue({ remoteServers: [] })
      mocks.isEncryptionAvailable.mockReturnValue(false)

      const server = { id: 'srv-new', host: 'new.example.com', username: 'root' }
      const result = await ipcMain.invoke('ssh-save-server', { server })

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({ id: 'srv-new', host: 'new.example.com' })
      expect(mocks.saveSettings).toHaveBeenCalledWith({
        remoteServers: [expect.objectContaining({ id: 'srv-new' })]
      })
    })

    it('should update an existing server', async () => {
      mocks.loadSettings.mockReturnValue({
        remoteServers: [{ id: 'srv-1', host: 'old.example.com', username: 'admin' }]
      })
      mocks.isEncryptionAvailable.mockReturnValue(false)

      const server = { id: 'srv-1', host: 'updated.example.com' }
      const result = await ipcMain.invoke('ssh-save-server', { server })

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({
        id: 'srv-1',
        host: 'updated.example.com',
        username: 'admin'
      })
    })

    it('should encrypt password when encryption is available', async () => {
      mocks.loadSettings.mockReturnValue({ remoteServers: [] })
      mocks.isEncryptionAvailable.mockReturnValue(true)
      mocks.encryptString.mockReturnValue(Buffer.from('encrypted-data'))

      const server = { id: 'srv-1', host: 'example.com', password: 'secret123' }
      const result = await ipcMain.invoke('ssh-save-server', { server })

      expect(result.success).toBe(true)
      expect(mocks.encryptString).toHaveBeenCalledWith('secret123')
      const saved = result.data[0]
      expect(saved.encryptedPassword).toBe(Buffer.from('encrypted-data').toString('base64'))
      expect(saved.password).toBeUndefined()
    })

    it('should keep plain password when encryption is unavailable', async () => {
      mocks.loadSettings.mockReturnValue({ remoteServers: [] })
      mocks.isEncryptionAvailable.mockReturnValue(false)

      const server = { id: 'srv-1', host: 'example.com', password: 'secret123' }
      const result = await ipcMain.invoke('ssh-save-server', { server })

      expect(result.success).toBe(true)
      expect(result.data[0].password).toBe('secret123')
    })

    it('should handle missing remoteServers in settings', async () => {
      mocks.loadSettings.mockReturnValue({})
      mocks.isEncryptionAvailable.mockReturnValue(false)

      const server = { id: 'srv-1', host: 'example.com' }
      const result = await ipcMain.invoke('ssh-save-server', { server })

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
    })
  })

  describe('ssh-delete-server', () => {
    it('should remove server and disconnect', async () => {
      mocks.loadSettings.mockReturnValue({
        remoteServers: [
          { id: 'srv-1', host: 'a.com' },
          { id: 'srv-2', host: 'b.com' }
        ]
      })

      const result = await ipcMain.invoke('ssh-delete-server', { serverId: 'srv-1' })

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe('srv-2')
      expect(mocks.disconnectSSH).toHaveBeenCalledWith('srv-1')
      expect(mocks.saveSettings).toHaveBeenCalledWith({
        remoteServers: [{ id: 'srv-2', host: 'b.com' }]
      })
    })

    it('should handle deleting non-existent server', async () => {
      mocks.loadSettings.mockReturnValue({ remoteServers: [{ id: 'srv-1', host: 'a.com' }] })

      const result = await ipcMain.invoke('ssh-delete-server', { serverId: 'srv-missing' })

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
    })

    it('should handle missing remoteServers in settings', async () => {
      mocks.loadSettings.mockReturnValue({})

      const result = await ipcMain.invoke('ssh-delete-server', { serverId: 'srv-1' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual([])
    })

    it('should return error if disconnect throws', async () => {
      mocks.disconnectSSH.mockImplementation(() => { throw new Error('Disconnect failed') })

      const result = await ipcMain.invoke('ssh-delete-server', { serverId: 'srv-1' })

      expect(result).toEqual({ success: false, error: 'Disconnect failed' })
    })
  })

  describe('ssh-get-servers', () => {
    it('should return server list', async () => {
      const servers = [
        { id: 'srv-1', host: 'a.com' },
        { id: 'srv-2', host: 'b.com' }
      ]
      mocks.loadSettings.mockReturnValue({ remoteServers: servers })

      const result = await ipcMain.invoke('ssh-get-servers')

      expect(result).toEqual({ success: true, data: servers })
    })

    it('should return empty array when no servers configured', async () => {
      mocks.loadSettings.mockReturnValue({})

      const result = await ipcMain.invoke('ssh-get-servers')

      expect(result).toEqual({ success: true, data: [] })
    })

    it('should handle loadSettings error', async () => {
      mocks.loadSettings.mockImplementation(() => { throw new Error('Corrupted settings') })

      const result = await ipcMain.invoke('ssh-get-servers')

      expect(result).toEqual({ success: false, error: 'Corrupted settings' })
    })
  })

  describe('handler registration', () => {
    it('should register all ssh handlers', () => {
      expect(ipcMain.handlers).toHaveProperty('ssh-connect')
      expect(ipcMain.handlers).toHaveProperty('ssh-disconnect')
      expect(ipcMain.handlers).toHaveProperty('ssh-discover')
      expect(ipcMain.handlers).toHaveProperty('ssh-exec')
      expect(ipcMain.handlers).toHaveProperty('ssh-save-server')
      expect(ipcMain.handlers).toHaveProperty('ssh-delete-server')
      expect(ipcMain.handlers).toHaveProperty('ssh-get-servers')
    })
  })
})
