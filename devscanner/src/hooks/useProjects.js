import { useState, useCallback, useMemo, useEffect } from 'react'
import electron from '../electronApi'

export default function useProjects() {
  const [projects, setProjects] = useState([])
  const [folderPath, setFolderPath] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [favorites, setFavorites] = useState(new Set())
  const [favoriteOrder, setFavoriteOrder] = useState([])
  const [previewFavoriteOrder, setPreviewFavoriteOrder] = useState(null)
  const [previewFavorites, setPreviewFavorites] = useState(null)
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
    const activeOrder = previewFavoriteOrder || favoriteOrder
    const activeFavs = previewFavorites || favorites
    // Favorites first, in custom order
    return [...list].sort((a, b) => {
      const aFav = activeFavs.has(a.path) ? 0 : 1
      const bFav = activeFavs.has(b.path) ? 0 : 1
      if (aFav !== bFav) return aFav - bFav
      if (aFav === 0) {
        const aIdx = activeOrder.indexOf(a.path)
        const bIdx = activeOrder.indexOf(b.path)
        return (aIdx === -1 ? Infinity : aIdx) - (bIdx === -1 ? Infinity : bIdx)
      }
      return 0
    })
  }, [projects, searchQuery, favorites, favoriteOrder, previewFavoriteOrder, previewFavorites])

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
      if (next.has(projectPath)) {
        next.delete(projectPath)
        setFavoriteOrder(order => {
          const newOrder = order.filter(p => p !== projectPath)
          electron.saveSettings({ favorites: [...next], favoriteOrder: newOrder })
          return newOrder
        })
      } else {
        next.add(projectPath)
        setFavoriteOrder(order => {
          const newOrder = [...order, projectPath]
          electron.saveSettings({ favorites: [...next], favoriteOrder: newOrder })
          return newOrder
        })
      }
      return next
    })
  }, [])

  const reorderFavorites = useCallback((fromPath, toPath) => {
    setFavoriteOrder(prev => {
      const order = [...prev]
      const fromIdx = order.indexOf(fromPath)
      const toIdx = order.indexOf(toPath)
      if (fromIdx === -1 || toIdx === -1) return prev
      order.splice(fromIdx, 1)
      order.splice(toIdx, 0, fromPath)
      electron.saveSettings({ favoriteOrder: order })
      return order
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
    favoriteOrder,
    setFavoriteOrder,
    previewFavoriteOrder,
    setPreviewFavoriteOrder,
    previewFavorites,
    setPreviewFavorites,
    gitInfoCache,
    setGitInfoCache,
    sortBy,
    setSortBy,
    filteredProjects,
    handleScan,
    handleSelectFolder,
    toggleFavorite,
    reorderFavorites,
    refreshGitInfo
  }
}
