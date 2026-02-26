import React, { useState, useCallback, useEffect } from 'react'
import {
  FolderOpen, Search, Terminal, Package, Radio,
  Globe, Container, Server
} from 'lucide-react'
import electron from '../electronApi'
import WindowControls from './WindowControls'

export default function Header({
  folderPath, scanning, searchQuery, setSearchQuery,
  onSelectFolder, activeView, setActiveView, isMaximized,
  projects, ports, dockerContainers, remoteServers,
  hostIp, wslDistros: wslDistrosProp
}) {
  const [wslDistros, setWslDistros] = useState(wslDistrosProp || [])
  const [wslMenuOpen, setWslMenuOpen] = useState(false)
  const [wslNetInfo, setWslNetInfo] = useState(null)
  const [wslNetOpen, setWslNetOpen] = useState(false)
  const [wslNetFixing, setWslNetFixing] = useState(false)
  const [wslNetFixed, setWslNetFixed] = useState(false)

  // Close WSL dropdown on outside click
  useEffect(() => {
    if (!wslMenuOpen) return
    const handleClick = (e) => {
      if (e.target.closest('.wsl-dropdown-wrapper')) return
      setWslMenuOpen(false)
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
    }
  }, [wslMenuOpen])

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

  const handleOpenWslFolder = useCallback(async (distro) => {
    setWslMenuOpen(false)
    const selected = await electron.selectWslFolder(distro)
    if (selected) {
      // Pass up via onSelectFolder with the WSL path
      // The parent will handle scanning
      onSelectFolder(selected)
    }
  }, [onSelectFolder])

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
            {wslDistros.length > 0 && (
              <div className="wsl-dropdown-wrapper" style={{ position: 'relative' }}>
                <button
                  className="btn btn-wsl"
                  onClick={(e) => { e.stopPropagation(); setWslMenuOpen(prev => !prev) }}
                >
                  <Terminal size={14} />
                  WSL
                </button>
                {wslMenuOpen && (
                  <div className="wsl-dropdown" onClick={(e) => e.stopPropagation()}>
                    {wslDistros.map(d => (
                      <button
                        key={d}
                        className="wsl-dropdown-item"
                        onClick={() => handleOpenWslFolder(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
            <button className="btn btn-primary" onClick={() => onSelectFolder()}>
              <FolderOpen size={14} />
              Choose Folder
            </button>
          </>
        )}
      </div>
      <WindowControls isMaximized={isMaximized} />
    </header>
  )
}
