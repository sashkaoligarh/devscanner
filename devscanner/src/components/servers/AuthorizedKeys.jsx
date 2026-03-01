import React, { useState, useEffect, useCallback } from 'react'
import { Key, Trash2, Plus, RefreshCw, Loader, Copy, Check } from 'lucide-react'
import electron from '../../electronApi'

export default function AuthorizedKeys({ serverId }) {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [newKey, setNewKey] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await electron.sshAuthorizedKeysList({ serverId })
    if (res.success) {
      setKeys(res.data)
    } else {
      setError(res.error)
    }
    setLoading(false)
  }, [serverId])

  useEffect(() => { loadKeys() }, [loadKeys])

  const handleAdd = useCallback(async () => {
    if (!newKey.trim()) return
    setAdding(true)
    setError(null)
    const res = await electron.sshAuthorizedKeysAdd({ serverId, publicKey: newKey.trim() })
    if (res.success) {
      setNewKey('')
      await loadKeys()
    } else {
      setError(res.error)
    }
    setAdding(false)
  }, [serverId, newKey, loadKeys])

  const handleRemove = useCallback(async (lineIndex) => {
    setRemoving(lineIndex)
    setError(null)
    const res = await electron.sshAuthorizedKeysRemove({ serverId, lineIndex })
    if (res.success) {
      await loadKeys()
    } else {
      setError(res.error)
    }
    setRemoving(null)
  }, [serverId, loadKeys])

  const copyFingerprint = useCallback((fp) => {
    navigator.clipboard.writeText(fp)
    setCopied(fp)
    setTimeout(() => setCopied(null), 1500)
  }, [])

  return (
    <div className="main" style={{ overflow: 'auto' }}>
      <div className="server-section">
        <div className="server-section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Key size={13} />
          Authorized Keys
          <button className="btn btn-sm" onClick={loadKeys} disabled={loading} style={{ marginLeft: 'auto' }}>
            <RefreshCw size={11} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {error && <div className="form-error" style={{ margin: '0.5rem 0' }}>{error}</div>}

        {loading ? (
          <div className="scanning-indicator"><div className="spinner" /> Loading keys...</div>
        ) : keys.length === 0 ? (
          <div className="empty-state" style={{ padding: '1rem' }}>
            <div className="empty-state-text">No authorized keys found</div>
          </div>
        ) : (
          <div className="server-section-list">
            {keys.map((k) => (
              <div key={k.index} className="server-svc-row">
                <span className="container-state-badge container-state-running">{k.type}</span>
                <span className="server-svc-name" style={{ fontFamily: 'monospace', fontSize: '11px', cursor: 'pointer' }}
                  onClick={() => copyFingerprint(k.fingerprint)} title="Click to copy fingerprint">
                  {copied === k.fingerprint ? <Check size={10} style={{ color: 'var(--color-success)' }} /> : <Copy size={10} />}
                  {' '}{k.fingerprint}
                </span>
                <span className="server-svc-detail">{k.comment || '(no comment)'}</span>
                <span className="svc-actions">
                  <button
                    className="svc-action-btn svc-action-danger"
                    onClick={() => handleRemove(k.index)}
                    disabled={removing === k.index}
                    title="Remove key"
                  >
                    {removing === k.index ? <Loader size={10} className="spin" /> : <Trash2 size={10} />}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: '0.75rem' }}>
          <label className="form-label">Add Public Key</label>
          <textarea
            className="form-input"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder="ssh-ed25519 AAAAC3... user@host"
            rows={3}
            spellCheck={false}
            style={{ fontFamily: 'monospace', fontSize: '11px', resize: 'vertical' }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={handleAdd}
            disabled={adding || !newKey.trim()}
            style={{ marginTop: '0.5rem' }}
          >
            {adding ? <><Loader size={11} className="spin" /> Adding...</> : <><Plus size={11} /> Add Key</>}
          </button>
        </div>
      </div>
    </div>
  )
}
