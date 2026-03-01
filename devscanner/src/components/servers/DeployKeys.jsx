import React, { useState, useEffect, useCallback } from 'react'
import { Key, Trash2, Plus, Loader, Copy, Check, Download } from 'lucide-react'
import electron from '../../electronApi'

export default function DeployKeys({ onClose }) {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState(null) // 'generate' | 'import'
  const [name, setName] = useState('')
  const [privKey, setPrivKey] = useState('')
  const [pubKey, setPubKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [copied, setCopied] = useState(null)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    const res = await electron.deployKeysList()
    if (res.success) setKeys(res.data)
    else setError(res.error)
    setLoading(false)
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  const handleGenerate = useCallback(async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    const res = await electron.deployKeysSave({ name: name.trim(), generate: true })
    if (res.success) {
      setName('')
      setMode(null)
      await loadKeys()
    } else {
      setError(res.error)
    }
    setSaving(false)
  }, [name, loadKeys])

  const handleImport = useCallback(async () => {
    if (!name.trim() || !privKey.trim() || !pubKey.trim()) return
    setSaving(true)
    setError(null)
    const res = await electron.deployKeysSave({ name: name.trim(), privateKey: privKey.trim(), publicKey: pubKey.trim() })
    if (res.success) {
      setName('')
      setPrivKey('')
      setPubKey('')
      setMode(null)
      await loadKeys()
    } else {
      setError(res.error)
    }
    setSaving(false)
  }, [name, privKey, pubKey, loadKeys])

  const handleDelete = useCallback(async (id) => {
    setDeleting(id)
    const res = await electron.deployKeysDelete({ id })
    if (res.success) await loadKeys()
    else setError(res.error)
    setDeleting(null)
  }, [loadKeys])

  const copyKey = useCallback((text) => {
    navigator.clipboard.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }, [])

  return (
    <div className="deploy-wizard">
      <div className="deploy-header">
        <Key size={14} />
        <span>Deploy Keys</span>
        {onClose && (
          <button className="btn btn-sm deploy-close" onClick={onClose} style={{ marginLeft: 'auto' }}>
            &times;
          </button>
        )}
      </div>

      <div className="deploy-body">
        {error && <div className="deploy-error">{error}</div>}

        {loading ? (
          <div className="scanning-indicator"><div className="spinner" /> Loading...</div>
        ) : keys.length === 0 && !mode ? (
          <div className="empty-state" style={{ padding: '1rem' }}>
            <div className="empty-state-text">No deploy keys yet</div>
          </div>
        ) : (
          <div className="server-section-list" style={{ marginBottom: '0.75rem' }}>
            {keys.map(k => (
              <div key={k.id} className="server-svc-row" style={{ flexWrap: 'wrap' }}>
                <span className="server-svc-name">{k.name}</span>
                <span className="server-svc-detail" style={{ fontSize: '10px' }}>
                  {new Date(k.createdAt).toLocaleDateString()}
                </span>
                <span className="svc-actions">
                  <button
                    className="svc-action-btn"
                    onClick={() => copyKey(k.publicKey)}
                    title="Copy public key"
                  >
                    {copied === k.publicKey ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                  <button
                    className="svc-action-btn svc-action-danger"
                    onClick={() => handleDelete(k.id)}
                    disabled={deleting === k.id}
                    title="Delete key"
                  >
                    {deleting === k.id ? <Loader size={10} className="spin" /> : <Trash2 size={10} />}
                  </button>
                </span>
                <div style={{ width: '100%', marginTop: '0.25rem' }}>
                  <input
                    readOnly
                    value={k.publicKey}
                    className="form-input"
                    style={{ fontFamily: 'monospace', fontSize: '10px', cursor: 'text' }}
                    onClick={e => e.target.select()}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {!mode && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setMode('generate')}>
              <Plus size={11} /> Generate Key
            </button>
            <button className="btn btn-sm" onClick={() => setMode('import')}>
              <Download size={11} /> Import Key
            </button>
          </div>
        )}

        {mode === 'generate' && (
          <div style={{ marginTop: '0.5rem' }}>
            <div className="deploy-field">
              <label>Key name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="my-deploy-key" autoFocus />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button className="btn btn-primary btn-sm" onClick={handleGenerate} disabled={saving || !name.trim()}>
                {saving ? <><Loader size={11} className="spin" /> Generating...</> : <><Key size={11} /> Generate</>}
              </button>
              <button className="btn btn-sm" onClick={() => { setMode(null); setName('') }}>Cancel</button>
            </div>
          </div>
        )}

        {mode === 'import' && (
          <div style={{ marginTop: '0.5rem' }}>
            <div className="deploy-field">
              <label>Key name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="my-deploy-key" autoFocus />
            </div>
            <div className="deploy-field">
              <label>Private Key</label>
              <textarea
                className="form-input"
                value={privKey}
                onChange={e => setPrivKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                rows={4}
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: '11px', resize: 'vertical' }}
              />
            </div>
            <div className="deploy-field">
              <label>Public Key</label>
              <textarea
                className="form-input"
                value={pubKey}
                onChange={e => setPubKey(e.target.value)}
                placeholder="ssh-ed25519 AAAAC3... deploy-key"
                rows={2}
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: '11px', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={saving || !name.trim() || !privKey.trim() || !pubKey.trim()}>
                {saving ? <><Loader size={11} className="spin" /> Importing...</> : <><Download size={11} /> Import</>}
              </button>
              <button className="btn btn-sm" onClick={() => { setMode(null); setName(''); setPrivKey(''); setPubKey('') }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
