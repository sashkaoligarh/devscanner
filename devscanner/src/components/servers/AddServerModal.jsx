import React, { useState } from 'react'
import { Wifi, Loader } from 'lucide-react'

export default function AddServerModal({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('root')
  const [authType, setAuthType] = useState('password')
  const [password, setPassword] = useState('')
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) return setError('Name is required')
    if (!host.trim()) return setError('Host is required')
    if (!username.trim()) return setError('Username is required')
    setError(null)
    setLoading(true)
    const serverData = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      authType,
      ...(authType === 'password' ? { password } : { privateKeyPath })
    }
    const result = await onAdd(serverData)
    setLoading(false)
    if (result.success) {
      onClose()
    } else {
      setError(result.error || 'Connection failed')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Add Server</div>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Production" />
        </div>
        <div className="form-group" style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Host</label>
            <input className="form-input" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100" />
          </div>
          <div style={{ width: '80px' }}>
            <label className="form-label">Port</label>
            <input className="form-input" type="number" value={port} onChange={e => setPort(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Username</label>
          <input className="form-input" value={username} onChange={e => setUsername(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Authentication</label>
          <div className="radio-group">
            <label className="radio-label">
              <input type="radio" checked={authType === 'password'} onChange={() => setAuthType('password')} />
              Password
            </label>
            <label className="radio-label">
              <input type="radio" checked={authType === 'key'} onChange={() => setAuthType('key')} />
              SSH Key
            </label>
          </div>
        </div>
        {authType === 'password' ? (
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">Private Key Path</label>
            <input className="form-input" value={privateKeyPath} onChange={e => setPrivateKeyPath(e.target.value)} placeholder="~/.ssh/id_rsa" />
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? <><Loader size={12} className="spin" /> Connecting...</> : <><Wifi size={12} /> Connect & Save</>}
          </button>
        </div>
      </div>
    </div>
  )
}
