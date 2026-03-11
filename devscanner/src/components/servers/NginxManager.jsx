import React, { useState, useCallback, useEffect } from 'react'
import { Plus, Save, Check, X, Shield, RefreshCw, Trash2, ToggleLeft, ToggleRight, Loader, FileText, AlertTriangle, Wifi } from 'lucide-react'
import CustomSelect from '../CustomSelect'
import electron from '../../electronApi'

export default function NginxManager({ serverId }) {
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSite, setSelectedSite] = useState(null)
  const [siteContent, setSiteContent] = useState({ raw: '', parsed: null })
  const [editMode, setEditMode] = useState('visual') // 'visual' | 'raw'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [testResult, setTestResult] = useState(null) // { ok, output }
  const [creating, setCreating] = useState(false)
  const [newSiteName, setNewSiteName] = useState('')
  const [newSiteTemplate, setNewSiteTemplate] = useState('static')
  const [actionLoading, setActionLoading] = useState(null) // 'test' | 'reload' | 'certbot' | 'enable' | 'disable' | 'install'
  const [nginxInstalled, setNginxInstalled] = useState(true)

  // Listening ports state
  const [listeningPorts, setListeningPorts] = useState([])
  const [portsLoading, setPortsLoading] = useState(false)

  // Visual editor state
  const [visualConfig, setVisualConfig] = useState({
    serverName: '',
    listen: '80',
    root: '',
    proxyPass: '',
    type: 'static' // 'static' | 'proxy' | 'redirect'
  })

  const loadPorts = useCallback(async () => {
    setPortsLoading(true)
    const result = await electron.sshListeningPorts({ serverId })
    if (result.success) {
      setListeningPorts(result.data)
    }
    setPortsLoading(false)
  }, [serverId])

  const loadSites = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await electron.sshNginxList({ serverId })
    if (result.success) {
      setSites(result.data)
      setNginxInstalled(true)
    } else {
      if (result.error === 'nginx_not_installed') {
        setNginxInstalled(false)
      } else {
        setError(result.error)
      }
    }
    setLoading(false)
  }, [serverId])

  useEffect(() => { loadSites() }, [loadSites])

  // Load ports when nginx is installed
  useEffect(() => {
    if (nginxInstalled && !loading) loadPorts()
  }, [nginxInstalled, loading, loadPorts])

  // Re-read site from server and update both raw + visual
  const refreshSite = useCallback(async (siteName) => {
    const result = await electron.sshNginxRead({ serverId, siteName })
    if (result.success) {
      setSiteContent(result.data)
      const p = result.data.parsed
      const hasProxy = p.locations?.some(l => l.directives?.proxy_pass)
      setVisualConfig({
        serverName: p.serverName || '',
        listen: p.listen || '80',
        root: p.root || '',
        proxyPass: p.locations?.find(l => l.directives?.proxy_pass)?.directives?.proxy_pass || '',
        type: hasProxy ? 'proxy' : p.root ? 'static' : 'redirect'
      })
    }
  }, [serverId])

  const handleSelectSite = useCallback(async (siteName) => {
    setSelectedSite(siteName)
    setTestResult(null)
    setError(null)
    await refreshSite(siteName)
  }, [refreshSite])

  const generateFromVisual = useCallback(() => {
    const lines = ['server {']
    lines.push(`    listen ${visualConfig.listen};`)
    lines.push(`    server_name ${visualConfig.serverName || '_'};`)
    lines.push('')

    if (visualConfig.type === 'static') {
      lines.push(`    root ${visualConfig.root || '/var/www/html'};`)
      lines.push('    index index.html index.htm;')
      lines.push('')
      lines.push('    location / {')
      lines.push('        try_files $uri $uri/ /index.html;')
      lines.push('    }')
    } else if (visualConfig.type === 'proxy') {
      lines.push('    location / {')
      lines.push(`        proxy_pass ${visualConfig.proxyPass || 'http://localhost:3000'};`)
      lines.push('        proxy_http_version 1.1;')
      lines.push("        proxy_set_header Upgrade $http_upgrade;")
      lines.push("        proxy_set_header Connection 'upgrade';")
      lines.push('        proxy_set_header Host $host;')
      lines.push('        proxy_cache_bypass $http_upgrade;')
      lines.push('    }')
    } else {
      lines.push('    location / {')
      lines.push('        return 301 https://$host$request_uri;')
      lines.push('    }')
    }

    lines.push('}')
    return lines.join('\n')
  }, [visualConfig])

  const handleSave = useCallback(async () => {
    if (!selectedSite) return
    setSaving(true)
    const content = editMode === 'raw' ? siteContent.raw : generateFromVisual()
    const result = await electron.sshNginxSave({ serverId, siteName: selectedSite, content })
    if (result.success) {
      // Re-read from server to sync both raw and visual
      await refreshSite(selectedSite)
      setTestResult(null)
    } else {
      setError(result.error)
    }
    setSaving(false)
  }, [serverId, selectedSite, editMode, siteContent.raw, generateFromVisual, refreshSite])

  const handleToggleEnable = useCallback(async (siteName, currentlyEnabled) => {
    setActionLoading(currentlyEnabled ? 'disable' : 'enable')
    const fn = currentlyEnabled ? electron.sshNginxDisable : electron.sshNginxEnable
    await fn({ serverId, siteName })
    await loadSites()
    setActionLoading(null)
  }, [serverId, loadSites])

  const handleTest = useCallback(async () => {
    setActionLoading('test')
    const result = await electron.sshNginxTest({ serverId })
    if (result.success) setTestResult(result.data)
    setActionLoading(null)
  }, [serverId])

  const handleReload = useCallback(async () => {
    setActionLoading('reload')
    setError(null)
    // Test first, then reload
    const testRes = await electron.sshNginxTest({ serverId })
    if (testRes.success) {
      setTestResult(testRes.data)
      if (testRes.data.ok) {
        const reloadRes = await electron.sshNginxReload({ serverId })
        if (reloadRes.success) {
          setTestResult({ ok: true, output: (testRes.data.output || '') + '\n✓ nginx reloaded' })
        } else {
          setTestResult({ ok: false, output: (testRes.data.output || '') + '\n✗ reload failed: ' + (reloadRes.error || '') })
        }
      }
    } else {
      setError(testRes.error)
    }
    // Refresh current site to sync visual
    if (selectedSite) await refreshSite(selectedSite)
    setActionLoading(null)
  }, [serverId, selectedSite, refreshSite])

  const handleCertbot = useCallback(async (domain) => {
    if (!domain) return
    setActionLoading('certbot')
    setError(null)
    setTestResult(null)

    let result = await electron.sshCertbotRun({ serverId, domain })

    // Auto-install certbot if not found
    if (!result.success && result.error === 'certbot_not_installed') {
      setTestResult({ ok: false, output: 'Certbot not installed. Installing...' })
      const installRes = await electron.sshCertbotInstall({ serverId })
      if (!installRes.success) {
        setTestResult({ ok: false, output: 'Failed to install certbot: ' + (installRes.error || '') })
        setActionLoading(null)
        return
      }
      setTestResult({ ok: true, output: 'Certbot installed. Running SSL setup...' })
      result = await electron.sshCertbotRun({ serverId, domain })
    }

    if (!result.success) {
      setTestResult({ ok: false, output: 'SSL failed: ' + (result.error || 'Unknown error') })
    } else {
      setTestResult({ ok: true, output: result.data?.output || 'SSL certificate installed successfully' })
      await loadSites()
      if (selectedSite) await refreshSite(selectedSite)
    }
    setActionLoading(null)
  }, [serverId, selectedSite, loadSites, refreshSite])

  const handleCreate = useCallback(async () => {
    if (!newSiteName.trim()) return
    const safeName = newSiteName.trim().replace(/[^a-zA-Z0-9._-]/g, '')
    if (!safeName) return
    setCreating(true)

    // Generate template content
    let content
    if (newSiteTemplate === 'proxy') {
      content = generateProxyTemplate(safeName)
    } else if (newSiteTemplate === 'redirect') {
      content = generateRedirectTemplate(safeName)
    } else {
      content = generateStaticTemplate(safeName)
    }

    const result = await electron.sshNginxSave({ serverId, siteName: safeName, content })
    if (result.success) {
      setNewSiteName('')
      await loadSites()
      handleSelectSite(safeName)
    } else {
      setError(result.error)
    }
    setCreating(false)
  }, [serverId, newSiteName, newSiteTemplate, loadSites, handleSelectSite])

  const handleDelete = useCallback(async (siteName) => {
    setActionLoading('delete')
    const result = await electron.sshNginxDelete({ serverId, siteName })
    if (!result.success) setError(result.error)
    await loadSites()
    if (selectedSite === siteName) setSelectedSite(null)
    setActionLoading(null)
  }, [serverId, selectedSite, loadSites])

  const handleInstall = useCallback(async () => {
    setActionLoading('install')
    const result = await electron.sshNginxInstall({ serverId })
    if (result.success) {
      setNginxInstalled(true)
      await loadSites()
    } else {
      setError(result.error || 'Installation failed')
    }
    setActionLoading(null)
  }, [serverId, loadSites])

  if (loading) {
    return <div className="scanning-indicator"><div className="spinner" /> Loading nginx sites...</div>
  }

  if (!nginxInstalled) {
    return (
      <div className="empty-state">
        <AlertTriangle size={48} className="empty-state-icon" />
        <div className="empty-state-text">Nginx is not installed on this server</div>
        <button className="btn btn-primary" onClick={handleInstall} disabled={actionLoading === 'install'}>
          {actionLoading === 'install' ? <><Loader size={12} className="spin" /> Installing...</> : 'Install nginx'}
        </button>
      </div>
    )
  }

  if (error && sites.length === 0) {
    return (
      <div className="empty-state">
        <AlertTriangle size={48} className="empty-state-icon" />
        <div className="empty-state-text">Nginx error: {error}</div>
        <button className="btn btn-primary" onClick={loadSites}>
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    )
  }

  // Filter ports for the port picker (exclude nginx's own ports)
  const availablePorts = listeningPorts.filter(p =>
    p.processName && p.processName !== 'nginx' && p.port !== 80 && p.port !== 443
  )

  return (
    <div className="main" style={{ display: 'flex', gap: '1rem', height: '100%' }}>
      {/* Site list */}
      <div style={{ width: '220px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>Sites</span>
          <button className="btn btn-sm" onClick={loadSites}><RefreshCw size={10} /></button>
        </div>

        {sites.map(site => (
          <div
            key={site.name}
            className={`project-card${selectedSite === site.name ? ' running' : ''}`}
            style={{ padding: '0.5rem', marginBottom: '0.25rem', cursor: 'pointer' }}
            onClick={() => handleSelectSite(site.name)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>{site.name}</span>
              <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                <button
                  className="btn-icon"
                  title={site.enabled ? 'Disable' : 'Enable'}
                  onClick={(e) => { e.stopPropagation(); handleToggleEnable(site.name, site.enabled) }}
                >
                  {site.enabled ? <ToggleRight size={14} style={{ color: 'var(--color-success)' }} /> : <ToggleLeft size={14} />}
                </button>
              </div>
            </div>
            {site.enabled && <span className="tag" style={{ fontSize: '0.6rem', marginTop: '0.25rem' }}>enabled</span>}
          </div>
        ))}

        {/* Create new */}
        <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}>
          <label style={{ fontSize: '0.65rem', color: 'var(--color-text-dim)', marginBottom: '0.15rem', display: 'block' }}>Site name</label>
          <input
            style={{
              width: '100%', marginBottom: '0.25rem', fontSize: '0.72rem', padding: '0.3rem 0.5rem',
              background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)', fontFamily: 'var(--font-mono)', outline: 'none', boxSizing: 'border-box'
            }}
            value={newSiteName}
            onChange={e => setNewSiteName(e.target.value)}
            placeholder="new-site-name"
          />
          <CustomSelect
            value={newSiteTemplate}
            onChange={setNewSiteTemplate}
            style={{ width: '100%', marginBottom: '0.25rem' }}
            options={[
              { value: 'static', label: 'Static Site' },
              { value: 'proxy', label: 'Reverse Proxy' },
              { value: 'redirect', label: 'Redirect' }
            ]}
          />
          <button
            className="btn btn-primary btn-sm"
            style={{ width: '100%' }}
            disabled={!newSiteName.trim() || creating}
            onClick={handleCreate}
          >
            {creating ? <Loader size={10} className="spin" /> : <Plus size={10} />}
            {' '}Create
          </button>
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selectedSite ? (
          <div className="empty-state"><div className="empty-state-text">Select a site to edit</div></div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{selectedSite}</span>
              <button
                className={`btn btn-sm${editMode === 'visual' ? ' btn-primary' : ''}`}
                onClick={() => setEditMode('visual')}
              >Visual</button>
              <button
                className={`btn btn-sm${editMode === 'raw' ? ' btn-primary' : ''}`}
                onClick={() => setEditMode('raw')}
              >Raw</button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={handleTest} disabled={!!actionLoading}>
                {actionLoading === 'test' ? <Loader size={10} className="spin" /> : <Check size={10} />} Test
              </button>
              <button className="btn btn-sm" onClick={handleReload} disabled={!!actionLoading}>
                {actionLoading === 'reload' ? <Loader size={10} className="spin" /> : <RefreshCw size={10} />} Reload
              </button>
              <button className="btn btn-sm" onClick={() => handleCertbot(visualConfig.serverName)} disabled={!!actionLoading || !visualConfig.serverName}>
                {actionLoading === 'certbot' ? <Loader size={10} className="spin" /> : <Shield size={10} />} SSL
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader size={10} className="spin" /> : <Save size={10} />} Save
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(selectedSite)} disabled={!!actionLoading}>
                {actionLoading === 'delete' ? <Loader size={10} className="spin" /> : <Trash2 size={10} />} Delete
              </button>
            </div>

            {testResult && (
              <div style={{
                padding: '0.5rem',
                marginBottom: '0.5rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                backgroundColor: testResult.ok ? 'rgba(0,200,100,0.1)' : 'rgba(255,100,100,0.1)',
                border: `1px solid ${testResult.ok ? 'rgba(0,200,100,0.3)' : 'rgba(255,100,100,0.3)'}`
              }}>
                {testResult.ok ? <Check size={10} style={{ color: 'var(--color-success)' }} /> : <X size={10} style={{ color: 'var(--color-danger)' }} />}
                {' '}{testResult.output}
              </div>
            )}

            {editMode === 'visual' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="form-row">
                  <label style={{ width: '100px', fontSize: '0.75rem' }}>Type</label>
                  <CustomSelect
                    style={{ flex: 1 }}
                    value={visualConfig.type}
                    onChange={v => setVisualConfig(prev => ({ ...prev, type: v }))}
                    options={[
                      { value: 'static', label: 'Static Site' },
                      { value: 'proxy', label: 'Reverse Proxy' },
                      { value: 'redirect', label: 'HTTP → HTTPS Redirect' }
                    ]}
                  />
                </div>
                <div className="form-row">
                  <label style={{ width: '100px', fontSize: '0.75rem' }}>server_name</label>
                  <input
                    className="form-input"
                    style={{ flex: 1 }}
                    value={visualConfig.serverName}
                    onChange={e => setVisualConfig(prev => ({ ...prev, serverName: e.target.value }))}
                    placeholder="example.com"
                  />
                </div>
                <div className="form-row">
                  <label style={{ width: '100px', fontSize: '0.75rem' }}>listen</label>
                  <input
                    className="form-input"
                    style={{ flex: 1 }}
                    value={visualConfig.listen}
                    onChange={e => setVisualConfig(prev => ({ ...prev, listen: e.target.value }))}
                    placeholder="80"
                  />
                </div>
                {visualConfig.type === 'static' && (
                  <div className="form-row">
                    <label style={{ width: '100px', fontSize: '0.75rem' }}>root</label>
                    <input
                      className="form-input"
                      style={{ flex: 1 }}
                      value={visualConfig.root}
                      onChange={e => setVisualConfig(prev => ({ ...prev, root: e.target.value }))}
                      placeholder="/var/www/html"
                    />
                  </div>
                )}
                {visualConfig.type === 'proxy' && (
                  <div className="form-row">
                    <label style={{ width: '100px', fontSize: '0.75rem' }}>proxy_pass</label>
                    <div style={{ flex: 1, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        className="form-input"
                        style={{ flex: 1 }}
                        value={visualConfig.proxyPass}
                        onChange={e => setVisualConfig(prev => ({ ...prev, proxyPass: e.target.value }))}
                        placeholder="http://localhost:3000"
                      />
                      {availablePorts.length > 0 && (
                        <CustomSelect
                          style={{ width: 'auto', minWidth: '140px' }}
                          value=""
                          onChange={v => {
                            if (v) {
                              setVisualConfig(prev => ({ ...prev, proxyPass: `http://localhost:${v}` }))
                            }
                          }}
                          options={[
                            { value: '', label: 'Select port...' },
                            ...availablePorts.map(p => ({
                              value: String(p.port),
                              label: `:${p.port} ${p.processName || ''}${p.pid ? ` (${p.pid})` : ''}`
                            }))
                          ]}
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Listening ports panel */}
                <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <Wifi size={11} />
                    <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>Running Services</span>
                    <button className="btn btn-sm" onClick={loadPorts} disabled={portsLoading} style={{ padding: '0 4px' }}>
                      <RefreshCw size={9} className={portsLoading ? 'spin' : ''} />
                    </button>
                  </div>
                  {listeningPorts.length === 0 ? (
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-dim)' }}>
                      {portsLoading ? 'Loading...' : 'No listening ports found'}
                    </div>
                  ) : (
                    <div style={{ maxHeight: '180px', overflow: 'auto' }}>
                      {listeningPorts
                        .filter(p => p.port !== 80 && p.port !== 443)
                        .map((p, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.3rem 0.4rem', fontSize: '0.68rem',
                            borderBottom: '1px solid var(--color-border)',
                            cursor: p.processName !== 'nginx' ? 'pointer' : 'default'
                          }}
                          onClick={() => {
                            if (p.processName === 'nginx') return
                            setVisualConfig(prev => ({
                              ...prev,
                              type: 'proxy',
                              proxyPass: `http://localhost:${p.port}`
                            }))
                          }}
                          title={p.processName !== 'nginx' ? `Proxy to localhost:${p.port}` : ''}
                        >
                          <span style={{
                            fontWeight: 600, minWidth: '45px',
                            color: 'var(--color-accent)'
                          }}>:{p.port}</span>
                          <span style={{ flex: 1, color: p.processName ? 'var(--color-text)' : 'var(--color-text-dim)' }}>
                            {p.processName || 'unknown'}
                          </span>
                          {p.pid && <span style={{ color: 'var(--color-text-dim)', fontSize: '0.6rem' }}>pid:{p.pid}</span>}
                          {p.processName !== 'nginx' && (
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ padding: '0.15rem 0.4rem', fontSize: '0.6rem' }}
                              onClick={e => {
                                e.stopPropagation()
                                setVisualConfig(prev => ({
                                  ...prev,
                                  type: 'proxy',
                                  proxyPass: `http://localhost:${p.port}`
                                }))
                              }}
                            >
                              Assign
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)', marginBottom: '0.25rem' }}>Config Preview:</div>
                  <pre style={{
                    padding: '0.5rem',
                    borderRadius: '4px',
                    backgroundColor: 'var(--color-bg-secondary)',
                    fontSize: '0.7rem',
                    overflow: 'auto',
                    maxHeight: '300px',
                    whiteSpace: 'pre-wrap'
                  }}>{generateFromVisual()}</pre>
                </div>
              </div>
            ) : (
              <textarea
                className="env-editor-textarea"
                style={{ width: '100%', minHeight: '400px', fontFamily: 'monospace', fontSize: '0.75rem' }}
                value={siteContent.raw}
                onChange={e => setSiteContent(prev => ({ ...prev, raw: e.target.value }))}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function generateStaticTemplate(name) {
  return `server {
    listen 80;
    server_name ${name};

    root /var/www/${name};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ /index.html;
    }
}`
}

function generateProxyTemplate(name) {
  return `server {
    listen 80;
    server_name ${name};

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}`
}

function generateRedirectTemplate(name) {
  return `server {
    listen 80;
    server_name ${name};

    location / {
        return 301 https://$host$request_uri;
    }
}`
}
