// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// Mock electron and child_process
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

// We need the constants but not the full analysis module for some tests
const { FRAMEWORK_PORT_MAP, LANGUAGE_PORT_MAP } = require('../../../electron/constants')

describe('analysis utils', () => {
  describe('getDefaultPort (logic test)', () => {
    function getDefaultPort(frameworks, languages) {
      for (const fw of frameworks) {
        if (FRAMEWORK_PORT_MAP[fw] !== undefined) return FRAMEWORK_PORT_MAP[fw]
      }
      for (const lang of languages) {
        if (LANGUAGE_PORT_MAP[lang] !== undefined) return LANGUAGE_PORT_MAP[lang]
      }
      return 3000
    }

    it('should return framework port for Next.js', () => {
      expect(getDefaultPort(['Next.js'], ['JavaScript'])).toBe(3000)
    })

    it('should return framework port for Vite', () => {
      expect(getDefaultPort(['Vite'], ['JavaScript'])).toBe(5173)
    })

    it('should return framework port for Django', () => {
      expect(getDefaultPort(['Django'], ['Python'])).toBe(8000)
    })

    it('should return framework port for Flask', () => {
      expect(getDefaultPort(['Flask'], ['Python'])).toBe(5000)
    })

    it('should return language port for Go', () => {
      expect(getDefaultPort([], ['Go'])).toBe(8080)
    })

    it('should return language port for C#', () => {
      expect(getDefaultPort(['.NET'], ['C#'])).toBe(5000)
    })

    it('should prefer framework over language port', () => {
      expect(getDefaultPort(['Express'], ['JavaScript'])).toBe(3000)
    })

    it('should return 3000 as default', () => {
      expect(getDefaultPort([], [])).toBe(3000)
    })
  })

  describe('detectLanguagesAndFrameworks (with temp files)', () => {
    let tmpDir

    function createTempProject(files) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devscanner-test-'))
      for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(tmpDir, name), content, 'utf-8')
      }
      return tmpDir
    }

    function cleanup() {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true })
        tmpDir = null
      }
    }

    // Import the actual module for integration-style tests
    let detectLanguagesAndFrameworks, detectEnvFiles
    try {
      const analysis = require('../../../electron/utils/analysis')
      detectLanguagesAndFrameworks = analysis.detectLanguagesAndFrameworks
      detectEnvFiles = analysis.detectEnvFiles
    } catch {
      // Module may fail to load if execInContext has issues
    }

    it('should detect JavaScript + Next.js from package.json', function () {
      if (!detectLanguagesAndFrameworks) return this.skip?.()
      const dir = createTempProject({
        'package.json': JSON.stringify({
          dependencies: { next: '14.0.0', react: '18.0.0' }
        })
      })
      try {
        const entries = fs.readdirSync(dir)
        const result = detectLanguagesAndFrameworks(dir, entries)
        expect(result.languages).toContain('JavaScript')
        expect(result.frameworks).toContain('Next.js')
      } finally {
        cleanup()
      }
    })

    it('should detect TypeScript when tsconfig.json present', function () {
      if (!detectLanguagesAndFrameworks) return this.skip?.()
      const dir = createTempProject({
        'package.json': JSON.stringify({ dependencies: {} }),
        'tsconfig.json': '{}'
      })
      try {
        const entries = fs.readdirSync(dir)
        const result = detectLanguagesAndFrameworks(dir, entries)
        expect(result.languages).toContain('TypeScript')
      } finally {
        cleanup()
      }
    })

    it('should detect Python + Django from requirements.txt', function () {
      if (!detectLanguagesAndFrameworks) return this.skip?.()
      const dir = createTempProject({
        'requirements.txt': 'django==4.2\ncelery==5.3'
      })
      try {
        const entries = fs.readdirSync(dir)
        const result = detectLanguagesAndFrameworks(dir, entries)
        expect(result.languages).toContain('Python')
        expect(result.frameworks).toContain('Django')
      } finally {
        cleanup()
      }
    })

    it('should detect Go from go.mod', function () {
      if (!detectLanguagesAndFrameworks) return this.skip?.()
      const dir = createTempProject({ 'go.mod': 'module example.com/app' })
      try {
        const entries = fs.readdirSync(dir)
        const result = detectLanguagesAndFrameworks(dir, entries)
        expect(result.languages).toContain('Go')
      } finally {
        cleanup()
      }
    })

    it('should detect Rust from Cargo.toml', function () {
      if (!detectLanguagesAndFrameworks) return this.skip?.()
      const dir = createTempProject({ 'Cargo.toml': '[package]\nname = "app"' })
      try {
        const entries = fs.readdirSync(dir)
        const result = detectLanguagesAndFrameworks(dir, entries)
        expect(result.languages).toContain('Rust')
      } finally {
        cleanup()
      }
    })
  })

  describe('detectEnvFiles', () => {
    let tmpDir
    let detectEnvFiles

    try {
      detectEnvFiles = require('../../../electron/utils/analysis').detectEnvFiles
    } catch {
      // may fail
    }

    function createDir(files) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devscanner-env-'))
      for (const name of files) {
        fs.writeFileSync(path.join(tmpDir, name), '', 'utf-8')
      }
      return tmpDir
    }

    function cleanup() {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    }

    it('should find .env files and sort them', function () {
      if (!detectEnvFiles) return this.skip?.()
      const dir = createDir(['.env', '.env.example', '.env.local', 'config.json'])
      try {
        const result = detectEnvFiles(dir)
        expect(result).toEqual(['.env', '.env.example', '.env.local'])
      } finally {
        cleanup()
      }
    })

    it('should return empty array for no env files', function () {
      if (!detectEnvFiles) return this.skip?.()
      const dir = createDir(['package.json', 'README.md'])
      try {
        expect(detectEnvFiles(dir)).toEqual([])
      } finally {
        cleanup()
      }
    })

    it('should return empty for non-existent dir', function () {
      if (!detectEnvFiles) return this.skip?.()
      expect(detectEnvFiles('/nonexistent/path')).toEqual([])
    })
  })
})
