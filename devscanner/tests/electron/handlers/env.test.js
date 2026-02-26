// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import Module from 'module'

// Create mock functions using vi.hoisted so they're available during module load
const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  validateEnvFileName: vi.fn(),
  validateEnvPath: vi.fn(),
  detectEnvFiles: vi.fn()
}))

// Shim Node's CJS module loader to intercept require() calls
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'fs') {
    return {
      existsSync: mocks.existsSync,
      readFileSync: mocks.readFileSync,
      writeFileSync: mocks.writeFileSync
    }
  }
  const parentDir = parent?.filename ? path.dirname(parent.filename) : ''
  if (request === '../utils/settings-store' || request === './utils/settings-store') {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/settings-store')) {
      return {
        validateEnvFileName: mocks.validateEnvFileName,
        validateEnvPath: mocks.validateEnvPath
      }
    }
  }
  if (request === '../utils/analysis' || request === './utils/analysis') {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/analysis')) {
      return {
        detectEnvFiles: mocks.detectEnvFiles
      }
    }
  }
  return originalLoad.apply(this, arguments)
}

// Now require the handler — it will get our mocks
const { registerEnvHandlers } = require('../../../electron/handlers/env')

// Restore the original loader
Module._load = originalLoad

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: (channel, fn) => { handlers[channel] = fn },
    invoke: (channel, ...args) => handlers[channel]?.(null, ...args),
    handlers
  }
}

describe('env handlers', () => {
  let ipcMain

  beforeEach(() => {
    vi.clearAllMocks()
    ipcMain = createMockIpcMain()
    registerEnvHandlers(ipcMain, {})
  })

  describe('read-env-file', () => {
    it('should read a valid env file', async () => {
      mocks.validateEnvFileName.mockReturnValue(true)
      mocks.validateEnvPath.mockReturnValue(true)
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue('KEY=value\nDB_HOST=localhost')

      const result = await ipcMain.invoke('read-env-file', {
        projectPath: '/project',
        fileName: '.env'
      })

      expect(result).toEqual({
        success: true,
        data: { content: 'KEY=value\nDB_HOST=localhost', fileName: '.env' }
      })
      expect(mocks.readFileSync).toHaveBeenCalledWith('/project/.env', 'utf-8')
    })

    it('should reject invalid file name', async () => {
      mocks.validateEnvFileName.mockReturnValue(false)
      mocks.validateEnvPath.mockReturnValue(true)

      const result = await ipcMain.invoke('read-env-file', {
        projectPath: '/project',
        fileName: 'not-env'
      })

      expect(result).toEqual({ success: false, error: 'Invalid file name' })
      expect(mocks.existsSync).not.toHaveBeenCalled()
    })

    it('should reject invalid path', async () => {
      mocks.validateEnvFileName.mockReturnValue(true)
      mocks.validateEnvPath.mockReturnValue(false)

      const result = await ipcMain.invoke('read-env-file', {
        projectPath: '/project',
        fileName: '../.env'
      })

      expect(result).toEqual({ success: false, error: 'Invalid file name' })
      expect(mocks.existsSync).not.toHaveBeenCalled()
    })

    it('should return error when file does not exist', async () => {
      mocks.validateEnvFileName.mockReturnValue(true)
      mocks.validateEnvPath.mockReturnValue(true)
      mocks.existsSync.mockReturnValue(false)

      const result = await ipcMain.invoke('read-env-file', {
        projectPath: '/project',
        fileName: '.env'
      })

      expect(result).toEqual({ success: false, error: 'File not found' })
      expect(mocks.readFileSync).not.toHaveBeenCalled()
    })

    it('should handle fs read errors gracefully', async () => {
      mocks.validateEnvFileName.mockReturnValue(true)
      mocks.validateEnvPath.mockReturnValue(true)
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockImplementation(() => { throw new Error('Permission denied') })

      const result = await ipcMain.invoke('read-env-file', {
        projectPath: '/project',
        fileName: '.env'
      })

      expect(result).toEqual({ success: false, error: 'Permission denied' })
    })
  })

  describe('save-env-file', () => {
    it('should save a valid env file', async () => {
      mocks.validateEnvFileName.mockReturnValue(true)
      mocks.validateEnvPath.mockReturnValue(true)

      const result = await ipcMain.invoke('save-env-file', {
        projectPath: '/project',
        fileName: '.env',
        content: 'KEY=new_value'
      })

      expect(result).toEqual({ success: true })
      expect(mocks.writeFileSync).toHaveBeenCalledWith('/project/.env', 'KEY=new_value', 'utf-8')
    })

    it('should reject invalid file name on save', async () => {
      mocks.validateEnvFileName.mockReturnValue(false)
      mocks.validateEnvPath.mockReturnValue(true)

      const result = await ipcMain.invoke('save-env-file', {
        projectPath: '/project',
        fileName: 'bad-name',
        content: 'KEY=value'
      })

      expect(result).toEqual({ success: false, error: 'Invalid file name' })
      expect(mocks.writeFileSync).not.toHaveBeenCalled()
    })

    it('should reject invalid path on save', async () => {
      mocks.validateEnvFileName.mockReturnValue(true)
      mocks.validateEnvPath.mockReturnValue(false)

      const result = await ipcMain.invoke('save-env-file', {
        projectPath: '/project',
        fileName: '../../etc/passwd',
        content: 'malicious'
      })

      expect(result).toEqual({ success: false, error: 'Invalid file name' })
      expect(mocks.writeFileSync).not.toHaveBeenCalled()
    })

    it('should handle fs write errors gracefully', async () => {
      mocks.validateEnvFileName.mockReturnValue(true)
      mocks.validateEnvPath.mockReturnValue(true)
      mocks.writeFileSync.mockImplementation(() => { throw new Error('Disk full') })

      const result = await ipcMain.invoke('save-env-file', {
        projectPath: '/project',
        fileName: '.env',
        content: 'KEY=value'
      })

      expect(result).toEqual({ success: false, error: 'Disk full' })
    })
  })

  describe('list-env-files', () => {
    it('should return detected env files', async () => {
      const mockFiles = ['.env', '.env.local', '.env.production']
      mocks.detectEnvFiles.mockReturnValue(mockFiles)

      const result = await ipcMain.invoke('list-env-files', {
        projectPath: '/project'
      })

      expect(result).toEqual({ success: true, data: mockFiles })
      expect(mocks.detectEnvFiles).toHaveBeenCalledWith('/project')
    })

    it('should return empty list when no env files exist', async () => {
      mocks.detectEnvFiles.mockReturnValue([])

      const result = await ipcMain.invoke('list-env-files', {
        projectPath: '/project'
      })

      expect(result).toEqual({ success: true, data: [] })
    })

    it('should handle detection errors gracefully', async () => {
      mocks.detectEnvFiles.mockImplementation(() => { throw new Error('Cannot read directory') })

      const result = await ipcMain.invoke('list-env-files', {
        projectPath: '/nonexistent'
      })

      expect(result).toEqual({ success: false, error: 'Cannot read directory' })
    })
  })
})
