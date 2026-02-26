// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron and other dependencies before requiring the module
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('js-yaml', () => ({ dump: vi.fn(() => 'mocked-yaml') }))

const {
  SERVICE_CATALOG,
  sanitizeProjectName,
  generateConnectionString
} = require('../../../electron/utils/docker-services')

describe('docker-services', () => {
  describe('SERVICE_CATALOG', () => {
    it('should contain expected services', () => {
      expect(SERVICE_CATALOG).toHaveProperty('postgres')
      expect(SERVICE_CATALOG).toHaveProperty('mysql')
      expect(SERVICE_CATALOG).toHaveProperty('redis')
      expect(SERVICE_CATALOG).toHaveProperty('mongodb')
      expect(SERVICE_CATALOG).toHaveProperty('clickhouse')
      expect(SERVICE_CATALOG).toHaveProperty('rabbitmq')
      expect(SERVICE_CATALOG).toHaveProperty('kafka')
    })

    it('should have required properties for each service', () => {
      for (const [key, svc] of Object.entries(SERVICE_CATALOG)) {
        if (svc.multi) continue // multi-services have different structure
        expect(svc.image, `${key} should have image`).toBeTruthy()
        expect(svc.defaultPort, `${key} should have defaultPort`).toBeGreaterThan(0)
      }
    })
  })

  describe('sanitizeProjectName', () => {
    it('should extract basename and sanitize', () => {
      expect(sanitizeProjectName('/home/user/my-project')).toBe('my-project')
    })

    it('should remove special characters', () => {
      expect(sanitizeProjectName('/path/my project!')).toBe('myproject')
    })

    it('should lowercase', () => {
      expect(sanitizeProjectName('/path/MyApp')).toBe('myapp')
    })

    it('should return "project" for empty result', () => {
      expect(sanitizeProjectName('/path/!!!')).toBe('project')
    })
  })

  describe('generateConnectionString', () => {
    it('should generate postgres connection string', () => {
      const result = generateConnectionString('postgres', { port: 5432 })
      expect(result).toBe('postgresql://dev:dev@localhost:5432/devdb')
    })

    it('should use custom port', () => {
      const result = generateConnectionString('postgres', { port: 5433 })
      expect(result).toBe('postgresql://dev:dev@localhost:5433/devdb')
    })

    it('should generate redis connection string', () => {
      const result = generateConnectionString('redis', { port: 6379 })
      expect(result).toBe('redis://localhost:6379')
    })

    it('should use default port if not specified', () => {
      const result = generateConnectionString('redis', {})
      expect(result).toBe('redis://localhost:6379')
    })

    it('should generate admin URL for pgadmin', () => {
      const result = generateConnectionString('pgadmin', { port: 5050 })
      expect(result).toBe('http://localhost:5050')
    })

    it('should return null for unknown service', () => {
      const result = generateConnectionString('nonexistent', {})
      expect(result).toBe(null)
    })

    it('should use custom env overrides', () => {
      const result = generateConnectionString('postgres', {
        port: 5432,
        env: { POSTGRES_USER: 'admin', POSTGRES_PASSWORD: 'secret', POSTGRES_DB: 'mydb' }
      })
      expect(result).toBe('postgresql://admin:secret@localhost:5432/mydb')
    })
  })
})
