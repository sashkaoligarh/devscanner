import React, { useState, useCallback, useEffect } from 'react'
import {
  FolderOpen, Search, Terminal, Package, Radio,
  Globe, Container, Server, Palette
} from 'lucide-react'
import electron from '../electronApi'
import WindowControls from './WindowControls'

export default function Header({
  folderPath, scanning, searchQuery, setSearchQuery,
  onSelectFolder, activeView, setActiveView, isMaximized,
  projects, ports, dockerContainers, remoteServers,
  hostIp, wslDistros: wslDistrosProp
}) {
  const THEMES = [
    { id: 'green', label: 'Green' },
    { id: 'violet', label: 'Violet' },
    { id: 'paper', label: 'Paper' },
    { id: 'red', label: 'Red' },
    { id: 'pink', label: 'Pink' },
    { id: 'ash', label: 'Ash' },
  ]
  const [theme, setTheme] = useState(() => localStorage.getItem('devscanner-theme') || 'green')
  const [wslDistros, setWslDistros] = useState(wslDistrosProp || [])
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [folderPickerStep, setFolderPickerStep] = useState('source') // 'source' | 'wsl-distro' | 'wsl-browser'
  const [wslPickerDistro, setWslPickerDistro] = useState(null)
  const [wslPickerPath, setWslPickerPath] = useState('/')
  const [wslPickerParentPath, setWslPickerParentPath] = useState(null)
  const [wslPickerDirs, setWslPickerDirs] = useState([])
  const [wslPickerLoadingDistros, setWslPickerLoadingDistros] = useState(false)
  const [wslPickerLoadingDirs, setWslPickerLoadingDirs] = useState(false)
  const [wslPickerResolving, setWslPickerResolving] = useState(false)
  const [wslPickerError, setWslPickerError] = useState(null)
  const [wslNetInfo, setWslNetInfo] = useState(null)
  const [wslNetOpen, setWslNetOpen] = useState(false)
  const [wslNetFixing, setWslNetFixing] = useState(false)
  const [wslNetFixed, setWslNetFixed] = useState(false)

  // Keep distro list in sync with App updates
  useEffect(() => {
    if (Array.isArray(wslDistrosProp)) {
      setWslDistros(wslDistrosProp)
    }
  }, [wslDistrosProp])

  // Close folder source popover on outside click
  useEffect(() => {
    if (!folderPickerOpen) return
    const handleClick = (e) => {
      if (e.target.closest('.folder-picker-wrapper')) return
      setFolderPickerOpen(false)
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
    }
  }, [folderPickerOpen])

  // Close WSL network popover on outside click
  useEffect(() => {
    if (!wslNetOpen) return
    const handleClick = (e) => {
      if (e.target.closest('.wsl-net-wrapper')) return
      setWslNetOpen(false)
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
    }
  }, [wslNetOpen])

  // Load WSL network info when hostIp is available
  useEffect(() => {
    if (hostIp) {
      electron.checkWslLocalhost().then(net => setWslNetInfo(net))
    }
  }, [hostIp])

  const openFolderPicker = useCallback(() => {
    setFolderPickerOpen(prev => {
      const next = !prev
      if (next) {
        setFolderPickerStep('source')
        setWslPickerError(null)
      }
      return next
    })
  }, [])

  const loadWslDistros = useCallback(async () => {
    if (wslDistros.length > 0) return wslDistros
    setWslPickerLoadingDistros(true)
    const distros = await electron.getWslDistros()
    setWslPickerLoadingDistros(false)
    setWslDistros(distros)
    return distros
  }, [wslDistros])

  const loadWslDirectory = useCallback(async (distro, linuxPath) => {
    setWslPickerLoadingDirs(true)
    setWslPickerError(null)
    const result = await electron.listWslDirectories({ distro, path: linuxPath })
    setWslPickerLoadingDirs(false)

    if (!result?.success || !result?.data) {
      setWslPickerError(result?.error || 'Failed to load WSL directory')
      return false
    }

    setWslPickerDistro(result.data.distro)
    setWslPickerPath(result.data.linuxPath)
    setWslPickerParentPath(result.data.parentPath)
    setWslPickerDirs(result.data.directories || [])
    setFolderPickerStep('wsl-browser')
    return true
  }, [])

  const handlePickWindowsFolder = useCallback(() => {
    setFolderPickerOpen(false)
    onSelectFolder()
  }, [onSelectFolder])

  const handlePickWslSource = useCallback(async () => {
    setFolderPickerStep('wsl-distro')
    setWslPickerError(null)
    const distros = await loadWslDistros()
    if (distros.length === 0) {
      setWslPickerError('No WSL distributions found')
    }
  }, [loadWslDistros])

  const handlePickWslDistro = useCallback(async (distro) => {
    await loadWslDirectory(distro)
  }, [loadWslDirectory])

  const handleSelectWslCurrentFolder = useCallback(async () => {
    if (!wslPickerDistro) return
    setWslPickerResolving(true)
    setWslPickerError(null)
    const result = await electron.resolveWslFolder({
      distro: wslPickerDistro,
      path: wslPickerPath
    })
    setWslPickerResolving(false)

    if (!result?.success || !result?.data?.windowsPath) {
      setWslPickerError(result?.error || 'Failed to select WSL folder')
      return
    }

    setFolderPickerOpen(false)
    onSelectFolder(result.data.windowsPath)
  }, [onSelectFolder, wslPickerDistro, wslPickerPath])

  const handleWslDirOpen = useCallback(async (linuxPath) => {
    if (!wslPickerDistro) return
    await loadWslDirectory(wslPickerDistro, linuxPath)
  }, [loadWslDirectory, wslPickerDistro])

  const handleWslParentOpen = useCallback(async () => {
    if (!wslPickerDistro || !wslPickerParentPath) return
    await loadWslDirectory(wslPickerDistro, wslPickerParentPath)
  }, [loadWslDirectory, wslPickerDistro, wslPickerParentPath])

  // Apply theme to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('devscanner-theme', theme)
  }, [theme])

  const handleThemeChange = useCallback((e) => {
    setTheme(e.target.value)
  }, [])

  const handleFixWslLocalhost = useCallback(async () => {
    setWslNetFixing(true)
    const result = await electron.fixWslLocalhost()
    setWslNetFixing(false)
    if (result.success) {
      setWslNetFixed(true)
      setWslNetInfo(prev => ({ ...prev, forwarding: true }))
    } else {
      alert(`Failed to apply fix: ${result.error || 'Unknown error'}`)
    }
  }, [])

  return (
    <header className="header">
      <span className="header-title">DevScanner</span>
      <nav className="nav-tabs">
        <button
          className={`nav-tab${activeView === 'projects' ? ' nav-tab-active' : ''}`}
          onClick={() => setActiveView('projects')}
        >
          <Package size={13} />
          Projects
        </button>
        <button
          className={`nav-tab${activeView === 'ports' ? ' nav-tab-active' : ''}`}
          onClick={() => setActiveView('ports')}
        >
          <Radio size={13} />
          Ports
          {ports.length > 0 && <span className="nav-tab-badge">{ports.length}</span>}
        </button>
        <button
          className={`nav-tab${activeView === 'docker' ? ' nav-tab-active' : ''}`}
          onClick={() => setActiveView('docker')}
        >
          <Container size={13} />
          Docker
          {dockerContainers.length > 0 && <span className="nav-tab-badge">{dockerContainers.length}</span>}
        </button>
        <button
          className={`nav-tab${activeView === 'servers' ? ' nav-tab-active' : ''}`}
          onClick={() => setActiveView('servers')}
        >
          <Server size={13} />
          Servers
          {remoteServers.length > 0 && <span className="nav-tab-badge">{remoteServers.length}</span>}
        </button>
      </nav>
      {folderPath && activeView === 'projects' && <span className="header-path" title={folderPath}>{folderPath}</span>}
      <div className="header-actions">
        {activeView === 'projects' && projects.length > 0 && (
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, color: 'var(--color-text-dim)' }} />
            <input
              className="search-input"
              style={{ paddingLeft: '2rem' }}
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        )}
        {activeView === 'projects' && (
          <>
            {hostIp && (
              <div className="wsl-net-wrapper" style={{ position: 'relative' }}>
                <button
                  className={`btn btn-wsl${wslNetInfo?.forwarding ? ' btn-wsl-ok' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setWslNetOpen(prev => !prev) }}
                  title={`WSL IP: ${hostIp}`}
                >
                  <Globe size={14} />
                  {hostIp}
                </button>
                {wslNetOpen && (
                  <div className="wsl-net-popover" onClick={(e) => e.stopPropagation()}>
                    <div className="wsl-net-title">WSL Network</div>
                    <div className="wsl-net-row">
                      <span className="wsl-net-label">IP address</span>
                      <code className="wsl-net-val">{hostIp}</code>
                    </div>
                    <div className="wsl-net-row">
                      <span className="wsl-net-label">localhost forwarding</span>
                      {wslNetInfo?.forwarding
                        ? <span className="wsl-net-status ok">enabled</span>
                        : <span className="wsl-net-status off">{wslNetInfo?.forwarding === false ? 'disabled' : 'not configured'}</span>
                      }
                    </div>
                    {!wslNetInfo?.forwarding && wslNetInfo?.available && !wslNetFixed && (
                      <button
                        className="btn btn-primary wsl-net-fix-btn"
                        onClick={handleFixWslLocalhost}
                        disabled={wslNetFixing}
                      >
                        {wslNetFixing ? 'Applying...' : 'Enable localhost forwarding'}
                      </button>
                    )}
                    {(wslNetFixed || wslNetInfo?.forwarding) && (
                      <div className="wsl-net-hint">
                        Run <code>wsl --shutdown</code> in PowerShell, then restart DevScanner to use <code>localhost</code>.
                      </div>
                    )}
                    {!wslNetInfo?.available && (
                      <div className="wsl-net-hint">
                        Add <code>localhostForwarding=true</code> under <code>[wsl2]</code> in <code>%USERPROFILE%\.wslconfig</code>.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="folder-picker-wrapper" style={{ position: 'relative' }}>
              <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); openFolderPicker() }}>
                <FolderOpen size={14} />
                Choose Folder
              </button>

              {folderPickerOpen && (
                <div className="folder-picker-popover" onClick={(e) => e.stopPropagation()}>
                  {folderPickerStep === 'source' && (
                    <>
                      <div className="folder-picker-title">Choose source</div>
                      <button className="folder-picker-option" onClick={handlePickWindowsFolder}>
                        <FolderOpen size={14} />
                        Windows
                      </button>
                      <button className="folder-picker-option" onClick={handlePickWslSource}>
                        <Terminal size={14} />
                        WSL
                      </button>
                    </>
                  )}

                  {folderPickerStep === 'wsl-distro' && (
                    <>
                      <div className="folder-picker-toolbar">
                        <button className="folder-picker-back" onClick={() => { setFolderPickerStep('source'); setWslPickerError(null) }}>
                          Back
                        </button>
                        <div className="folder-picker-title">Select WSL distro</div>
                      </div>

                      {wslPickerLoadingDistros ? (
                        <div className="folder-picker-hint">Loading WSL distributions...</div>
                      ) : wslDistros.length > 0 ? (
                        <div className="folder-picker-list">
                          {wslDistros.map(distro => (
                            <button
                              key={distro}
                              className="folder-picker-list-item"
                              onClick={() => handlePickWslDistro(distro)}
                            >
                              {distro}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="folder-picker-hint">No WSL distributions found</div>
                      )}
                    </>
                  )}

                  {folderPickerStep === 'wsl-browser' && (
                    <>
                      <div className="folder-picker-toolbar">
                        <button className="folder-picker-back" onClick={() => { setFolderPickerStep('wsl-distro'); setWslPickerError(null) }}>
                          Back
                        </button>
                        <div className="folder-picker-title">{wslPickerDistro}</div>
                      </div>

                      <div className="folder-picker-path" title={wslPickerPath}>{wslPickerPath}</div>

                      <div className="folder-picker-actions-row">
                        <button className="btn btn-sm" onClick={handleWslParentOpen} disabled={!wslPickerParentPath || wslPickerLoadingDirs}>
                          Up
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={handleSelectWslCurrentFolder} disabled={wslPickerResolving || wslPickerLoadingDirs}>
                          {wslPickerResolving ? 'Selecting...' : 'Select this folder'}
                        </button>
                      </div>

                      {wslPickerLoadingDirs ? (
                        <div className="folder-picker-hint">Loading folders...</div>
                      ) : (
                        <div className="folder-picker-list">
                          {wslPickerDirs.length > 0 ? (
                            wslPickerDirs.map(dir => (
                              <button
                                key={dir.linuxPath}
                                className="folder-picker-list-item"
                                onClick={() => handleWslDirOpen(dir.linuxPath)}
                              >
                                {dir.name}
                              </button>
                            ))
                          ) : (
                            <div className="folder-picker-hint">No subfolders</div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {wslPickerError && (
                    <div className="folder-picker-error">{wslPickerError}</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="theme-select-wrapper">
        <Palette size={14} className="theme-select-icon" />
        <select className="theme-select" value={theme} onChange={handleThemeChange} title="Theme">
          {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      <WindowControls isMaximized={isMaximized} />
    </header>
  )
}
