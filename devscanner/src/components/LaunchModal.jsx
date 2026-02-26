import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { Play, Terminal, Loader } from 'lucide-react'
import electron from '../electronApi'
import { FRAMEWORK_PORT_MAP_SIMPLE } from '../constants'

export function buildLaunchTargets(project) {
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

export function NpmScriptsList({ project, scripts, onClose }) {
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

export default function LaunchModal({ project, runningInstances, savedConfig, onLaunch, onLaunchMultiple, onSaveConfig, onClose }) {
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
