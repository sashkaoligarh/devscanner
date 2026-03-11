import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Upload, Key, Loader } from 'lucide-react'
import electron from '../../electronApi'

export default function SSHKeysSettings() {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [label, setLabel] = useState('')
  const [keyData, setKeyData] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [savePassphrase, setSavePassphrase] = useState(true)
  const [addError, setAddError] = useState(null)
  const [adding, setAdding] = useState(false)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    const result = await electron.sshKeysList()
    if (result.success) setKeys(result.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  const handleImportFile = async () => {
    const result = await electron.sshKeysImportFile()
    if (result.success) {
      setKeyData(result.data.privateKeyData)
      if (!label) setLabel(result.data.fileName.replace(/\.(pem|key|pub)$/, ''))
    }
  }

  const handleAdd = async () => {
    if (!keyData.trim()) return setAddError('Key data is required')
    setAddError(null)
    setAdding(true)
    const result = await electron.sshKeysAdd({
      label: label.trim() || 'Untitled Key',
      privateKeyData: keyData,
      passphrase: savePassphrase ? passphrase || null : null
    })
    setAdding(false)
    if (result.success) {
      setShowAddForm(false)
      setLabel('')
      setKeyData('')
      setPassphrase('')
      loadKeys()
    } else {
      setAddError(result.error)
    }
  }

  const handleDelete = async (keyId, keyLabel) => {
    if (!window.confirm(`Delete key "${keyLabel}"? Servers using this key will lose their key reference.`)) return
    const result = await electron.sshKeysDelete({ keyId })
    if (result.success) {
      loadKeys()
      if (result.data.affectedServers?.length > 0) {
        window.alert(`Key removed from servers: ${result.data.affectedServers.join(', ')}`)
      }
    }
  }

  if (loading) {
    return <div className="empty-state"><div className="spinner" /><div className="empty-state-text">Loading keys...</div></div>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '13px', color: 'var(--color-text-dim)' }}>{keys.length} key{keys.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(f => !f)}>
          <Plus size={12} /> Add Key
        </button>
      </div>

      {showAddForm && (
        <div style={{
          background: 'var(--color-bg-secondary, #111)',
          border: '1px solid var(--color-border)',
          borderRadius: '6px',
          padding: '0.75rem',
          marginBottom: '0.75rem'
        }}>
          <div className="form-group">
            <label className="form-label">Label</label>
            <input className="form-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="My SSH Key" />
          </div>
          <div className="form-group">
            <label className="form-label">Private Key</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <button className="btn btn-sm" onClick={handleImportFile}>
                <Upload size={11} /> Import from file
              </button>
            </div>
            <textarea
              className="form-input"
              value={keyData}
              onChange={e => setKeyData(e.target.value)}
              placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
              rows={5}
              spellCheck={false}
              style={{ fontFamily: 'monospace', fontSize: '11px', resize: 'vertical' }}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Passphrase (if key is encrypted)</label>
            <input
              className="form-input"
              type="password"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              placeholder="Leave empty if no passphrase"
            />
            {passphrase && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', marginTop: '4px', color: 'var(--color-text-dim)' }}>
                <input type="checkbox" checked={savePassphrase} onChange={e => setSavePassphrase(e.target.checked)} />
                Save passphrase (encrypted)
              </label>
            )}
          </div>
          {addError && <div className="form-error">{addError}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => { setShowAddForm(false); setAddError(null) }}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={adding}>
              {adding ? <><Loader size={11} className="spin" /> Adding...</> : 'Add Key'}
            </button>
          </div>
        </div>
      )}

      {keys.length === 0 && !showAddForm ? (
        <div className="empty-state">
          <Key size={32} className="empty-state-icon" />
          <div className="empty-state-text">No SSH keys in library</div>
        </div>
      ) : (
        <div>
          {keys.map(k => (
            <div key={k.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem',
              borderBottom: '1px solid var(--color-border)',
              fontSize: '12px'
            }}>
              <Key size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{k.label}</div>
                <div style={{ color: 'var(--color-text-dim)', fontSize: '11px' }}>
                  {k.keyType?.toUpperCase()} &middot; {k.fingerprint?.substring(0, 20)}...
                  {k.hasPassphrase && ' \u00b7 passphrase'}
                </div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => handleDelete(k.id, k.label)}
                style={{ color: '#ff5555', padding: '2px 6px' }}
                title="Delete key"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
