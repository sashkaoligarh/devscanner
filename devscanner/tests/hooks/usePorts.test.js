import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockElectron = vi.hoisted(() => ({
  available: true,
  scanPorts: vi.fn(),
  killPortProcess: vi.fn(),
}))

vi.mock('../../src/electronApi', () => ({ default: mockElectron }))

import usePorts from '../../src/hooks/usePorts'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePorts', () => {
  describe('scanPorts', () => {
    it('sets ports on success', async () => {
      const data = [
        { port: 3000, pid: 1234, process: 'node' },
        { port: 8080, pid: 5678, process: 'java' },
      ]
      mockElectron.scanPorts.mockResolvedValue({ success: true, data })

      const { result } = renderHook(() => usePorts())

      await act(async () => {
        await result.current.scanPorts('common')
      })

      expect(mockElectron.scanPorts).toHaveBeenCalledWith({ mode: 'common' })
      expect(result.current.ports).toEqual(data)
      expect(result.current.portsScanning).toBe(false)
      expect(result.current.portsError).toBeNull()
    })

    it('sets error on failure', async () => {
      mockElectron.scanPorts.mockResolvedValue({ success: false, error: 'Port scan failed' })

      const { result } = renderHook(() => usePorts())

      await act(async () => {
        await result.current.scanPorts('all')
      })

      expect(mockElectron.scanPorts).toHaveBeenCalledWith({ mode: 'all' })
      expect(result.current.portsError).toBe('Port scan failed')
      expect(result.current.ports).toEqual([])
      expect(result.current.portsScanning).toBe(false)
    })
  })

  describe('handleKillPort', () => {
    it('adds and removes pid from killingPids set', async () => {
      mockElectron.killPortProcess.mockResolvedValue({ success: false })

      const { result } = renderHook(() => usePorts())

      await act(async () => {
        await result.current.handleKillPort(1234, 'SIGTERM')
      })

      expect(mockElectron.killPortProcess).toHaveBeenCalledWith({ pid: 1234, signal: 'SIGTERM' })
      // After completion, pid should be removed from killingPids
      expect(result.current.killingPids.has(1234)).toBe(false)
    })

    it('rescans ports after successful kill', async () => {
      const portsData = [{ port: 3000, pid: 1234, process: 'node' }]
      mockElectron.killPortProcess.mockResolvedValue({ success: true })
      mockElectron.scanPorts.mockResolvedValue({ success: true, data: [] })

      const { result } = renderHook(() => usePorts())

      // Set initial ports
      act(() => {
        mockElectron.scanPorts.mockResolvedValue({ success: true, data: portsData })
      })

      await act(async () => {
        await result.current.handleKillPort(1234, 'SIGTERM')
      })

      // The kill triggers a setTimeout of 500ms before re-scanning
      mockElectron.scanPorts.mockResolvedValue({ success: true, data: [] })

      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      // scanPorts should have been called from the setTimeout
      expect(mockElectron.scanPorts).toHaveBeenCalled()
    })

    it('does nothing when pid is falsy', async () => {
      const { result } = renderHook(() => usePorts())

      await act(async () => {
        await result.current.handleKillPort(null, 'SIGTERM')
      })

      expect(mockElectron.killPortProcess).not.toHaveBeenCalled()

      await act(async () => {
        await result.current.handleKillPort(0, 'SIGTERM')
      })

      expect(mockElectron.killPortProcess).not.toHaveBeenCalled()

      await act(async () => {
        await result.current.handleKillPort(undefined, 'SIGTERM')
      })

      expect(mockElectron.killPortProcess).not.toHaveBeenCalled()
    })
  })
})
