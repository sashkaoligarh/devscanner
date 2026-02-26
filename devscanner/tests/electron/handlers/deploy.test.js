// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import Module from 'module'

const mocks = vi.hoisted(() => ({
  getSSHClient: vi.fn(),
  sshExec: vi.fn(),
  sshExecSudo: vi.fn(),
  getServerPassword: vi.fn(),
  getSFTPClient: vi.fn(),
  uploadDirectory: vi.fn(),
  generateNginxConfig: vi.fn(),
  staticSiteTemplate: vi.fn(),
  staticPlusProxyTemplate: vi.fn(),
  showOpenDialog: vi.fn(),
  ensureNginx: vi.fn(),
  ensurePM2: vi.fn(),
  pm2Start: vi.fn(),
}))

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      dialog: { showOpenDialog: mocks.showOpenDialog }
    }
  }
  const parentDir = parent?.filename ? path.dirname(parent.filename) : ''
  if (request === '../utils/ssh-pool' || request === './utils/ssh-pool') {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/ssh-pool')) {
      return {
        getSSHClient: mocks.getSSHClient,
        sshExec: mocks.sshExec,
        sshExecSudo: mocks.sshExecSudo,
        getServerPassword: mocks.getServerPassword,
      }
    }
  }
  if (request === '../utils/sftp-utils' || request === './utils/sftp-utils') {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/sftp-utils')) {
      return {
        getSFTPClient: mocks.getSFTPClient,
        uploadDirectory: mocks.uploadDirectory,
      }
    }
  }
  if (request === '../utils/nginx-utils' || request === './utils/nginx-utils') {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/nginx-utils')) {
      return {
        generateNginxConfig: mocks.generateNginxConfig,
        staticSiteTemplate: mocks.staticSiteTemplate,
        staticPlusProxyTemplate: mocks.staticPlusProxyTemplate,
      }
    }
  }
  if (request === '../utils/pm2-utils' || request === './utils/pm2-utils') {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/pm2-utils')) {
      return {
        ensureNginx: mocks.ensureNginx,
        ensurePM2: mocks.ensurePM2,
        pm2Start: mocks.pm2Start,
      }
    }
  }
  return originalLoad.apply(this, arguments)
}

const { registerDeployHandlers } = require('../../../electron/handlers/deploy')

Module._load = originalLoad

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: (channel, fn) => { handlers[channel] = fn },
    invoke: (channel, ...args) => handlers[channel]?.(null, ...args),
    handlers
  }
}

describe('deploy handlers', () => {
  let ipcMain
  let ctx

  beforeEach(() => {
    vi.clearAllMocks()
    ipcMain = createMockIpcMain()
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    }
    ctx = { mainWindow: () => fakeWindow, app: {} }
    registerDeployHandlers(ipcMain, ctx)
  })

  describe('select-deploy-folder', () => {
    it('should return selected folder path', async () => {
      mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/home/user/site'] })
      const result = await ipcMain.invoke('select-deploy-folder')
      expect(result).toBe('/home/user/site')
    })

    it('should return null when cancelled', async () => {
      mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      const result = await ipcMain.invoke('select-deploy-folder')
      expect(result).toBeNull()
    })

    it('should return null when no window', async () => {
      ctx.mainWindow = () => null
      ipcMain = createMockIpcMain()
      registerDeployHandlers(ipcMain, ctx)
      const result = await ipcMain.invoke('select-deploy-folder')
      expect(result).toBeNull()
    })
  })

  describe('ssh-upload-folder', () => {
    it('should upload folder and return success', async () => {
      const fakeClient = {}
      const fakeSftp = {}
      mocks.getSSHClient.mockReturnValue(fakeClient)
      mocks.getSFTPClient.mockResolvedValue(fakeSftp)
      mocks.uploadDirectory.mockResolvedValue({ uploaded: 5, total: 5 })

      const result = await ipcMain.invoke('ssh-upload-folder', {
        serverId: 'srv1', localPath: '/local', remotePath: '/remote'
      })

      expect(result).toEqual({ success: true, data: { uploaded: 5, total: 5 } })
      expect(mocks.getSSHClient).toHaveBeenCalledWith('srv1')
      expect(mocks.getSFTPClient).toHaveBeenCalledWith(fakeClient)
      expect(mocks.uploadDirectory).toHaveBeenCalledWith(fakeSftp, '/local', '/remote', expect.any(Function))
    })

    it('should return error when not connected', async () => {
      mocks.getSSHClient.mockReturnValue(null)

      const result = await ipcMain.invoke('ssh-upload-folder', {
        serverId: 'srv1', localPath: '/local', remotePath: '/remote'
      })

      expect(result).toEqual({ success: false, error: 'Not connected' })
    })

    it('should return error on upload failure', async () => {
      mocks.getSSHClient.mockReturnValue({})
      mocks.getSFTPClient.mockRejectedValue(new Error('SFTP failed'))

      const result = await ipcMain.invoke('ssh-upload-folder', {
        serverId: 'srv1', localPath: '/local', remotePath: '/remote'
      })

      expect(result).toEqual({ success: false, error: 'SFTP failed' })
    })
  })

  describe('ssh-quick-deploy', () => {
    it('should run full deploy pipeline on success', async () => {
      const fakeClient = {}
      const fakeSftp = {}
      mocks.getSSHClient.mockReturnValue(fakeClient)
      mocks.getServerPassword.mockReturnValue('pass123')
      mocks.getSFTPClient.mockResolvedValue(fakeSftp)
      mocks.uploadDirectory.mockResolvedValue({ uploaded: 3, total: 3 })
      mocks.staticSiteTemplate.mockReturnValue({ serverName: 'example.com', listen: '80', root: '/var/www/example.com' })
      mocks.generateNginxConfig.mockReturnValue('server { listen 80; }')
      mocks.sshExecSudo.mockResolvedValue({ stdout: 'test is successful', stderr: '', code: 0 })

      const result = await ipcMain.invoke('ssh-quick-deploy', {
        serverId: 'srv1', localPath: '/local/site', domain: 'example.com'
      })

      expect(result.success).toBe(true)
      expect(result.data.domain).toBe('example.com')
      expect(result.data.uploaded).toBe(3)
      expect(result.data.url).toBe('http://example.com')
      expect(mocks.sshExecSudo).toHaveBeenCalled()
      expect(mocks.staticSiteTemplate).toHaveBeenCalledWith('example.com', '/var/www/example.com')
    })

    it('should include port in URL when non-80', async () => {
      mocks.getSSHClient.mockReturnValue({})
      mocks.getServerPassword.mockReturnValue('')
      mocks.getSFTPClient.mockResolvedValue({})
      mocks.uploadDirectory.mockResolvedValue({ uploaded: 1, total: 1 })
      mocks.staticSiteTemplate.mockReturnValue({ serverName: 'app.dev', listen: '3000' })
      mocks.generateNginxConfig.mockReturnValue('server {}')
      mocks.sshExecSudo.mockResolvedValue({ stdout: 'successful', stderr: '', code: 0 })

      const result = await ipcMain.invoke('ssh-quick-deploy', {
        serverId: 'srv1', localPath: '/local', domain: 'app.dev', port: '3000'
      })

      expect(result.success).toBe(true)
      expect(result.data.url).toBe('http://app.dev:3000')
    })

    it('should return error when not connected', async () => {
      mocks.getSSHClient.mockReturnValue(null)

      const result = await ipcMain.invoke('ssh-quick-deploy', {
        serverId: 'srv1', localPath: '/local', domain: 'test.com'
      })

      expect(result).toEqual({ success: false, error: 'Not connected' })
    })

    it('should return error for invalid domain', async () => {
      mocks.getSSHClient.mockReturnValue({})

      const result = await ipcMain.invoke('ssh-quick-deploy', {
        serverId: 'srv1', localPath: '/local', domain: '!@#$%'
      })

      expect(result).toEqual({ success: false, error: 'Invalid domain' })
    })

    it('should return error when nginx test fails', async () => {
      mocks.getSSHClient.mockReturnValue({})
      mocks.getServerPassword.mockReturnValue('')
      mocks.getSFTPClient.mockResolvedValue({})
      mocks.uploadDirectory.mockResolvedValue({ uploaded: 1, total: 1 })
      mocks.staticSiteTemplate.mockReturnValue({ serverName: 'bad.com', listen: '80' })
      mocks.generateNginxConfig.mockReturnValue('server {}')
      mocks.sshExecSudo.mockResolvedValue({ stdout: 'nginx: test failed', stderr: 'syntax error', code: 1 })

      const result = await ipcMain.invoke('ssh-quick-deploy', {
        serverId: 'srv1', localPath: '/local', domain: 'bad.com'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Nginx config test failed')
      expect(result.data.nginxTestFailed).toBe(true)
    })

    it('should handle unexpected errors', async () => {
      mocks.getSSHClient.mockReturnValue({})
      mocks.getServerPassword.mockReturnValue('')
      mocks.sshExecSudo.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
      mocks.getSFTPClient.mockRejectedValue(new Error('Connection dropped'))

      const result = await ipcMain.invoke('ssh-quick-deploy', {
        serverId: 'srv1', localPath: '/local', domain: 'test.com'
      })

      expect(result).toEqual({ success: false, error: 'Connection dropped' })
    })
  })
})
