import React, { useState, useEffect, useCallback } from 'react'
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
    gitInfoCache, setGitInfoCache, filteredProjects,
    handleSelectFolder, toggleFavorite, refreshGitInfo,
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

  // Handle WSL folder selection from Header
  const handleSelectFolderFromHeader = useCallback(async (wslPath) => {
    if (wslPath) {
      // WSL folder was selected directly
      setFolderPath(wslPath)
      setScanError(null)
      setScanning(true)
      setLogs({})
      setOpenTabs([])
      setActiveTab('projects')
      const result = await electron.scanFolder(wslPath)
      if (result.success) {
        setProjects(result.data)
      } else {
        setScanError(result.error)
        setProjects([])
      }
      setScanning(false)
    } else {
      // Regular folder selection
      const selected = await electron.selectFolder()
      if (selected) {
        setFolderPath(selected)
        setScanError(null)
        setScanning(true)
        setLogs({})
        setOpenTabs([])
        setActiveTab('projects')
        const result = await electron.scanFolder(selected)
        if (result.success) {
          setProjects(result.data)
        } else {
          setScanError(result.error)
          setProjects([])
        }
        setScanning(false)
      }
    }
  }, [setFolderPath, setScanError, setScanning, setLogs, setOpenTabs, setActiveTab, setProjects])

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
                <div className="project-grid">
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
                      isFavorite={favorites.has(project.path)}
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
