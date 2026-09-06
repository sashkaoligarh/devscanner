import React, { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, Key, Rocket, X } from 'lucide-react'
import electron from '../../electronApi'

const MODES = { 'github-direct': 'GitHub → server (SSH / Ansible)', 'private-vpn': 'Server pulls images (VPN / private network)' }
const DEFAULT_NGINX = 'server {\n    listen 80;\n    server_name your-domain.com;\n    location / {\n        proxy_pass http://127.0.0.1:4321;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n'

export default function DeploySetupModal({ project, servers, connections = {}, onClose }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [serverId, setServerId] = useState('')
  const [mode, setMode] = useState('github-direct')
  const [targetId, setTargetId] = useState('')
  const [deployUser, setDeployUser] = useState('deploy')
  const [remoteBase, setRemoteBase] = useState('/opt/app')
  const [sudoAccess, setSudoAccess] = useState(false)
  const [installCron, setInstallCron] = useState(true)
  const [runNow, setRunNow] = useState(false)
  const [envValues, setEnvValues] = useState({})
  const [envSource, setEnvSource] = useState('')
  const [overwriteEnv, setOverwriteEnv] = useState(false)
  const [showSecrets, setShowSecrets] = useState(false)
  const [configureNginx, setConfigureNginx] = useState(false)
  const [domain, setDomain] = useState('')
  const [nginxConfig, setNginxConfig] = useState('')
  const [sslCert, setSslCert] = useState('')
  const [sslKey, setSslKey] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [running, setRunning] = useState(false)
  const [busyEnv, setBusyEnv] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [logs, setLogs] = useState([])
  const [completed, setCompleted] = useState([])
  const target = preview?.targets.find(t => t.id === targetId)
  const close = () => { if (!running) onClose() }

  useEffect(() => {
    setServerId(current => current || (servers.find(s => connections[s.id] === 'connected') || servers[0])?.id || '')
  }, [servers, connections])

  useEffect(() => {
    let active = true
    setLoading(true)
    electron.deploySetupPreview({ projectPath: project.path }).then(res => {
      if (!active) return
      if (!res.success) throw new Error(res.error || 'Failed to analyze project')
      const data = res.data
      setPreview(data)
      setMode(data.mode)
      setDeployUser(data.deployUser)
      setRemoteBase(data.remoteBase)
      setTargetId(data.targets[0]?.id || '')
      setEnvValues(Object.fromEntries(data.envFields.map(f => [f.key, f.value])))
      setEnvSource(data.envSources[0] || '')
      setConfigureNginx(!!data.nginxFile)
      setNginxConfig(data.nginxFile ? '' : DEFAULT_NGINX)
    }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [project.path])

  useEffect(() => {
    const remove = electron.onDeployLog(data => {
      if (data.serverId === serverId) setLogs(prev => [...prev, data.message])
    })
    return () => { if (typeof remove === 'function') remove() }
  }, [serverId])

  const copy = useCallback(text => navigator.clipboard?.writeText(text || '').catch(() => {}), [])
  const handleRun = async () => {
    setRunning(true)
    setError(null)
    setLogs([])
    setCompleted([])
    try {
      const res = await electron.deploySetupRun({ serverId, projectPath: project.path, mode, targetId, deployUser, remoteBase, sudoAccess, installCron, runNow, envValues, overwriteEnv, configureNginx, domain, nginxConfig, sslCert, sslKey, privateKey })
      if (!res.success) { setCompleted(res.completed || []); throw new Error(res.error || 'Setup failed') }
      setResult(res.data)
      setEnvValues({})
      setPrivateKey('')
      setSslKey('')
    } catch (err) { setError(err.message) } finally { setRunning(false) }
  }
  const editEnv = async generate => {
    setBusyEnv(true)
    setError(null)
    try {
      const res = generate
        ? await electron.deploySetupGenerateEnv({ keys: preview.envFields.filter(f => !envValues[f.key]).map(f => f.key) })
        : await electron.deploySetupImportEnv({ projectPath: project.path, file: envSource })
      if (!res.success) throw new Error(res.error)
      setEnvValues(prev => ({ ...prev, ...res.data }))
    } catch (err) { setError(err.message) } finally { setBusyEnv(false) }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal deploy-setup-modal" role="dialog" aria-label="Deploy Setup" aria-busy={running} onClick={e => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title deploy-setup-title"><Rocket size={16} /> Deploy Setup</div>
          <button className="btn btn-sm" aria-label="Close" disabled={running} onClick={close}><X size={12} /></button>
        </div>
        <div className="deploy-project-summary"><div><span>Project</span><strong>{project.name}</strong></div><code>{project.path}</code></div>
        {loading ? <div className="scanning-indicator"><div className="spinner" /> Analyzing deploy config...</div> : result ? (
          <DeploySetupResult result={result} logs={logs} onCopy={copy} />
        ) : (
          <div className="deploy-setup-layout">
            {error && <div className="deploy-error" role="alert"><AlertCircle size={13} /> {error}</div>}
            {completed.length > 0 && <div className="deploy-warning">Completed before the error: {completed.join('; ')}. Correct the input and retry; existing env values are preserved by default.</div>}
            {preview && <fieldset className="deploy-setup-fields" disabled={running || busyEnv}>
              <div className="deploy-detected-card">{preview.recommendations.map(item => <div key={item}>{item}</div>)}</div>
              <div className="deploy-setup-grid">
                <label className="deploy-field">Server<select className="input" value={serverId} onChange={e => setServerId(e.target.value)} aria-label="Server">
                  <option value="" disabled>Choose server</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({connections[s.id] || 'disconnected'})</option>)}
                </select></label>
                <label className="deploy-field">Deployment profile<select className="input" value={mode} onChange={e => setMode(e.target.value)}>{Object.entries(MODES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              </div>
              {preview.targets.length > 0 && <label className="deploy-field">Workflow / target<select className="input" value={targetId} onChange={e => setTargetId(e.target.value)}>{preview.targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>}
              {mode === 'github-direct' && target?.type !== 'ansible' && <div className="deploy-warning">Select an Ansible deployment target. For build-and-publish workflows, use server pull.</div>}
              {target?.type === 'ansible' && mode === 'github-direct' && <div className="deploy-detected-card">GitHub will run <code>{target.playbook}</code> and deliver the application environment from its vars. DevScanner prepares Docker, Compose, Python, the deploy account and SSH credentials. {target.siblingTargets > 1 && 'This workflow also deploys to other servers; prepare each target before running it.'}</div>}
              <div className="deploy-setup-grid">
                <label className="deploy-field">Deploy user<input className="input" value={deployUser} onChange={e => setDeployUser(e.target.value)} /></label>
                <label className="deploy-field">Remote base<input className="input" value={remoteBase} onChange={e => setRemoteBase(e.target.value)} /></label>
              </div>
              <label className="checkbox-label"><input type="checkbox" checked={sudoAccess} onChange={e => setSudoAccess(e.target.checked)} />Grant passwordless sudo (for playbooks that use become/sudo)</label>
              {<details className="deploy-detected-card"><summary>Use an existing deploy SSH key</summary><p>Leave empty to reuse the securely stored project key or generate one. For a GitHub secret already shared with another server, paste its current private key.</p><textarea className="input deploy-config-editor" aria-label="Existing deploy private key" autoComplete="off" value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></details>}
              {mode === 'private-vpn' && <>
                <div className="deploy-detected-card"><strong>Files installed on the server</strong><div>{preview.composeFile || 'No Compose file detected'} → {remoteBase}/stack/stack.yml</div><div>{preview.autodeployScript || 'Generated Compose updater'} → {remoteBase}/bin/</div><div>Environment → {remoteBase}/env/server.env (permissions 600)</div><div>The updater runs as root. Existing files receive a .devscanner-backup copy.</div></div>
                <div className="deploy-detected-card">
                  <div className="deploy-detected-title">Server environment</div>
                  <p>Fill values here or import a local env. Blank fields may use existing server values, checked before installation. Imported values are sent over SSH and are not saved in app settings.</p>
                  <div className="deploy-env-tools">
                    <select className="input" aria-label="Local env file" value={envSource} onChange={e => setEnvSource(e.target.value)}>{preview.envSources.map(file => <option key={file} value={file}>{file}</option>)}</select>
                    <button className="btn btn-sm" disabled={!envSource} onClick={() => editEnv(false)}>Import env</button>
                    <button className="btn btn-sm" onClick={() => editEnv(true)}>Generate empty app keys</button>
                  </div>
                  <p>Generate app keys only for a new application. Existing database passwords and application keys should be imported or preserved.</p>
                  <label className="checkbox-label"><input type="checkbox" checked={overwriteEnv} onChange={e => setOverwriteEnv(e.target.checked)} />Replace existing server values with non-empty form values</label>
                  <label className="checkbox-label"><input type="checkbox" checked={showSecrets} onChange={e => setShowSecrets(e.target.checked)} />Show sensitive values</label>
                  <div className="deploy-env-list">{preview.envFields.map(field => <label className="deploy-field" key={field.key}><span>{field.key}{field.required ? ' *' : ''}</span><input className="input" type={field.sensitive && !showSecrets ? 'password' : 'text'} autoComplete="off" value={envValues[field.key] || ''} onChange={e => setEnvValues(prev => ({ ...prev, [field.key]: e.target.value }))} placeholder={field.required ? 'Required, or already on server' : 'Optional'} /></label>)}</div>
                </div>
                <label className="checkbox-label"><input type="checkbox" checked={installCron} onChange={e => setInstallCron(e.target.checked)} />Enable automatic updates every minute after env and Compose validation</label>
                <label className="checkbox-label"><input type="checkbox" checked={runNow} onChange={e => setRunNow(e.target.checked)} />Run first deployment now (images and registry credentials must be available)</label>
              </>}
              <label className="checkbox-label"><input type="checkbox" checked={configureNginx} onChange={e => setConfigureNginx(e.target.checked)} />Install nginx configuration{preview.nginxFile ? ' from ' + preview.nginxFile : ''}</label>
              {configureNginx && <div className="deploy-detected-card">
                <label className="deploy-field">Public domain<input className="input" placeholder="app.example.com" value={domain} onChange={e => setDomain(e.target.value)} /></label>
                {preview.nginxFile && <p>The project config is installed with its upstreams, routes and rate limits. The domain replaces your-domain.com. nginx is tested before reload.</p>}
                <details open={!preview.nginxFile}><summary>Custom nginx config (optional override)</summary><textarea className="input deploy-config-editor" aria-label="Nginx config" value={nginxConfig} onChange={e => setNginxConfig(e.target.value)} spellCheck={false} /></details>
                <details><summary>TLS certificate and key</summary><p>Leave empty to use certificates already on the server{preview.certificates.length ? ': ' + preview.certificates.join(', ') : '. Paths come from the nginx config'}. Paste both to install them during setup.</p>
                  <label className="deploy-field">Certificate PEM<textarea className="input" autoComplete="off" value={sslCert} onChange={e => setSslCert(e.target.value)} /></label>
                  <label className="deploy-field">Private key PEM<textarea className="input" autoComplete="off" value={sslKey} onChange={e => setSslKey(e.target.value)} /></label>
                </details>
              </div>}
              <div className="deploy-detected-card"><div className="deploy-detected-title">Secrets for the selected workflow</div><div className="deploy-secret-pills">{target?.secrets.map(name => <span key={name}>{name}</span>)}</div></div>
            </fieldset>}
            {logs.length > 0 && <DeployLog logs={logs} />}
            <div className="modal-actions"><button className="btn" disabled={running} onClick={close}>Cancel</button><button className="btn btn-primary" onClick={handleRun} disabled={running || busyEnv || !preview || !serverId || (mode === 'github-direct' && target?.type !== 'ansible')}>{running ? <><div className="spinner" /> Preparing...</> : <><Key size={12} /> Prepare Server & Secrets</>}</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

function DeploySetupResult({ result, logs, onCopy }) {
  const [showSecrets, setShowSecrets] = useState(false)
  const instructions = ['Project: ' + result.profile.projectName, 'Target: ' + (result.target?.label || result.profile.mode), ...result.nextSteps, '', 'Installed files:', ...(result.assets.files || [])].join('\n\n')
  return <div className="deploy-setup-layout">
    <div className="deploy-title deploy-success"><Check size={16} /> Server preparation complete</div>
    <div className="deploy-detected-card"><div className="deploy-detected-title">Remaining actions<button className="btn btn-sm" onClick={() => onCopy(instructions)}><Copy size={11} /> Copy instructions</button></div><ol>{result.nextSteps.map(step => <li key={step}>{step}</li>)}</ol></div>
    <div className="deploy-detected-card"><div className="deploy-detected-title">Completed by DevScanner</div>{result.completed.map(step => <div key={step}>✓ {step}</div>)}{result.assets.files.map(file => <div key={file}><code>{file}</code></div>)}{result.firstDeploy === 'not-requested' && result.profile.mode === 'private-vpn' && <p>First deployment was not run by this wizard. {result.assets.cronInstalled ? 'Automatic updates are enabled.' : 'Automatic updates are disabled.'}</p>}</div>
    {!result.keySaved && <div className="deploy-warning">The SSH private key was not saved to secure storage. It is reused while the app is open. Copy it before closing the app and supply it on future setups to keep shared GitHub secrets working.</div>}
    {result.secrets.length > 0 && <>
      <div className="deploy-secret-header"><span>GitHub Actions secrets</span><button className="btn btn-sm" onClick={() => onCopy(result.secrets.filter(s => s.value).map(s => s.name + '\n' + s.value).join('\n\n'))}><Copy size={11} /> Copy values</button></div>
      <label className="checkbox-label"><input type="checkbox" checked={showSecrets} onChange={e => setShowSecrets(e.target.checked)} />Show secret values</label>
      <div className="deploy-secret-list">{result.secrets.map(secret => <div className="deploy-secret-row" key={secret.name}><div className="deploy-secret-meta"><strong>{secret.name}</strong><span>{secret.description}</span></div>{secret.value ? <><textarea readOnly aria-label={secret.name} value={showSecrets ? secret.value : '••••••••'} spellCheck={false} /><button className="btn btn-sm" onClick={() => onCopy(secret.value)}><Copy size={11} /> Copy</button></> : <div className="deploy-secret-manual">Fill manually in GitHub</div>}</div>)}</div>
    </>}
    {result.variables.length > 0 && <div className="deploy-detected-card"><div className="deploy-detected-title">GitHub Actions variables</div>{result.variables.map(v => <div key={v.name}><code>{v.name}: {v.value || 'Fill in GitHub'}</code>{v.value && <button className="btn btn-sm" onClick={() => onCopy(v.value)}>Copy</button>}</div>)}</div>}
    {result.serverAccess && <div className="deploy-detected-card"><div className="deploy-detected-title">Server SSH access<button className="btn btn-sm" onClick={() => onCopy(result.serverAccess.privateKey)}><Copy size={11} /> Copy SSH private key</button></div><code>{result.serverAccess.username}@{result.serverAccess.host}:{result.serverAccess.port}</code><p>The public key is installed on the server. The private key is available here for your SSH client.</p></div>}
    {result.publicKey && <div className="deploy-detected-card"><div className="deploy-detected-title">Public key installed for {result.profile.deployUser}</div><code className="deploy-public-key">{result.publicKey}</code></div>}
    <DeployLog logs={logs} />
  </div>
}
function DeployLog({ logs }) { return <div className="deploy-log deploy-setup-log" role="log">{logs.map((line, i) => <div key={i}>{line}</div>)}</div> }
