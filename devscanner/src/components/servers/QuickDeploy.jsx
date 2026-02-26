import React, { useState, useCallback, useEffect } from 'react'
import { Upload, Folder, Globe, ChevronRight, Check, AlertCircle, X, Server, Lock, Shield, Trash2 } from 'lucide-react'
import electron from '../../electronApi'

const STEPS = ['folder', 'config', 'review', 'deploying', 'done']

export default function QuickDeploy({ serverId, onClose, onRefresh }) {
  const [step, setStep] = useState('folder')
  const [localPath, setLocalPath] = useState(null)
  const [domain, setDomain] = useState('')
  const [port, setPort] = useState('80')
  const [progress, setProgress] = useState({ uploaded: 0, total: 0, file: '' })
  const [deployLogs, setDeployLogs] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  // SSL state
  const [ssl, setSsl] = useState('none')
  const [sslCert, setSslCert] = useState('')
  const [sslKey, setSslKey] = useState('')

  // Full stack state
  const [mode, setMode] = useState('static')
  const [entryFile, setEntryFile] = useState('server.js')
  const [appName, setAppName] = useState('')
  const [backendPort, setBackendPort] = useState('3000')
  const [proxyPath, setProxyPath] = useState('/api')

  useEffect(() => {
    electron.onUploadProgress((data) => {
      if (data.serverId === serverId) {
        setProgress({ uploaded: data.uploaded, total: data.total, file: data.file })
      }
    })
    electron.onDeployLog((data) => {
      if (data.serverId === serverId) {
        setDeployLogs(prev => [...prev, data.message])
      }
    })
    return () => {
      electron.removeUploadProgressListener()
      electron.removeDeployLogListener()
    }
  }, [serverId])

  const handleSelectFolder = useCallback(async () => {
    const folder = await electron.selectDeployFolder()
    if (folder) {
      setLocalPath(folder)
      setStep('config')
    }
  }, [])

  const handleDeploy = useCallback(async () => {
    if (!domain.trim()) return
    setStep('deploying')
    setError(null)
    setDeployLogs([])

    let res
    const sslParams = {
      ssl,
      sslCert: ssl === 'custom' ? sslCert : undefined,
      sslKey: ssl === 'custom' ? sslKey : undefined
    }

    if (mode === 'fullstack') {
      res = await electron.sshFullDeploy({
        serverId,
        localPath,
        domain: domain.trim(),
        entryFile: entryFile.trim() || 'server.js',
        appName: appName.trim() || domain.trim().replace(/[^a-zA-Z0-9_-]/g, ''),
        backendPort: backendPort.trim() || '3000',
        proxyPath: proxyPath.trim() || '/api',
        ...sslParams
      })
    } else {
      res = await electron.sshQuickDeploy({
        serverId,
        localPath,
        domain: domain.trim(),
        port: port.trim() || undefined,
        ...sslParams
      })
    }

    if (res.success) {
      setResult(res.data)
      setStep('done')
      if (onRefresh) onRefresh()
    } else {
      setError(res.error)
      setStep('review')
    }
  }, [serverId, localPath, domain, port, mode, entryFile, appName, backendPort, proxyPath, ssl, sslCert, sslKey, onRefresh])

  const [undeploying, setUndeploying] = useState(false)

  const handleUndeploy = useCallback(async () => {
    if (!result?.domain) return
    setUndeploying(true)
    setDeployLogs([])
    const res = await electron.sshUndeploy({
      serverId,
      domain: result.domain,
      pm2Name: result.pm2Name
    })
    setUndeploying(false)
    if (res.success) {
      setResult(null)
      setStep('folder')
      setError(null)
      setDomain('')
    } else {
      setError(res.error)
    }
  }, [serverId, result])

  const handleReset = useCallback(() => {
    setStep('folder')
    setResult(null)
    setError(null)
    setDeployLogs([])
    setLocalPath(null)
    setDomain('')
    setPort('80')
    setMode('static')
    setEntryFile('server.js')
    setAppName('')
    setBackendPort('3000')
    setProxyPath('/api')
    setSsl('none')
    setSslCert('')
    setSslKey('')
  }, [])

  const stepIndex = STEPS.indexOf(step)
  const pct = progress.total > 0 ? Math.round((progress.uploaded / progress.total) * 100) : 0

  return (
    <div className="deploy-wizard">
      <div className="deploy-header">
        <Upload size={14} />
        <span>{mode === 'fullstack' ? 'Full Stack Deploy' : 'Quick Deploy'}</span>
        {onClose && (
          <button className="btn btn-sm deploy-close" onClick={onClose}>
            <X size={12} />
          </button>
        )}
      </div>

      <div className="deploy-steps">
        {STEPS.filter(s => s !== 'deploying').map((s, i) => (
          <div key={s} className={`deploy-step-dot${stepIndex >= STEPS.indexOf(s) ? ' active' : ''}${step === s ? ' current' : ''}`}>
            {STEPS.indexOf(s) < stepIndex ? <Check size={10} /> : i + 1}
          </div>
        ))}
      </div>

      {step === 'folder' && (
        <div className="deploy-body">
          <div className="deploy-title">Select folder to deploy</div>
          <div className="deploy-desc">Choose a local directory containing your site files.</div>

          <div className="deploy-mode-toggle">
            <button
              className={`deploy-mode-btn${mode === 'static' ? ' active' : ''}`}
              onClick={() => setMode('static')}
            >
              <Globe size={12} /> Static Site
            </button>
            <button
              className={`deploy-mode-btn${mode === 'fullstack' ? ' active' : ''}`}
              onClick={() => setMode('fullstack')}
            >
              <Server size={12} /> Full Stack
            </button>
          </div>

          <button className="btn btn-primary" onClick={handleSelectFolder}>
            <Folder size={13} /> Choose Folder
          </button>
        </div>
      )}

      {step === 'config' && (
        <div className="deploy-body">
          <div className="deploy-title">Configure deployment</div>

          <div className="deploy-mode-toggle">
            <button
              className={`deploy-mode-btn${mode === 'static' ? ' active' : ''}`}
              onClick={() => setMode('static')}
            >
              <Globe size={12} /> Static Site
            </button>
            <button
              className={`deploy-mode-btn${mode === 'fullstack' ? ' active' : ''}`}
              onClick={() => setMode('fullstack')}
            >
              <Server size={12} /> Full Stack
            </button>
          </div>

          <div className="deploy-field">
            <label>Local folder</label>
            <div className="deploy-path">{localPath}</div>
          </div>
          <div className="deploy-field">
            <label>Domain</label>
            <input
              className="input"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="example.com"
              autoFocus
            />
          </div>

          {mode === 'static' && (
            <div className="deploy-field">
              <label>Port</label>
              <input
                className="input"
                value={port}
                onChange={e => setPort(e.target.value)}
                placeholder="80"
                style={{ width: '80px' }}
              />
            </div>
          )}

          {mode === 'fullstack' && (
            <>
              <div className="deploy-field">
                <label>Entry file</label>
                <input
                  className="input"
                  value={entryFile}
                  onChange={e => setEntryFile(e.target.value)}
                  placeholder="server.js"
                />
              </div>
              <div className="deploy-field">
                <label>PM2 app name</label>
                <input
                  className="input"
                  value={appName}
                  onChange={e => setAppName(e.target.value)}
                  placeholder={domain.replace(/[^a-zA-Z0-9_-]/g, '') || 'my-app'}
                />
              </div>
              <div className="deploy-field">
                <label>Backend port</label>
                <input
                  className="input"
                  value={backendPort}
                  onChange={e => setBackendPort(e.target.value)}
                  placeholder="3000"
                  style={{ width: '80px' }}
                />
              </div>
              <div className="deploy-field">
                <label>Proxy path</label>
                <input
                  className="input"
                  value={proxyPath}
                  onChange={e => setProxyPath(e.target.value)}
                  placeholder="/api"
                  style={{ width: '120px' }}
                />
              </div>
            </>
          )}

          <div className="deploy-field">
            <label>SSL</label>
            <div className="deploy-mode-toggle">
              <button
                className={`deploy-mode-btn${ssl === 'none' ? ' active' : ''}`}
                onClick={() => setSsl('none')}
              >
                None
              </button>
              <button
                className={`deploy-mode-btn${ssl === 'certbot' ? ' active' : ''}`}
                onClick={() => setSsl('certbot')}
              >
                <Lock size={10} /> Let's Encrypt
              </button>
              <button
                className={`deploy-mode-btn${ssl === 'custom' ? ' active' : ''}`}
                onClick={() => setSsl('custom')}
              >
                <Shield size={10} /> Custom
              </button>
            </div>
          </div>

          {ssl === 'custom' && (
            <>
              <div className="deploy-field">
                <label>Certificate (PEM)</label>
                <textarea
                  className="deploy-cert-input"
                  value={sslCert}
                  onChange={e => setSslCert(e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  spellCheck={false}
                />
              </div>
              <div className="deploy-field">
                <label>Private Key (PEM)</label>
                <textarea
                  className="deploy-cert-input"
                  value={sslKey}
                  onChange={e => setSslKey(e.target.value)}
                  placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                  spellCheck={false}
                />
              </div>
            </>
          )}

          <div className="deploy-actions">
            <button className="btn" onClick={() => setStep('folder')}>Back</button>
            <button className="btn btn-primary" onClick={() => domain.trim() && setStep('review')} disabled={!domain.trim()}>
              Next <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="deploy-body">
          <div className="deploy-title">Review deployment</div>
          {error && (
            <div className="deploy-error">
              <AlertCircle size={13} /> {error}
            </div>
          )}
          <div className="deploy-summary">
            <div className="deploy-summary-row"><span>Mode:</span><span>{mode === 'fullstack' ? 'Full Stack' : 'Static Site'}</span></div>
            <div className="deploy-summary-row"><span>Folder:</span><span>{localPath}</span></div>
            <div className="deploy-summary-row"><span>Domain:</span><span>{domain}</span></div>
            {mode === 'static' && (
              <div className="deploy-summary-row"><span>Port:</span><span>{port || '80'}</span></div>
            )}
            <div className="deploy-summary-row"><span>Remote path:</span><span>/var/www/{domain.replace(/[^a-zA-Z0-9.-]/g, '')}</span></div>
            <div className="deploy-summary-row"><span>SSL:</span><span>{ssl === 'none' ? 'None' : ssl === 'certbot' ? "Let's Encrypt" : 'Custom'}</span></div>
            {mode === 'fullstack' && (
              <>
                <div className="deploy-summary-row"><span>Entry file:</span><span>{entryFile || 'server.js'}</span></div>
                <div className="deploy-summary-row"><span>PM2 name:</span><span>{appName || domain.replace(/[^a-zA-Z0-9_-]/g, '')}</span></div>
                <div className="deploy-summary-row"><span>Backend port:</span><span>{backendPort || '3000'}</span></div>
                <div className="deploy-summary-row"><span>Proxy path:</span><span>{proxyPath || '/api'}</span></div>
              </>
            )}
          </div>
          {error && deployLogs.length > 0 && (
            <div className="deploy-log">
              {deployLogs.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
          <div className="deploy-actions">
            <button className="btn" onClick={() => setStep('config')}>Back</button>
            <button className="btn btn-primary" onClick={handleDeploy}>
              <Upload size={12} /> Deploy
            </button>
          </div>
        </div>
      )}

      {step === 'deploying' && (
        <div className="deploy-body">
          <div className="deploy-title">Deploying{mode === 'fullstack' ? ' (Full Stack)' : ''}...</div>
          <div className="deploy-progress-bar">
            <div className="deploy-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="deploy-progress-text">
            {progress.uploaded}/{progress.total} files ({pct}%)
          </div>
          {progress.file && <div className="deploy-progress-file">{progress.file}</div>}
          {deployLogs.length > 0 && (
            <div className="deploy-log">
              {deployLogs.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>
      )}

      {step === 'done' && result && (
        <div className="deploy-body">
          <div className="deploy-title deploy-success">
            <Check size={16} /> Deployed successfully!
          </div>
          <div className="deploy-summary">
            <div className="deploy-summary-row"><span>Files uploaded:</span><span>{result.uploaded}</span></div>
            <div className="deploy-summary-row"><span>Domain:</span><span>{result.domain}</span></div>
            <div className="deploy-summary-row"><span>Remote path:</span><span>{result.remoteDir}</span></div>
            {result.pm2Name && (
              <>
                <div className="deploy-summary-row"><span>PM2 process:</span><span>{result.pm2Name}</span></div>
                <div className="deploy-summary-row"><span>Backend port:</span><span>{result.backendPort}</span></div>
                <div className="deploy-summary-row"><span>Proxy path:</span><span>{result.proxyPath}</span></div>
              </>
            )}
          </div>
          {deployLogs.length > 0 && (
            <div className="deploy-log">
              {deployLogs.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
          {result.sslError && (
            <div className="deploy-error">
              <AlertCircle size={13} /> {result.sslError}
            </div>
          )}
          {result.url && (
            <button className="btn btn-primary" onClick={() => electron.openBrowser(result.url)}>
              <Globe size={12} /> Open {result.url}
            </button>
          )}
          <div className="deploy-actions" style={{ marginTop: '0.75rem' }}>
            <button className="btn" onClick={handleReset}>
              Deploy Another
            </button>
            <button className="btn btn-danger" onClick={handleUndeploy} disabled={undeploying}>
              <Trash2 size={11} /> {undeploying ? 'Removing...' : 'Undeploy'}
            </button>
            {onClose && <button className="btn" onClick={onClose}>Close</button>}
          </div>
        </div>
      )}
    </div>
  )
}
