import { useState, useCallback, useEffect } from 'react'
import electron from '../electronApi'

export default function useDocker({ folderPath, navTab, openTabs, setOpenTabs, setActiveTab, setNavTab }) {
  const [dockerContainers, setDockerContainers] = useState([])
  const [dockerLoading, setDockerLoading] = useState(false)
  const [dockerError, setDockerError] = useState(null)
  const [dockerInfo, setDockerInfo] = useState(null)
  const [dockerLogs, setDockerLogs] = useState({})
  const [dockerContainerMap, setDockerContainerMap] = useState({})
  const [dockerActionLoading, setDockerActionLoading] = useState(new Set())

  const refreshDocker = useCallback(async () => {
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

  const viewDockerLogs = useCallback(async (container) => {
    const tabKey = `docker-log::${container.ID}`
    setDockerContainerMap(prev => ({ ...prev, [container.ID]: container }))
    setOpenTabs(prev => prev.includes(tabKey) ? prev : [...prev, tabKey])
    setActiveTab(tabKey)
    setNavTab('projects')
    const ctxOpts = folderPath ? { projectPath: folderPath } : {}
    await electron.dockerStreamLogs({ containerId: container.ID, ...ctxOpts })
  }, [folderPath, setOpenTabs, setActiveTab, setNavTab])

  const stopDockerLogs = useCallback((containerId) => {
    electron.dockerStopLogs({ containerId })
    setDockerLogs(prev => { const next = { ...prev }; delete next[containerId]; return next })
  }, [])

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

  // Docker log IPC listeners
  useEffect(() => {
    if (!electron.available) return

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
        return { ...prev, [containerId]: [...lines, '\u2014 log stream ended \u2014'] }
      })
    })

    return () => {
      electron.removeDockerLogListeners()
    }
  }, [])

  return {
    dockerContainers,
    dockerLoading,
    dockerError,
    dockerInfo,
    dockerLogs,
    dockerContainerMap,
    dockerActionLoading,
    refreshDocker,
    handleDockerAction,
    viewDockerLogs,
    stopDockerLogs
  }
}
