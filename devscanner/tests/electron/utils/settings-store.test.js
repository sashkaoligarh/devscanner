// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// Mock electron app module
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-devscanner' }
}))

const { validateEnvFileName, validateEnvPath } = require('../../../electron/utils/settings-store')

describe('settings-store', () => {
  describe('validateEnvFileName', () => {
    it('should accept .env', () => {
      expect(validateEnvFileName('.env')).toBe(true)
    })

    it('should accept .env.local', () => {
      expect(validateEnvFileName('.env.local')).toBe(true)
    })

    it('should accept .env.production', () => {
      expect(validateEnvFileName('.env.production')).toBe(true)
    })

    it('should accept .env.example', () => {
      expect(validateEnvFileName('.env.example')).toBe(true)
    })

    it('should reject names not starting with .env', () => {
      expect(validateEnvFileName('config.json')).toBe(false)
      expect(validateEnvFileName('secrets')).toBe(false)
    })

    it('should reject paths with slashes', () => {
      expect(validateEnvFileName('.env/../secret')).toBe(false)
      expect(validateEnvFileName('.env/../../etc/passwd')).toBe(false)
    })

    it('should reject paths with backslashes', () => {
      expect(validateEnvFileName('.env\\..\\secret')).toBe(false)
    })

    it('should reject names with ..', () => {
      expect(validateEnvFileName('.env..')).toBe(false)
    })

    it('should reject non-string input', () => {
      expect(validateEnvFileName(null)).toBe(false)
      expect(validateEnvFileName(undefined)).toBe(false)
      expect(validateEnvFileName(123)).toBe(false)
    })
  })

  describe('validateEnvPath', () => {
    it('should accept file within project', () => {
      expect(validateEnvPath('/home/user/project', '.env')).toBe(true)
    })

    it('should accept nested env file', () => {
      expect(validateEnvPath('/home/user/project', '.env.local')).toBe(true)
    })

    it('should reject path traversal', () => {
      expect(validateEnvPath('/home/user/project', '../.env')).toBe(false)
    })

    it('should reject escaping project root', () => {
      expect(validateEnvPath('/home/user/project', '../../etc/passwd')).toBe(false)
    })
  })
})
