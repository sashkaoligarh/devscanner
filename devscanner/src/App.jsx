import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  FolderOpen, Play, Square, ExternalLink, Search,
  Terminal, GitBranch,
  FileCode, X, Package, Radio, RefreshCw, Skull,
  Zap, Globe, Download, Container, ScrollText, RotateCcw,
  Minus, Maximize2, Minimize2,
  Star, Database, Copy, Trash2, ArrowUp, ArrowDown,
  GitPullRequest, Loader, CheckCircle, XCircle, Clock,
  FileText, Plus, AlertTriangle, Save,
  Server, Wifi, WifiOff, Key
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
  getHostInfo: () => window.electron?.getHostInfo?.() ?? Promise.resolve({ isWsl: false, wslIp: null }),
  checkWslLocalhost: () => window.electron?.checkWslLocalhost?.() ?? Promise.resolve({ available: false }),
  fixWslLocalhost: () => window.electron?.fixWslLocalhost?.() ?? Promise.resolve({ success: false }),
  getWslDistros: () => window.electron?.getWslDistros?.() ?? Promise.resolve([]),
  selectWslFolder: (d) => window.electron?.selectWslFolder?.(d) ?? Promise.resolve(null),
  onProjectLog: (cb) => window.electron?.onProjectLog?.(cb),
  onProjectStopped: (cb) => window.electron?.onProjectStopped?.(cb),
  onProjectPortChanged: (cb) => window.electron?.onProjectPortChanged?.(cb),
  removeProjectLogListener: () => window.electron?.removeProjectLogListener?.(),
  removeProjectStoppedListener: () => window.electron?.removeProjectStoppedListener?.(),
  removeProjectPortChangedListener: () => window.electron?.removeProjectPortChangedListener?.(),
  onUpdateAvailable: (cb) => window.electron?.onUpdateAvailable?.(cb),
  onUpdateDownloadProgress: (cb) => window.electron?.onUpdateDownloadProgress?.(cb),
  onUpdateDownloaded: (cb) => window.electron?.onUpdateDownloaded?.(cb),
  downloadUpdate: () => window.electron?.downloadUpdate?.() ?? Promise.resolve({ success: false }),
  installUpdate: () => window.electron?.installUpdate?.(),
  checkForUpdate: () => window.electron?.checkForUpdate?.() ?? Promise.resolve({ success: false }),
  removeUpdateListeners: () => window.electron?.removeUpdateListeners?.(),
  checkDocker: (o) => window.electron?.checkDocker?.(o) ?? Promise.resolve({ docker: false, compose: null }),
  gitInfo: (o) => window.electron?.gitInfo?.(o) ?? Promise.resolve(null),
  gitFetch: (o) => window.electron?.gitFetch?.(o) ?? Promise.resolve({ success: false }),
  gitPull: (o) => window.electron?.gitPull?.(o) ?? Promise.resolve({ success: false }),
  getNpmScripts: (o) => window.electron?.getNpmScripts?.(o) ?? Promise.resolve({ success: false }),
  runNpmScript: (o) => window.electron?.runNpmScript?.(o) ?? Promise.resolve({ success: false }),
  windowMinimize: () => window.electron?.windowMinimize?.(),
  windowMaximize: () => window.electron?.windowMaximize?.(),
  windowClose: () => window.electron?.windowClose?.(),
  windowIsMaximized: () => window.electron?.windowIsMaximized?.() ?? Promise.resolve(false),
  onWindowMaximized: (cb) => window.electron?.onWindowMaximized?.(cb),
  removeWindowListeners: () => window.electron?.removeWindowListeners?.(),
  dockerListContainers: (o) => window.electron?.dockerListContainers?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  dockerContainerAction: (o) => window.electron?.dockerContainerAction?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  dockerStreamLogs: (o) => window.electron?.dockerStreamLogs?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  dockerStopLogs: (o) => window.electron?.dockerStopLogs?.(o) ?? Promise.resolve({ success: false }),
  readEnvFile: (o) => window.electron?.readEnvFile?.(o) ?? Promise.resolve({ success: false }),
  saveEnvFile: (o) => window.electron?.saveEnvFile?.(o) ?? Promise.resolve({ success: false }),
  listEnvFiles: (o) => window.electron?.listEnvFiles?.(o) ?? Promise.resolve({ success: false }),
  sshConnect: (o) => window.electron?.sshConnect?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  sshDisconnect: (o) => window.electron?.sshDisconnect?.(o) ?? Promise.resolve({ success: false }),
  sshDiscover: (o) => window.electron?.sshDiscover?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  sshExec: (o) => window.electron?.sshExec?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  sshSaveServer: (o) => window.electron?.sshSaveServer?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  sshDeleteServer: (o) => window.electron?.sshDeleteServer?.(o) ?? Promise.resolve({ success: false, error: 'Not available' }),
  sshGetServers: () => window.electron?.sshGetServers?.() ?? Promise.resolve({ success: false, data: [] }),
  onDockerLog: (cb) => window.electron?.onDockerLog?.(cb),
  onDockerLogEnd: (cb) => window.electron?.onDockerLogEnd?.(cb),
  removeDockerLogListeners: () => window.electron?.removeDockerLogListeners?.(),
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
  const [hostIp, setHostIp] = useState(null)
  const [dockerContainers, setDockerContainers] = useState([])
  const [dockerLoading, setDockerLoading] = useState(false)
  const [dockerError, setDockerError] = useState(null)
  const [dockerInfo, setDockerInfo] = useState(null) // { docker: bool, compose: string|null }
  const [dockerLogs, setDockerLogs] = useState({}) // { [containerId]: string[] }
  const [dockerContainerMap, setDockerContainerMap] = useState({}) // { [containerId]: container }
  const [dockerActionLoading, setDockerActionLoading] = useState(new Set())
  const [isMaximized, setIsMaximized] = useState(false)
  const [favorites, setFavorites] = useState(new Set()) // Set of project paths
  const [health, setHealth] = useState({}) // { [projectPath::instanceId]: 'pending'|'healthy'|'unhealthy' }
  const [gitInfoCache, setGitInfoCache] = useState({}) // { [projectPath]: { branch, changed, ahead, behind } }
  const [wslNetInfo, setWslNetInfo] = useState(null) // { available, forwarding, wslconfigPath }
  const [wslNetOpen, setWslNetOpen] = useState(false) // WSL network popover visible
  const [wslNetFixing, setWslNetFixing] = useState(false) // fixing in progress
  const [wslNetFixed, setWslNetFixed] = useState(false) // fix applied
  const [envModal, setEnvModal] = useState(null) // { project }

  // --- Remote Servers state ---
  const [remoteServers, setRemoteServers] = useState([])
  const [serverConnections, setServerConnections] = useState({}) // { [serverId]: 'disconnected'|'connecting'|'connected' }
  const [serverDiscovery, setServerDiscovery] = useState({}) // { [serverId]: discoveryResult }
  const [activeServerId, setActiveServerId] = useState(null)
  const [serverSubTab, setServerSubTab] = useState('services')
  const [addServerModal, setAddServerModal] = useState(false)
  const [serverDiscovering, setServerDiscovering] = useState({}) // { [serverId]: bool }
  const [terminalOutput, setTerminalOutput] = useState({}) // { [serverId]: string[] }
  const [terminalInput, setTerminalInput] = useState('')

  const logRef = useRef(null)
  const healthTimers = useRef({}) // { [key]: intervalId }

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

    electron.onProjectPortChanged(({ projectPath, instanceId, port }) => {
      setRunning(prev => {
        if (!prev[projectPath]?.[instanceId]) return prev
        return {
          ...prev,
          [projectPath]: {
            ...prev[projectPath],
            [instanceId]: { ...prev[projectPath][instanceId], port }
          }
        }
      })
    })

    electron.onProjectStopped(({ projectPath, instanceId, code, background }) => {
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
        let msg
        if (background && code === 0) {
          msg = '✓ Containers started in background'
        } else if (code !== null) {
          msg = `Process exited with code ${code}`
        } else {
          msg = 'Process was terminated'
        }
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

    // Detect host info (WSL IP, etc.)
    electron.getHostInfo().then(info => {
      if (info.wslIp) {
        setHostIp(info.wslIp)
        // Check if localhost forwarding is enabled
        electron.checkWslLocalhost().then(net => setWslNetInfo(net))
      }
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
      if (settings.favorites) {
        setFavorites(new Set(settings.favorites))
      }
      if (settings.remoteServers) {
        setRemoteServers(settings.remoteServers)
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

    electron.onDockerLog(({ containerId, data }) => {
      setDockerLogs(prev => {
        const lines = prev[containerId] || []
        const newLines = data.split('\n').filter(l => l.length > 0)
        const combined = [...lines, ...newLines]
        while (combined.length > 1000) combined.shift()
        return { ...prev, [containerId]: combined }
      })
    })

    electron.onDockerLogEnd(({ containerId }) => {
      setDockerLogs(prev => {
        const lines = prev[containerId] || []
        return { ...prev, [containerId]: [...lines, '— log stream ended —'] }
      })
    })

    electron.windowIsMaximized().then(setIsMaximized)
    electron.onWindowMaximized(setIsMaximized)

    return () => {
      electron.removeProjectLogListener()
      electron.removeProjectStoppedListener()
      electron.removeProjectPortChangedListener()
      electron.removeUpdateListeners()
      electron.removeDockerLogListeners()
      electron.removeWindowListeners()
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
    const handleClick = (e) => {
      if (e.target.closest('.wsl-dropdown-wrapper')) return
      setWslMenuOpen(false)
    }
    // Delay to avoid catching the same click that opened the menu
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
        dockerServices: target.dockerServices || undefined,
        background: target.background || false
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
        if (result.data.port) startHealthCheck(project.path, target.instanceId, result.data.port)
      } else {
        errors.push(`${target.instanceId}: ${result.error}`)
      }
    }
    return errors.length > 0 ? errors.join('\n') : null
  }, [])

  // Health check polling
  const startHealthCheck = useCallback((projectPath, instanceId, port) => {
    if (!port) return
    const key = makeLogKey(projectPath, instanceId)
    // Clear any existing timer
    if (healthTimers.current[key]) clearInterval(healthTimers.current[key])
    setHealth(prev => ({ ...prev, [key]: 'pending' }))

    const checkOnce = async () => {
      // Use WSL2 IP if available (localhost may not work in Windows browser via WSL2)
      const host = hostIp || 'localhost'
      for (const p of ['/health', '/api/health', '/']) {
        try {
          const res = await fetch(`http://${host}:${port}${p}`, {
            signal: AbortSignal.timeout(2000)
          })
          if (res.status < 500) {
            setHealth(prev => ({ ...prev, [key]: 'healthy' }))
            return true
          }
        } catch { /* try next */ }
      }
      setHealth(prev => ({ ...prev, [key]: 'unhealthy' }))
      return false
    }

    let attempts = 0
    const id = setInterval(async () => {
      attempts++
      const ok = await checkOnce()
      // Slow down after healthy or too many attempts
      if (ok || attempts > 30) {
        clearInterval(healthTimers.current[key])
        if (ok) {
          healthTimers.current[key] = setInterval(checkOnce, 15000)
        } else {
          delete healthTimers.current[key]
        }
      }
    }, 2000)
    healthTimers.current[key] = id
  }, [])

  const stopHealthCheck = useCallback((projectPath, instanceId) => {
    const key = makeLogKey(projectPath, instanceId)
    if (healthTimers.current[key]) {
      clearInterval(healthTimers.current[key])
      delete healthTimers.current[key]
    }
    setHealth(prev => { const next = { ...prev }; delete next[key]; return next })
  }, [])

  const handleToggleFavorite = useCallback((projectPath) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(projectPath)) next.delete(projectPath)
      else next.add(projectPath)
      electron.saveSettings({ favorites: [...next] })
      return next
    })
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
      stopHealthCheck(projectPath, instanceId)
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
  }, [stopHealthCheck])

  const handleOpenBrowser = useCallback((port) => {
    // When running inside WSL, localhost in the Windows browser doesn't resolve
    // to WSL2. Use the WSL2 IP directly so the link works in any browser.
    const host = hostIp || 'localhost'
    electron.openBrowser(`http://${host}:${port}`)
  }, [hostIp])

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

  const handleCloseTab = useCallback((tabKey) => {
    if (tabKey.startsWith('docker-log::')) {
      const containerId = tabKey.substring('docker-log::'.length)
      electron.dockerStopLogs({ containerId })
      setDockerLogs(prev => { const next = { ...prev }; delete next[containerId]; return next })
      setOpenTabs(prev => prev.filter(t => t !== tabKey))
      setActiveTab(prev => prev === tabKey ? 'projects' : prev)
      return
    }
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
    if (navTab === 'docker' && dockerContainers.length === 0 && !dockerLoading) {
      handleDockerRefresh()
    }
  }, [navTab])

  // Auto-refresh docker containers every 10s while on docker tab
  useEffect(() => {
    if (navTab !== 'docker') return
    const ctxOpts = folderPath ? { projectPath: folderPath } : {}
    const id = setInterval(async () => {
      const result = await electron.dockerListContainers(ctxOpts)
      if (result.success) setDockerContainers(result.data)
    }, 10000)
    return () => clearInterval(id)
  }, [navTab, folderPath])

  const handleDockerRefresh = useCallback(async () => {
    setDockerLoading(true)
    setDockerError(null)
    const ctxOpts = folderPath ? { projectPath: folderPath } : {}
    const info = await electron.checkDocker(ctxOpts)
    setDockerInfo(info)
    if (!info.docker) {
      setDockerError('Docker is not installed or not running')
      setDockerLoading(false)
      return
    }
    const result = await electron.dockerListContainers(ctxOpts)
    if (result.success) {
      setDockerContainers(result.data)
    } else {
      setDockerError(result.error)
    }
    setDockerLoading(false)
  }, [folderPath])

  const handleDockerAction = useCallback(async (containerId, action) => {
    setDockerActionLoading(prev => new Set([...prev, containerId]))
    const ctxOpts = folderPath ? { projectPath: folderPath } : {}
    const result = await electron.dockerContainerAction({ containerId, action, ...ctxOpts })
    if (!result.success) setDockerError(result.error)
    const listResult = await electron.dockerListContainers(ctxOpts)
    if (listResult.success) setDockerContainers(listResult.data)
    setDockerActionLoading(prev => { const next = new Set(prev); next.delete(containerId); return next })
  }, [folderPath])

  const handleDockerViewLogs = useCallback(async (container) => {
    const tabKey = `docker-log::${container.ID}`
    setDockerContainerMap(prev => ({ ...prev, [container.ID]: container }))
    setOpenTabs(prev => prev.includes(tabKey) ? prev : [...prev, tabKey])
    setActiveTab(tabKey)
    setNavTab('projects')
    const ctxOpts = folderPath ? { projectPath: folderPath } : {}
    await electron.dockerStreamLogs({ containerId: container.ID, ...ctxOpts })
  }, [folderPath])

  // --- SSH Handlers ---

  const handleSSHDiscover = useCallback(async (serverId) => {
    setServerDiscovering(prev => ({ ...prev, [serverId]: true }))
    const result = await electron.sshDiscover({ serverId })
    if (result.success) {
      setServerDiscovery(prev => ({ ...prev, [serverId]: result.data }))
      // Update tags on server
      setRemoteServers(prev => prev.map(s =>
        s.id === serverId ? { ...s, tags: result.data.tags, discoveredServices: result.data } : s
      ))
      // Save updated server with tags
      const server = remoteServers.find(s => s.id === serverId)
      if (server) {
        electron.sshSaveServer({ server: { ...server, tags: result.data.tags, discoveredServices: result.data, lastConnected: new Date().toISOString() } })
      }
    }
    setServerDiscovering(prev => ({ ...prev, [serverId]: false }))
    return result
  }, [remoteServers])

  const handleSSHConnect = useCallback(async (server) => {
    setServerConnections(prev => ({ ...prev, [server.id]: 'connecting' }))
    const result = await electron.sshConnect({ server })
    if (result.success) {
      setServerConnections(prev => ({ ...prev, [server.id]: 'connected' }))
      handleSSHDiscover(server.id)
    } else {
      setServerConnections(prev => ({ ...prev, [server.id]: 'disconnected' }))
      alert(`SSH connection failed: ${result.error}`)
    }
    return result
  }, [handleSSHDiscover])

  const handleSSHDisconnect = useCallback(async (serverId) => {
    await electron.sshDisconnect({ serverId })
    setServerConnections(prev => ({ ...prev, [serverId]: 'disconnected' }))
    setServerDiscovery(prev => { const n = { ...prev }; delete n[serverId]; return n })
  }, [])

  const handleAddServer = useCallback(async (serverData) => {
    const server = {
      ...serverData,
      id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tags: [],
      lastConnected: null,
      discoveredServices: null
    }
    // Connect first
    setServerConnections(prev => ({ ...prev, [server.id]: 'connecting' }))
    const connectResult = await electron.sshConnect({ server })
    if (!connectResult.success) {
      setServerConnections(prev => ({ ...prev, [server.id]: 'disconnected' }))
      return { success: false, error: connectResult.error }
    }
    setServerConnections(prev => ({ ...prev, [server.id]: 'connected' }))
    // Save
    const saveResult = await electron.sshSaveServer({ server })
    if (saveResult.success) {
      setRemoteServers(saveResult.data)
    } else {
      setRemoteServers(prev => [...prev, server])
    }
    // Discover
    handleSSHDiscover(server.id)
    return { success: true }
  }, [handleSSHDiscover])

  const handleDeleteServer = useCallback(async (serverId) => {
    const result = await electron.sshDeleteServer({ serverId })
    if (result.success) {
      setRemoteServers(result.data)
    } else {
      setRemoteServers(prev => prev.filter(s => s.id !== serverId))
    }
    setServerConnections(prev => { const n = { ...prev }; delete n[serverId]; return n })
    setServerDiscovery(prev => { const n = { ...prev }; delete n[serverId]; return n })
    if (activeServerId === serverId) setActiveServerId(null)
  }, [activeServerId])

  const handleSSHExec = useCallback(async (serverId, command) => {
    setTerminalOutput(prev => ({
      ...prev,
      [serverId]: [...(prev[serverId] || []), `$ ${command}`]
    }))
    const result = await electron.sshExec({ serverId, command })
    if (result.success) {
      const lines = []
      if (result.data.stdout) lines.push(...result.data.stdout.split('\n').filter(Boolean))
      if (result.data.stderr) lines.push(...result.data.stderr.split('\n').filter(Boolean).map(l => `[stderr] ${l}`))
      if (result.data.code !== 0) lines.push(`[exit code: ${result.data.code}]`)
      setTerminalOutput(prev => ({
        ...prev,
        [serverId]: [...(prev[serverId] || []), ...lines]
      }))
    } else {
      setTerminalOutput(prev => ({
        ...prev,
        [serverId]: [...(prev[serverId] || []), `[error] ${result.error}`]
      }))
    }
  }, [])

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

  // Load git info for all projects when project list changes
  useEffect(() => {
    if (!electron.available || projects.length === 0) return
    projects.forEach(p => {
      if (!p.git) return // only if git detected at scan time
      electron.gitInfo({ projectPath: p.path }).then(info => {
        if (info) setGitInfoCache(prev => ({ ...prev, [p.path]: info }))
      })
    })
  }, [projects])

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
          <button
            className={`nav-tab${navTab === 'docker' ? ' nav-tab-active' : ''}`}
            onClick={() => setNavTab('docker')}
          >
            <Container size={13} />
            Docker
            {dockerContainers.length > 0 && <span className="nav-tab-badge">{dockerContainers.length}</span>}
          </button>
          <button
            className={`nav-tab${navTab === 'servers' ? ' nav-tab-active' : ''}`}
            onClick={() => setNavTab('servers')}
          >
            <Server size={13} />
            Servers
            {remoteServers.length > 0 && <span className="nav-tab-badge">{remoteServers.length}</span>}
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
              <button className="btn btn-primary" onClick={handleChooseFolder}>
                <FolderOpen size={14} />
                Choose Folder
              </button>
            </>
          )}
        </div>
        <WindowControls isMaximized={isMaximized} />
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
          onConnect={handleSSHConnect}
          onDisconnect={handleSSHDisconnect}
          onDiscover={handleSSHDiscover}
          onDelete={handleDeleteServer}
          onAddServer={() => setAddServerModal(true)}
          onExec={handleSSHExec}
          onSetTerminalInput={setTerminalInput}
        />
      ) : navTab === 'docker' ? (
        <DockerContainers
          containers={dockerContainers}
          loading={dockerLoading}
          error={dockerError}
          dockerInfo={dockerInfo}
          actionLoading={dockerActionLoading}
          onRefresh={handleDockerRefresh}
          onAction={handleDockerAction}
          onViewLogs={handleDockerViewLogs}
        />
      ) : navTab === 'ports' ? (
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
                      isFavorite={favorites.has(project.path)}
                      onToggleFavorite={handleToggleFavorite}
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
          ) : activeTabKey.startsWith('docker-log::') ? (
            <DockerConsoleView
              containerId={activeTabKey.substring('docker-log::'.length)}
              container={dockerContainerMap[activeTabKey.substring('docker-log::'.length)]}
              logs={dockerLogs[activeTabKey.substring('docker-log::'.length)] || []}
            />
          ) : (
            <ConsoleView
              tabKey={activeTabKey}
              info={getTabInfo(activeTabKey)}
              logs={logs[activeTabKey] || []}
              logRef={logRef}
              onStop={handleStop}
              onOpenBrowser={handleOpenBrowser}
              healthStatus={health[activeTabKey]}
              onClearLogs={() => setLogs(prev => ({ ...prev, [activeTabKey]: [] }))}
              hostIp={hostIp}
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

      {envModal && (
        <EnvEditorModal
          project={envModal.project}
          onClose={() => setEnvModal(null)}
        />
      )}

      {addServerModal && (
        <AddServerModal
          onAdd={handleAddServer}
          onClose={() => setAddServerModal(false)}
        />
      )}
    </div>
  )
}

function WindowControls({ isMaximized }) {
  return (
    <div className="window-controls">
      <button
        className="wc-btn wc-minimize"
        onClick={() => electron.windowMinimize()}
        title="Minimize"
      >
        <Minus size={11} />
      </button>
      <button
        className="wc-btn wc-maximize"
        onClick={() => electron.windowMaximize()}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
      </button>
      <button
        className="wc-btn wc-close"
        onClick={() => electron.windowClose()}
        title="Close"
      >
        <X size={11} />
      </button>
    </div>
  )
}

function HealthIndicator({ status }) {
  if (!status) return null
  if (status === 'pending') return <span className="health-badge health-pending"><Clock size={11} /> checking</span>
  if (status === 'healthy') return <span className="health-badge health-ok"><CheckCircle size={11} /> healthy</span>
  return <span className="health-badge health-err"><XCircle size={11} /> unreachable</span>
}

function ConsoleView({ tabKey, info, logs, logRef, onStop, onOpenBrowser, healthStatus, onClearLogs, hostIp }) {
  const [logSearch, setLogSearch] = useState('')

  const filteredLogs = useMemo(() => {
    if (!logSearch.trim()) return logs
    const q = logSearch.toLowerCase()
    return logs.filter(l => l.toLowerCase().includes(q))
  }, [logs, logSearch])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(logs.join('\n')).catch(() => {})
  }, [logs])

  return (
    <div className="console-view">
      <div className="console-header">
        <span className="console-title">
          {info.projectName} / {info.instanceId}
          {info.isRunning && <HealthIndicator status={healthStatus} />}
        </span>
        <div className="console-actions">
          {info.isRunning && (
            <>
              <span className="status-badge">{hostIp || 'localhost'}:{info.port}</span>
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
          <button className="btn btn-sm" title="Copy all logs" onClick={handleCopy}>
            <Copy size={11} />
          </button>
          <button className="btn btn-sm" title="Clear logs" onClick={onClearLogs}>
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <div className="console-search-bar">
        <Search size={12} style={{ color: 'var(--color-text-dim)', flexShrink: 0 }} />
        <input
          className="console-search-input"
          type="text"
          placeholder="Search logs..."
          value={logSearch}
          onChange={e => setLogSearch(e.target.value)}
        />
        {logSearch && (
          <span className="console-search-count">
            {filteredLogs.length}/{logs.length}
          </span>
        )}
      </div>
      <div className="console-output" ref={logRef}>
        {filteredLogs.map((line, i) => (
          <div
            key={i}
            className={`log-line${/error|fail|exception/i.test(line) ? ' log-line-error' : /warn/i.test(line) ? ' log-line-warn' : ''}`}
          >
            {line}
          </div>
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
  project, instances, onLaunch, onStop, onOpenBrowser, onViewTab, openTabs,
  isFavorite, onToggleFavorite, health, gitInfo, onGitFetch, onGitPull, hostIp,
  onEnvEdit
}) {
  const instanceEntries = instances ? Object.entries(instances) : []
  const isRunning = instanceEntries.length > 0
  const [gitLoading, setGitLoading] = useState(null) // 'fetch'|'pull'|null

  const dbServices = useMemo(() => {
    if (!project.dockerServices) return []
    return project.dockerServices
      .map(svc => ({ svc, conn: getDbConnectionString(svc) }))
      .filter(x => x.conn !== null)
  }, [project.dockerServices])

  const handleGitFetch = async () => {
    setGitLoading('fetch')
    await onGitFetch(project.path)
    setGitLoading(null)
  }
  const handleGitPull = async () => {
    setGitLoading('pull')
    await onGitPull(project.path)
    setGitLoading(null)
  }

  const gi = gitInfo || project.git

  return (
    <div className={`project-card${isRunning ? ' running' : ''}${isFavorite ? ' favorited' : ''}`}>
      <div className="project-name-row">
        <div className="project-name">
          {project.name}
          {isWslPath(project.path) && <span className="wsl-badge">WSL</span>}
        </div>
        <button
          className={`btn-star${isFavorite ? ' starred' : ''}`}
          onClick={() => onToggleFavorite(project.path)}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {(project.type === 'docker-compose' || project.type === 'monorepo') && (
        <div className="project-type-badge">{project.type}</div>
      )}

      {(project.languages.length > 0 || project.frameworks.length > 0) && (
        <div className="tags">
          {project.languages.map(lang => (
            <span key={lang} className="tag" style={{
              backgroundColor: `${LANGUAGE_COLORS[lang] || '#888'}26`,
              borderColor: LANGUAGE_COLORS[lang] || '#888',
              color: LANGUAGE_COLORS[lang] || '#888'
            }}>{lang}</span>
          ))}
          {project.frameworks.map(fw => (
            <span key={fw} className="tag" style={{
              backgroundColor: `${FRAMEWORK_COLORS[fw] || '#888'}26`,
              borderColor: FRAMEWORK_COLORS[fw] || '#888',
              color: FRAMEWORK_COLORS[fw] || '#888'
            }}>{fw}</span>
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

      {dbServices.length > 0 && (
        <div className="db-connections">
          {dbServices.map(({ svc, conn }) => (
            <div key={svc.name} className="db-conn-row">
              <Database size={10} />
              <span className="db-conn-type">{conn.type}</span>
              <code className="db-conn-url" title={conn.url}>{conn.url}</code>
              <button
                className="btn-icon"
                title="Copy connection string"
                onClick={() => navigator.clipboard.writeText(conn.url).catch(() => {})}
              >
                <Copy size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="project-stats">
        {gi && (
          <>
            <span><GitBranch size={12} /> {gi.branch}</span>
            {gitInfo?.changed > 0 && <span className="git-changed">~{gitInfo.changed}</span>}
            {gitInfo?.ahead > 0 && <span className="git-ahead"><ArrowUp size={10} />{gitInfo.ahead}</span>}
            {gitInfo?.behind > 0 && <span className="git-behind"><ArrowDown size={10} />{gitInfo.behind}</span>}
          </>
        )}
        <span><FileCode size={12} /> {project.stats.sourceFiles} files</span>
        {gi && (
          <span className="git-actions">
            <button
              className="btn-icon"
              title="git fetch"
              disabled={!!gitLoading}
              onClick={handleGitFetch}
            >
              {gitLoading === 'fetch' ? <Loader size={10} className="spin" /> : <RefreshCw size={10} />}
            </button>
            <button
              className="btn-icon"
              title="git pull"
              disabled={!!gitLoading}
              onClick={handleGitPull}
            >
              {gitLoading === 'pull' ? <Loader size={10} className="spin" /> : <GitPullRequest size={10} />}
            </button>
          </span>
        )}
      </div>

      <div className="project-actions">
        {instanceEntries.map(([instanceId, info]) => {
          const tabKey = makeLogKey(project.path, instanceId)
          const healthKey = makeLogKey(project.path, instanceId)
          const hs = health?.[healthKey]
          return (
            <div key={instanceId} className="instance-row">
              <span className="status-badge">
                {instanceId} :{info.port}{hostIp ? ` (${hostIp})` : ''}
              </span>
              {hs === 'pending' && <Clock size={11} className="health-icon-pending" title="Checking health..." />}
              {hs === 'healthy' && <CheckCircle size={11} className="health-icon-ok" title="Service healthy" />}
              {hs === 'unhealthy' && <XCircle size={11} className="health-icon-err" title="Unreachable" />}
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
        {(project.envFiles?.length > 0 || project.subprojectEnvFiles) && (
          <button className="btn btn-sm" onClick={() => onEnvEdit(project)}>
            <FileText size={12} /> .env
          </button>
        )}
        <button className="btn btn-primary" onClick={onLaunch}>
          <Play size={12} /> Launch
        </button>
      </div>
    </div>
  )
}

function PortScanner({ ports, scanning, scanMode, error, killingPids, onScan, onSetMode, onKill, onOpenBrowser }) {
  const [portSearch, setPortSearch] = useState('')

  const filteredPorts = useMemo(() => {
    if (!portSearch.trim()) return ports
    const q = portSearch.toLowerCase()
    return ports.filter(e =>
      String(e.port).includes(q) ||
      (e.processName && e.processName.toLowerCase().includes(q)) ||
      (e.address && e.address.toLowerCase().includes(q)) ||
      (e.pid && String(e.pid).includes(q))
    )
  }, [ports, portSearch])

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
        <div className="port-scanner-right">
          {ports.length > 0 && (
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, color: 'var(--color-text-dim)' }} />
              <input
                className="search-input search-input-sm"
                style={{ paddingLeft: '1.75rem' }}
                type="text"
                placeholder="Filter ports..."
                value={portSearch}
                onChange={e => setPortSearch(e.target.value)}
              />
            </div>
          )}
          <span className="port-scanner-count">
            {filteredPorts.length}{filteredPorts.length !== ports.length ? `/${ports.length}` : ''} port{filteredPorts.length !== 1 ? 's' : ''}
          </span>
        </div>
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
      ) : filteredPorts.length === 0 ? (
        <div className="empty-state">
          <Search size={48} className="empty-state-icon" />
          <div className="empty-state-text">No ports match "{portSearch}"</div>
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
              {filteredPorts.map((entry) => (
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

function DockerContainers({ containers, loading, error, dockerInfo, actionLoading, onRefresh, onAction, onViewLogs }) {
  const runningCount = containers.filter(c => c.State === 'running').length

  return (
    <div className="port-scanner">
      <div className="port-scanner-toolbar">
        <div className="port-scanner-controls">
          <button
            className="btn btn-primary"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          {dockerInfo && (
            <div className="docker-info-badges">
              <span className={`docker-badge ${dockerInfo.docker ? 'docker-badge-ok' : 'docker-badge-err'}`}>
                Docker {dockerInfo.docker ? '✓' : '✗'}
              </span>
              {dockerInfo.docker && (
                <span className={`docker-badge ${dockerInfo.compose ? 'docker-badge-ok' : 'docker-badge-warn'}`}>
                  Compose: {dockerInfo.compose || 'not found'}
                </span>
              )}
            </div>
          )}
        </div>
        <span className="port-scanner-count">
          {runningCount > 0 && `${runningCount} running / `}{containers.length} container{containers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <div className="port-scanner-error">{error}</div>}

      {loading && containers.length === 0 ? (
        <div className="scanning-indicator">
          <div className="spinner" />
          Loading containers...
        </div>
      ) : containers.length === 0 ? (
        <div className="empty-state">
          <Container size={48} className="empty-state-icon" />
          <div className="empty-state-text">
            {dockerInfo && !dockerInfo.docker
              ? 'Docker is not installed or not running'
              : 'No Docker containers found'}
          </div>
          <button className="btn btn-primary" onClick={onRefresh}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      ) : (
        <div className="port-table-wrapper">
          <table className="port-table docker-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Image</th>
                <th>Status</th>
                <th>Ports</th>
                <th className="docker-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {containers.map(c => {
                const busy = actionLoading.has(c.ID)
                const isRunning = c.State === 'running'
                return (
                  <tr key={c.ID} className={`port-row${isRunning ? ' docker-row-running' : ''}`}>
                    <td className="docker-name">{c.Names}</td>
                    <td className="docker-image" title={c.Image}>{c.Image}</td>
                    <td>
                      <span className={`container-state-badge container-state-${c.State}`}>
                        {c.Status}
                      </span>
                    </td>
                    <td className="docker-ports">{c.Ports || '—'}</td>
                    <td className="docker-actions-cell">
                      <button
                        className="btn btn-sm"
                        onClick={() => onViewLogs(c)}
                        title="View logs"
                      >
                        <ScrollText size={11} />
                      </button>
                      {isRunning ? (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => onAction(c.ID, 'stop')}
                          disabled={busy}
                          title="Stop"
                        >
                          <Square size={11} />
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          onClick={() => onAction(c.ID, 'start')}
                          disabled={busy}
                          title="Start"
                        >
                          <Play size={11} />
                        </button>
                      )}
                      <button
                        className="btn btn-sm"
                        onClick={() => onAction(c.ID, 'restart')}
                        disabled={busy}
                        title="Restart"
                      >
                        <RotateCcw size={11} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DockerConsoleView({ containerId, container, logs }) {
  const logRef = useRef(null)
  const [logSearch, setLogSearch] = useState('')

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const filteredLogs = useMemo(() => {
    if (!logSearch.trim()) return logs
    const q = logSearch.toLowerCase()
    return logs.filter(l => l.toLowerCase().includes(q))
  }, [logs, logSearch])

  const handleCopy = () => {
    navigator.clipboard.writeText(logs.join('\n')).catch(() => {})
  }

  return (
    <div className="console-view">
      <div className="console-header">
        <span className="console-title">
          <ScrollText size={14} />
          {container ? container.Names : containerId}
          {container?.Image && (
            <span className="launch-target-image">{container.Image}</span>
          )}
          {container?.State && (
            <span className={`container-state-badge container-state-${container.State}`}>
              {container.State}
            </span>
          )}
        </span>
        <div className="console-actions">
          <button className="btn btn-sm" title="Copy all logs" onClick={handleCopy}>
            <Copy size={11} />
          </button>
        </div>
      </div>
      <div className="console-search-bar">
        <Search size={12} style={{ color: 'var(--color-text-dim)', flexShrink: 0 }} />
        <input
          className="console-search-input"
          type="text"
          placeholder="Search logs..."
          value={logSearch}
          onChange={e => setLogSearch(e.target.value)}
        />
        {logSearch && (
          <span className="console-search-count">{filteredLogs.length}/{logs.length}</span>
        )}
      </div>
      <div className="console-output" ref={logRef}>
        {filteredLogs.map((line, i) => (
          <div key={i} className="log-line">{line}</div>
        ))}
        {logs.length === 0 && (
          <div className="log-line" style={{ color: 'var(--color-text-dim)' }}>
            Loading logs...
          </div>
        )}
      </div>
    </div>
  )
}

function EnvEditorModal({ project, onClose }) {
  // Build directory list: root + subprojects with env files
  const dirs = useMemo(() => {
    const list = []
    if (project.envFiles?.length > 0) {
      list.push({ key: '__root__', label: project.name + ' (root)', path: project.path, files: project.envFiles })
    }
    if (project.subprojectEnvFiles) {
      for (const [name, info] of Object.entries(project.subprojectEnvFiles)) {
        list.push({ key: name, label: name, path: info.path, files: info.files })
      }
    }
    // If root has no env files but subprojects do, still allow root
    if (list.length === 0) {
      list.push({ key: '__root__', label: project.name + ' (root)', path: project.path, files: [] })
    }
    return list
  }, [project])

  const [selectedDir, setSelectedDir] = useState(dirs[0]?.key || '__root__')
  const [selectedFile, setSelectedFile] = useState(null)
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState(null)
  const [fileList, setFileList] = useState(dirs[0]?.files || [])
  const [creating, setCreating] = useState(false)
  const [newFileName, setNewFileName] = useState('.env')

  const currentDir = dirs.find(d => d.key === selectedDir) || dirs[0]
  const isDirty = content !== originalContent

  const loadFile = useCallback(async (dirPath, fileName) => {
    setLoading(true)
    setError(null)
    setSaveSuccess(false)
    const res = await electron.readEnvFile({ projectPath: dirPath, fileName })
    if (res.success) {
      setContent(res.data.content)
      setOriginalContent(res.data.content)
      setSelectedFile(fileName)
    } else {
      setError(res.error || 'Failed to read file')
    }
    setLoading(false)
  }, [])

  const refreshFileList = useCallback(async (dirPath) => {
    const res = await electron.listEnvFiles({ projectPath: dirPath })
    if (res.success) setFileList(res.data)
  }, [])

  // Load first file when dir changes
  useEffect(() => {
    if (currentDir && fileList.length > 0) {
      loadFile(currentDir.path, fileList[0])
    } else {
      setSelectedFile(null)
      setContent('')
      setOriginalContent('')
    }
  }, [selectedDir]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDirChange = (dirKey) => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
    const dir = dirs.find(d => d.key === dirKey)
    if (dir) {
      setFileList(dir.files)
      setSelectedDir(dirKey)
      setCreating(false)
    }
  }

  const handleFileChange = (fileName) => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
    loadFile(currentDir.path, fileName)
    setCreating(false)
  }

  const handleSave = async () => {
    if (!selectedFile || !currentDir) return
    setSaving(true)
    setError(null)
    const res = await electron.saveEnvFile({
      projectPath: currentDir.path,
      fileName: selectedFile,
      content
    })
    if (res.success) {
      setOriginalContent(content)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } else {
      setError(res.error || 'Failed to save')
    }
    setSaving(false)
  }

  const handleCreate = async () => {
    const name = newFileName.trim()
    if (!name.startsWith('.env')) {
      setError('File name must start with .env')
      return
    }
    if (fileList.includes(name)) {
      setError('File already exists')
      return
    }
    setError(null)
    // If .env.example exists, copy its content
    let initialContent = ''
    if (fileList.includes('.env.example')) {
      const res = await electron.readEnvFile({ projectPath: currentDir.path, fileName: '.env.example' })
      if (res.success) initialContent = res.data.content
    }
    const saveRes = await electron.saveEnvFile({
      projectPath: currentDir.path,
      fileName: name,
      content: initialContent
    })
    if (saveRes.success) {
      await refreshFileList(currentDir.path)
      setCreating(false)
      setNewFileName('.env')
      loadFile(currentDir.path, name)
    } else {
      setError(saveRes.error || 'Failed to create file')
    }
  }

  const handleClose = () => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-env" onClick={e => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title"><FileText size={16} /> .env Editor</div>
          <button className="btn btn-sm" onClick={handleClose}><X size={14} /></button>
        </div>

        <div className="env-warning">
          <AlertTriangle size={14} />
          <span>These files may contain secrets. Do not commit them to version control.</span>
        </div>

        {dirs.length > 1 && (
          <div className="env-dir-selector">
            {dirs.map(d => (
              <button
                key={d.key}
                className={`env-dir-btn${selectedDir === d.key ? ' active' : ''}`}
                onClick={() => handleDirChange(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        <div className="env-file-tabs">
          {fileList.map(f => (
            <button
              key={f}
              className={`env-file-tab${selectedFile === f ? ' active' : ''}`}
              onClick={() => handleFileChange(f)}
            >
              {f}
            </button>
          ))}
          <button
            className="env-file-tab env-file-tab-add"
            onClick={() => setCreating(!creating)}
            title="Create new .env file"
          >
            <Plus size={12} />
          </button>
        </div>

        {creating && (
          <div className="env-create-row">
            <input
              className="form-input form-input-sm"
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              placeholder=".env.local"
            />
            <button className="btn btn-primary btn-sm" onClick={handleCreate}>Create</button>
            <button className="btn btn-sm" onClick={() => { setCreating(false); setNewFileName('.env') }}>Cancel</button>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {loading ? (
          <div className="scanning-indicator"><div className="spinner" /> Loading...</div>
        ) : selectedFile ? (
          <textarea
            className="env-editor"
            value={content}
            onChange={e => setContent(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className="env-empty">
            No .env files found. Create one with the + button above.
          </div>
        )}

        <div className="env-footer">
          <div className="env-footer-left">
            {isDirty && <span className="env-dirty-indicator">Unsaved changes</span>}
            {saveSuccess && <span className="env-save-success"><CheckCircle size={12} /> Saved</span>}
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={handleClose}>Close</button>
            <button
              className="btn btn-primary"
              disabled={!isDirty || saving}
              onClick={handleSave}
            >
              <Save size={12} /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function getDbConnectionString(service) {
  const image = service.image || ''
  const env = service.environment || []
  const em = Object.fromEntries(env.map(e => [e.key, e.value]))
  const port = service.ports[0]?.host || null
  if (/postgres/i.test(image)) {
    const u = em.POSTGRES_USER || 'postgres'
    const pw = em.POSTGRES_PASSWORD ? `:${em.POSTGRES_PASSWORD}` : ''
    const db = em.POSTGRES_DB || u
    return { type: 'PostgreSQL', url: `postgresql://${u}${pw}@localhost:${port || 5432}/${db}` }
  }
  if (/mysql|mariadb/i.test(image)) {
    const u = em.MYSQL_USER || 'root'
    const pw = em.MYSQL_ROOT_PASSWORD || em.MYSQL_PASSWORD || ''
    const db = em.MYSQL_DATABASE || ''
    return { type: 'MySQL', url: `mysql://${u}${pw ? `:${pw}` : ''}@localhost:${port || 3306}/${db}` }
  }
  if (/redis/i.test(image)) {
    return { type: 'Redis', url: `redis://localhost:${port || 6379}` }
  }
  if (/mongo/i.test(image)) {
    const u = em.MONGO_INITDB_ROOT_USERNAME
    const pw = em.MONGO_INITDB_ROOT_PASSWORD
    const db = em.MONGO_INITDB_DATABASE || 'test'
    const auth = u ? `${u}:${pw}@` : ''
    return { type: 'MongoDB', url: `mongodb://${auth}localhost:${port || 27017}/${db}` }
  }
  if (/rabbitmq/i.test(image)) {
    const u = em.RABBITMQ_DEFAULT_USER || 'guest'
    const pw = em.RABBITMQ_DEFAULT_PASS || 'guest'
    return { type: 'RabbitMQ', url: `amqp://${u}:${pw}@localhost:${port || 5672}` }
  }
  return null
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

function NpmScriptsList({ project, scripts, onClose }) {
  const [running, setRunning] = useState({}) // { [scriptName]: bool }
  const [errors, setErrors] = useState({})

  const handleRun = async (scriptName) => {
    const instanceId = `script:${scriptName}`
    setRunning(prev => ({ ...prev, [scriptName]: true }))
    setErrors(prev => { const n = { ...prev }; delete n[scriptName]; return n })
    const res = await electron.runNpmScript({ projectPath: project.path, scriptName, instanceId })
    if (!res.success) {
      setErrors(prev => ({ ...prev, [scriptName]: res.error }))
    }
    setRunning(prev => ({ ...prev, [scriptName]: false }))
    if (res.success) onClose()
  }

  return (
    <div className="npm-scripts-list">
      {scripts.map(({ name, cmd }) => (
        <div key={name} className="npm-script-row">
          <div className="npm-script-info">
            <span className="npm-script-name">{name}</span>
            <code className="npm-script-cmd">{cmd}</code>
            {errors[name] && <span className="npm-script-error">{errors[name]}</span>}
          </div>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => handleRun(name)}
            disabled={running[name]}
          >
            {running[name] ? <Loader size={11} className="spin" /> : <Play size={11} />}
            {running[name] ? 'Running...' : 'Run'}
          </button>
        </div>
      ))}
    </div>
  )
}

function LaunchModal({ project, runningInstances, savedConfig, onLaunch, onLaunchMultiple, onSaveConfig, onClose }) {
  const allTargets = useMemo(() => buildLaunchTargets(project), [project])
  const [npmScripts, setNpmScripts] = useState(null) // null=loading, []|[...]
  const [npmScriptsError, setNpmScriptsError] = useState(null)
  const [scriptTab, setScriptTab] = useState('launch') // 'launch'|'scripts'

  useEffect(() => {
    if (!project.hasNpm) return
    electron.getNpmScripts({ projectPath: project.path }).then(res => {
      if (res.success) setNpmScripts(res.data)
      else setNpmScriptsError(res.error)
    })
  }, [project.path])

  const [checked, setChecked] = useState(() => {
    const initial = {}
    if (savedConfig?.targets) {
      for (const t of savedConfig.targets) initial[t.id] = true
    }
    return initial
  })

  const [ports, setPorts] = useState(() => {
    const initial = {}
    for (const t of allTargets) {
      const saved = savedConfig?.targets?.find(s => s.id === t.id)
      initial[t.id] = String(saved?.port || t.defaultPort)
    }
    return initial
  })

  const [backgrounds, setBackgrounds] = useState(() => {
    const initial = {}
    for (const t of allTargets) {
      const saved = savedConfig?.targets?.find(s => s.id === t.id)
      initial[t.id] = saved?.background || false
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

  const handleBackgroundToggle = useCallback((id) => {
    setBackgrounds(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const selectedTargets = allTargets.filter(t => checked[t.id] && !runningInstances[t.instanceId])

  const handleSubmit = useCallback(async () => {
    if (selectedTargets.length === 0) {
      setLaunchError('Select at least one target to launch')
      return
    }

    for (const t of selectedTargets) {
      const portNum = parseInt(ports[t.id], 10)
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
        setLaunchError(`${t.label}: port must be between 1024 and 65535`)
        return
      }
    }

    setLaunchError(null)
    setLaunching(true)

    const configTargets = allTargets
      .filter(t => checked[t.id])
      .map(t => ({ id: t.id, port: parseInt(ports[t.id], 10), background: backgrounds[t.id] || false }))
    onSaveConfig({ targets: configTargets })

    const launches = selectedTargets.map(t => ({
      method: t.method,
      port: parseInt(ports[t.id], 10),
      instanceId: t.instanceId,
      subprojectPath: t.subprojectPath,
      dockerServices: t.dockerServices || undefined,
      background: t.method === 'docker' ? (backgrounds[t.id] || false) : false
    }))

    const error = await onLaunchMultiple(project, launches)
    setLaunching(false)
    if (error) {
      setLaunchError(error)
    } else {
      onClose()
    }
  }, [selectedTargets, ports, backgrounds, allTargets, checked, project, onLaunchMultiple, onSaveConfig, onClose])

  useEffect(() => {
    if (allTargets.length === 1 && Object.keys(checked).length === 0) {
      setChecked({ [allTargets[0].id]: true })
    }
  }, [])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title">Launch {project.name}</div>
          {project.hasNpm && npmScripts && npmScripts.length > 0 && (
            <div className="modal-tab-toggle">
              <button
                className={`modal-tab-btn${scriptTab === 'launch' ? ' active' : ''}`}
                onClick={() => setScriptTab('launch')}
              >
                <Play size={11} /> Launch
              </button>
              <button
                className={`modal-tab-btn${scriptTab === 'scripts' ? ' active' : ''}`}
                onClick={() => setScriptTab('scripts')}
              >
                <Terminal size={11} /> Scripts ({npmScripts.length})
              </button>
            </div>
          )}
        </div>

        {scriptTab === 'scripts' ? (
          <NpmScriptsList project={project} scripts={npmScripts || []} onClose={onClose} />
        ) : allTargets.length === 0 ? (
          <div className="form-error">No launchable targets found for this project</div>
        ) : (
          <div className="launch-targets">
            {allTargets.map(target => {
              const isRunning = !!runningInstances[target.instanceId]
              const isDocker = target.method === 'docker'
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
                      {isDocker && (
                        <label className="checkbox-label launch-bg-toggle">
                          <input
                            type="checkbox"
                            checked={!!backgrounds[target.id]}
                            onChange={() => handleBackgroundToggle(target.id)}
                          />
                          <span>Background <span className="launch-target-method">-d</span></span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {scriptTab === 'launch' && launchError && <div className="form-error">{launchError}</div>}

        {scriptTab === 'launch' && (
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
        )}
        {scriptTab === 'scripts' && (
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

// --- Remote Server Components ---

const SERVER_TAG_COLORS = {
  Docker: '#4488ff', PM2: '#aa44ff', nginx: '#00cc66', PHP: '#aa44ff',
  'Node.js': '#ffcc00', MySQL: '#ff8844', PostgreSQL: '#4488ff', Redis: '#ff4444',
  MongoDB: '#00cc66', Apache: '#cc0000', Python: '#44aaff', Go: '#66ccff',
  screen: '#ffcc00'
}

function RemoteServers({
  servers, connections, discovery, discovering, activeServerId, serverSubTab,
  terminalOutput, terminalInput, onSetActiveServer, onSetSubTab,
  onConnect, onDisconnect, onDiscover, onDelete, onAddServer, onExec, onSetTerminalInput
}) {
  if (activeServerId) {
    const server = servers.find(s => s.id === activeServerId)
    if (!server) { onSetActiveServer(null); return null }
    const disc = discovery[activeServerId]
    const isConnected = connections[activeServerId] === 'connected'
    return (
      <div className="port-scanner">
        <div className="port-scanner-toolbar">
          <div className="port-scanner-controls">
            <button className="btn" onClick={() => onSetActiveServer(null)}>
              <Package size={12} /> Back
            </button>
            <span className="server-detail-name">{server.name}</span>
            <span className="server-detail-host">{server.username}@{server.host}:{server.port || 22}</span>
            {disc?.os && <span className="server-os-badge">{disc.os.name}</span>}
          </div>
          <div className="port-scanner-right">
            {isConnected ? (
              <>
                <button className="btn btn-sm" onClick={() => onDiscover(server.id)} disabled={discovering[server.id]}>
                  <RefreshCw size={11} className={discovering[server.id] ? 'spin' : ''} /> Rediscover
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => onDisconnect(server.id)}>
                  <WifiOff size={11} /> Disconnect
                </button>
              </>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => onConnect(server)}>
                <Wifi size={11} /> Connect
              </button>
            )}
          </div>
        </div>

        {isConnected && (
          <div className="server-sub-tabs">
            {['services', 'nginx', 'projects', 'ports', 'terminal'].map(tab => (
              <button
                key={tab}
                className={`server-sub-tab${serverSubTab === tab ? ' active' : ''}`}
                onClick={() => onSetSubTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        )}

        {!isConnected ? (
          <div className="empty-state">
            <WifiOff size={48} className="empty-state-icon" />
            <div className="empty-state-text">Not connected to this server</div>
            <button className="btn btn-primary" onClick={() => onConnect(server)}>
              <Wifi size={14} /> Connect
            </button>
          </div>
        ) : discovering[server.id] ? (
          <div className="scanning-indicator"><div className="spinner" /> Discovering services...</div>
        ) : serverSubTab === 'services' ? (
          <ServerServices discovery={disc} />
        ) : serverSubTab === 'nginx' ? (
          <ServerNginxSites sites={disc?.nginx || []} />
        ) : serverSubTab === 'projects' ? (
          <ServerProjects projects={disc?.projects || []} />
        ) : serverSubTab === 'ports' ? (
          <ServerPorts ports={disc?.ports || []} />
        ) : serverSubTab === 'terminal' ? (
          <ServerTerminal
            serverId={server.id}
            output={terminalOutput[server.id] || []}
            input={terminalInput}
            onSetInput={onSetTerminalInput}
            onExec={onExec}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="port-scanner">
      <div className="port-scanner-toolbar">
        <div className="port-scanner-controls">
          <button className="btn btn-primary" onClick={onAddServer}>
            <Plus size={13} /> Add Server
          </button>
        </div>
        <span className="port-scanner-count">
          {servers.filter(s => connections[s.id] === 'connected').length} connected / {servers.length} server{servers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {servers.length === 0 ? (
        <div className="empty-state">
          <Server size={48} className="empty-state-icon" />
          <div className="empty-state-text">No remote servers configured</div>
          <button className="btn btn-primary" onClick={onAddServer}>
            <Plus size={14} /> Add Server
          </button>
        </div>
      ) : (
        <div className="main">
          <div className="server-grid">
            {servers.map(server => (
              <ServerCard
                key={server.id}
                server={server}
                connection={connections[server.id] || 'disconnected'}
                discovering={discovering[server.id]}
                onConnect={() => onConnect(server)}
                onDisconnect={() => onDisconnect(server.id)}
                onDelete={() => {
                  if (window.confirm(`Delete server "${server.name}"?`)) onDelete(server.id)
                }}
                onSelect={() => { onSetActiveServer(server.id); onSetSubTab('services') }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ServerCard({ server, connection, discovering, onConnect, onDisconnect, onDelete, onSelect }) {
  const isConnected = connection === 'connected'
  const isConnecting = connection === 'connecting'
  return (
    <div
      className={`server-card${isConnected ? ' server-card-connected' : ''}`}
      onClick={isConnected ? onSelect : undefined}
      style={isConnected ? { cursor: 'pointer' } : undefined}
    >
      <div className="server-card-header">
        <div className="server-card-name">{server.name}</div>
        <span className={`server-conn-badge server-conn-${connection}`}>
          {isConnecting && <Loader size={10} className="spin" />}
          {isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}
        </span>
      </div>
      <div className="server-card-info">
        <span>{server.username}@{server.host}:{server.port || 22}</span>
        <span className="server-auth-badge">
          {server.authType === 'key' ? <Key size={10} /> : <span>***</span>}
          {server.authType === 'key' ? ' key' : ' password'}
        </span>
      </div>
      {(server.tags?.length > 0) && (
        <div className="tags" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
          {server.tags.map(tag => (
            <span
              key={tag}
              className={`tag server-tag-${tag.toLowerCase().replace(/[^a-z0-9]/g, '')}`}
              style={{
                backgroundColor: `${SERVER_TAG_COLORS[tag] || '#888'}26`,
                borderColor: SERVER_TAG_COLORS[tag] || '#888',
                color: SERVER_TAG_COLORS[tag] || '#888'
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="server-card-footer">
        {isConnected ? (
          <>
            <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onSelect() }}>
              <Terminal size={11} /> Open
            </button>
            <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDisconnect() }}>
              <WifiOff size={11} />
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={onConnect}
            disabled={isConnecting}
          >
            {isConnecting ? <Loader size={11} className="spin" /> : <Wifi size={11} />}
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        )}
        <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete() }}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

function AddServerModal({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('root')
  const [authType, setAuthType] = useState('password')
  const [password, setPassword] = useState('')
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) return setError('Name is required')
    if (!host.trim()) return setError('Host is required')
    if (!username.trim()) return setError('Username is required')
    setError(null)
    setLoading(true)
    const serverData = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      authType,
      ...(authType === 'password' ? { password } : { privateKeyPath })
    }
    const result = await onAdd(serverData)
    setLoading(false)
    if (result.success) {
      onClose()
    } else {
      setError(result.error || 'Connection failed')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Add Server</div>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Production" />
        </div>
        <div className="form-group" style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Host</label>
            <input className="form-input" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100" />
          </div>
          <div style={{ width: '80px' }}>
            <label className="form-label">Port</label>
            <input className="form-input" type="number" value={port} onChange={e => setPort(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Username</label>
          <input className="form-input" value={username} onChange={e => setUsername(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Authentication</label>
          <div className="radio-group">
            <label className="radio-label">
              <input type="radio" checked={authType === 'password'} onChange={() => setAuthType('password')} />
              Password
            </label>
            <label className="radio-label">
              <input type="radio" checked={authType === 'key'} onChange={() => setAuthType('key')} />
              SSH Key
            </label>
          </div>
        </div>
        {authType === 'password' ? (
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">Private Key Path</label>
            <input className="form-input" value={privateKeyPath} onChange={e => setPrivateKeyPath(e.target.value)} placeholder="~/.ssh/id_rsa" />
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? <><Loader size={12} className="spin" /> Connecting...</> : <><Wifi size={12} /> Connect & Save</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ServerServices({ discovery }) {
  if (!discovery) return <div className="empty-state"><div className="empty-state-text">No discovery data</div></div>

  const sections = [
    { title: 'Docker Containers', data: discovery.docker, render: (items) => items.map((c, i) => (
      <div key={i} className="server-svc-row">
        <span className={`container-state-badge container-state-${c.State}`}>{c.State}</span>
        <span className="server-svc-name">{c.Names}</span>
        <span className="server-svc-detail">{c.Image}</span>
        {c.Ports && <span className="server-svc-port">{c.Ports}</span>}
      </div>
    ))},
    { title: 'PM2 Processes', data: discovery.pm2, render: (items) => items.map((p, i) => (
      <div key={i} className="server-svc-row">
        <span className={`container-state-badge container-state-${p.pm2_env?.status === 'online' ? 'running' : 'exited'}`}>
          {p.pm2_env?.status || 'unknown'}
        </span>
        <span className="server-svc-name">{p.name}</span>
        <span className="server-svc-detail">pid: {p.pid}</span>
      </div>
    ))},
    { title: 'Screen Sessions', data: discovery.screen, render: (items) => items.map((s, i) => (
      <div key={i} className="server-svc-row">
        <span className={`container-state-badge container-state-${s.state === 'Attached' ? 'running' : 'exited'}`}>{s.state}</span>
        <span className="server-svc-name">{s.name}</span>
      </div>
    ))},
    { title: 'Systemd Services', data: discovery.systemd, render: (items) => items.map((s, i) => (
      <div key={i} className="server-svc-row">
        <span className={`container-state-badge container-state-${s.sub === 'running' ? 'running' : 'exited'}`}>{s.sub}</span>
        <span className="server-svc-name">{s.unit}</span>
        <span className="server-svc-detail">{s.description}</span>
      </div>
    ))}
  ]

  const hasSomething = sections.some(s => s.data?.length > 0)
  if (!hasSomething) {
    return <div className="empty-state"><div className="empty-state-text">No services discovered</div></div>
  }

  return (
    <div className="main">
      {sections.map(section => (
        section.data?.length > 0 && (
          <div key={section.title} className="server-section">
            <div className="server-section-title">{section.title} ({section.data.length})</div>
            <div className="server-section-list">{section.render(section.data)}</div>
          </div>
        )
      ))}
    </div>
  )
}

function ServerNginxSites({ sites }) {
  if (sites.length === 0) {
    return <div className="empty-state"><div className="empty-state-text">No nginx sites found</div></div>
  }
  return (
    <div className="port-table-wrapper">
      <table className="port-table">
        <thead>
          <tr><th>Server Name</th><th>Root</th><th>Proxy Pass</th></tr>
        </thead>
        <tbody>
          {sites.map((site, i) => (
            <tr key={i} className="port-row">
              <td className="port-process">{site.serverName || '—'}</td>
              <td className="port-address">{site.root || '—'}</td>
              <td className="port-address">{site.proxyPass || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ServerProjects({ projects }) {
  if (projects.length === 0) {
    return <div className="empty-state"><div className="empty-state-text">No project roots found</div></div>
  }
  return (
    <div className="port-table-wrapper">
      <table className="port-table">
        <thead>
          <tr><th>Path</th><th>Manifests</th></tr>
        </thead>
        <tbody>
          {projects.map((p, i) => (
            <tr key={i} className="port-row">
              <td className="port-process">{p.path}</td>
              <td className="port-address">{p.manifests.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ServerPorts({ ports }) {
  if (ports.length === 0) {
    return <div className="empty-state"><div className="empty-state-text">No listening ports found</div></div>
  }
  return (
    <div className="port-table-wrapper">
      <table className="port-table">
        <thead>
          <tr><th>Port</th><th>Address</th><th>PID</th><th>Process</th></tr>
        </thead>
        <tbody>
          {ports.map((p, i) => (
            <tr key={i} className="port-row">
              <td className="port-number">:{p.port}</td>
              <td className="port-address">{p.address || '*'}</td>
              <td className="port-pid">{p.pid || '—'}</td>
              <td className="port-process">{p.processName || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ServerTerminal({ serverId, output, input, onSetInput, onExec }) {
  const outputRef = useRef(null)

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim()) return
    onExec(serverId, input.trim())
    onSetInput('')
  }

  return (
    <div className="console-view">
      <div className="console-output" ref={outputRef}>
        {output.map((line, i) => (
          <div
            key={i}
            className={`log-line${line.startsWith('[stderr]') || line.startsWith('[error]') ? ' log-line-error' : line.startsWith('$') ? ' log-line-warn' : ''}`}
          >
            {line}
          </div>
        ))}
        {output.length === 0 && (
          <div className="log-line" style={{ color: 'var(--color-text-dim)' }}>
            Type a command below and press Enter...
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="server-terminal-input">
        <span className="server-terminal-prompt">$</span>
        <input
          className="server-terminal-cmd"
          value={input}
          onChange={e => onSetInput(e.target.value)}
          placeholder="Enter command..."
          autoFocus
        />
      </form>
    </div>
  )
}
