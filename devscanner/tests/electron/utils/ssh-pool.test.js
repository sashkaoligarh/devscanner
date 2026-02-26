// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// Mock electron
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

const { generateServerTags } = require('../../../electron/utils/ssh-pool')

describe('ssh-pool', () => {
  describe('generateServerTags', () => {
    it('should return empty tags for empty discovery', () => {
      const tags = generateServerTags({})
      expect(tags).toEqual([])
    })

    it('should detect Docker tag', () => {
      const tags = generateServerTags({ docker: [{ Name: 'nginx' }] })
      expect(tags).toContain('Docker')
    })

    it('should detect PM2 tag', () => {
      const tags = generateServerTags({ pm2: [{ name: 'app' }] })
      expect(tags).toContain('PM2')
    })

    it('should detect screen tag', () => {
      const tags = generateServerTags({ screen: [{ name: '1234.session' }] })
      expect(tags).toContain('screen')
    })

    it('should detect nginx tag', () => {
      const tags = generateServerTags({ nginx: [{ serverName: 'example.com' }] })
      expect(tags).toContain('nginx')
    })

    it('should detect systemd service tags', () => {
      const tags = generateServerTags({
        systemd: [
          { unit: 'mysql.service', active: 'active' },
          { unit: 'redis-server.service', active: 'active' },
          { unit: 'nginx.service', active: 'active' },
          { unit: 'php-fpm.service', active: 'active' }
        ]
      })
      expect(tags).toContain('MySQL')
      expect(tags).toContain('Redis')
      expect(tags).toContain('PHP')
    })

    it('should detect PostgreSQL from systemd', () => {
      const tags = generateServerTags({
        systemd: [{ unit: 'postgresql.service', active: 'active' }]
      })
      expect(tags).toContain('PostgreSQL')
    })

    it('should detect MongoDB from systemd', () => {
      const tags = generateServerTags({
        systemd: [{ unit: 'mongod.service', active: 'active' }]
      })
      expect(tags).toContain('MongoDB')
    })

    it('should detect Node.js from projects with package.json', () => {
      const tags = generateServerTags({
        projects: [{ path: '/home/app', manifests: ['package.json'] }]
      })
      expect(tags).toContain('Node.js')
    })

    it('should detect Python from projects with requirements.txt', () => {
      const tags = generateServerTags({
        projects: [{ path: '/home/app', manifests: ['requirements.txt'] }]
      })
      expect(tags).toContain('Python')
    })

    it('should detect Go from projects with go.mod', () => {
      const tags = generateServerTags({
        projects: [{ path: '/home/app', manifests: ['go.mod'] }]
      })
      expect(tags).toContain('Go')
    })

    it('should not duplicate Node.js tag', () => {
      const tags = generateServerTags({
        systemd: [{ unit: 'node.service', active: 'active' }],
        projects: [{ path: '/home/app', manifests: ['package.json'] }]
      })
      const nodeCount = tags.filter(t => t === 'Node.js').length
      expect(nodeCount).toBe(1)
    })

    it('should detect multiple tags from complex discovery', () => {
      const tags = generateServerTags({
        docker: [{ Name: 'app' }],
        pm2: [{ name: 'api' }],
        nginx: [{ serverName: 'example.com' }],
        systemd: [
          { unit: 'redis-server.service', active: 'active' },
          { unit: 'postgres.service', active: 'active' }
        ],
        projects: [
          { path: '/home/app', manifests: ['package.json'] },
          { path: '/home/py', manifests: ['requirements.txt'] }
        ]
      })
      expect(tags).toContain('Docker')
      expect(tags).toContain('PM2')
      expect(tags).toContain('nginx')
      expect(tags).toContain('Redis')
      expect(tags).toContain('PostgreSQL')
      expect(tags).toContain('Node.js')
      expect(tags).toContain('Python')
    })
  })
})
