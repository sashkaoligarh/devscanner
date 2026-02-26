import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Play, Square, Search, Terminal, Loader, ChevronDown, ChevronRight, Trash2, AlertCircle } from 'lucide-react'
import { LANGUAGE_COLORS, FRAMEWORK_COLORS } from '../../constants'
import electron from '../../electronApi'

export default function RemoteProjectManager({ serverId, projects, remoteRunning, remoteLogs, onRefresh }) {
  const [analyses, setAnalyses] = useState({}) // path -> analysis
  const [analyzing, setAnalyzing] = useState({}) // path -> bool
  const [expandedProject, setExpandedProject] = useState(null)
  const [launchCmd, setLaunchCmd] = useState({}) // path -> command
  const [launchPort, setLaunchPort] = useState({}) // path -> port
  const [launching, setLaunching] = useState({}) // path -> bool
  const [showLogs, setShowLogs] = useState(null) // instanceId
  const [deleting, setDeleting] = useState({}) // path -> bool
  const [deleteLogs, setDeleteLogs] = useState({}) // path -> string[]
  const [deleteError, setDeleteError] = useState({}) // path -> string
  const logRef = useRef(null)

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [showLogs, remoteLogs])

  // Listen for deploy-log events (used by ssh-remove-project)
  useEffect(() => {
    electron.onDeployLog((data) => {
      if (data.serverId === serverId) {
        setDeleteLogs(prev => {
          // Append to whichever project is currently being deleted
          const updated = { ...prev }
          for (const path of Object.keys(deleting)) {
            if (deleting[path]) {
              updated[path] = [...(updated[path] || []), data.message]
            }
          }
          return updated
        })
      }
    })
    return () => electron.removeDeployLogListener()
  }, [serverId, deleting])

  const handleDelete = useCallback(async (projectPath) => {
    if (!confirm(`Delete project and all associated configs?\n\n${projectPath}`)) return
    setDeleting(prev => ({ ...prev, [projectPath]: true }))
    setDeleteLogs(prev => ({ ...prev, [projectPath]: [] }))
    setDeleteError(prev => ({ ...prev, [projectPath]: null }))

    const res = await electron.sshRemoveProject({ serverId, projectPath })

    setDeleting(prev => ({ ...prev, [projectPath]: false }))
    if (!res.success) {
      setDeleteError(prev => ({ ...prev, [projectPath]: res.error }))
    } else {
      // Refresh project list
      if (onRefresh) onRefresh()
    }
  }, [serverId, onRefresh])

  const handleAnalyze = useCallback(async (projectPath) => {
    setAnalyzing(prev => ({ ...prev, [projectPath]: true }))
    const result = await electron.sshAnalyzeProject({ serverId, projectPath })
    if (result.success) {
      setAnalyses(prev => ({ ...prev, [projectPath]: result.data }))
      // Set default command based on scripts
      const scripts = result.data.scripts || {}
      const defaultScript = scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : null
      if (defaultScript) {
        setLaunchCmd(prev => ({ ...prev, [projectPath]: defaultScript }))
      }
    }
    setAnalyzing(prev => ({ ...prev, [projectPath]: false }))
  }, [serverId])

  const handleLaunch = useCallback(async (projectPath) => {
    const cmd = launchCmd[projectPath]
    if (!cmd) return
    setLaunching(prev => ({ ...prev, [projectPath]: true }))
    const port = launchPort[projectPath] ? parseInt(launchPort[projectPath], 10) : undefined
    await electron.sshLaunchProject({ serverId, projectPath, command: cmd, port: port || undefined })
    setLaunching(prev => ({ ...prev, [projectPath]: false }))
  }, [serverId, launchCmd, launchPort])

  const handleStop = useCallback(async (instanceId) => {
    // Find the projectPath for this instance
    const entry = remoteRunning?.[instanceId]
    if (entry) {
      await electron.sshStopProject({ serverId, projectPath: entry.projectPath, instanceId })
    }
  }, [serverId, remoteRunning])

  const toggleExpand = useCallback((projectPath) => {
    setExpandedProject(prev => prev === projectPath ? null : projectPath)
    // Auto-analyze on expand
    if (!analyses[projectPath] && !analyzing[projectPath]) {
      handleAnalyze(projectPath)
    }
  }, [analyses, analyzing, handleAnalyze])

  if (!projects || projects.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">No project roots found</div>
      </div>
    )
  }

  // Map running processes to their project paths
  const runningByProject = {}
  if (remoteRunning) {
    for (const [instanceId, entry] of Object.entries(remoteRunning)) {
      const p = entry.projectPath
      if (!runningByProject[p]) runningByProject[p] = []
      runningByProject[p].push({ instanceId, ...entry })
    }
  }

  // Viewing logs for an instance
  if (showLogs) {
    const instanceLogs = remoteLogs?.[showLogs] || []
    return (
      <div className="console-view">
        <div className="console-toolbar">
          <button className="btn btn-sm" onClick={() => setShowLogs(null)}>
            Back to Projects
          </button>
          <span className="console-title">Remote Logs: {showLogs}</span>
        </div>
        <div className="console-output" ref={logRef}>
          {instanceLogs.map((line, i) => (
            <div key={i} className="log-line">{line}</div>
          ))}
          {instanceLogs.length === 0 && (
            <div className="log-line" style={{ color: 'var(--color-text-dim)' }}>
              Waiting for output...
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="main">
      {projects.map(project => {
        const isExpanded = expandedProject === project.path
        const analysis = analyses[project.path]
        const isAnalyzing = analyzing[project.path]
        const running = runningByProject[project.path] || []
        const isLaunching = launching[project.path]

        return (
          <div key={project.path} className="project-card" style={{ marginBottom: '0.5rem' }}>
            <div
              className="project-name-row"
              style={{ cursor: 'pointer' }}
              onClick={() => toggleExpand(project.path)}
            >
              <div className="project-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {project.path.split('/').pop()}
                {running.length > 0 && <span className="status-badge" style={{ fontSize: '0.65rem' }}>running</span>}
              </div>
              <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                {project.manifests.map(m => (
                  <span key={m} className="tag" style={{ fontSize: '0.65rem' }}>{m}</span>
                ))}
              </div>
            </div>

            {isExpanded && (
              <div style={{ padding: '0.5rem 0' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)', marginBottom: '0.5rem' }}>
                  {project.path}
                </div>

                {isAnalyzing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <Loader size={12} className="spin" /> Analyzing...
                  </div>
                )}

                {analysis && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div className="tags" style={{ marginBottom: '0.5rem' }}>
                      {analysis.language && (
                        <span className="tag" style={{
                          backgroundColor: `${LANGUAGE_COLORS[analysis.language] || '#888'}26`,
                          borderColor: LANGUAGE_COLORS[analysis.language] || '#888',
                          color: LANGUAGE_COLORS[analysis.language] || '#888'
                        }}>{analysis.language}</span>
                      )}
                      {analysis.framework && (
                        <span className="tag" style={{
                          backgroundColor: `${FRAMEWORK_COLORS[analysis.framework] || '#888'}26`,
                          borderColor: FRAMEWORK_COLORS[analysis.framework] || '#888',
                          color: FRAMEWORK_COLORS[analysis.framework] || '#888'
                        }}>{analysis.framework}</span>
                      )}
                      {analysis.hasDocker && <span className="tag">Docker</span>}
                    </div>

                    {Object.keys(analysis.scripts).length > 0 && (
                      <div style={{ marginBottom: '0.5rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)', marginBottom: '0.25rem' }}>
                          npm scripts:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                          {Object.keys(analysis.scripts).map(script => (
                            <button
                              key={script}
                              className={`btn btn-sm${launchCmd[project.path] === `npm run ${script}` || (script === 'start' && launchCmd[project.path] === 'npm start') ? ' btn-primary' : ''}`}
                              onClick={() => setLaunchCmd(prev => ({
                                ...prev,
                                [project.path]: script === 'start' ? 'npm start' : `npm run ${script}`
                              }))}
                            >
                              {script}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Launch controls */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <input
                    className="server-terminal-cmd"
                    style={{ flex: 1 }}
                    value={launchCmd[project.path] || ''}
                    onChange={e => setLaunchCmd(prev => ({ ...prev, [project.path]: e.target.value }))}
                    placeholder="Command to run (e.g. npm run dev)"
                  />
                  <input
                    className="server-terminal-cmd"
                    style={{ width: '5rem' }}
                    value={launchPort[project.path] || ''}
                    onChange={e => setLaunchPort(prev => ({ ...prev, [project.path]: e.target.value }))}
                    placeholder="Port"
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!launchCmd[project.path] || isLaunching}
                    onClick={() => handleLaunch(project.path)}
                  >
                    {isLaunching ? <Loader size={11} className="spin" /> : <Play size={11} />}
                    Launch
                  </button>
                  {!analysis && !isAnalyzing && (
                    <button className="btn btn-sm" onClick={() => handleAnalyze(project.path)}>
                      <Search size={11} /> Analyze
                    </button>
                  )}
                </div>

                {/* Running instances */}
                {running.map(inst => (
                  <div key={inst.instanceId} className="instance-row" style={{ marginTop: '0.25rem' }}>
                    <span className="status-badge">{inst.command}</span>
                    {inst.port && <span className="status-badge">:{inst.port}</span>}
                    <button className="btn btn-danger btn-sm" onClick={() => handleStop(inst.instanceId)}>
                      <Square size={10} /> Stop
                    </button>
                    <button className="btn btn-sm" onClick={() => setShowLogs(inst.instanceId)}>
                      <Terminal size={10} /> Logs
                    </button>
                  </div>
                ))}

                {/* Delete project */}
                <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={deleting[project.path]}
                    onClick={() => handleDelete(project.path)}
                  >
                    {deleting[project.path] ? <Loader size={11} className="spin" /> : <Trash2 size={11} />}
                    {deleting[project.path] ? ' Removing...' : ' Delete from server'}
                  </button>

                  {deleteError[project.path] && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <AlertCircle size={11} /> {deleteError[project.path]}
                    </div>
                  )}

                  {deleteLogs[project.path]?.length > 0 && (
                    <div className="deploy-log" style={{ marginTop: '0.5rem', maxHeight: '150px' }}>
                      {deleteLogs[project.path].map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
