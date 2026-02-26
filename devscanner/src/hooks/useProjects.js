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

  // Load git info for all projects when project list changes
  useEffect(() => {
    if (!electron.available || projects.length === 0) return
    projects.forEach(p => {
      if (!p.git) return
      electron.gitInfo({ projectPath: p.path }).then(info => {
        if (info) setGitInfoCache(prev => ({ ...prev, [p.path]: info }))
      })
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
