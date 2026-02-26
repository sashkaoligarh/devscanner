import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockElectron = vi.hoisted(() => ({
  available: true,
  scanFolder: vi.fn(),
  selectFolder: vi.fn(),
  saveSettings: vi.fn(),
  gitInfo: vi.fn(),
}))

vi.mock('../../src/electronApi', () => ({ default: mockElectron }))

import useProjects from '../../src/hooks/useProjects'

beforeEach(() => {
  vi.clearAllMocks()
  mockElectron.gitInfo.mockResolvedValue(null)
})

describe('useProjects', () => {
  describe('filteredProjects', () => {
    it('filters by search query across name, languages, and frameworks', async () => {
      const { result } = renderHook(() => useProjects())

      const projects = [
        { name: 'alpha', path: '/alpha', languages: ['JavaScript'], frameworks: ['React'] },
        { name: 'beta', path: '/beta', languages: ['Python'], frameworks: ['Django'] },
        { name: 'gamma', path: '/gamma', languages: ['TypeScript'], frameworks: ['Vue'] },
      ]

      act(() => { result.current.setProjects(projects) })

      // Filter by name
      act(() => { result.current.setSearchQuery('alpha') })
      expect(result.current.filteredProjects).toHaveLength(1)
      expect(result.current.filteredProjects[0].name).toBe('alpha')

      // Filter by language
      act(() => { result.current.setSearchQuery('python') })
      expect(result.current.filteredProjects).toHaveLength(1)
      expect(result.current.filteredProjects[0].name).toBe('beta')

      // Filter by framework
      act(() => { result.current.setSearchQuery('vue') })
      expect(result.current.filteredProjects).toHaveLength(1)
      expect(result.current.filteredProjects[0].name).toBe('gamma')

      // Empty query returns all
      act(() => { result.current.setSearchQuery('') })
      expect(result.current.filteredProjects).toHaveLength(3)
    })

    it('sorts favorites first', () => {
      const { result } = renderHook(() => useProjects())

      const projects = [
        { name: 'alpha', path: '/alpha', languages: [], frameworks: [] },
        { name: 'beta', path: '/beta', languages: [], frameworks: [] },
        { name: 'gamma', path: '/gamma', languages: [], frameworks: [] },
      ]

      act(() => { result.current.setProjects(projects) })
      act(() => { result.current.setFavorites(new Set(['/gamma'])) })

      expect(result.current.filteredProjects[0].name).toBe('gamma')
    })
  })

  describe('handleScan', () => {
    it('sets projects on success', async () => {
      const data = [
        { name: 'proj1', path: '/proj1', languages: [], frameworks: [] },
      ]
      mockElectron.scanFolder.mockResolvedValue({ success: true, data })

      const { result } = renderHook(() => useProjects())

      await act(async () => {
        await result.current.handleScan('/some/path')
      })

      expect(mockElectron.scanFolder).toHaveBeenCalledWith('/some/path')
      expect(result.current.projects).toEqual(data)
      expect(result.current.scanning).toBe(false)
      expect(result.current.scanError).toBeNull()
    })

    it('sets error on failure', async () => {
      mockElectron.scanFolder.mockResolvedValue({ success: false, error: 'Scan failed' })

      const { result } = renderHook(() => useProjects())

      await act(async () => {
        await result.current.handleScan('/bad/path')
      })

      expect(result.current.scanError).toBe('Scan failed')
      expect(result.current.projects).toEqual([])
      expect(result.current.scanning).toBe(false)
    })
  })

  describe('handleSelectFolder', () => {
    it('when folder selected, scans the folder', async () => {
      const data = [
        { name: 'proj1', path: '/selected/proj1', languages: [], frameworks: [] },
      ]
      mockElectron.selectFolder.mockResolvedValue('/selected')
      mockElectron.scanFolder.mockResolvedValue({ success: true, data })

      const { result } = renderHook(() => useProjects())

      await act(async () => {
        await result.current.handleSelectFolder()
      })

      expect(mockElectron.selectFolder).toHaveBeenCalled()
      expect(mockElectron.scanFolder).toHaveBeenCalledWith('/selected')
      expect(result.current.folderPath).toBe('/selected')
      expect(result.current.projects).toEqual(data)
      expect(result.current.scanning).toBe(false)
    })

    it('when cancelled (null), does not scan', async () => {
      mockElectron.selectFolder.mockResolvedValue(null)

      const { result } = renderHook(() => useProjects())

      await act(async () => {
        await result.current.handleSelectFolder()
      })

      expect(mockElectron.selectFolder).toHaveBeenCalled()
      expect(mockElectron.scanFolder).not.toHaveBeenCalled()
      expect(result.current.folderPath).toBeNull()
      expect(result.current.scanning).toBe(false)
    })
  })

  describe('toggleFavorite', () => {
    it('adds and removes favorites', () => {
      mockElectron.saveSettings.mockResolvedValue({ success: true })

      const { result } = renderHook(() => useProjects())

      // Add favorite
      act(() => { result.current.toggleFavorite('/proj/a') })
      expect(result.current.favorites.has('/proj/a')).toBe(true)
      expect(mockElectron.saveSettings).toHaveBeenCalledWith({
        favorites: ['/proj/a'],
      })

      // Add another
      act(() => { result.current.toggleFavorite('/proj/b') })
      expect(result.current.favorites.has('/proj/a')).toBe(true)
      expect(result.current.favorites.has('/proj/b')).toBe(true)

      // Remove first
      act(() => { result.current.toggleFavorite('/proj/a') })
      expect(result.current.favorites.has('/proj/a')).toBe(false)
      expect(result.current.favorites.has('/proj/b')).toBe(true)
    })
  })
})
