import React, { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, Key, Rocket, X } from 'lucide-react'
import electron from '../../electronApi'
import CustomSelect from '../CustomSelect'
import DeployAssistantPanel from './DeployAssistantPanel'

const MODES = { 'github-direct': 'GitHub → server', 'private-vpn': 'Server pulls images' }
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
  const [savedState, setSavedState] = useState(null)
  const [restoring, setRestoring] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [logs, setLogs] = useState([])
  const [completed, setCompleted] = useState([])
  const [tab, setTab] = useState('setup')
  const [envFilter, setEnvFilter] = useState('')
  const [checking, setChecking] = useState(false)
  const [preflight, setPreflight] = useState(null)
  const [portOverrides, setPortOverrides] = useState(null)
  const [portsChanged, setPortsChanged] = useState(false)
  const [showTls, setShowTls] = useState(false)
  const [tlsMode, setTlsMode] = useState('existing')
  const [certbotEmail, setCertbotEmail] = useState('')
  const [certbotAgree, setCertbotAgree] = useState(false)
  const [assistantBusy, setAssistantBusy] = useState(false)
  const [assistantProposalId, setAssistantProposalId] = useState(null)
  const target = preview?.targets.find(t => t.id === targetId)
  const disabled = loading || restoring || saving || running || busyEnv || checking || assistantBusy
  const tabs = [{ id: 'setup', label: 'Deployment' }, ...(mode === 'private-vpn' ? [{ id: 'env', label: 'Environment' }] : []), { id: 'advanced', label: 'Advanced' }, { id: 'assistant', label: 'Codex' }]
  const activeTab = tab === 'env' && mode !== 'private-vpn' ? 'setup' : tab
  const close = async () => {
    if (running || checking || assistantBusy || restoring || saving) return
    if (preview && serverId && !result) {
      setSaving(true)
      try {
        const res = await electron.deploySetupSaveDraft(setupPayload())
        if (!res.success) throw new Error(res.error)
      } catch (err) { setError(err.message); setSaving(false); return }
      setSaving(false)
    }
    onClose()
  }

  useEffect(() => { setPreflight(null); setPortsChanged(false) }, [serverId, project.path, mode, targetId, remoteBase, envValues, overwriteEnv, configureNginx, domain, nginxConfig, sslCert, sslKey, tlsMode, certbotEmail, certbotAgree])
  useEffect(() => { setPortOverrides(null); setAssistantProposalId(null) }, [serverId, project.path, mode, targetId])

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
      const saved = data.profiles?.find(profile => servers.some(s => s.id === profile.serverId) && (!profile.targetId || data.targets.some(t => t.id === profile.targetId)))
      if (saved) { setServerId(saved.serverId); setMode(saved.mode); setTargetId(saved.targetId || data.targets[0]?.id || '') }
    }).catch(err => { if (active) { setError(err.message); setRestoring(false) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [project.path])

  useEffect(() => {
    const remove = electron.onDeployLog(data => {
      if (data.serverId === serverId) setLogs(prev => [...prev, data.message])
    })
    return () => { if (typeof remove === 'function') remove() }
  }, [serverId])

  const copy = useCallback(text => navigator.clipboard?.writeText(text || '').catch(() => {}), [])
  const setupPayload = () => ({ serverId, projectPath: project.path, mode, targetId, deployUser, remoteBase, sudoAccess, installCron, runNow, envValues, overwriteEnv, configureNginx, domain, nginxConfig, sslCert, sslKey, privateKey, portOverrides, tlsMode, certbotEmail, certbotAgree, assistantProposalId })
  useEffect(() => {
    if (loading || !preview) return
    if (!serverId) { setRestoring(false); return }
    let active = true
    setRestoring(true)
    setSavedState(null); setResult(null); setError(null); setLogs([]); setCompleted([])
    electron.deploySetupState({ projectPath: project.path, serverId, targetId, mode }).then(res => {
      if (!active) return
      if (!res.success) throw new Error(res.error)
      if (!res.data) return
      const state = res.data, input = state.input || {}
      const setters = { deployUser: setDeployUser, remoteBase: setRemoteBase, sudoAccess: setSudoAccess, installCron: setInstallCron, runNow: setRunNow,
        envValues: setEnvValues, overwriteEnv: setOverwriteEnv, configureNginx: setConfigureNginx, domain: setDomain, nginxConfig: setNginxConfig,
        sslCert: setSslCert, sslKey: setSslKey, privateKey: setPrivateKey, portOverrides: setPortOverrides, tlsMode: setTlsMode,
        certbotEmail: setCertbotEmail, certbotAgree: setCertbotAgree }
      for (const [key, setter] of Object.entries(setters)) if (Object.hasOwn(input, key)) setter(input[key])
      setSavedState(state); setCompleted(state.profile.completed || []); setLogs(state.logs || []); setError(state.profile.error || null)
      if (state.profile.status === 'prepared' && state.result) setResult(state.result)
    }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setRestoring(false) })
    return () => { active = false }
  }, [loading, project.path, serverId, targetId, mode])

  const draft = JSON.stringify(setupPayload())
  useEffect(() => {
    if (disabled || result || !preview || !serverId) return
    let active = true
    const timer = setTimeout(() => {
      electron.deploySetupSaveDraft(JSON.parse(draft)).then(res => { if (active && !res.success) setError(res.error) })
        .catch(err => { if (active) setError(err.message) })
    }, 500)
    return () => { active = false; clearTimeout(timer) }
  }, [draft, disabled, result, preview])
  const handleCheck = async (choices = portOverrides, suppliedPayload = null) => {
    setChecking(true)
    setError(null)
    setCompleted([])
    try {
      const res = await electron.deploySetupCheck({ ...(suppliedPayload || setupPayload()), portOverrides: choices })
      if (!res.success) throw new Error(res.error || 'Server check failed')
      setPreflight(res.data)
      setPortOverrides(res.data.portOverrides || {})
      setPortsChanged(false)
    } catch (err) { setPreflight(null); setError(err.message) } finally { setChecking(false) }
  }
  const applyAssistant = plan => {
    const next = { ...setupPayload(), portOverrides: { ...(plan.portOverrides || {}), ...portOverrides }, assistantProposalId: plan.id }
    for (const change of plan.changes) {
      if (change.field === 'port') next.portOverrides[change.key] = Number(change.value)
      else if (['nginxConfig', 'tlsMode', 'domain', 'remoteBase'].includes(change.field)) next[change.field] = change.value
    }
    if (next.nginxConfig !== nginxConfig || next.tlsMode !== tlsMode) next.configureNginx = true
    setPortOverrides(next.portOverrides); setNginxConfig(next.nginxConfig); setTlsMode(next.tlsMode)
    setDomain(next.domain); setRemoteBase(next.remoteBase); setConfigureNginx(next.configureNginx)
    setAssistantProposalId(plan.id); setTab('setup')
    handleCheck(next.portOverrides, next)
  }
  const tlsChoice = <>
    <div className="form-group">
      <label className="form-label" htmlFor="deploy-tls-mode">TLS certificate</label>
      <CustomSelect id="deploy-tls-mode" value={tlsMode} onChange={setTlsMode} disabled={disabled} options={[
        { value: 'none', label: 'No certificate — HTTP only' },
        { value: 'existing', label: 'Use existing server certificate' },
        { value: 'manual', label: 'Install certificate manually (PEM)' },
        { value: 'certbot', label: 'Let’s Encrypt — automatic renewal' }
      ]} />
    </div>
    {tlsMode === 'none' && <p className="deploy-help">Deploy over HTTP now and install a certificate later. Removes HTTPS redirects and TLS settings from the server config. For a single site, public URLs and CORS use the domain entered above, or the server address when empty.</p>}
    {tlsMode === 'certbot' && <>
      <div className="form-group"><label className="form-label" htmlFor="deploy-certbot-email">Let’s Encrypt account email</label><input id="deploy-certbot-email" className="form-input" type="email" value={certbotEmail} onChange={e => setCertbotEmail(e.target.value)} placeholder="admin@example.com" /></div>
      <label className="checkbox-label"><input type="checkbox" checked={certbotAgree} onChange={e => setCertbotAgree(e.target.checked)} />I accept the Let’s Encrypt subscriber agreement</label>
      <button className="btn btn-sm" onClick={() => electron.openBrowser('https://letsencrypt.org/repository/')}>Read subscriber agreement</button>
      <p className="deploy-help">Installs Certbot, issues the certificate, enables automatic renewal and tests it. Public A/AAAA DNS and port 80 must reach this server. For VPN-only domains, use a manual certificate.</p>
    </>}
  </>
  const handleRun = async () => {
    setRunning(true)
    setError(null)
    setLogs([])
    setCompleted([])
    try {
      const res = await electron.deploySetupRun(setupPayload())
      if (!res.success) {
        setCompleted(res.completed || [])
        if (res.state) setSavedState(res.state)
        if (res.preflight) { setPreflight(res.preflight); setPortOverrides(res.preflight.portOverrides || {}); setPortsChanged(false); setTab('setup') }
        throw new Error(res.error || 'Setup failed')
      }
      setResult(res.data)
      setSavedState({ profile: res.data.profile, result: res.data })
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
      <div className="modal deploy-setup-modal" role="dialog" aria-modal="true" aria-label="Deploy Setup" aria-busy={running || checking || assistantBusy} onClick={e => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title deploy-setup-title"><Rocket size={16} /> Deploy Setup</div>
          <button className="btn btn-sm" aria-label="Close" disabled={running || checking || assistantBusy || restoring || saving} onClick={close}><X size={12} /></button>
        </div>
        <div className="deploy-project-summary">
          <strong>{project.name}</strong>
          <span title={project.path}>{project.relativePath || project.path}</span>
        </div>

        {!loading && !result && preview && (
          <div className="modal-tab-toggle deploy-setup-tabs" role="tablist" aria-label="Deployment settings">
            {tabs.map((item, index) => (
              <button
                key={item.id}
                id={`deploy-tab-${item.id}`}
                className={`modal-tab-btn${activeTab === item.id ? ' active' : ''}`}
                role="tab"
                aria-selected={activeTab === item.id}
                aria-controls={`deploy-panel-${item.id}`}
                tabIndex={activeTab === item.id ? 0 : -1}
                disabled={disabled}
                onClick={() => setTab(item.id)}
                onKeyDown={e => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
                  e.preventDefault()
                  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
                    : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                  setTab(tabs[next].id)
                  e.currentTarget.parentElement.children[next].focus()
                }}
              >{item.label}</button>
            ))}
          </div>
        )}

        <div className="deploy-setup-layout">
          {loading ? <div className="scanning-indicator"><div className="spinner" /> Analyzing deploy config...</div> : result ? (
            <DeploySetupResult result={result} logs={logs} onCopy={copy} />
          ) : <>
            {error && <div className="deploy-error" role="alert"><AlertCircle size={13} /><span>{error}</span></div>}
            {restoring && <p className="deploy-help">Loading saved deployment...</p>}
            {savedState?.profile.status && savedState.profile.status !== 'draft' && <div className="deploy-help">
              <strong>{savedState.profile.status === 'prepared' ? 'Server prepared' : 'Preparation incomplete'}</strong>
              {' · '}{new Date(savedState.profile.updatedAt).toLocaleString()}
              {' · '}{savedState.profile.automation === 'enabled' ? 'Automatic image updates enabled' : savedState.profile.mode === 'github-direct' ? 'GitHub workflow still needs to be configured and run' : savedState.profile.automation === 'disabled' ? 'Automatic image updates not enabled' : 'Automatic image updates not checked'}
            </div>}
            {savedState?.result && <details className="deploy-details" open={savedState.profile.status === 'failed'}>
              <summary>Saved credentials and completed steps</summary>
              <div className="deploy-details-body"><DeploySetupResult result={savedState.result} logs={[]} onCopy={copy} /></div>
            </details>}
            {error && preview && activeTab !== 'assistant' && <button className="btn btn-sm" disabled={disabled} onClick={() => setTab('assistant')}>Ask Codex</button>}
            {completed.length > 0 && <p className="deploy-warning">Completed before the error: {completed.join('; ')}. Correct the input and retry; existing env values are preserved by default.</p>}
            {preview && (
              <fieldset className="deploy-setup-fields" disabled={disabled && activeTab !== 'assistant'}>
                <div role="tabpanel" id={`deploy-panel-${activeTab}`} aria-labelledby={`deploy-tab-${activeTab}`}>
                  {activeTab === 'setup' && <>
                    <div className="deploy-setup-grid">
                      <div className="form-group">
                        <label className="form-label" htmlFor="deploy-server">Server</label>
                        <CustomSelect id="deploy-server" value={serverId} onChange={setServerId} disabled={disabled || !servers.length}
                          placeholder="Choose server" options={servers.map(s => ({ value: s.id, label: s.name }))} />
                        {serverId && <p className="deploy-help">{connections[serverId] === 'connected' ? 'Connected via SSH' : 'Connects using saved SSH credentials'}</p>}
                        {!servers.length && <p className="form-error">Add an SSH server in Servers to continue.</p>}
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="deploy-profile">Deployment profile</label>
                        <CustomSelect id="deploy-profile" value={mode} onChange={setMode} disabled={disabled}
                          options={Object.entries(MODES).map(([value, label]) => ({ value, label }))} />
                        <p className="deploy-help">{mode === 'github-direct' ? 'SSH / Ansible from GitHub Actions' : 'Image updates over a VPN or private network'}</p>
                      </div>
                    </div>
                    {preview.targets.length > 0 && <div className="form-group">
                      <label className="form-label" htmlFor="deploy-target">Workflow / target</label>
                      <CustomSelect id="deploy-target" value={targetId} onChange={setTargetId} disabled={disabled}
                        options={preview.targets.map(t => ({ value: t.id, label: t.label }))} />
                    </div>}
                    {mode === 'github-direct' && target?.type !== 'ansible' && <p className="deploy-warning">Select an Ansible deployment target. For build-and-publish workflows, use server pull.</p>}
                    {target?.type === 'ansible' && mode === 'github-direct' && <p className="deploy-help">
                      DevScanner prepares the server and SSH access. GitHub deploys the application with <code>{target.playbook}</code>.
                      {target.siblingTargets > 1 && ' Prepare the other servers in this workflow before running it.'}
                    </p>}
                    {configureNginx && <div className="form-group">
                      <label className="form-label" htmlFor="deploy-domain">{tlsMode === 'none' ? 'Domain or server IP (optional)' : 'Public domain'}</label>
                      <input id="deploy-domain" className="form-input" placeholder={tlsMode === 'none' ? servers.find(s => s.id === serverId)?.host || 'Use server address' : 'app.example.com'} value={domain} onChange={e => setDomain(e.target.value)} />
                    </div>}
                    {configureNginx && tlsChoice}
                    {configureNginx && tlsMode === 'manual' && <button className="btn btn-sm" onClick={() => { setShowTls(true); setTab('advanced') }}>Enter certificate and key</button>}
                    {mode === 'private-vpn' && <div className="deploy-option-list">
                      <label className="checkbox-label"><input type="checkbox" checked={installCron} onChange={e => setInstallCron(e.target.checked)} />Enable automatic image updates</label>
                      <p className="deploy-help">Runs every minute after environment and Compose validation.</p>
                      <label className="checkbox-label"><input type="checkbox" checked={runNow} onChange={e => setRunNow(e.target.checked)} />Run first deployment now</label>
                      <p className="deploy-help">Requires published images and registry credentials on the server.</p>
                    </div>}
                    <section className="deploy-preflight" aria-label="Server checks">
                      <div className="deploy-section-heading">
                        <h3 className="deploy-section-title">Ports and TLS</h3>
                        <button className="btn btn-sm" disabled={disabled || !serverId} onClick={() => handleCheck()}>{checking ? 'Checking…' : preflight ? 'Check again' : 'Check server'}</button>
                      </div>
                      {!preflight && <p className="deploy-help">Checks host ports and certificate files without changing the server. Prepare server repeats these checks.</p>}
                      {preflight && <>
                        <p className={preflight.blocked || portsChanged ? 'deploy-help' : 'deploy-success'}>{portsChanged ? 'Port choices changed — check again before preparing.' : preflight.blocked ? 'Resolve the conflicts below before preparing.' : 'No port or TLS conflicts found.'}</p>
                        {preflight.ports.map(port => <div className="deploy-port-row" key={port.id}>
                          <div>
                            <label className="form-label" htmlFor={`deploy-port-${port.id}`}>{port.service}{port.target ? ` → container ${port.target}/${port.protocol}` : ` · ${port.protocol}`}</label>
                            <p className="deploy-help">{port.address}{port.conflicts.length ? ' · Used by ' + port.conflicts.join(', ') : ' · Available'}{port.suggestedPort ? ' · Suggested: ' + port.suggestedPort : ''}</p>
                          </div>
                          {port.editable ? <input id={`deploy-port-${port.id}`} className="form-input" type="number" min="1" max="65535" aria-label={`${port.service} host port`}
                            value={portOverrides?.[port.id] ?? port.port} onChange={e => { setPortOverrides(prev => ({ ...prev, [port.id]: e.target.value })); setPortsChanged(true) }} /> : <code>{port.port}</code>}
                        </div>)}
                        {preflight.ports.some(p => p.suggestedPort) && <button className="btn btn-sm" onClick={() => {
                          const choices = { ...portOverrides }
                          for (const port of preflight.ports) if (port.suggestedPort) choices[port.id] = port.suggestedPort
                          setPortOverrides(choices)
                          handleCheck(choices)
                        }}>Use suggested ports</button>}
                        {preflight.ports.some(p => p.editable) && <p className="deploy-help">Only host ports change. Matching nginx upstreams and updater health checks follow automatically.</p>}
                        {preflight.issues.map(issue => <p className="deploy-warning" key={issue}>{issue}</p>)}
                        {preflight.tlsIssues?.map(issue => <p className="deploy-warning" key={issue}>{issue}</p>)}
                        {preflight.tlsNotice && <p className="deploy-help">{preflight.tlsNotice}</p>}
                        {!!preflight.tlsIssues?.length && <button className="btn btn-sm" onClick={() => { setShowTls(true); setTab('advanced') }}>Configure TLS</button>}
                        {!!preflight.missingEnv?.length && <p className="deploy-help">Still required in Environment: {preflight.missingEnv.join(', ')}.</p>}
                      </>}
                    </section>
                    <details className="deploy-details">
                      <summary>Deployment details</summary>
                      <div className="deploy-details-body">
                        {preview.recommendations.map(item => <p className="deploy-help" key={item}>{item}</p>)}
                        {mode === 'private-vpn' && <>
                          <p className="deploy-section-title">Files installed on the server</p>
                          <ul className="deploy-file-list">
                            <li>{preview.composeFile || 'No Compose file detected'} → <code>{remoteBase}/stack/stack.yml</code></li>
                            <li>{preview.autodeployScript || 'Generated Compose updater'} → <code>{remoteBase}/bin/</code></li>
                            <li>Environment → <code>{remoteBase}/env/server.env</code></li>
                          </ul>
                          <p className="deploy-help">The updater runs as root. Environment permissions are 600; replaced files receive a .devscanner-backup copy.</p>
                        </>}
                        {!!target?.secrets.length && <>
                          <p className="deploy-section-title">Secrets for the selected workflow</p>
                          <ul className="deploy-file-list">{target.secrets.map(name => <li key={name}><code>{name}</code></li>)}</ul>
                        </>}
                      </div>
                    </details>
                  </>}

                  {activeTab === 'assistant' && <DeployAssistantPanel payload={{ ...setupPayload(), error }} onBusyChange={setAssistantBusy} onApply={applyAssistant} />}

                  {activeTab === 'env' && <>
                    <p className="deploy-section-title">Server environment</p>
                    <p className="deploy-help">Import existing values or fill them below. Blank fields keep existing server values. Values are sent over SSH and are not saved in app settings.</p>
                    <div className="deploy-env-tools">
                      <div className="form-group">
                        <label className="form-label" htmlFor="deploy-env-source">Local env file</label>
                        <CustomSelect id="deploy-env-source" value={envSource} onChange={setEnvSource} disabled={disabled || !preview.envSources.length}
                          placeholder="No local env files" options={preview.envSources.map(file => ({ value: file, label: file }))} />
                      </div>
                      <button className="btn btn-sm" disabled={!envSource} onClick={() => editEnv(false)}>Import env</button>
                      <button className="btn btn-sm" onClick={() => editEnv(true)}>Generate empty app keys</button>
                    </div>
                    <p className="deploy-help">Generate keys only for a new application. Import or preserve existing passwords and application keys.</p>
                    <div className="deploy-option-list">
                      <label className="checkbox-label"><input type="checkbox" checked={overwriteEnv} onChange={e => setOverwriteEnv(e.target.checked)} />Replace existing server values with non-empty form values</label>
                      <label className="checkbox-label"><input type="checkbox" checked={showSecrets} onChange={e => setShowSecrets(e.target.checked)} />Show sensitive values</label>
                    </div>
                    {preview.envFields.length > 8 && <div className="form-group">
                      <label className="form-label" htmlFor="deploy-env-filter">Filter variables</label>
                      <input id="deploy-env-filter" className="form-input" value={envFilter} onChange={e => setEnvFilter(e.target.value)} placeholder="Search by name..." />
                    </div>}
                    <div className="deploy-env-list">
                      {preview.envFields.filter(field => field.key.toLowerCase().includes(envFilter.trim().toLowerCase())).map(field => (
                        <div className="form-group" key={field.key}>
                          <label className="form-label" htmlFor={`deploy-env-${field.key}`}>{field.key}{field.required ? ' *' : ''}</label>
                          <input id={`deploy-env-${field.key}`} className="form-input" type={field.sensitive && !showSecrets ? 'password' : 'text'} autoComplete="off"
                            value={envValues[field.key] || ''} onChange={e => setEnvValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                            placeholder={field.required ? 'Required, or already on server' : 'Optional'} />
                          {field.key === 'GHCR_TOKEN' && <p className="deploy-help">Use a GitHub personal access token (classic) with read:packages and access to these images. Provider tokens are not generated by the app.</p>}
                        </div>
                      ))}
                    </div>
                    {envFilter.trim() && !preview.envFields.some(field => field.key.toLowerCase().includes(envFilter.trim().toLowerCase())) && <p className="deploy-help">No matching variables.</p>}
                  </>}

                  {activeTab === 'advanced' && <>
                    <div className="deploy-setup-grid">
                      <div className="form-group">
                        <label className="form-label" htmlFor="deploy-user">Deploy user</label>
                        <input id="deploy-user" className="form-input" value={deployUser} onChange={e => setDeployUser(e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="deploy-base">Remote base</label>
                        <input id="deploy-base" className="form-input" value={remoteBase} onChange={e => { setRemoteBase(e.target.value); setPortOverrides(null) }} />
                      </div>
                    </div>
                    <div className="deploy-option-list">
                      <label className="checkbox-label"><input type="checkbox" checked={sudoAccess} onChange={e => setSudoAccess(e.target.checked)} />Grant passwordless sudo</label>
                      <p className="deploy-help">For playbooks that use become or sudo.</p>
                      <label className="checkbox-label"><input type="checkbox" checked={configureNginx} onChange={e => setConfigureNginx(e.target.checked)} />Install nginx configuration</label>
                      {preview.nginxFile && <p className="deploy-help">Detected: <code>{preview.nginxFile}</code></p>}
                    </div>
                    {configureNginx && <>
                      <div className="form-group">
                        <label className="form-label" htmlFor="deploy-advanced-domain">{tlsMode === 'none' ? 'Domain or server IP (optional)' : 'Public domain'}</label>
                        <input id="deploy-advanced-domain" className="form-input" placeholder="app.example.com" value={domain} onChange={e => setDomain(e.target.value)} />
                      </div>
                      <details className="deploy-details" open={!preview.nginxFile}>
                        <summary>Custom nginx config</summary>
                        <div className="deploy-details-body">
                          <p className="deploy-help">{preview.nginxFile ? 'Leave empty to use the project config with its upstreams, routes and rate limits. The domain replaces your-domain.com.' : 'Set upstreams and routes for this application.'} nginx is tested before reload.</p>
                          <textarea className="form-input deploy-config-editor" aria-label="Nginx config" value={nginxConfig} onChange={e => setNginxConfig(e.target.value)} spellCheck={false} />
                        </div>
                      </details>
                      <details className="deploy-details" open={showTls} onToggle={e => setShowTls(e.currentTarget.open)}>
                        <summary>TLS certificate and key</summary>
                        <div className="deploy-details-body">
                          {tlsChoice}
                          {['existing', 'manual'].includes(tlsMode) && <>
                          <p className="deploy-help">Leave empty to use certificates already on the server{preview.certificates.length ? ': ' + preview.certificates.join(', ') : '. Paths come from the nginx config'}. Paste both to install them.</p>
                          <div className="form-group">
                            <label className="form-label" htmlFor="deploy-cert">Certificate PEM</label>
                            <textarea id="deploy-cert" className="form-input deploy-config-editor" autoComplete="off" value={sslCert} onChange={e => setSslCert(e.target.value)} />
                          </div>
                          <div className="form-group">
                            <label className="form-label" htmlFor="deploy-cert-key">Private key PEM</label>
                            <textarea id="deploy-cert-key" className="form-input deploy-config-editor" autoComplete="off" value={sslKey} onChange={e => setSslKey(e.target.value)} />
                          </div>
                          </>}
                        </div>
                      </details>
                    </>}
                    <details className="deploy-details">
                      <summary>Use an existing deploy SSH key</summary>
                      <div className="deploy-details-body">
                        <p className="deploy-help">Leave empty to reuse the saved project key or generate one. If a GitHub secret is shared with another server, paste its current private key.</p>
                        <textarea className="form-input deploy-config-editor" aria-label="Existing deploy private key" autoComplete="off" value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                      </div>
                    </details>
                  </>}
                </div>
              </fieldset>
            )}
            {logs.length > 0 && <DeployLog logs={logs} expanded />}
          </>}
        </div>

        <div className="modal-actions deploy-setup-footer">
          {preview && !result && <span className="deploy-destination" title={`${deployUser} · ${remoteBase}`}>{deployUser} · {remoteBase}</span>}
          <button className="btn" disabled={running || checking || assistantBusy || restoring || saving} onClick={close}>{saving ? 'Saving...' : result ? 'Done' : 'Close'}</button>
          {result && <button className="btn" onClick={() => setResult(null)}>Edit setup</button>}
          {!result && <button className="btn btn-primary" onClick={handleRun} disabled={disabled || !preview || !serverId || (mode === 'github-direct' && target?.type !== 'ansible')}>
            {running ? <><div className="spinner" /> Preparing...</> : <><Key size={12} /> Prepare server</>}
          </button>}
        </div>
      </div>
    </div>
  )
}

function DeploySetupResult({ result, logs, onCopy }) {
  const [showSecrets, setShowSecrets] = useState(false)
  const instructions = ['Project: ' + result.profile.projectName, 'Target: ' + (result.target?.label || result.profile.mode), ...result.nextSteps, '', 'Installed files:', ...(result.assets.files || [])].join('\n\n')
  return <>
    <div className={'deploy-title ' + (result.profile.status && result.profile.status !== 'prepared' ? '' : 'deploy-success')}>
      {result.profile.status && result.profile.status !== 'prepared' ? <AlertCircle size={16} /> : <Check size={16} />}
      {result.profile.status && result.profile.status !== 'prepared' ? 'Saved preparation progress' : 'Server preparation complete'}
    </div>
    <p className="deploy-help">{result.profile.projectName} · {result.serverAccess?.host || result.profile.serverId} · {result.profile.remoteBase}</p>
    <section className="deploy-result-section">
      <div className="deploy-section-heading">
        <h3 className="deploy-section-title">Remaining actions</h3>
        <button className="btn btn-sm" onClick={() => onCopy(instructions)}><Copy size={11} /> Copy instructions</button>
      </div>
      <ol className="deploy-next-steps">{result.nextSteps.map(step => <li key={step}>{step}</li>)}</ol>
      {result.firstDeploy === 'not-requested' && result.profile.mode === 'private-vpn' && <p className="deploy-help">First deployment was not run by this wizard. {result.assets.cronInstalled ? 'Automatic updates are enabled.' : 'Automatic updates are disabled.'}</p>}
    </section>
    {result.keySaved && <p className="deploy-help">Credentials are saved on this device and remain available after closing this window or restarting DevScanner.</p>}
    {result.secrets.length > 0 && <section className="deploy-result-section">
      <div className="deploy-section-heading">
        <h3 className="deploy-section-title">GitHub Actions secrets</h3>
        <button className="btn btn-sm" onClick={() => onCopy(result.secrets.filter(s => s.value).map(s => s.name + '\n' + s.value).join('\n\n'))}><Copy size={11} /> Copy values</button>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={showSecrets} onChange={e => setShowSecrets(e.target.checked)} />Show secret values</label>
      <div className="deploy-secret-list">{result.secrets.map(secret => (
        <div className="deploy-secret-row" key={secret.name}>
          <div className="deploy-secret-meta"><strong>{secret.name}</strong><span>{secret.description}</span></div>
          {secret.value ? <>
            <textarea className="form-input" readOnly aria-label={secret.name} value={showSecrets ? secret.value : '••••••••'} spellCheck={false} />
            <button className="btn btn-sm" aria-label={`Copy ${secret.name}`} onClick={() => onCopy(secret.value)}><Copy size={11} /></button>
          </> : <div className="deploy-secret-manual">Fill manually in GitHub</div>}
        </div>
      ))}</div>
    </section>}
    {result.variables.length > 0 && <section className="deploy-result-section">
      <h3 className="deploy-section-title">GitHub Actions variables</h3>
      {result.variables.map(v => <div className="deploy-section-heading" key={v.name}>
        <code>{v.name}: {v.value || 'Fill in GitHub'}</code>
        {v.value && <button className="btn btn-sm" onClick={() => onCopy(v.value)}>Copy</button>}
      </div>)}
    </section>}
    {result.serverAccess && <section className="deploy-result-section">
      <div className="deploy-section-heading">
        <h3 className="deploy-section-title">Server SSH access</h3>
        <button className="btn btn-sm" onClick={() => onCopy(result.serverAccess.privateKey)}><Copy size={11} /> Copy SSH private key</button>
      </div>
      <code>{result.serverAccess.username}@{result.serverAccess.host}:{result.serverAccess.port}</code>
      <p className="deploy-help">The public key is installed. Use this private key with your SSH client.</p>
    </section>}
    <details className="deploy-details">
      <summary>Completed steps and installed files</summary>
      <div className="deploy-details-body">
        <ul className="deploy-file-list">{result.completed.map(step => <li key={step}>{step}</li>)}</ul>
        <ul className="deploy-file-list">{result.assets.files.map(file => <li key={file}><code>{file}</code></li>)}</ul>
        {result.publicKey && <>
          <p className="deploy-help">Public key installed for {result.profile.deployUser}</p>
          <code className="deploy-public-key">{result.publicKey}</code>
        </>}
      </div>
    </details>
    {logs.length > 0 && <DeployLog logs={logs} />}
  </>
}

function DeployLog({ logs, expanded = false }) {
  return <details className="deploy-details" open={expanded}>
    <summary>Setup log</summary>
    <div className="deploy-log deploy-setup-log" role="log">{logs.map((line, i) => <div key={i}>{line}</div>)}</div>
  </details>
}
