import React, { useState, useEffect } from 'react'
import {
  X, Play, Square, ExternalLink, Copy, CheckCircle, ArrowDown,
  AlertTriangle, Loader
} from 'lucide-react'
import electron from '../electronApi'

export default function DockerServicesModal({ project, catalog, healthStatus, onClose }) {
  const [view, setView] = useState('selection') // 'selection' | 'running'
  const [services, setServices] = useState({})
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)
  const [injected, setInjected] = useState(null)

  // Load saved config on mount
  useEffect(() => {
    electron.dockerServicesConfig({ projectPath: project.path }).then(res => {
      if (res.success && res.data?.services) {
        setServices(res.data.services)
        // Check if services are running
        electron.dockerServicesStatus({ projectPath: project.path }).then(statusRes => {
          if (statusRes.success) {
            const anyRunning = Object.values(statusRes.data).some(s => s.running)
            if (anyRunning) setView('running')
          }
          setLoading(false)
        })
      } else {
        // Initialize with defaults from catalog
        const initial = {}
        for (const [key, entry] of Object.entries(catalog)) {
          initial[key] = {
            enabled: false,
            port: entry.multi ? entry.services?.redis?.defaultPort || 6379 : entry.defaultPort
          }
        }
        setServices(initial)
        setLoading(false)
      }
    })
  }, [project.path, catalog])

  const toggleService = (key) => {
    setServices(prev => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key]?.enabled }
    }))
  }

  const setPort = (key, port) => {
    setServices(prev => ({
      ...prev,
      [key]: { ...prev[key], port: parseInt(port, 10) || 0 }
    }))
  }

  const handleStart = async () => {
    setStarting(true)
    setError(null)
    // Save config first
    await electron.dockerServicesSave({ projectPath: project.path, services })
    const res = await electron.dockerServicesStart({ projectPath: project.path })
    if (res.success) {
      setView('running')
    } else {
      setError(res.error)
    }
    setStarting(false)
  }

  const handleStop = async () => {
    setStopping(true)
    setError(null)
    const res = await electron.dockerServicesStop({ projectPath: project.path })
    if (res.success) {
      setView('selection')
    } else {
      setError(res.error)
    }
    setStopping(false)
  }

  const getConnectionString = (key) => {
    const entry = catalog[key]
    if (!entry?.connectionTemplate) return null
    const svcConfig = services[key] || {}
    let str = entry.connectionTemplate
    const port = svcConfig.port || (entry.multi ? entry.services?.redis?.defaultPort || 6379 : entry.defaultPort)
    str = str.replace('{port}', String(port))
    const envVars = { ...(entry.env || {}), ...(svcConfig.env || {}) }
    str = str.replace(/\{([A-Z_]+)\}/g, (_, varName) => envVars[varName] || '')
    return str
  }

  const getAdminUrl = (key) => {
    const entry = catalog[key]
    if (!entry?.adminUrl) return null
    const svcConfig = services[key] || {}
    const port = svcConfig.port || entry.defaultPort
    return entry.adminUrl.replace('{port}', String(port))
  }

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleInjectEnv = async (key) => {
    const entry = catalog[key]
    if (!entry?.envKey) return
    const connStr = getConnectionString(key)
    if (!connStr) return
    const res = await electron.dockerServicesInjectEnv({
      projectPath: project.path,
      envFileName: '.env',
      entries: [{ key: entry.envKey, value: connStr }]
    })
    if (res.success) {
      setInjected(key)
      setTimeout(() => setInjected(null), 2000)
    } else {
      setError(res.error)
    }
  }

  const enabledKeys = Object.entries(services).filter(([, v]) => v.enabled).map(([k]) => k)

  const getHealthDot = (key) => {
    const h = healthStatus[key]
    if (!h) return 'stopped'
    if (h.health === 'healthy') return 'healthy'
    if (h.running && h.health !== 'unhealthy') return 'starting'
    if (h.health === 'unhealthy') return 'unhealthy'
    return 'stopped'
  }

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal modal-docker-services" onClick={e => e.stopPropagation()}>
          <div className="modal-title-row">
            <h3 className="modal-title">Docker Services — {project.name}</h3>
            <button className="btn btn-sm" onClick={onClose}><X size={14} /></button>
          </div>
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-dim)' }}>
            <Loader size={20} className="spin" /> Loading...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-docker-services" onClick={e => e.stopPropagation()}>
        <div className="modal-title-row">
          <h3 className="modal-title">
            {view === 'running' ? 'Services' : 'Docker Services'} — {project.name}
          </h3>
          <button className="btn btn-sm" onClick={onClose}><X size={14} /></button>
        </div>

        {error && (
          <div style={{ padding: '0.5rem 1rem', color: 'var(--color-error)', fontSize: '0.78rem' }}>
            <AlertTriangle size={12} /> {error}
          </div>
        )}

        <div className="ds-body">
          {view === 'selection' ? (
            <>
              {Object.entries(catalog).map(([key, entry]) => (
                <div key={key} className="ds-service-row">
                  <label className="ds-service-label">
                    <input
                      type="checkbox"
                      checked={!!services[key]?.enabled}
                      onChange={() => toggleService(key)}
                    />
                    <span>{entry.label}</span>
                    {entry.multi && <span className="ds-note">(multi)</span>}
                  </label>
                  <input
                    className="ds-port-input"
                    type="number"
                    value={services[key]?.port || (entry.multi ? entry.services?.redis?.defaultPort || 6379 : entry.defaultPort)}
                    onChange={e => setPort(key, e.target.value)}
                    min={1}
                    max={65535}
                  />
                </div>
              ))}
            </>
          ) : (
            <>
              {enabledKeys.map(key => {
                const entry = catalog[key]
                if (!entry) return null
                const dot = getHealthDot(key)
                const connStr = getConnectionString(key)
                const adminUrl = getAdminUrl(key)
                const svcConfig = services[key] || {}
                const port = svcConfig.port || (entry.multi ? entry.services?.redis?.defaultPort || 6379 : entry.defaultPort)

                return (
                  <div key={key} className="ds-running-row">
                    <div className="ds-running-header">
                      <span className={`ds-running-dot ds-dot-${dot}`} />
                      <span className="ds-running-label">{entry.label}</span>
                      <span className="ds-running-port">:{port}</span>
                      <span className={`health-badge health-${dot === 'healthy' ? 'ok' : dot === 'starting' ? 'pending' : 'err'}`}>
                        {dot}
                      </span>
                    </div>
                    {connStr && entry.envKey !== null && (
                      <div className="ds-conn-string-row">
                        <code className="ds-conn-string">{connStr}</code>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleCopy(connStr)}
                          title="Copy"
                        >
                          {copied === connStr ? <CheckCircle size={11} /> : <Copy size={11} />}
                        </button>
                        {entry.envKey && (
                          <button
                            className="btn btn-sm"
                            onClick={() => handleInjectEnv(key)}
                            title={`Inject ${entry.envKey} into .env`}
                          >
                            {injected === key ? <CheckCircle size={11} /> : <ArrowDown size={11} />} .env
                          </button>
                        )}
                      </div>
                    )}
                    {adminUrl && (
                      <div className="ds-conn-string-row">
                        <button
                          className="btn btn-sm"
                          onClick={() => electron.openBrowser(adminUrl)}
                        >
                          <ExternalLink size={11} /> Open in Browser
                        </button>
                      </div>
                    )}
                    {entry.multi && entry.services?.celery?.note && (
                      <div className="ds-note" style={{ marginLeft: '1.2rem' }}>{entry.services.celery.note}</div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>

        <div className="ds-modal-footer">
          {view === 'selection' ? (
            <>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={enabledKeys.length === 0 || starting}
                onClick={handleStart}
              >
                {starting ? <><Loader size={12} className="spin" /> Starting...</> : <><Play size={12} /> Start</>}
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setView('selection')}>Configure</button>
              <button
                className="btn btn-danger"
                disabled={stopping}
                onClick={handleStop}
              >
                {stopping ? <><Loader size={12} className="spin" /> Stopping...</> : <><Square size={12} /> Stop</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
