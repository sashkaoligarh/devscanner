// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import Module from 'module'

const mocks = vi.hoisted(() => ({
  readdirSync: vi.fn(),
}))

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'fs') {
    return {
      readdirSync: mocks.readdirSync,
    }
  }
  return originalLoad.apply(this, arguments)
}

const { getSFTPClient, sftpMkdir, sftpPutFile, collectFiles, uploadDirectory } = require('../../../electron/utils/sftp-utils')

Module._load = originalLoad

describe('sftp-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSFTPClient', () => {
    it('should resolve with sftp object on success', async () => {
      const fakeSftp = { mkdir: vi.fn() }
      const fakeClient = {
        sftp: (cb) => cb(null, fakeSftp)
      }
      const result = await getSFTPClient(fakeClient)
      expect(result).toBe(fakeSftp)
    })

    it('should reject on error', async () => {
      const fakeClient = {
        sftp: (cb) => cb(new Error('SFTP failed'))
      }
      await expect(getSFTPClient(fakeClient)).rejects.toThrow('SFTP failed')
    })
  })

  describe('sftpMkdir', () => {
    it('should resolve when mkdir succeeds', async () => {
      const sftp = { mkdir: vi.fn((p, cb) => cb(null)) }
      await expect(sftpMkdir(sftp, '/remote/dir')).resolves.toBeUndefined()
      expect(sftp.mkdir).toHaveBeenCalledWith('/remote/dir', expect.any(Function))
    })

    it('should resolve when directory already exists (code 4)', async () => {
      const sftp = { mkdir: vi.fn((p, cb) => cb({ code: 4 })) }
      await expect(sftpMkdir(sftp, '/remote/dir')).resolves.toBeUndefined()
    })

    it('should try creating parent on other errors', async () => {
      let callCount = 0
      const sftp = {
        mkdir: vi.fn((p, cb) => {
          callCount++
          if (callCount <= 1 && p === '/remote/dir') {
            // First call to /remote/dir fails
            cb({ code: 2 })
          } else {
            // Parent mkdir and retry succeed
            cb(null)
          }
        })
      }
      await expect(sftpMkdir(sftp, '/remote/dir')).resolves.toBeUndefined()
      // Should have called mkdir for /remote (parent) and then /remote/dir again
      expect(sftp.mkdir.mock.calls.length).toBeGreaterThan(1)
    })
  })

  describe('sftpPutFile', () => {
    it('should resolve on success', async () => {
      const sftp = { fastPut: vi.fn((l, r, cb) => cb(null)) }
      await expect(sftpPutFile(sftp, '/local/file.txt', '/remote/file.txt')).resolves.toBeUndefined()
      expect(sftp.fastPut).toHaveBeenCalledWith('/local/file.txt', '/remote/file.txt', expect.any(Function))
    })

    it('should reject on error', async () => {
      const sftp = { fastPut: vi.fn((l, r, cb) => cb(new Error('Upload failed'))) }
      await expect(sftpPutFile(sftp, '/local/f', '/remote/f')).rejects.toThrow('Upload failed')
    })
  })

  describe('collectFiles', () => {
    it('should collect files recursively, skipping excluded dirs', () => {
      // Root level
      mocks.readdirSync.mockImplementation((dir) => {
        if (dir === '/project') {
          return [
            { name: 'index.html', isDirectory: () => false },
            { name: 'css', isDirectory: () => true },
            { name: 'node_modules', isDirectory: () => true },
            { name: '.git', isDirectory: () => true },
          ]
        }
        if (dir === path.join('/project', 'css')) {
          return [
            { name: 'style.css', isDirectory: () => false },
          ]
        }
        return []
      })

      const files = collectFiles('/project')
      expect(files).toHaveLength(2)
      expect(files.map(f => f.relativePath)).toContain('index.html')
      expect(files.map(f => f.relativePath)).toContain('css/style.css')
    })

    it('should return empty array for empty directory', () => {
      mocks.readdirSync.mockReturnValue([])
      const files = collectFiles('/empty')
      expect(files).toEqual([])
    })
  })

  describe('uploadDirectory', () => {
    it('should upload all files and call progress callback', async () => {
      mocks.readdirSync.mockImplementation((dir) => {
        if (dir === '/local') {
          return [
            { name: 'a.html', isDirectory: () => false },
            { name: 'b.css', isDirectory: () => false },
          ]
        }
        return []
      })

      const sftp = {
        mkdir: vi.fn((p, cb) => cb(null)),
        fastPut: vi.fn((l, r, cb) => cb(null)),
      }

      const progressCalls = []
      const result = await uploadDirectory(sftp, '/local', '/remote', (p) => progressCalls.push(p))

      expect(result).toEqual({ uploaded: 2, total: 2 })
      expect(progressCalls).toHaveLength(2)
      expect(progressCalls[0].uploaded).toBe(1)
      expect(progressCalls[1].uploaded).toBe(2)
      expect(sftp.fastPut).toHaveBeenCalledTimes(2)
    })

    it('should work without progress callback', async () => {
      mocks.readdirSync.mockReturnValue([
        { name: 'file.txt', isDirectory: () => false },
      ])

      const sftp = {
        mkdir: vi.fn((p, cb) => cb(null)),
        fastPut: vi.fn((l, r, cb) => cb(null)),
      }

      const result = await uploadDirectory(sftp, '/local', '/remote')
      expect(result).toEqual({ uploaded: 1, total: 1 })
    })
  })
})
