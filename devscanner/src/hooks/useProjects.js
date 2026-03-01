import { useState, useCallback, useMemo, useEffect } from 'react'
import electron from '../electronApi'

export default function useProjects() {
  const [projects, setProjects] = useState([])
  const [folderPath, setFolderPath] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [favorites, setFavorites] = useState(new Set())
  const [gitInfoCache, setGitInfoCache] = useState({})
  const [sortBy, setSortBy] = useState(null)

  const filteredProjects = useMemo(() => {
    let list = projects
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.languages.some(l => l.toLowerCase().includes(q)) ||
        p.frameworks.some(f => f.toLowerCase().includes(q))
      )
    }
    // Favorites first
    return [...list].sort((a, b) => {
      const aFav = favorites.has(a.path) ? 0 : 1
      const bFav = favorites.has(b.path) ? 0 : 1
      return aFav - bFav
    })
  }, [projects, searchQuery, favorites])

  const handleScan = useCallback(async (path) => {
    setScanError(null)
    setScanning(true)
    const result = await electron.scanFolder(path)
    if (result.success) {
      setProjects(result.data)
    } else {
      setScanError(result.error)
      setProjects([])
    }
    setScanning(false)
  }, [])

  const handleSelectFolder = useCallback(async () => {
    const selected = await electron.selectFolder()
    if (selected) {
      setFolderPath(selected)
      setScanError(null)
      setScanning(true)
      const result = await electron.scanFolder(selected)
      if (result.success) {
        setProjects(result.data)
      } else {
        setScanError(result.error)
        setProjects([])
      }
      setScanning(false)
    }
  }, [])

  const toggleFavorite = useCallback((projectPath) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(projectPath)) next.delete(projectPath)
      else next.add(projectPath)
      electron.saveSettings({ favorites: [...next] })
      return next
    })
  }, [])

  const refreshGitInfo = useCallback((projectPath) => {
    return electron.gitInfo({ projectPath }).then(info => {
      if (info) setGitInfoCache(prev => ({ ...prev, [projectPath]: info }))
      return info
    })
  }, [])

  // Load git info for all projects when project list changes (batched to avoid N re-renders)
  useEffect(() => {
    if (!electron.available || projects.length === 0) return
    const gitProjects = projects.filter(p => p.git)
    if (gitProjects.length === 0) return
    Promise.allSettled(
      gitProjects.map(p =>
        electron.gitInfo({ projectPath: p.path }).then(info => ({ path: p.path, info }))
      )
    ).then(results => {
      const batch = {}
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.info) {
          batch[r.value.path] = r.value.info
        }
      }
      if (Object.keys(batch).length > 0) {
        setGitInfoCache(prev => ({ ...prev, ...batch }))
      }
    })
  }, [projects])

  return {
    projects,
    setProjects,
    folderPath,
    setFolderPath,
    scanning,
    setScanning,
    scanError,
    setScanError,
    searchQuery,
    setSearchQuery,
    favorites,
    setFavorites,
    gitInfoCache,
    setGitInfoCache,
    sortBy,
    setSortBy,
    filteredProjects,
    handleScan,
    handleSelectFolder,
    toggleFavorite,
    refreshGitInfo
  }
}
