import { useState, useCallback, useRef, useEffect } from 'react'
import electron from '../electronApi'
import { makeLogKey } from '../constants'

export default function useLauncher({ hostIp }) {
  const [running, setRunning] = useState({})
  const [logs, setLogs] = useState({})
  const [openTabs, setOpenTabs] = useState([])
  const [activeTab, setActiveTab] = useState('projects')
  const [launchModal, setLaunchModal] = useState(null)
  const [launchConfigs, setLaunchConfigs] = useState({})
  const [health, setHealth] = useState({})

  const logRef = useRef(null)
  const healthTimers = useRef({})

  // Health check polling
  const startHealthCheck = useCallback((projectPath, instanceId, port) => {
    if (!port) return
    const key = makeLogKey(projectPath, instanceId)
    if (healthTimers.current[key]) clearInterval(healthTimers.current[key])
    setHealth(prev => ({ ...prev, [key]: 'pending' }))

    const checkOnce = async () => {
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
  }, [hostIp])

  const stopHealthCheck = useCallback((projectPath, instanceId) => {
    const key = makeLogKey(projectPath, instanceId)
    if (healthTimers.current[key]) {
      clearInterval(healthTimers.current[key])
      delete healthTimers.current[key]
    }
    setHealth(prev => { const next = { ...prev }; delete next[key]; return next })
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
  }, [startHealthCheck])

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

  const handleCloseTab = useCallback((tabKey) => {
    if (tabKey.startsWith('docker-log::')) {
      const containerId = tabKey.substring('docker-log::'.length)
      electron.dockerStopLogs({ containerId })
      setLogs(prev => { const next = { ...prev }; delete next[containerId]; return next })
      setOpenTabs(prev => prev.filter(t => t !== tabKey))
      setActiveTab(prev => prev === tabKey ? 'projects' : prev)
      return
    }
    const sepIdx = tabKey.indexOf('::')
    const projectPath = tabKey.substring(0, sepIdx)
    const instanceId = tabKey.substring(sepIdx + 2)
    // stop if still running
    handleStop(projectPath, instanceId)
    setOpenTabs(prev => prev.filter(t => t !== tabKey))
    setActiveTab(prev => prev === tabKey ? 'projects' : prev)
    setLogs(prev => {
      const next = { ...prev }
      delete next[tabKey]
      return next
    })
  }, [handleStop])

  const handleClearLogs = useCallback((tabKey) => {
    setLogs(prev => ({ ...prev, [tabKey]: [] }))
  }, [])

  const handleOpenBrowser = useCallback((port) => {
    const host = hostIp || 'localhost'
    electron.openBrowser(`http://${host}:${port}`)
  }, [hostIp])

  const handleSaveConfig = useCallback((projectPath, config) => {
    setLaunchConfigs(prev => {
      const next = { ...prev, [projectPath]: config }
      electron.saveSettings({ launchConfigs: next })
      return next
    })
  }, [])

  // IPC listeners
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
          msg = '\u2713 Containers started in background'
        } else if (code !== null) {
          msg = `Process exited with code ${code}`
        } else {
          msg = 'Process was terminated'
        }
        return { ...prev, [key]: [...lines, msg] }
      })
    })

    return () => {
      electron.removeProjectLogListener()
      electron.removeProjectStoppedListener()
      electron.removeProjectPortChangedListener()
    }
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, activeTab])

  return {
    running,
    setRunning,
    logs,
    setLogs,
    openTabs,
    setOpenTabs,
    activeTab,
    setActiveTab,
    launchModal,
    setLaunchModal,
    launchConfigs,
    setLaunchConfigs,
    health,
    logRef,
    handleLaunch,
    handleLaunchMultiple,
    handleStop,
    handleCloseTab,
    handleClearLogs,
    handleOpenBrowser,
    handleSaveConfig,
    startHealthCheck,
    stopHealthCheck
  }
}
