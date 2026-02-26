// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import Module from 'module'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn()
}))

// For globals, the handler destructures at require-time: const { isRunningInsideWsl, wslHostIp } = require(...)
// Destructuring copies values, so we need a way to make re-registration pick up new values.
// We'll load the handler fresh each time by clearing the require cache.

const handlerPath = require.resolve('../../../electron/handlers/settings')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      shell: { openExternal: mocks.openExternal }
    }
  }
  const parentDir = parent?.filename ? path.dirname(parent.filename) : ''
  if (request.includes('utils/settings-store')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/utils/settings-store')) {
      return {
        loadSettings: mocks.loadSettings,
        saveSettings: mocks.saveSettings
      }
    }
  }
  if (request.includes('globals')) {
    const resolved = path.resolve(parentDir, request)
    if (resolved.includes('electron/globals')) {
      return currentGlobals
    }
  }
  return originalLoad.apply(this, arguments)
}

let currentGlobals = { isRunningInsideWsl: false, wslHostIp: null }

function loadHandler() {
  // Clear cache so handler re-requires its dependencies
  delete require.cache[handlerPath]
  return require('../../../electron/handlers/settings')
}

const { registerSettingsHandlers } = loadHandler()

Module._load = originalLoad

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: (channel, fn) => { handlers[channel] = fn },
    invoke: (channel, ...args) => handlers[channel]?.(null, ...args),
    handlers
  }
}

describe('settings handlers', () => {
  let ipcMain

  beforeEach(() => {
    vi.clearAllMocks()
    ipcMain = createMockIpcMain()
    registerSettingsHandlers(ipcMain, {})
  })

  describe('get-settings', () => {
    it('should return loaded settings', async () => {
      const mockSettings = { theme: 'dark', port: 3000 }
      mocks.loadSettings.mockReturnValue(mockSettings)

      const result = await ipcMain.invoke('get-settings')

      expect(result).toEqual(mockSettings)
      expect(mocks.loadSettings).toHaveBeenCalledOnce()
    })

    it('should return empty settings object', async () => {
      mocks.loadSettings.mockReturnValue({})

      const result = await ipcMain.invoke('get-settings')

      expect(result).toEqual({})
    })
  })

  describe('save-settings', () => {
    it('should save settings and return success', async () => {
      const newSettings = { theme: 'light', autoSave: true }

      const result = await ipcMain.invoke('save-settings', newSettings)

      expect(result).toEqual({ success: true })
      expect(mocks.saveSettings).toHaveBeenCalledWith(newSettings)
    })

    it('should pass through any settings object', async () => {
      const complexSettings = {
        remoteServers: [{ id: '1', host: 'example.com' }],
        dockerServices: { '/project': { services: {} } }
      }

      const result = await ipcMain.invoke('save-settings', complexSettings)

      expect(result).toEqual({ success: true })
      expect(mocks.saveSettings).toHaveBeenCalledWith(complexSettings)
    })
  })

  describe('open-browser', () => {
    it('should call shell.openExternal with the url', async () => {
      mocks.openExternal.mockResolvedValue(undefined)

      await ipcMain.invoke('open-browser', 'https://example.com')

      expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com')
    })

    it('should silently fail on error', async () => {
      mocks.openExternal.mockRejectedValue(new Error('No browser'))

      const result = await ipcMain.invoke('open-browser', 'https://example.com')

      // Handler has empty catch, so no error is thrown
      expect(result).toBeUndefined()
    })
  })

  describe('get-host-info', () => {
    it('should return WSL info from globals', async () => {
      const result = await ipcMain.invoke('get-host-info')

      expect(result).toEqual({
        isWsl: false,
        wslIp: null
      })
    })

    it('should reflect WSL environment when running inside WSL', async () => {
      // Temporarily re-enable our Module._load shim to load with WSL globals
      currentGlobals = { isRunningInsideWsl: true, wslHostIp: '172.20.0.1' }
      const prevLoad = Module._load
      Module._load = function (request, parent, isMain) {
        if (request === 'electron') {
          return { shell: { openExternal: mocks.openExternal } }
        }
        const parentDir = parent?.filename ? path.dirname(parent.filename) : ''
        if (request.includes('utils/settings-store')) {
          const resolved = path.resolve(parentDir, request)
          if (resolved.includes('electron/utils/settings-store')) {
            return { loadSettings: mocks.loadSettings, saveSettings: mocks.saveSettings }
          }
        }
        if (request.includes('globals')) {
          const resolved = path.resolve(parentDir, request)
          if (resolved.includes('electron/globals')) {
            return currentGlobals
          }
        }
        return originalLoad.apply(this, arguments)
      }

      const { registerSettingsHandlers: registerWithWsl } = loadHandler()
      Module._load = prevLoad

      const ipc2 = createMockIpcMain()
      registerWithWsl(ipc2, {})

      const result = await ipc2.invoke('get-host-info')

      expect(result).toEqual({
        isWsl: true,
        wslIp: '172.20.0.1'
      })

      // Reset
      currentGlobals = { isRunningInsideWsl: false, wslHostIp: null }
    })
  })

  describe('handler registration', () => {
    it('should register all four handlers', () => {
      expect(ipcMain.handlers).toHaveProperty('get-settings')
      expect(ipcMain.handlers).toHaveProperty('save-settings')
      expect(ipcMain.handlers).toHaveProperty('open-browser')
      expect(ipcMain.handlers).toHaveProperty('get-host-info')
    })
  })
})
