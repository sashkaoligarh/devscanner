// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import path from 'path'
import Module from 'module'

const mocks = vi.hoisted(() => ({
  // child_process
  execSync: vi.fn(),
  spawn: vi.fn(),
  // fs
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  // context
  isWslPath: vi.fn(),
  parseWslPath: vi.fn(),
  execInContext: vi.fn(),
  // docker-detect
  isDockerAvailable: vi.fn(),
  isDockerAvailableInContext: vi.fn(),
  getDockerComposeCmd: vi.fn(),
  getDockerComposeCmdInContext: vi.fn(),
  // docker-services
  SERVICE_CATALOG: {
    postgres: { label: 'PostgreSQL', defaultPort: 5432, image: 'postgres:16' },
    redis: { label: 'Redis', defaultPort: 6379, image: 'redis:7' },
    mysql: { label: 'MySQL', defaultPort: 3306, image: 'mysql:8' }
  },
  sanitizeProjectName: vi.fn(),
  generateComposeFile: vi.fn(),
  generateConnectionString: vi.fn(),
  startHealthPolling: vi.fn(),
  stopHealthPolling: vi.fn(),
  // process
  stripAnsi: vi.fn((s) => s),
  // port-utils
  probePort: vi.fn(),
  // settings-store
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  validateEnvFileName: vi.fn(),
  validateEnvPath: vi.fn()
}))

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  const parentDir = parent?.filename ? path.dirname(parent.filename) : ''

  if (request === 'child_process') {
    return { execSync: mocks.execSync, spawn: mocks.spawn }
  }
  if (request === 'fs') {
    return {
      existsSync: mocks.existsSync,
      readFileSync: mocks.readFileSync,
      writeFileSync: mocks.writeFileSync
    }
  }
  if (request.includes('utils/context')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/context')) {
      return {
        isWslPath: mocks.isWslPath,
        parseWslPath: mocks.parseWslPath,
        execInContext: mocks.execInContext
      }
    }
  }
  if (request.includes('utils/docker-detect')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/docker-detect')) {
      return {
        isDockerAvailable: mocks.isDockerAvailable,
        isDockerAvailableInContext: mocks.isDockerAvailableInContext,
        getDockerComposeCmd: mocks.getDockerComposeCmd,
        getDockerComposeCmdInContext: mocks.getDockerComposeCmdInContext
      }
    }
  }
  if (request.includes('utils/docker-services')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/docker-services')) {
      return {
        SERVICE_CATALOG: mocks.SERVICE_CATALOG,
        sanitizeProjectName: mocks.sanitizeProjectName,
        generateComposeFile: mocks.generateComposeFile,
        generateConnectionString: mocks.generateConnectionString,
        startHealthPolling: mocks.startHealthPolling,
        stopHealthPolling: mocks.stopHealthPolling
      }
    }
  }
  if (request.includes('utils/process')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/process')) {
      return { stripAnsi: mocks.stripAnsi }
    }
  }
  if (request.includes('utils/port-utils')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/port-utils')) {
      return { probePort: mocks.probePort }
    }
  }
  if (request.includes('utils/settings-store')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/settings-store')) {
      return {
        loadSettings: mocks.loadSettings,
        saveSettings: mocks.saveSettings,
        validateEnvFileName: mocks.validateEnvFileName,
        validateEnvPath: mocks.validateEnvPath
      }
    }
  }
  return originalLoad.apply(this, arguments)
}

const { registerDockerHandlers, containerLogProcesses } = require('../../../electron/handlers/docker')

Module._load = originalLoad

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: (channel, fn) => { handlers[channel] = fn },
    invoke: (channel, ...args) => handlers[channel]?.(null, ...args),
    handlers
  }
}

describe('docker handlers', () => {
  let ipcMain

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    Object.values(mocks).forEach(m => {
      if (typeof m?.mockReset === 'function') m.mockReset()
    })
    // Restore stripAnsi default behavior
    mocks.stripAnsi.mockImplementation((s) => s)
    containerLogProcesses.clear()
    ipcMain = createMockIpcMain()
    registerDockerHandlers(ipcMain, {
      mainWindow: () => null
    })
  })

  describe('docker-services-catalog', () => {
    it('should return the SERVICE_CATALOG', async () => {
      const result = await ipcMain.invoke('docker-services-catalog')

      expect(result).toEqual({ success: true, data: mocks.SERVICE_CATALOG })
      expect(result.data).toHaveProperty('postgres')
      expect(result.data).toHaveProperty('redis')
      expect(result.data).toHaveProperty('mysql')
    })

    it('should return catalog entries with expected fields', async () => {
      const result = await ipcMain.invoke('docker-services-catalog')

      expect(result.data.postgres).toMatchObject({
        label: 'PostgreSQL',
        defaultPort: 5432,
        image: 'postgres:16'
      })
    })
  })

  describe('docker-services-config', () => {
    it('should return config for a project', async () => {
      const mockConfig = {
        services: { postgres: { enabled: true, port: 5432 } },
        lastStarted: '2026-01-01T00:00:00.000Z'
      }
      mocks.loadSettings.mockReturnValue({
        dockerServices: { '/project': mockConfig }
      })

      const result = await ipcMain.invoke('docker-services-config', {
        projectPath: '/project'
      })

      expect(result).toEqual({ success: true, data: mockConfig })
    })

    it('should return null when no config exists for project', async () => {
      mocks.loadSettings.mockReturnValue({ dockerServices: {} })

      const result = await ipcMain.invoke('docker-services-config', {
        projectPath: '/unknown-project'
      })

      expect(result).toEqual({ success: true, data: null })
    })

    it('should return null when dockerServices is missing', async () => {
      mocks.loadSettings.mockReturnValue({})

      const result = await ipcMain.invoke('docker-services-config', {
        projectPath: '/project'
      })

      expect(result).toEqual({ success: true, data: null })
    })

    it('should handle loadSettings error', async () => {
      mocks.loadSettings.mockImplementation(() => { throw new Error('Read error') })

      const result = await ipcMain.invoke('docker-services-config', {
        projectPath: '/project'
      })

      expect(result).toEqual({ success: false, error: 'Read error' })
    })
  })

  describe('docker-services-save', () => {
    it('should save services config for a project', async () => {
      mocks.loadSettings.mockReturnValue({ dockerServices: {} })

      const services = {
        postgres: { enabled: true, port: 5432 },
        redis: { enabled: false }
      }
      const result = await ipcMain.invoke('docker-services-save', {
        projectPath: '/project',
        services
      })

      expect(result).toEqual({ success: true })
      expect(mocks.saveSettings).toHaveBeenCalledWith({
        dockerServices: {
          '/project': { services, lastStarted: null }
        }
      })
    })

    it('should preserve lastStarted from existing config', async () => {
      mocks.loadSettings.mockReturnValue({
        dockerServices: {
          '/project': {
            services: { postgres: { enabled: true } },
            lastStarted: '2026-01-15T12:00:00.000Z'
          }
        }
      })

      const services = { postgres: { enabled: true, port: 5433 } }
      const result = await ipcMain.invoke('docker-services-save', {
        projectPath: '/project',
        services
      })

      expect(result).toEqual({ success: true })
      expect(mocks.saveSettings).toHaveBeenCalledWith({
        dockerServices: {
          '/project': { services, lastStarted: '2026-01-15T12:00:00.000Z' }
        }
      })
    })

    it('should initialize dockerServices if missing', async () => {
      mocks.loadSettings.mockReturnValue({})

      const services = { redis: { enabled: true, port: 6379 } }
      const result = await ipcMain.invoke('docker-services-save', {
        projectPath: '/project',
        services
      })

      expect(result).toEqual({ success: true })
      expect(mocks.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          dockerServices: expect.objectContaining({
            '/project': expect.objectContaining({ services })
          })
        })
      )
    })

    it('should handle save error', async () => {
      mocks.loadSettings.mockReturnValue({ dockerServices: {} })
      mocks.saveSettings.mockImplementation(() => { throw new Error('Write error') })

      const result = await ipcMain.invoke('docker-services-save', {
        projectPath: '/project',
        services: {}
      })

      expect(result).toEqual({ success: false, error: 'Write error' })
    })
  })

  describe('docker-services-inject-env', () => {
    beforeEach(() => {
      mocks.validateEnvFileName.mockReturnValue(true)
      mocks.validateEnvPath.mockReturnValue(true)
    })

    it('should create new env file with entries', async () => {
      mocks.existsSync.mockReturnValue(false)
      mocks.writeFileSync.mockImplementation(() => {})

      const result = await ipcMain.invoke('docker-services-inject-env', {
        projectPath: '/project',
        envFileName: '.env',
        entries: [
          { key: 'DB_HOST', value: 'localhost' },
          { key: 'DB_PORT', value: '5432' }
        ]
      })

      expect(result).toEqual({ success: true })
      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        '/project/.env',
        'DB_HOST=localhost\nDB_PORT=5432\n',
        'utf-8'
      )
    })

    it('should append to existing env file', async () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue('EXISTING_KEY=value\n')
      mocks.writeFileSync.mockImplementation(() => {})

      const result = await ipcMain.invoke('docker-services-inject-env', {
        projectPath: '/project',
        envFileName: '.env',
        entries: [{ key: 'NEW_KEY', value: 'new_value' }]
      })

      expect(result).toEqual({ success: true })
      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        '/project/.env',
        'EXISTING_KEY=value\nNEW_KEY=new_value\n',
        'utf-8'
      )
    })

    it('should replace existing keys in env file', async () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue('DB_HOST=oldhost\nDB_PORT=3306\n')
      mocks.writeFileSync.mockImplementation(() => {})

      const result = await ipcMain.invoke('docker-services-inject-env', {
        projectPath: '/project',
        envFileName: '.env',
        entries: [{ key: 'DB_HOST', value: 'newhost' }]
      })

      expect(result).toEqual({ success: true })
      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        '/project/.env',
        'DB_HOST=newhost\nDB_PORT=3306\n',
        'utf-8'
      )
    })

    it('should handle mix of new and existing keys', async () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue('DB_HOST=oldhost\nAPP_NAME=myapp\n')
      mocks.writeFileSync.mockImplementation(() => {})

      const result = await ipcMain.invoke('docker-services-inject-env', {
        projectPath: '/project',
        envFileName: '.env',
        entries: [
          { key: 'DB_HOST', value: 'newhost' },
          { key: 'DB_PORT', value: '5432' }
        ]
      })

      expect(result).toEqual({ success: true })
      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        '/project/.env',
        'DB_HOST=newhost\nAPP_NAME=myapp\nDB_PORT=5432\n',
        'utf-8'
      )
    })

    it('should default to .env when envFileName is not provided', async () => {
      mocks.existsSync.mockReturnValue(false)
      mocks.writeFileSync.mockImplementation(() => {})

      const result = await ipcMain.invoke('docker-services-inject-env', {
        projectPath: '/project',
        entries: [{ key: 'KEY', value: 'val' }]
      })

      expect(result).toEqual({ success: true })
      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        '/project/.env',
        expect.stringContaining('KEY=val'),
        'utf-8'
      )
    })

    it('should reject invalid file name', async () => {
      mocks.validateEnvFileName.mockReturnValue(false)

      const result = await ipcMain.invoke('docker-services-inject-env', {
        projectPath: '/project',
        envFileName: 'bad-file',
        entries: [{ key: 'KEY', value: 'val' }]
      })

      expect(result).toEqual({ success: false, error: 'Invalid file name' })
    })

    it('should reject invalid path', async () => {
      mocks.validateEnvFileName.mockReturnValue(true)
      mocks.validateEnvPath.mockReturnValue(false)

      const result = await ipcMain.invoke('docker-services-inject-env', {
        projectPath: '/project',
        envFileName: '.env',
        entries: [{ key: 'KEY', value: 'val' }]
      })

      expect(result).toEqual({ success: false, error: 'Invalid file name' })
    })

    it('should add newline before appending if content does not end with one', async () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue('EXISTING=value')
      mocks.writeFileSync.mockImplementation(() => {})

      await ipcMain.invoke('docker-services-inject-env', {
        projectPath: '/project',
        envFileName: '.env',
        entries: [{ key: 'NEW_KEY', value: 'new_value' }]
      })

      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        '/project/.env',
        'EXISTING=value\nNEW_KEY=new_value\n',
        'utf-8'
      )
    })
  })

  describe('docker-container-action', () => {
    it('should reject invalid action', async () => {
      const result = await ipcMain.invoke('docker-container-action', {
        containerId: 'abc123',
        action: 'exec',
        projectPath: '/project'
      })

      expect(result).toEqual({ success: false, error: 'Invalid action' })
    })

    it('should reject invalid container ID', async () => {
      const result = await ipcMain.invoke('docker-container-action', {
        containerId: 'not-valid!',
        action: 'start',
        projectPath: '/project'
      })

      expect(result).toEqual({ success: false, error: 'Invalid container ID' })
    })

    it('should reject container ID that is too short', async () => {
      const result = await ipcMain.invoke('docker-container-action', {
        containerId: 'abc',
        action: 'stop',
        projectPath: '/project'
      })

      expect(result).toEqual({ success: false, error: 'Invalid container ID' })
    })

    it('should accept valid container ID with start action', async () => {
      mocks.execSync.mockReturnValue('')

      const result = await ipcMain.invoke('docker-container-action', {
        containerId: 'abcd1234',
        action: 'start',
        projectPath: '/project'
      })

      expect(result).toEqual({ success: true })
    })

    it('should accept valid container ID with stop action', async () => {
      mocks.execSync.mockReturnValue('')

      const result = await ipcMain.invoke('docker-container-action', {
        containerId: 'abcdef1234567890',
        action: 'stop',
        projectPath: '/project'
      })

      expect(result).toEqual({ success: true })
    })

    it('should accept valid container ID with restart action', async () => {
      mocks.execSync.mockReturnValue('')

      const result = await ipcMain.invoke('docker-container-action', {
        containerId: 'abcdef12',
        action: 'restart',
        projectPath: '/project'
      })

      expect(result).toEqual({ success: true })
    })

    it('should use rm -f for remove action', async () => {
      mocks.execSync.mockReturnValue('')

      await ipcMain.invoke('docker-container-action', {
        containerId: 'abcdef12',
        action: 'rm',
        projectPath: '/project'
      })

      expect(mocks.execSync).toHaveBeenCalledWith(
        'docker rm -f abcdef12',
        expect.objectContaining({ encoding: 'utf-8' })
      )
    })

    it('should handle docker error', async () => {
      mocks.execSync.mockImplementation(() => { throw new Error('Container not found') })

      const result = await ipcMain.invoke('docker-container-action', {
        containerId: 'abcdef12',
        action: 'stop',
        projectPath: '/project'
      })

      expect(result).toEqual({ success: false, error: 'Container not found' })
    })
  })

  describe('docker-stop-logs', () => {
    it('should kill and remove log process', async () => {
      const mockProc = { kill: vi.fn() }
      containerLogProcesses.set('abc123', mockProc)

      const result = await ipcMain.invoke('docker-stop-logs', {
        containerId: 'abc123'
      })

      expect(result).toEqual({ success: true })
      expect(mockProc.kill).toHaveBeenCalled()
      expect(containerLogProcesses.has('abc123')).toBe(false)
    })

    it('should return success even if no log process exists', async () => {
      const result = await ipcMain.invoke('docker-stop-logs', {
        containerId: 'nonexistent'
      })

      expect(result).toEqual({ success: true })
    })
  })

  describe('handler registration', () => {
    it('should register all docker handlers', () => {
      expect(ipcMain.handlers).toHaveProperty('check-docker')
      expect(ipcMain.handlers).toHaveProperty('docker-list-containers')
      expect(ipcMain.handlers).toHaveProperty('docker-container-action')
      expect(ipcMain.handlers).toHaveProperty('docker-stream-logs')
      expect(ipcMain.handlers).toHaveProperty('docker-stop-logs')
      expect(ipcMain.handlers).toHaveProperty('docker-services-catalog')
      expect(ipcMain.handlers).toHaveProperty('docker-services-config')
      expect(ipcMain.handlers).toHaveProperty('docker-services-save')
      expect(ipcMain.handlers).toHaveProperty('docker-services-start')
      expect(ipcMain.handlers).toHaveProperty('docker-services-stop')
      expect(ipcMain.handlers).toHaveProperty('docker-services-status')
      expect(ipcMain.handlers).toHaveProperty('docker-services-inject-env')
    })
  })
})
