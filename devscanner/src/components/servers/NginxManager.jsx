import React, { useState, useCallback, useEffect } from 'react'
import { Plus, Save, Check, X, Shield, RefreshCw, Trash2, ToggleLeft, ToggleRight, Loader, FileText, AlertTriangle } from 'lucide-react'
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

  // Visual editor state
  const [visualConfig, setVisualConfig] = useState({
    serverName: '',
    listen: '80',
    root: '',
    proxyPass: '',
    type: 'static' // 'static' | 'proxy' | 'redirect'
  })

  const loadSites = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await electron.sshNginxList({ serverId })
    if (result.success) {
      setSites(result.data)
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [serverId])

  useEffect(() => { loadSites() }, [loadSites])

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
    const result = await electron.sshCertbotRun({ serverId, domain })
    if (!result.success) {
      setError(result.error)
    } else {
      await loadSites()
      // Refresh visual after certbot modifies config
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

  if (loading) {
    return <div className="scanning-indicator"><div className="spinner" /> Loading nginx sites...</div>
  }

  if (error && sites.length === 0) {
    return (
      <div className="empty-state">
        <AlertTriangle size={48} className="empty-state-icon" />
        <div className="empty-state-text">Nginx not found or not accessible</div>
        <button className="btn btn-primary" onClick={async () => {
          setActionLoading('install')
          await electron.sshNginxInstall({ serverId })
          await loadSites()
          setActionLoading(null)
        }} disabled={actionLoading === 'install'}>
          {actionLoading === 'install' ? <><Loader size={12} className="spin" /> Installing...</> : 'Install nginx'}
        </button>
      </div>
    )
  }

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
          <input
            className="server-terminal-cmd"
            style={{ width: '100%', marginBottom: '0.25rem' }}
            value={newSiteName}
            onChange={e => setNewSiteName(e.target.value)}
            placeholder="new-site-name"
          />
          <select
            className="server-terminal-cmd"
            style={{ width: '100%', marginBottom: '0.25rem' }}
            value={newSiteTemplate}
            onChange={e => setNewSiteTemplate(e.target.value)}
          >
            <option value="static">Static Site</option>
            <option value="proxy">Reverse Proxy</option>
            <option value="redirect">Redirect</option>
          </select>
          <button
            className="btn btn-primary btn-sm"
            style={{ width: '100%' }}
            disabled={!newSiteName.trim() || creating}
            onClick={handleCreate}
          >
            {creating ? <Loader size={10} className="spin" /> : <Plus size={10} />}
            Create
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
                  <select
                    className="server-terminal-cmd"
                    style={{ flex: 1 }}
                    value={visualConfig.type}
                    onChange={e => setVisualConfig(prev => ({ ...prev, type: e.target.value }))}
                  >
                    <option value="static">Static Site</option>
                    <option value="proxy">Reverse Proxy</option>
                    <option value="redirect">HTTP &rarr; HTTPS Redirect</option>
                  </select>
                </div>
                <div className="form-row">
                  <label style={{ width: '100px', fontSize: '0.75rem' }}>server_name</label>
                  <input
                    className="server-terminal-cmd"
                    style={{ flex: 1 }}
                    value={visualConfig.serverName}
                    onChange={e => setVisualConfig(prev => ({ ...prev, serverName: e.target.value }))}
                    placeholder="example.com"
                  />
                </div>
                <div className="form-row">
                  <label style={{ width: '100px', fontSize: '0.75rem' }}>listen</label>
                  <input
                    className="server-terminal-cmd"
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
                      className="server-terminal-cmd"
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
                    <input
                      className="server-terminal-cmd"
                      style={{ flex: 1 }}
                      value={visualConfig.proxyPass}
                      onChange={e => setVisualConfig(prev => ({ ...prev, proxyPass: e.target.value }))}
                      placeholder="http://localhost:3000"
                    />
                  </div>
                )}
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
