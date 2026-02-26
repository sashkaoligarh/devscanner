// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron modules
vi.mock('electron', () => ({
  app: { setBadgeCount: vi.fn() },
  Notification: { isSupported: () => false }
}))

const {
  runningProcesses,
  getProcessEntry,
  setProcessEntry,
  deleteProcessEntry,
  stripAnsi,
  detectPort
} = require('../../../electron/utils/process')

describe('process utils', () => {
  beforeEach(() => {
    runningProcesses.clear()
  })

  describe('process entry CRUD', () => {
    it('should set and get a process entry', () => {
      setProcessEntry('/project', 'inst-1', { port: 3000, method: 'npm' })
      const entry = getProcessEntry('/project', 'inst-1')
      expect(entry).toEqual({ port: 3000, method: 'npm' })
    })

    it('should return undefined for non-existent entry', () => {
      expect(getProcessEntry('/project', 'missing')).toBeUndefined()
      expect(getProcessEntry('/missing', 'inst')).toBeUndefined()
    })

    it('should delete entry and clean up project map', () => {
      setProcessEntry('/project', 'inst-1', { port: 3000 })
      deleteProcessEntry('/project', 'inst-1')
      expect(getProcessEntry('/project', 'inst-1')).toBeUndefined()
      expect(runningProcesses.has('/project')).toBe(false)
    })

    it('should keep project map if other instances remain', () => {
      setProcessEntry('/project', 'inst-1', { port: 3000 })
      setProcessEntry('/project', 'inst-2', { port: 3001 })
      deleteProcessEntry('/project', 'inst-1')
      expect(getProcessEntry('/project', 'inst-2')).toEqual({ port: 3001 })
    })

    it('should handle delete on non-existent project gracefully', () => {
      expect(() => deleteProcessEntry('/missing', 'inst')).not.toThrow()
    })
  })

  describe('stripAnsi', () => {
    it('should strip ANSI escape sequences', () => {
      expect(stripAnsi('\x1b[32mgreen text\x1b[0m')).toBe('green text')
    })

    it('should strip bold and reset codes', () => {
      expect(stripAnsi('\x1b[1mbold\x1b[0m normal')).toBe('bold normal')
    })

    it('should strip orphaned bracket codes from WSL pipes', () => {
      expect(stripAnsi('[32mgreen text[0m')).toBe('green text')
    })

    it('should leave clean text unchanged', () => {
      expect(stripAnsi('hello world')).toBe('hello world')
    })

    it('should handle empty string', () => {
      expect(stripAnsi('')).toBe('')
    })

    it('should handle complex ANSI sequences', () => {
      const input = '\x1b[38;5;196mred\x1b[0m \x1b[48;2;0;255;0mgreen bg\x1b[0m'
      const result = stripAnsi(input)
      expect(result).not.toContain('\x1b')
    })
  })

  describe('detectPort', () => {
    it('should detect port from http://localhost:3000', () => {
      expect(detectPort('Server running at http://localhost:3000')).toBe(3000)
    })

    it('should detect port from http://127.0.0.1:5173', () => {
      expect(detectPort('  > Local: http://127.0.0.1:5173/')).toBe(5173)
    })

    it('should detect port from http://0.0.0.0:8080', () => {
      expect(detectPort('http://0.0.0.0:8080')).toBe(8080)
    })

    it('should detect port from Vite output', () => {
      expect(detectPort('  Local:   http://localhost:5174/')).toBe(5174)
    })

    it('should detect "listening on port" pattern', () => {
      expect(detectPort('listening on port 3000')).toBe(3000)
      expect(detectPort('Listening at port 8000')).toBe(8000)
    })

    it('should detect "started on port" pattern', () => {
      expect(detectPort('Server started on port 4000')).toBe(4000)
    })

    it('should detect "ready on" pattern', () => {
      expect(detectPort('ready on http://localhost:3000')).toBe(3000)
    })

    it('should return null when no port found', () => {
      expect(detectPort('Starting development server...')).toBe(null)
      expect(detectPort('')).toBe(null)
    })
  })
})
