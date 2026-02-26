import { useState, useCallback, useEffect } from 'react'
import electron from '../electronApi'

export default function useServers() {
  const [remoteServers, setRemoteServers] = useState([])
  const [serverConnections, setServerConnections] = useState({})
  const [serverDiscovery, setServerDiscovery] = useState({})
  const [activeServerId, setActiveServerId] = useState(null)
  const [serverSubTab, setServerSubTab] = useState('services')
  const [addServerModal, setAddServerModal] = useState(false)
  const [serverDiscovering, setServerDiscovering] = useState({})
  const [terminalOutput, setTerminalOutput] = useState({})
  const [terminalInput, setTerminalInput] = useState('')
  const [remoteRunning, setRemoteRunning] = useState({}) // serverId -> { instanceId -> { projectPath, command, port } }
  const [remoteLogs, setRemoteLogs] = useState({}) // instanceId -> [lines]

  // Listen for remote project logs and stopped events
  useEffect(() => {
    const handleLog = (data) => {
      setRemoteLogs(prev => ({
        ...prev,
        [data.instanceId]: [...(prev[data.instanceId] || []), data.data]
      }))
    }
    const handleStopped = (data) => {
      setRemoteRunning(prev => {
        const serverInstances = { ...(prev[data.serverId] || {}) }
        delete serverInstances[data.instanceId]
        return { ...prev, [data.serverId]: serverInstances }
      })
    }

    electron.onRemoteProjectLog(handleLog)
    electron.onRemoteProjectStopped?.(handleStopped)

    return () => {
      electron.removeRemoteProjectLogListener()
      electron.removeRemoteProjectStoppedListener?.()
    }
  }, [])

  const discoverServer = useCallback(async (serverId, servers) => {
    // Accept servers array to avoid stale closure
    const serverList = servers || remoteServers
    setServerDiscovering(prev => ({ ...prev, [serverId]: true }))
    const result = await electron.sshDiscover({ serverId })
    if (result.success) {
      setServerDiscovery(prev => ({ ...prev, [serverId]: result.data }))
      setRemoteServers(prev => prev.map(s =>
        s.id === serverId ? { ...s, tags: result.data.tags, discoveredServices: result.data } : s
      ))
      const server = serverList.find(s => s.id === serverId)
      if (server) {
        electron.sshSaveServer({ server: { ...server, tags: result.data.tags, discoveredServices: result.data, lastConnected: new Date().toISOString() } })
      }
    }
    setServerDiscovering(prev => ({ ...prev, [serverId]: false }))
    return result
  }, [remoteServers])

  const connectServer = useCallback(async (server) => {
    setServerConnections(prev => ({ ...prev, [server.id]: 'connecting' }))
    const result = await electron.sshConnect({ server })
    if (result.success) {
      setServerConnections(prev => ({ ...prev, [server.id]: 'connected' }))
      discoverServer(server.id)
    } else {
      setServerConnections(prev => ({ ...prev, [server.id]: 'disconnected' }))
      alert(`SSH connection failed: ${result.error}`)
    }
    return result
  }, [discoverServer])

  const disconnectServer = useCallback(async (serverId) => {
    await electron.sshDisconnect({ serverId })
    setServerConnections(prev => ({ ...prev, [serverId]: 'disconnected' }))
    setServerDiscovery(prev => { const n = { ...prev }; delete n[serverId]; return n })
  }, [])

  const saveServer = useCallback(async (serverData) => {
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
    discoverServer(server.id)
    return { success: true }
  }, [discoverServer])

  const deleteServer = useCallback(async (serverId) => {
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

  const execOnServer = useCallback(async (serverId, command) => {
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

  return {
    remoteServers,
    setRemoteServers,
    serverConnections,
    serverDiscovery,
    activeServerId,
    setActiveServerId,
    serverSubTab,
    setServerSubTab,
    addServerModal,
    setAddServerModal,
    serverDiscovering,
    terminalOutput,
    terminalInput,
    setTerminalInput,
    connectServer,
    disconnectServer,
    discoverServer,
    saveServer,
    deleteServer,
    execOnServer,
    remoteRunning,
    remoteLogs,
    setRemoteRunning
  }
}
