import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Copy, Key, Rocket, Server, Shield, X } from 'lucide-react'
import CustomSelect from '../CustomSelect'
import electron from '../../electronApi'

const MODE_LABELS = {
  'github-direct': 'GitHub direct',
  'private-vpn': 'Private/VPN server pull'
}

export default function DeploySetupModal({ project, servers, connections = {}, onClose }) {
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [selectedServerId, setSelectedServerId] = useState('')
  const [mode, setMode] = useState('github-direct')
  const [deployUser, setDeployUser] = useState('deploy')
  const [remoteBase, setRemoteBase] = useState('/opt/app')
  const [sudoAccess, setSudoAccess] = useState(true)
  const [installCron, setInstallCron] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [logs, setLogs] = useState([])

  const selectedServer = servers.find(server => server.id === selectedServerId)

  useEffect(() => {
    const preferred = servers.find(server => connections[server.id] === 'connected') || servers[0]
    if (preferred) setSelectedServerId(preferred.id)
  }, [servers, connections])

  useEffect(() => {
    let mounted = true
    setLoadingPreview(true)
    electron.deploySetupPreview({ projectPath: project.path }).then(res => {
      if (!mounted) return
      setLoadingPreview(false)
      if (res.success) {
        setPreview(res.data)
        setMode(res.data.mode || 'github-direct')
        setDeployUser(res.data.deployUser || 'deploy')
        setRemoteBase(res.data.remoteBase || `/opt/${project.name}`)
      } else {
        setError(res.error || 'Failed to analyze project')
      }
    })
    return () => { mounted = false }
  }, [project.path, project.name])

  useEffect(() => {
    if (!selectedServerId) return undefined
    const removeDeployLogListener = electron.onDeployLog((data) => {
      if (data.serverId === selectedServerId) setLogs(prev => [...prev, data.message])
    })
    return () => {
      if (typeof removeDeployLogListener === 'function') removeDeployLogListener()
      else electron.removeDeployLogListener()
    }
  }, [selectedServerId])

  const serverOptions = useMemo(() => servers.map(server => ({
    value: server.id,
    label: `${server.name} (${connections[server.id] || 'disconnected'})`
  })), [servers, connections])

  const handleRun = useCallback(async () => {
    if (!selectedServerId || !preview) return
    setRunning(true)
    setResult(null)
    setError(null)
    setLogs([])
    const res = await electron.deploySetupRun({
      serverId: selectedServerId,
      projectPath: project.path,
      mode,
      deployUser,
      remoteBase,
      sudoAccess,
      installCron
    })
    setRunning(false)
    if (res.success) {
      setResult(res.data)
    } else {
      setError(res.error || 'Deploy setup failed')
    }
  }, [selectedServerId, preview, project.path, mode, deployUser, remoteBase, sudoAccess, installCron])

  const copyText = useCallback((text) => {
    navigator.clipboard?.writeText(text || '').catch(() => {})
  }, [])

  const copyAllGenerated = useCallback(() => {
    if (!result?.secrets) return
    const body = result.secrets
      .filter(secret => secret.value)
      .map(secret => `${secret.name}\n${secret.value}`)
      .join('\n\n---\n\n')
    copyText(body)
  }, [result, copyText])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal deploy-setup-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title deploy-setup-title">
            <Rocket size={16} /> Deploy Setup
          </div>
          <button className="btn btn-sm" onClick={onClose}><X size={12} /></button>
        </div>

        <div className="deploy-project-summary">
          <div>
            <span>Project</span>
            <strong>{project.name}</strong>
          </div>
          <code title={project.path}>{project.path}</code>
        </div>

        {loadingPreview ? (
          <div className="scanning-indicator"><div className="spinner" /> Analyzing deploy config...</div>
        ) : result ? (
          <DeploySetupResult result={result} logs={logs} onCopy={copyText} onCopyAll={copyAllGenerated} />
        ) : (
          <div className="deploy-setup-layout">
            {error && <div className="deploy-error"><AlertCircle size={13} /> {error}</div>}

            {preview?.recommendations?.length > 0 && (
              <div className="deploy-detected-card">
                <div className="deploy-detected-title">Detected profile</div>
                {preview.recommendations.map(item => <div key={item}>{item}</div>)}
              </div>
            )}

            <div className="deploy-setup-grid">
              <div className="deploy-field">
                <label>Server</label>
                <CustomSelect
                  value={selectedServerId}
                  onChange={setSelectedServerId}
                  options={serverOptions}
                  placeholder="Choose server"
                />
              </div>
              <div className="deploy-field">
                <label>Profile</label>
                <div className="deploy-mode-toggle">
                  {Object.entries(MODE_LABELS).map(([id, label]) => (
                    <button
                      key={id}
                      className={`deploy-mode-btn${mode === id ? ' active' : ''}`}
                      onClick={() => setMode(id)}
                    >
                      {id === 'private-vpn' ? <Shield size={12} /> : <Server size={12} />}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="deploy-setup-grid">
              <div className="deploy-field">
                <label>Deploy user</label>
                <input className="input" value={deployUser} onChange={e => setDeployUser(e.target.value)} />
              </div>
              <div className="deploy-field">
                <label>Remote base</label>
                <input className="input" value={remoteBase} onChange={e => setRemoteBase(e.target.value)} />
              </div>
            </div>

            <label className="checkbox-label">
              <input type="checkbox" checked={sudoAccess} onChange={e => setSudoAccess(e.target.checked)} />
              Grant passwordless sudo to deploy user for automation
            </label>

            {mode === 'private-vpn' && (
              <label className="checkbox-label">
                <input type="checkbox" checked={installCron} onChange={e => setInstallCron(e.target.checked)} />
                Install cron entry now (enable only after server env is ready)
              </label>
            )}

            {selectedServer && connections[selectedServer.id] !== 'connected' && (
              <div className="deploy-warning">
                Server is not connected. DevScanner will try to connect using saved credentials.
              </div>
            )}

            {preview?.secrets?.length > 0 && (
              <div className="deploy-detected-card">
                <div className="deploy-detected-title">Workflow secrets</div>
                <div className="deploy-secret-pills">
                  {preview.secrets.map(secret => <span key={secret}>{secret}</span>)}
                </div>
              </div>
            )}

            {running && logs.length > 0 && <DeployLog logs={logs} />}

            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRun} disabled={running || !selectedServerId || !preview}>
                {running ? <><div className="spinner" /> Preparing...</> : <><Key size={12} /> Prepare Server & Secrets</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DeploySetupResult({ result, logs, onCopy, onCopyAll }) {
  return (
    <div className="deploy-setup-layout">
      <div className="deploy-title deploy-success"><Check size={16} /> Setup complete</div>

      <div className="deploy-detected-card">
        <div className="deploy-detected-title">Next steps</div>
        {result.nextSteps?.map(step => <div key={step}>{step}</div>)}
      </div>

      <div className="deploy-secret-header">
        <span>GitHub Secrets</span>
        <button className="btn btn-sm" onClick={onCopyAll}><Copy size={11} /> Copy generated</button>
      </div>

      <div className="deploy-secret-list">
        {result.secrets?.map(secret => (
          <div key={secret.name} className="deploy-secret-row">
            <div className="deploy-secret-meta">
              <strong>{secret.name}</strong>
              <span>{secret.description}</span>
            </div>
            {secret.value ? (
              <>
                <textarea readOnly value={secret.value} spellCheck={false} />
                <button className="btn btn-sm" onClick={() => onCopy(secret.value)}><Copy size={11} /> Copy</button>
              </>
            ) : (
              <div className="deploy-secret-manual">Fill manually in GitHub</div>
            )}
          </div>
        ))}
      </div>

      {result.variables?.length > 0 && (
        <div className="deploy-detected-card">
          <div className="deploy-detected-title">GitHub Variables</div>
          <div className="deploy-secret-pills">
            {result.variables.map(variable => <span key={variable.name}>{variable.name}</span>)}
          </div>
        </div>
      )}

      {result.publicKey && (
        <div className="deploy-detected-card">
          <div className="deploy-detected-title">Deploy public key installed on server</div>
          <code className="deploy-public-key">{result.publicKey}</code>
        </div>
      )}

      {logs.length > 0 && <DeployLog logs={logs} />}
    </div>
  )
}

function DeployLog({ logs }) {
  return (
    <div className="deploy-log deploy-setup-log">
      {logs.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
    </div>
  )
}
