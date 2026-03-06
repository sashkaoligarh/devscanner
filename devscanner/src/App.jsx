import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import {
  FolderOpen, X, Package, Terminal, ScrollText, Download
} from 'lucide-react'
import electron from './electronApi'
import { makeLogKey } from './constants'

// Hooks
import useProjects from './hooks/useProjects'
import useLauncher from './hooks/useLauncher'
import useDocker from './hooks/useDocker'
import usePorts from './hooks/usePorts'
import useServers from './hooks/useServers'
import useDockerServices from './hooks/useDockerServices'

// Components
import Header from './components/Header'
import ProjectCard from './components/ProjectCard'
import LaunchModal from './components/LaunchModal'
import EnvEditorModal from './components/EnvEditorModal'
import DockerServicesModal from './components/DockerServicesModal'
import PortScanner from './components/PortScanner'
import DockerContainers from './components/DockerContainers'
import { ConsoleView, DockerConsoleView } from './components/ConsoleView'
import RemoteServers from './components/servers/RemoteServers'
import AddServerModal from './components/servers/AddServerModal'

export default function App() {
  // Top-level UI state
  const [navTab, setNavTab] = useState('projects')
  const [isMaximized, setIsMaximized] = useState(false)
  const [hostIp, setHostIp] = useState(null)
  const [wslDistros, setWslDistros] = useState([])
  const [envModal, setEnvModal] = useState(null)

  // Update state
  const [updateInfo, setUpdateInfo] = useState(null)
  const [updateProgress, setUpdateProgress] = useState(null)
  const [updateReady, setUpdateReady] = useState(false)

  // Hooks
  const projectsHook = useProjects()
  const {
    projects, folderPath, setFolderPath, scanning, scanError,
    searchQuery, setSearchQuery, favorites, setFavorites,
    favoriteOrder, setFavoriteOrder,
    previewFavoriteOrder, setPreviewFavoriteOrder,
    previewFavorites, setPreviewFavorites,
    gitInfoCache, setGitInfoCache, filteredProjects,
    handleSelectFolder, toggleFavorite, reorderFavorites, refreshGitInfo,
    setProjects, setScanning, setScanError
  } = projectsHook

  const launcherHook = useLauncher({ hostIp })
  const {
    running, logs, openTabs, setOpenTabs, activeTab, setActiveTab,
    launchModal, setLaunchModal, launchConfigs, setLaunchConfigs, health, logRef,
    handleLaunch, handleLaunchMultiple, handleStop, handleCloseTab,
    handleClearLogs, handleOpenBrowser, handleSaveConfig, setLogs
  } = launcherHook

  const dockerHook = useDocker({
    folderPath, navTab,
    openTabs, setOpenTabs, setActiveTab, setNavTab
  })
  const {
    dockerContainers, dockerLoading, dockerError, dockerInfo,
    dockerLogs, dockerContainerMap, dockerActionLoading,
    refreshDocker, handleDockerAction, viewDockerLogs
  } = dockerHook

  const portsHook = usePorts()
  const {
    ports, portsScanning, portsScanMode, setPortsScanMode,
    portsError, killingPids, scanPorts, handleKillPort
  } = portsHook

  const serversHook = useServers()
  const {
    remoteServers, setRemoteServers, serverConnections, serverDiscovery,
    activeServerId, setActiveServerId, serverSubTab, setServerSubTab,
    addServerModal, setAddServerModal, serverDiscovering,
    terminalOutput, terminalInput, setTerminalInput,
    connectServer, disconnectServer, discoverServer,
    saveServer, deleteServer, execOnServer,
    remoteRunning, remoteLogs, setRemoteRunning
  } = serversHook

  const dockerServicesHook = useDockerServices()
  const {
    serviceCatalog, dockerServicesHealth,
    dockerServicesModal, openServicesModal, closeServicesModal
  } = dockerServicesHook

  // Initialization: window state, host info, settings, update listeners
  useEffect(() => {
    if (!electron.available) return

    // Window maximize
    electron.windowIsMaximized().then(setIsMaximized)
    electron.onWindowMaximized(setIsMaximized)

    // Host info (WSL IP, etc.)
    electron.getHostInfo().then(info => {
      if (info.wslIp) setHostIp(info.wslIp)
    })

    // WSL distros
    electron.getWslDistros().then(distros => {
      if (distros.length > 0) setWslDistros(distros)
    })

    // Update listeners
    electron.onUpdateAvailable((info) => setUpdateInfo(info))
    electron.onUpdateDownloadProgress((progress) => setUpdateProgress(progress))
    electron.onUpdateDownloaded(() => { setUpdateProgress(null); setUpdateReady(true) })

    // Load saved settings
    electron.getSettings().then(settings => {
      if (settings.launchConfigs) setLaunchConfigs(settings.launchConfigs)
      if (settings.favorites) setFavorites(new Set(settings.favorites))
      if (settings.favoriteOrder) setFavoriteOrder(settings.favoriteOrder)
      else if (settings.favorites) setFavoriteOrder(settings.favorites)
      if (settings.remoteServers) setRemoteServers(settings.remoteServers)
      if (settings.lastFolder) {
        setFolderPath(settings.lastFolder)
        setScanning(true)
        electron.scanFolder(settings.lastFolder).then(result => {
          if (result.success) {
            setProjects(result.data)
          } else {
            setScanError(result.error)
          }
          setScanning(false)
        })
      }
    })

    return () => {
      electron.removeUpdateListeners()
      electron.removeWindowListeners()
    }
  }, [])

  // Auto-scan ports and docker when switching tabs
  useEffect(() => {
    if (navTab === 'ports' && ports.length === 0 && !portsScanning) {
      scanPorts()
    }
    if (navTab === 'docker' && dockerContainers.length === 0 && !dockerLoading) {
      refreshDocker()
    }
  }, [navTab])

  const scanSelectedFolder = useCallback(async (selectedPath) => {
    setFolderPath(selectedPath)
    setScanError(null)
    setScanning(true)
    setLogs({})
    setOpenTabs([])
    setActiveTab('projects')

    const result = await electron.scanFolder(selectedPath)
    if (result.success) {
      setProjects(result.data)
    } else {
      setScanError(result.error)
      setProjects([])
    }
    setScanning(false)
  }, [setFolderPath, setScanError, setScanning, setLogs, setOpenTabs, setActiveTab, setProjects])

  // Handle folder selection from Header (Windows picker or WSL popup)
  const handleSelectFolderFromHeader = useCallback(async (pickedPath) => {
    const selectedPath = pickedPath || await electron.selectFolder()
    if (!selectedPath) return

    await scanSelectedFolder(selectedPath)
    await electron.saveSettings({ lastFolder: selectedPath })
  }, [scanSelectedFolder])

  // ── Project card drag-and-drop ──
  const dragRef = useRef(null)
  const previewOrderRef = useRef(null)
  const previewFavsRef = useRef(null)
  const gridRef = useRef(null)
  const gridColsRef = useRef(3)
  const cardRectsRef = useRef(new Map())

  // Build a lookup: projectPath → visual index.
  // Runs synchronously after DOM commit so it's never stale.
  const idxMapRef = useRef(new Map())

  // FLIP animation: capture old positions, compute deltas, animate
  useLayoutEffect(() => {
    const m = new Map()
    filteredProjects.forEach((p, i) => m.set(p.path, i))
    idxMapRef.current = m

    const oldRects = cardRectsRef.current
    if (!gridRef.current || oldRects.size === 0) return
    const cards = gridRef.current.querySelectorAll('[data-project-path]')
    cards.forEach(card => {
      const path = card.dataset.projectPath
      const oldRect = oldRects.get(path)
      if (!oldRect) return
      const newRect = card.getBoundingClientRect()
      const dx = oldRect.left - newRect.left
      const dy = oldRect.top - newRect.top
      if (dx === 0 && dy === 0) return
      card.style.transform = `translate(${dx}px, ${dy}px)`
      card.style.transition = 'none'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)'
          card.style.transform = ''
        })
      })
    })
    cardRectsRef.current = new Map()
  }, [filteredProjects])

  const captureCardPositions = useCallback(() => {
    if (!gridRef.current) return
    const cards = gridRef.current.querySelectorAll('[data-project-path]')
    const rects = new Map()
    cards.forEach(card => {
      const rect = card.getBoundingClientRect()
      // Compensate for any active FLIP transform so we capture the final position
      const st = getComputedStyle(card)
      const matrix = new DOMMatrix(st.transform)
      rects.set(card.dataset.projectPath, {
        left: rect.left - matrix.m41,
        top: rect.top - matrix.m42
      })
    })
    cardRectsRef.current = rects
  }, [])

  const handleDragStart = useCallback((e, projectPath) => {
    dragRef.current = projectPath
    previewOrderRef.current = null
    previewFavsRef.current = null
    if (gridRef.current) {
      gridColsRef.current = getComputedStyle(gridRef.current)
        .gridTemplateColumns.split(' ').length
    }
    e.dataTransfer.effectAllowed = 'move'
    e.currentTarget.classList.add('dragging')
  }, [])

  const handleDragOver = useCallback((e, projectPath) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragRef.current || dragRef.current === projectPath) return

    const idxMap = idxMapRef.current
    const fromIdx = idxMap.get(dragRef.current)
    const toIdx = idxMap.get(projectPath)
    if (fromIdx === undefined || toIdx === undefined || fromIdx === toIdx) return

    const cols = gridColsRef.current
    const fromCol = fromIdx % cols
    const toCol = toIdx % cols
    const fromRow = Math.floor(fromIdx / cols)
    const toRow = Math.floor(toIdx / cols)

    // Cursor position relative to the target card (getBoundingClientRect is reliable, no transforms)
    const rect = e.currentTarget.getBoundingClientRect()
    const xRatio = (e.clientX - rect.left) / rect.width
    const yRatio = (e.clientY - rect.top) / rect.height

    // 50% midpoint: cursor must cross the center line of the target card
    if (fromRow === toRow) {
      if (toCol > fromCol && xRatio < 0.5) return   // dragging right, not past center
      if (toCol < fromCol && xRatio > 0.5) return   // dragging left, not past center
    } else if (fromCol === toCol) {
      if (toRow > fromRow && yRatio < 0.5) return   // dragging down, not past center
      if (toRow < fromRow && yRatio > 0.5) return   // dragging up, not past center
    } else {
      const xOk = toCol > fromCol ? xRatio >= 0.5 : xRatio <= 0.5
      const yOk = toRow > fromRow ? yRatio >= 0.5 : yRatio <= 0.5
      if (!xOk && !yOk) return
    }

    const curFavs = previewFavsRef.current || favorites
    const curOrder = previewOrderRef.current || favoriteOrder
    const targetIsFav = curFavs.has(projectPath)
    const draggedPath = dragRef.current
    const movingForward = fromIdx < toIdx

    let newOrder, newFavs

    if (targetIsFav) {
      newFavs = new Set(curFavs)
      newFavs.add(draggedPath)
      newOrder = curOrder.filter(p => p !== draggedPath)
      const targetPos = newOrder.indexOf(projectPath)
      if (targetPos === -1) return
      // Moving forward: insert AFTER target (to reach its position)
      // Moving backward: insert BEFORE target
      newOrder.splice(movingForward ? targetPos + 1 : targetPos, 0, draggedPath)
    } else {
      if (!curFavs.has(draggedPath)) return
      newFavs = new Set(curFavs)
      newFavs.delete(draggedPath)
      newOrder = curOrder.filter(p => p !== draggedPath)
    }

    captureCardPositions()
    previewOrderRef.current = newOrder
    previewFavsRef.current = newFavs
    setPreviewFavoriteOrder(newOrder)
    setPreviewFavorites(newFavs)
  }, [favorites, favoriteOrder, captureCardPositions, setPreviewFavoriteOrder, setPreviewFavorites])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    if (dragRef.current && (previewOrderRef.current || previewFavsRef.current)) {
      const finalOrder = previewOrderRef.current || favoriteOrder
      const finalFavs = previewFavsRef.current || favorites
      setFavoriteOrder(finalOrder)
      setFavorites(finalFavs)
      electron.saveSettings({
        favorites: [...finalFavs],
        favoriteOrder: finalOrder
      })
    }
    setPreviewFavoriteOrder(null)
    setPreviewFavorites(null)
    previewOrderRef.current = null
    previewFavsRef.current = null
    dragRef.current = null
  }, [favorites, favoriteOrder, setFavoriteOrder, setFavorites, setPreviewFavoriteOrder, setPreviewFavorites])

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.classList.remove('dragging')
    setPreviewFavoriteOrder(null)
    setPreviewFavorites(null)
    previewOrderRef.current = null
    previewFavsRef.current = null
    dragRef.current = null
  }, [setPreviewFavoriteOrder, setPreviewFavorites])

  // ── Tab drag-and-drop ──
  const tabDragRef = useRef(null)
  const tabLastSwap = useRef(null)

  const handleTabDragStart = useCallback((e, tabKey) => {
    tabDragRef.current = tabKey
    tabLastSwap.current = null
    e.dataTransfer.effectAllowed = 'move'
    e.currentTarget.classList.add('tab-dragging')
  }, [])

  const handleTabDragOver = useCallback((e, tabKey) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!tabDragRef.current || tabDragRef.current === tabKey) return

    if (tabLastSwap.current === tabKey) {
      const rect = e.currentTarget.getBoundingClientRect()
      const xFromCenter = Math.abs(e.clientX - (rect.left + rect.width / 2))
      if (xFromCenter > rect.width / 4) return
    }

    tabLastSwap.current = tabKey
    setOpenTabs(prev => {
      const tabs = [...prev]
      const fromIdx = tabs.indexOf(tabDragRef.current)
      const toIdx = tabs.indexOf(tabKey)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev
      tabs.splice(fromIdx, 1)
      tabs.splice(toIdx, 0, tabDragRef.current)
      return tabs
    })
  }, [setOpenTabs])

  const handleTabDrop = useCallback((e) => {
    e.preventDefault()
    tabDragRef.current = null
    tabLastSwap.current = null
  }, [])

  const handleTabDragEnd = useCallback((e) => {
    e.currentTarget.classList.remove('tab-dragging')
    tabDragRef.current = null
    tabLastSwap.current = null
  }, [])

  // Tab info helper
  const getTabInfo = useCallback((tabKey) => {
    if (tabKey.startsWith('docker-log::')) {
      const containerId = tabKey.substring('docker-log::'.length)
      const container = dockerContainerMap[containerId]
      return {
        type: 'docker-log',
        containerId,
        projectName: container ? container.Names : containerId.substring(0, 12),
        instanceId: 'logs',
        isRunning: false,
        port: null
      }
    }
    const sepIdx = tabKey.indexOf('::')
    const projectPath = tabKey.substring(0, sepIdx)
    const instanceId = tabKey.substring(sepIdx + 2)
    const project = projects.find(p => p.path === projectPath)
    const projectName = project ? project.name : projectPath.split('/').pop()
    const instances = running[projectPath]
    const isRunning = instances && instances[instanceId]
    const port = isRunning ? instances[instanceId].port : null
    return { type: 'project', projectPath, instanceId, projectName, isRunning: !!isRunning, port }
  }, [projects, running, dockerContainerMap])

  return (
    <div className="app">
      <Header
        folderPath={folderPath}
        scanning={scanning}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onSelectFolder={handleSelectFolderFromHeader}
        activeView={navTab}
        setActiveView={setNavTab}
        isMaximized={isMaximized}
        projects={projects}
        ports={ports}
        dockerContainers={dockerContainers}
        remoteServers={remoteServers}
        hostIp={hostIp}
        wslDistros={wslDistros}
      />

      {/* Update banner */}
      {updateReady ? (
        <div className="update-banner">
          <Download size={14} />
          <span className="update-banner-text">Update ready to install</span>
          <button className="btn btn-primary" onClick={() => electron.installUpdate()}>
            Install & Restart
          </button>
        </div>
      ) : updateProgress ? (
        <div className="update-banner">
          <Download size={14} />
          <span className="update-banner-text">Downloading... {Math.round(updateProgress.percent)}%</span>
          <div className="update-progress-bar">
            <div className="update-progress-fill" style={{ width: `${updateProgress.percent}%` }} />
          </div>
        </div>
      ) : updateInfo ? (
        <div className="update-banner">
          <Download size={14} />
          <span className="update-banner-text">Version {updateInfo.version} available</span>
          <button className="btn btn-primary" onClick={() => electron.downloadUpdate()}>
            Download
          </button>
          <button className="btn btn-dismiss" onClick={() => setUpdateInfo(null)}>
            <X size={12} />
          </button>
        </div>
      ) : null}

      {/* Main content based on active view */}
      {navTab === 'servers' ? (
        <RemoteServers
          servers={remoteServers}
          connections={serverConnections}
          discovery={serverDiscovery}
          discovering={serverDiscovering}
          activeServerId={activeServerId}
          serverSubTab={serverSubTab}
          terminalOutput={terminalOutput}
          terminalInput={terminalInput}
          onSetActiveServer={setActiveServerId}
          onSetSubTab={setServerSubTab}
          onConnect={connectServer}
          onDisconnect={disconnectServer}
          onDiscover={discoverServer}
          onDelete={deleteServer}
          onAddServer={() => setAddServerModal(true)}
          onExec={execOnServer}
          onSetTerminalInput={setTerminalInput}
          remoteRunning={remoteRunning}
          remoteLogs={remoteLogs}
        />
      ) : navTab === 'docker' ? (
        <DockerContainers
          containers={dockerContainers}
          loading={dockerLoading}
          error={dockerError}
          dockerInfo={dockerInfo}
          actionLoading={dockerActionLoading}
          onRefresh={refreshDocker}
          onAction={handleDockerAction}
          onViewLogs={viewDockerLogs}
        />
      ) : navTab === 'ports' ? (
        <PortScanner
          ports={ports}
          scanning={portsScanning}
          scanMode={portsScanMode}
          error={portsError}
          killingPids={killingPids}
          onScan={scanPorts}
          onSetMode={setPortsScanMode}
          onKill={handleKillPort}
          onOpenBrowser={handleOpenBrowser}
        />
      ) : (
        <>
          {/* Tab bar for open process/docker log tabs */}
          {openTabs.length > 0 && (
            <div className="tab-bar">
              <button
                className={`tab${activeTab === 'projects' ? ' tab-active' : ''}`}
                onClick={() => setActiveTab('projects')}
              >
                <Package size={12} />
                Projects
              </button>
              {openTabs.map(tabKey => {
                const info = getTabInfo(tabKey)
                const isDockerLog = info.type === 'docker-log'
                return (
                  <button
                    key={tabKey}
                    className={`tab${activeTab === tabKey ? ' tab-active' : ''}${info.isRunning ? ' tab-running' : ''}`}
                    onClick={() => setActiveTab(tabKey)}
                    draggable
                    onDragStart={(e) => handleTabDragStart(e, tabKey)}
                    onDragOver={(e) => handleTabDragOver(e, tabKey)}
                    onDrop={handleTabDrop}
                    onDragEnd={handleTabDragEnd}
                  >
                    {isDockerLog ? <ScrollText size={12} /> : <Terminal size={12} />}
                    {isDockerLog
                      ? info.projectName
                      : `${info.projectName}/${info.instanceId}`}
                    {info.port && <span className="tab-port">:{info.port}</span>}
                    <span
                      className="tab-close"
                      onClick={e => { e.stopPropagation(); handleCloseTab(tabKey) }}
                    >
                      <X size={10} />
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Projects list or console view */}
          {activeTab === 'projects' ? (
            <div className="main">
              {scanning ? (
                <div className="scanning-indicator">
                  <div className="spinner" />
                  Scanning...
                </div>
              ) : scanError ? (
                <div className="empty-state">
                  <div className="empty-state-text error-message">{scanError}</div>
                  <button className="btn btn-primary" onClick={() => handleSelectFolderFromHeader()}>
                    <FolderOpen size={14} />
                    Choose Another Folder
                  </button>
                </div>
              ) : filteredProjects.length > 0 ? (
                <div className="project-grid" ref={gridRef}>
                  {filteredProjects.map(project => (
                    <ProjectCard
                      key={project.path}
                      project={project}
                      instances={running[project.path]}
                      onLaunch={() => setLaunchModal({ project })}
                      onStop={handleStop}
                      onOpenBrowser={handleOpenBrowser}
                      onViewTab={(tabKey) => setActiveTab(tabKey)}
                      openTabs={openTabs}
                      isFavorite={(previewFavorites || favorites).has(project.path)}
                      onToggleFavorite={toggleFavorite}
                      health={health}
                      gitInfo={gitInfoCache[project.path] || null}
                      onGitFetch={(p) => electron.gitFetch({ projectPath: p }).then(() =>
                        electron.gitInfo({ projectPath: p }).then(info => {
                          if (info) setGitInfoCache(prev => ({ ...prev, [p]: info }))
                        })
                      )}
                      onGitPull={(p) => electron.gitPull({ projectPath: p }).then(() =>
                        electron.gitInfo({ projectPath: p }).then(info => {
                          if (info) setGitInfoCache(prev => ({ ...prev, [p]: info }))
                        })
                      )}
                      hostIp={hostIp}
                      onEnvEdit={(p) => setEnvModal({ project: p })}
                      onDockerServices={(p) => openServicesModal(p)}
                      isDragOver={false}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>
              ) : folderPath && !scanning ? (
                <div className="empty-state">
                  <FolderOpen size={48} className="empty-state-icon" />
                  <div className="empty-state-text">
                    {searchQuery
                      ? 'No projects match your search'
                      : 'No projects found in this directory'}
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <FolderOpen size={48} className="empty-state-icon" />
                  <div className="empty-state-text">
                    Choose a folder to scan for projects
                  </div>
                </div>
              )}
            </div>
          ) : activeTab.startsWith('docker-log::') ? (
            <DockerConsoleView
              containerId={activeTab.substring('docker-log::'.length)}
              container={dockerContainerMap[activeTab.substring('docker-log::'.length)]}
              logs={dockerLogs[activeTab.substring('docker-log::'.length)] || []}
            />
          ) : (
            <ConsoleView
              tabKey={activeTab}
              info={getTabInfo(activeTab)}
              logs={logs[activeTab] || []}
              logRef={logRef}
              onStop={handleStop}
              onOpenBrowser={handleOpenBrowser}
              healthStatus={health[activeTab]}
              onClearLogs={() => handleClearLogs(activeTab)}
              hostIp={hostIp}
            />
          )}
        </>
      )}

      {/* Modals */}
      {launchModal && (
        <LaunchModal
          project={launchModal.project}
          runningInstances={running[launchModal.project.path] || {}}
          savedConfig={launchConfigs[launchModal.project.path]}
          onLaunch={handleLaunch}
          onLaunchMultiple={handleLaunchMultiple}
          onSaveConfig={(config) => handleSaveConfig(launchModal.project.path, config)}
          onClose={() => setLaunchModal(null)}
        />
      )}

      {envModal && (
        <EnvEditorModal
          project={envModal.project}
          onClose={() => setEnvModal(null)}
        />
      )}

      {dockerServicesModal && serviceCatalog && (
        <DockerServicesModal
          project={dockerServicesModal.project}
          catalog={serviceCatalog}
          healthStatus={dockerServicesHealth[dockerServicesModal.project.path] || {}}
          onClose={closeServicesModal}
        />
      )}

      {addServerModal && (
        <AddServerModal
          onAdd={saveServer}
          onClose={() => setAddServerModal(false)}
        />
      )}
    </div>
  )
}
