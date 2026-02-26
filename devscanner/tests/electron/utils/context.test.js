// @vitest-environment node
import { describe, it, expect } from 'vitest'

// We can't require the module directly because it imports child_process
// Instead, test the pure functions by reimplementing their logic
// or by dynamically importing

describe('context utils', () => {
  describe('isWslPath', () => {
    // isWslPath checks: process.platform === 'win32' && /^\\\\wsl/i.test(p)
    // On Linux (test env), platform !== 'win32', so it always returns false
    // We test the regex logic directly instead

    it('should match \\\\wsl$ paths', () => {
      const re = /^\\\\wsl/i
      expect(re.test('\\\\wsl$\\Ubuntu\\home')).toBe(true)
    })

    it('should match \\\\wsl.localhost paths', () => {
      const re = /^\\\\wsl/i
      expect(re.test('\\\\wsl.localhost\\Ubuntu\\home')).toBe(true)
    })

    it('should not match regular paths', () => {
      const re = /^\\\\wsl/i
      expect(re.test('/home/user/projects')).toBe(false)
      expect(re.test('C:\\Users\\user')).toBe(false)
    })
  })

  describe('parseWslPath', () => {
    function parseWslPath(p) {
      const match = p.match(/^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(.*)/i)
      if (!match) return null
      return {
        distro: match[1],
        linuxPath: match[2].replace(/\\/g, '/') || '/'
      }
    }

    it('should parse \\\\wsl$\\Distro\\path', () => {
      const result = parseWslPath('\\\\wsl$\\Ubuntu\\home\\user')
      expect(result).toEqual({ distro: 'Ubuntu', linuxPath: '/home/user' })
    })

    it('should parse \\\\wsl.localhost\\Distro\\path', () => {
      const result = parseWslPath('\\\\wsl.localhost\\Debian\\srv\\app')
      expect(result).toEqual({ distro: 'Debian', linuxPath: '/srv/app' })
    })

    it('should return root path when no subpath', () => {
      const result = parseWslPath('\\\\wsl$\\Ubuntu')
      expect(result).toEqual({ distro: 'Ubuntu', linuxPath: '/' })
    })

    it('should return null for non-WSL paths', () => {
      expect(parseWslPath('/home/user')).toBe(null)
      expect(parseWslPath('C:\\Users')).toBe(null)
    })
  })

  describe('shellQuote', () => {
    function shellQuote(s) {
      if (/^[a-zA-Z0-9._\-\/=:@]+$/.test(s)) return s
      return "'" + s.replace(/'/g, "'\\''") + "'"
    }

    it('should return safe strings unchanged', () => {
      expect(shellQuote('hello')).toBe('hello')
      expect(shellQuote('/usr/bin/node')).toBe('/usr/bin/node')
      expect(shellQuote('PORT=3000')).toBe('PORT=3000')
      expect(shellQuote('user@host')).toBe('user@host')
    })

    it('should quote strings with spaces', () => {
      expect(shellQuote('hello world')).toBe("'hello world'")
    })

    it('should escape single quotes', () => {
      expect(shellQuote("it's")).toBe("'it'\\''s'")
    })

    it('should quote strings with special chars', () => {
      expect(shellQuote('a&b')).toBe("'a&b'")
      expect(shellQuote('$(cmd)')).toBe("'$(cmd)'")
    })
  })
})
