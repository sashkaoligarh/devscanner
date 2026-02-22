import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  FolderOpen, Play, Square, ExternalLink, Search,
  ChevronDown, ChevronRight, Terminal, GitBranch,
  FileCode, X, Package, Radio, RefreshCw, Skull,
  Zap, Globe, Save, Download
} from 'lucide-react'

const LANGUAGE_COLORS = {
  TypeScript: '#4488ff',
  JavaScript: '#ffcc00',
  Python: '#44aaff',
  Go: '#66ccff',
  Rust: '#ff7744',
  PHP: '#aa44ff',
  Ruby: '#ff4466',
  Java: '#ff8844',
  Kotlin: '#ff44aa',
  'C#': '#44ffaa'
}

const FRAMEWORK_COLORS = {
  'Next.js': '#ffffff',
  React: '#61dafb',
  Vue: '#41b883',
  Nuxt: '#00dc82',
  Express: '#68a063',
  NestJS: '#e0234e',
  Vite: '#646cff',
  Strapi: '#4945ff',
  Django: '#44aa66',
  Flask: '#aaaaaa',
  FastAPI: '#009688',
  Laravel: '#ff2d20',
  Rails: '#cc0000',
  'Spring Boot': '#6db33f',
  '.NET': '#512bd4',
  Electron: '#47848f',
  Svelte: '#ff3e00',
  SvelteKit: '#ff3e00',
  Fastify: '#000000'
}

function makeLogKey(projectPath, instanceId) {
  return `${projectPath}::${instanceId}`
}

function isWslPath(p) {
  return typeof p === 'string' && /^\\\\wsl/i.test(p)
}

// Safe electron API wrapper
const electron = {
  get available() { return !!window.electron },
  selectFolder: () => window.electron?.selectFolder?.() ?? Promise.resolve(null),
  scanFolder: (p) => window.electron?.scanFolder?.(p) ?? Promise.resolve({ success: false, error: 'Not available' }),
  launchProject: (o) => window.electron?.launchProject?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  stopProject: (o) => window.electron?.stopProject?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  getRunning: () => window.electron?.getRunning?.() ?? Promise.resolve({}),
  openBrowser: (u) => window.electron?.openBrowser?.(u),
  scanPorts: (o) => window.electron?.scanPorts?.(o) ?? Promise.resolve({ success: false, error: 'Restart Electron to enable port scanning' }),
  killPortProcess: (o) => window.electron?.killPortProcess?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  getSettings: () => window.electron?.getSettings?.() ?? Promise.resolve({}),
  saveSettings: (s) => window.electron?.saveSettings?.(s) ?? Promise.resolve({ success: true }),
  getWslDistros: () => window.electron?.getWslDistros?.() ?? Promise.resolve([]),
  selectWslFolder: (d) => window.electron?.selectWslFolder?.(d) ?? Promise.resolve(null),
  onProjectLog: (cb) => window.electron?.onProjectLog?.(cb),
  onProjectStopped: (cb) => window.electron?.onProjectStopped?.(cb),
  removeProjectLogListener: () => window.electron?.removeProjectLogListener?.(),
  removeProjectStoppedListener: () => window.electron?.removeProjectStoppedListener?.(),
  onUpdateAvailable: (cb) => window.electron?.onUpdateAvailable?.(cb),
  onUpdateDownloadProgress: (cb) => window.electron?.onUpdateDownloadProgress?.(cb),
  onUpdateDownloaded: (cb) => window.electron?.onUpdateDownloaded?.(cb),
  downloadUpdate: () => window.electron?.downloadUpdate?.() ?? Promise.resolve({ success: false }),
  installUpdate: () => window.electron?.installUpdate?.(),
  checkForUpdate: () => window.electron?.checkForUpdate?.() ?? Promise.resolve({ success: false }),
  removeUpdateListeners: () => window.electron?.removeUpdateListeners?.(),
}

export default function App() {
  const [folderPath, setFolderPath] = useState(null)
  const [projects, setProjects] = useState([])
  const [scanning, setScanning] = useState(false)
  const [running, setRunning] = useState({})
  const [logs, setLogs] = useState({})
  const [searchQuery, setSearchQuery] = useState('')
  const [launchModal, setLaunchModal] = useState(null)
  const [scanError, setScanError] = useState(null)
  const [activeTab, setActiveTab] = useState('projects')
  const [openTabs, setOpenTabs] = useState([])
  const [navTab, setNavTab] = useState('projects')
  const [ports, setPorts] = useState([])
  const [portsScanning, setPortsScanning] = useState(false)
  const [portsScanMode, setPortsScanMode] = useState('common')
  const [portsError, setPortsError] = useState(null)
  const [killingPids, setKillingPids] = useState(new Set())
  // Saved launch configs per project: { [projectPath]: { targets: [...] } }
  const [launchConfigs, setLaunchConfigs] = useState({})
  const [updateInfo, setUpdateInfo] = useState(null)
  const [updateProgress, setUpdateProgress] = useState(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [wslDistros, setWslDistros] = useState([])
  const [wslMenuOpen, setWslMenuOpen] = useState(false)

  const logRef = useRef(null)

  useEffect(() => {
    if (!electron.available) return

    electron.onProjectLog(({ projectPath, instanceId, data }) => {
      const key = makeLogKey(projectPath, instanceId)
      setLogs(prev => {
        const lines = prev[key] || []
        const newLines = data.split('\n').filter(l => l.length > 0)
        const combined = [...lines, ...newLines]
        while (combined.length > 500) combined.shift()
        return { ...prev, [key]: combined }
      })
    })

    electron.onProjectStopped(({ projectPath, instanceId, code }) => {
      setRunning(prev => {
        const next = { ...prev }
        if (next[projectPath]) {
          const instances = { ...next[projectPath] }
          delete instances[instanceId]
          if (Object.keys(instances).length === 0) {
            delete next[projectPath]
          } else {
            next[projectPath] = instances
          }
        }
        return next
      })
      const key = makeLogKey(projectPath, instanceId)
      setLogs(prev => {
        const lines = prev[key] || []
        const msg = code !== null
          ? `Process exited with code ${code}`
          : 'Process was terminated'
        return { ...prev, [key]: [...lines, msg] }
      })
    })

    electron.onUpdateAvailable((info) => {
      setUpdateInfo(info)
    })

    electron.onUpdateDownloadProgress((progress) => {
      setUpdateProgress(progress)
    })

    electron.onUpdateDownloaded(() => {
      setUpdateProgress(null)
      setUpdateReady(true)
    })

    // Detect WSL distros
    electron.getWslDistros().then(distros => {
      if (distros.length > 0) setWslDistros(distros)
    })

    // Load saved settings
    electron.getSettings().then(settings => {
      if (settings.launchConfigs) {
        setLaunchConfigs(settings.launchConfigs)
      }
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
      electron.removeProjectLogListener()
      electron.removeProjectStoppedListener()
      electron.removeUpdateListeners()
    }
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, activeTab])

  // Close WSL dropdown on outside click
  useEffect(() => {
    if (!wslMenuOpen) return
    const handleClick = () => setWslMenuOpen(false)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [wslMenuOpen])

  const handleChooseFolder = useCallback(async () => {
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
  }, [])

  const handleOpenWslFolder = useCallback(async (distro) => {
    setWslMenuOpen(false)
    const selected = await electron.selectWslFolder(distro)
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
  }, [])

  const handleLaunch = useCallback(async (project, port, method, instanceId, subprojectPath) => {
    const result = await electron.launchProject({
      projectPath: project.path,
      port: Number(port),
      method,
      instanceId,
      subprojectPath: subprojectPath || undefined
    })
    if (result.success) {
      setRunning(prev => ({
        ...prev,
        [project.path]: {
          ...(prev[project.path] || {}),
          [instanceId]: {
            port: result.data.port,
            method,
            pid: result.data.pid
          }
        }
      }))
      const tabKey = makeLogKey(project.path, instanceId)
      setOpenTabs(prev => prev.includes(tabKey) ? prev : [...prev, tabKey])
      setActiveTab(tabKey)
      return null
    }
    return result.error
  }, [])

  const handleLaunchMultiple = useCallback(async (project, targets) => {
    const errors = []
    for (const target of targets) {
      const result = await electron.launchProject({
        projectPath: project.path,
        port: Number(target.port),
        method: target.method,
        instanceId: target.instanceId,
        subprojectPath: target.subprojectPath || undefined,
        dockerServices: target.dockerServices || undefined
      })
      if (result.success) {
        setRunning(prev => ({
          ...prev,
          [project.path]: {
            ...(prev[project.path] || {}),
            [target.instanceId]: {
              port: result.data.port,
              method: target.method,
              pid: result.data.pid
            }
          }
        }))
        const tabKey = makeLogKey(project.path, target.instanceId)
        setOpenTabs(prev => prev.includes(tabKey) ? prev : [...prev, tabKey])
        setActiveTab(tabKey)
      } else {
        errors.push(`${target.instanceId}: ${result.error}`)
      }
    }
    return errors.length > 0 ? errors.join('\n') : null
  }, [])

  const handleSaveConfig = useCallback((projectPath, config) => {
    setLaunchConfigs(prev => {
      const next = { ...prev, [projectPath]: config }
      electron.saveSettings({ launchConfigs: next })
      return next
    })
  }, [])

  const handleStop = useCallback(async (projectPath, instanceId) => {
    const result = await electron.stopProject({ projectPath, instanceId })
    if (result.success) {
      setRunning(prev => {
        const next = { ...prev }
        if (next[projectPath]) {
          const instances = { ...next[projectPath] }
          delete instances[instanceId]
          if (Object.keys(instances).length === 0) {
            delete next[projectPath]
          } else {
            next[projectPath] = instances
          }
        }
        return next
      })
    }
  }, [])

  const handleOpenBrowser = useCallback((port) => {
    electron.openBrowser(`http://localhost:${port}`)
  }, [])

  const handleCloseTab = useCallback((tabKey) => {
    const sepIdx = tabKey.indexOf('::')
    const projectPath = tabKey.substring(0, sepIdx)
    const instanceId = tabKey.substring(sepIdx + 2)
    const projectInstances = running[projectPath]
    if (projectInstances && projectInstances[instanceId]) {
      handleStop(projectPath, instanceId)
    }
    setOpenTabs(prev => prev.filter(t => t !== tabKey))
    setActiveTab(prev => prev === tabKey ? 'projects' : prev)
    setLogs(prev => {
      const next = { ...prev }
      delete next[tabKey]
      return next
    })
  }, [running, handleStop])

  const handleScanPorts = useCallback(async (mode) => {
    setPortsScanning(true)
    setPortsError(null)
    const result = await electron.scanPorts({ mode: mode || portsScanMode })
    if (result.success) {
      setPorts(result.data)
    } else {
      setPortsError(result.error)
    }
    setPortsScanning(false)
  }, [portsScanMode])

  const handleKillPort = useCallback(async (pid, signal) => {
    if (!pid) return
    setKillingPids(prev => new Set([...prev, pid]))
    const result = await electron.killPortProcess({ pid, signal })
    if (result.success) {
      setTimeout(() => handleScanPorts(), 500)
    }
    setKillingPids(prev => {
      const next = new Set(prev)
      next.delete(pid)
      return next
    })
  }, [handleScanPorts])

  useEffect(() => {
    if (navTab === 'ports' && ports.length === 0 && !portsScanning) {
      handleScanPorts()
    }
  }, [navTab])

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase()
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.languages.some(l => l.toLowerCase().includes(q)) ||
      p.frameworks.some(f => f.toLowerCase().includes(q))
    )
  }, [projects, searchQuery])

  const getTabInfo = useCallback((tabKey) => {
    const sepIdx = tabKey.indexOf('::')
    const projectPath = tabKey.substring(0, sepIdx)
    const instanceId = tabKey.substring(sepIdx + 2)
    const project = projects.find(p => p.path === projectPath)
    const projectName = project ? project.name : projectPath.split('/').pop()
    const instances = running[projectPath]
    const isRunning = instances && instances[instanceId]
    const port = isRunning ? instances[instanceId].port : null
    return { projectPath, instanceId, projectName, isRunning: !!isRunning, port }
  }, [projects, running])

  const activeTabKey = activeTab

  return (
    <div className="app">
      <header className="header">
        <span className="header-title">DevScanner</span>
        <nav className="nav-tabs">
          <button
            className={`nav-tab${navTab === 'projects' ? ' nav-tab-active' : ''}`}
            onClick={() => setNavTab('projects')}
          >
            <Package size={13} />
            Projects
          </button>
          <button
            className={`nav-tab${navTab === 'ports' ? ' nav-tab-active' : ''}`}
            onClick={() => setNavTab('ports')}
          >
            <Radio size={13} />
            Ports
            {ports.length > 0 && <span className="nav-tab-badge">{ports.length}</span>}
          </button>
        </nav>
        {folderPath && navTab === 'projects' && <span className="header-path" title={folderPath}>{folderPath}</span>}
        <div className="header-actions">
          {navTab === 'projects' && projects.length > 0 && (

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
          {navTab === 'projects' && (
            <>
              {wslDistros.length > 0 && (
                <div style={{ position: 'relative' }}>
                  <button
                    className="btn btn-wsl"
                    onClick={() => setWslMenuOpen(prev => !prev)}
                  >
                    <Terminal size={14} />
                    WSL
                  </button>
                  {wslMenuOpen && (
                    <div className="wsl-dropdown">
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
              <button className="btn btn-primary" onClick={handleChooseFolder}>
                <FolderOpen size={14} />
                Choose Folder
              </button>
            </>
          )}
        </div>
      </header>

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

      {navTab === 'ports' ? (
        <PortScanner
          ports={ports}
          scanning={portsScanning}
          scanMode={portsScanMode}
          error={portsError}
          killingPids={killingPids}
          onScan={handleScanPorts}
          onSetMode={setPortsScanMode}
          onKill={handleKillPort}
          onOpenBrowser={handleOpenBrowser}
        />
      ) : (
        <>
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
                return (
                  <button
                    key={tabKey}
                    className={`tab${activeTab === tabKey ? ' tab-active' : ''}${info.isRunning ? ' tab-running' : ''}`}
                    onClick={() => setActiveTab(tabKey)}
                  >
                    <Terminal size={12} />
                    {info.projectName}/{info.instanceId}
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
                  <button className="btn btn-primary" onClick={handleChooseFolder}>
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
          ) : (
            <ConsoleView
              tabKey={activeTabKey}
              info={getTabInfo(activeTabKey)}
              logs={logs[activeTabKey] || []}
              logRef={logRef}
              onStop={handleStop}
              onOpenBrowser={handleOpenBrowser}
            />
          )}
        </>
      )}

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
    </div>
  )
}

function ConsoleView({ tabKey, info, logs, logRef, onStop, onOpenBrowser }) {
  return (
    <div className="console-view">
      <div className="console-header">
        <span className="console-title">
          {info.projectName} / {info.instanceId}
        </span>
        <div className="console-actions">
          {info.isRunning && (
            <>
              <span className="status-badge">Running on :{info.port}</span>
              <button
                className="btn btn-danger"
                onClick={() => onStop(info.projectPath, info.instanceId)}
              >
                <Square size={12} /> Stop
              </button>
              <button
                className="btn"
                onClick={() => onOpenBrowser(info.port)}
              >
                <ExternalLink size={12} /> Open in Browser
              </button>
            </>
          )}
          {!info.isRunning && (
            <span className="status-badge-stopped">Stopped</span>
          )}
        </div>
      </div>
      <div className="console-output" ref={logRef}>
        {logs.map((line, i) => (
          <div key={i} className="log-line">{line}</div>
        ))}
        {logs.length === 0 && (
          <div className="log-line" style={{ color: 'var(--color-text-dim)' }}>
            Waiting for output...
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  instances,
  onLaunch,
  onStop,
  onOpenBrowser,
  onViewTab,
  openTabs
}) {
  const instanceEntries = instances ? Object.entries(instances) : []
  const isRunning = instanceEntries.length > 0

  return (
    <div className={`project-card${isRunning ? ' running' : ''}`}>
      <div className="project-name">
        {project.name}
        {isWslPath(project.path) && <span className="wsl-badge">WSL</span>}
      </div>

      {(project.type === 'docker-compose' || project.type === 'monorepo') && (
        <div className="project-type-badge">{project.type}</div>
      )}

      {(project.languages.length > 0 || project.frameworks.length > 0) && (
        <div className="tags">
          {project.languages.map(lang => (
            <span
              key={lang}
              className="tag"
              style={{
                backgroundColor: `${LANGUAGE_COLORS[lang] || '#888'}26`,
                borderColor: LANGUAGE_COLORS[lang] || '#888',
                color: LANGUAGE_COLORS[lang] || '#888'
              }}
            >
              {lang}
            </span>
          ))}
          {project.frameworks.map(fw => (
            <span
              key={fw}
              className="tag"
              style={{
                backgroundColor: `${FRAMEWORK_COLORS[fw] || '#888'}26`,
                borderColor: FRAMEWORK_COLORS[fw] || '#888',
                color: FRAMEWORK_COLORS[fw] || '#888'
              }}
            >
              {fw}
            </span>
          ))}
        </div>
      )}

      {project.subprojects && (
        <div className="subprojects-info">
          <span className="subprojects-label">Subprojects:</span>
          {project.subprojects.map(sp => (
            <span key={sp.name} className="subproject-name">{sp.name}</span>
          ))}
        </div>
      )}

      {project.dockerServices && (
        <div className="docker-services">
          <span className="docker-services-label">Docker services:</span>
          <div className="docker-services-list">
            {project.dockerServices.map(svc => (
              <div key={svc.name} className="docker-service">
                <span className="docker-service-name">{svc.name}</span>
                {svc.image && <span className="docker-service-detail">{svc.image}</span>}
                {svc.build && !svc.image && <span className="docker-service-detail">build: {svc.build}</span>}
                {svc.ports.map(p => (
                  <span key={`${p.host}:${p.container}`} className="docker-service-port">:{p.host}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="project-stats">
        {project.git && (
          <>
            <span><GitBranch size={12} /> {project.git.branch}</span>
            <span>{project.git.commits} commits</span>
          </>
        )}
        <span><FileCode size={12} /> {project.stats.sourceFiles} files</span>
      </div>

      <div className="project-actions">
        {instanceEntries.map(([instanceId, info]) => {
          const tabKey = makeLogKey(project.path, instanceId)
          return (
            <div key={instanceId} className="instance-row">
              <span className="status-badge">
                {instanceId} :{info.port}
              </span>
              <button className="btn btn-danger btn-sm" onClick={() => onStop(project.path, instanceId)}>
                <Square size={10} /> Stop
              </button>
              <button className="btn btn-sm" onClick={() => onOpenBrowser(info.port)}>
                <ExternalLink size={10} />
              </button>
              <button className="btn btn-sm" onClick={() => onViewTab(tabKey)}>
                <Terminal size={10} />
              </button>
            </div>
          )
        })}
        <button className="btn btn-primary" onClick={onLaunch}>
          <Play size={12} /> Launch
        </button>
      </div>
    </div>
  )
}

function PortScanner({ ports, scanning, scanMode, error, killingPids, onScan, onSetMode, onKill, onOpenBrowser }) {
  return (
    <div className="port-scanner">
      <div className="port-scanner-toolbar">
        <div className="port-scanner-controls">
          <div className="port-mode-toggle">
            <button
              className={`port-mode-btn${scanMode === 'common' ? ' active' : ''}`}
              onClick={() => onSetMode('common')}
            >
              <Zap size={12} />
              Common Ports
            </button>
            <button
              className={`port-mode-btn${scanMode === 'all' ? ' active' : ''}`}
              onClick={() => onSetMode('all')}
            >
              <Globe size={12} />
              All Ports
            </button>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => onScan(scanMode)}
            disabled={scanning}
          >
            <RefreshCw size={13} className={scanning ? 'spin' : ''} />
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        </div>
        <span className="port-scanner-count">
          {ports.length} port{ports.length !== 1 ? 's' : ''} listening
        </span>
      </div>

      {error && <div className="port-scanner-error">{error}</div>}

      {scanning && ports.length === 0 ? (
        <div className="scanning-indicator">
          <div className="spinner" />
          Scanning ports...
        </div>
      ) : ports.length === 0 ? (
        <div className="empty-state">
          <Radio size={48} className="empty-state-icon" />
          <div className="empty-state-text">
            No listening ports found
          </div>
          <button className="btn btn-primary" onClick={() => onScan(scanMode)}>
            <RefreshCw size={14} />
            Scan Ports
          </button>
        </div>
      ) : (
        <div className="port-table-wrapper">
          <table className="port-table">
            <thead>
              <tr>
                <th>Port</th>
                <th>Address</th>
                <th>PID</th>
                <th>Process</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ports.map((entry) => (
                <tr key={`${entry.port}-${entry.pid}`} className="port-row">
                  <td className="port-number">:{entry.port}</td>
                  <td className="port-address">{entry.address || '*'}</td>
                  <td className="port-pid">{entry.pid || '\u2014'}</td>
                  <td className="port-process">
                    {entry.processName || '\u2014'}
                    {entry.processName && entry.processName.toLowerCase().includes('wslrelay') && (
                      <span className="wsl-badge">WSL</span>
                    )}
                  </td>
                  <td className="port-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => onOpenBrowser(entry.port)}
                      title="Open in browser"
                    >
                      <ExternalLink size={11} />
                    </button>
                    {entry.pid && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => onKill(entry.pid, 'SIGTERM')}
                        disabled={killingPids.has(entry.pid)}
                        title="Kill process (SIGTERM)"
                      >
                        <Square size={11} />
                        {killingPids.has(entry.pid) ? 'Killing...' : 'Stop'}
                      </button>
                    )}
                    {entry.pid && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => onKill(entry.pid, 'SIGKILL')}
                        disabled={killingPids.has(entry.pid)}
                        title="Force kill (SIGKILL)"
                      >
                        <Skull size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Build list of all launchable targets for a project
function buildLaunchTargets(project) {
  const targets = []

  // Root project npm
  if (project.hasNpm) {
    targets.push({
      id: 'npm',
      label: project.name + ' (root)',
      method: 'npm',
      instanceId: 'npm',
      subprojectPath: null,
      defaultPort: project.defaultPort
    })
  }

  // Subproject npm targets
  if (project.subprojects) {
    for (const sp of project.subprojects) {
      if (sp.hasNpm) {
        const instanceId = `npm:${sp.name}`
        targets.push({
          id: instanceId,
          label: sp.name,
          method: 'npm',
          instanceId,
          subprojectPath: sp.path,
          defaultPort: sp.frameworks?.length > 0
            ? (FRAMEWORK_PORT_MAP_SIMPLE[sp.frameworks[0]] || 3000)
            : 3000
        })
      }
    }
  }

  // Docker-compose targets: show individual services with their ports
  if (project.hasDocker && project.dockerServices) {
    targets.push({
      id: 'docker:all',
      label: 'Docker Compose (all services)',
      method: 'docker',
      instanceId: 'docker',
      subprojectPath: null,
      defaultPort: project.dockerServices.find(s => s.ports.length > 0)?.ports[0]?.host || 8080,
      dockerServices: null, // null = all services
      dockerServicesList: project.dockerServices
    })

    // Individual docker services that have port mappings
    for (const svc of project.dockerServices) {
      if (svc.ports.length > 0) {
        targets.push({
          id: `docker:${svc.name}`,
          label: `${svc.name}`,
          method: 'docker',
          instanceId: `docker:${svc.name}`,
          subprojectPath: null,
          defaultPort: svc.ports[0].host,
          dockerServices: [svc.name],
          dockerServiceInfo: svc
        })
      }
    }
  } else if (project.hasDocker) {
    // Dockerfile only, no compose
    targets.push({
      id: 'docker',
      label: 'Docker',
      method: 'docker',
      instanceId: 'docker',
      subprojectPath: null,
      defaultPort: 8080
    })
  }

  // Subproject docker targets
  if (project.subprojects) {
    for (const sp of project.subprojects) {
      if (sp.hasDocker) {
        const instanceId = `docker:${sp.name}`
        targets.push({
          id: instanceId,
          label: sp.name + ' (docker)',
          method: 'docker',
          instanceId,
          subprojectPath: sp.path,
          defaultPort: 8080
        })
      }
    }
  }

  return targets
}

const FRAMEWORK_PORT_MAP_SIMPLE = {
  'Next.js': 3000, Vite: 5173, Vue: 8080, Nuxt: 8080, Express: 3000,
  NestJS: 3000, Fastify: 3000, React: 3000, Django: 8000, FastAPI: 8000,
  Flask: 5000, 'Spring Boot': 8080, '.NET': 5000, Laravel: 8000, Rails: 3000,
  Strapi: 1337, Astro: 4321
}

function LaunchModal({ project, runningInstances, savedConfig, onLaunch, onLaunchMultiple, onSaveConfig, onClose }) {
  const allTargets = useMemo(() => buildLaunchTargets(project), [project])

  // State: which targets are checked + their port values
  const [checked, setChecked] = useState(() => {
    const initial = {}
    if (savedConfig?.targets) {
      // Restore from saved config
      for (const t of savedConfig.targets) {
        initial[t.id] = true
      }
    }
    return initial
  })

  const [ports, setPorts] = useState(() => {
    const initial = {}
    for (const t of allTargets) {
      // Restore saved port or use default
      const saved = savedConfig?.targets?.find(s => s.id === t.id)
      initial[t.id] = String(saved?.port || t.defaultPort)
    }
    return initial
  })

  const [launchError, setLaunchError] = useState(null)
  const [launching, setLaunching] = useState(false)

  const handleToggle = useCallback((id) => {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const handlePortChange = useCallback((id, value) => {
    setPorts(prev => ({ ...prev, [id]: value }))
  }, [])

  const selectedTargets = allTargets.filter(t => checked[t.id] && !runningInstances[t.instanceId])

  const handleSubmit = useCallback(async () => {
    if (selectedTargets.length === 0) {
      setLaunchError('Select at least one target to launch')
      return
    }

    // Validate all ports
    for (const t of selectedTargets) {
      const portNum = parseInt(ports[t.id], 10)
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
        setLaunchError(`${t.label}: port must be between 1024 and 65535`)
        return
      }
    }

    setLaunchError(null)
    setLaunching(true)

    // Save config before launching
    const configTargets = allTargets
      .filter(t => checked[t.id])
      .map(t => ({ id: t.id, port: parseInt(ports[t.id], 10) }))
    onSaveConfig({ targets: configTargets })

    const launches = selectedTargets.map(t => ({
      method: t.method,
      port: parseInt(ports[t.id], 10),
      instanceId: t.instanceId,
      subprojectPath: t.subprojectPath,
      dockerServices: t.dockerServices || undefined
    }))

    const error = await onLaunchMultiple(project, launches)
    setLaunching(false)
    if (error) {
      setLaunchError(error)
    } else {
      onClose()
    }
  }, [selectedTargets, ports, allTargets, checked, project, onLaunchMultiple, onSaveConfig, onClose])

  // Auto-check if only one target
  useEffect(() => {
    if (allTargets.length === 1 && Object.keys(checked).length === 0) {
      setChecked({ [allTargets[0].id]: true })
    }
  }, [])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Launch {project.name}</div>

        {allTargets.length === 0 ? (
          <div className="form-error">No launchable targets found for this project</div>
        ) : (
          <div className="launch-targets">
            {allTargets.map(target => {
              const isRunning = !!runningInstances[target.instanceId]
              return (
                <div key={target.id} className={`launch-target${checked[target.id] ? ' checked' : ''}${isRunning ? ' running' : ''}`}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!checked[target.id]}
                      disabled={isRunning}
                      onChange={() => handleToggle(target.id)}
                    />
                    <span className="launch-target-label">
                      {target.label}
                      <span className="launch-target-method">{target.method}</span>
                    </span>
                    {isRunning && <span className="launch-target-running">running</span>}
                  </label>
                  {target.dockerServiceInfo && (
                    <div className="launch-target-info">
                      {target.dockerServiceInfo.image && (
                        <span className="launch-target-image">{target.dockerServiceInfo.image}</span>
                      )}
                      {target.dockerServiceInfo.build && !target.dockerServiceInfo.image && (
                        <span className="launch-target-image">build: {target.dockerServiceInfo.build}</span>
                      )}
                      {target.dockerServiceInfo.ports.map(p => (
                        <span key={`${p.host}:${p.container}`} className="launch-target-port-map">
                          {p.host}:{p.container}
                        </span>
                      ))}
                      {target.dockerServiceInfo.dependsOn.length > 0 && (
                        <span className="launch-target-deps">
                          depends: {target.dockerServiceInfo.dependsOn.join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                  {target.dockerServicesList && checked[target.id] && !isRunning && (
                    <div className="launch-target-info">
                      {target.dockerServicesList.map(svc => (
                        <div key={svc.name} className="launch-target-svc-row">
                          <span className="docker-service-name">{svc.name}</span>
                          {svc.ports.map(p => (
                            <span key={`${p.host}:${p.container}`} className="launch-target-port-map">
                              {p.host}:{p.container}
                            </span>
                          ))}
                          {svc.image && <span className="launch-target-image">{svc.image}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {checked[target.id] && !isRunning && (
                    <div className="launch-target-port">
                      <label className="form-label">Port</label>
                      <input
                        className="form-input form-input-sm"
                        type="number"
                        value={ports[target.id]}
                        min={1024}
                        max={65535}
                        onChange={e => handlePortChange(target.id, e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {launchError && <div className="form-error">{launchError}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={launching || selectedTargets.length === 0}
          >
            {launching ? 'Launching...' : `Launch${selectedTargets.length > 1 ? ` (${selectedTargets.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
