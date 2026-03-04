import React, { useState, useEffect, useCallback } from 'react'
import { X, Search, Trash2, Clock } from 'lucide-react'
import electron from '../../electronApi'

export default function CommandHistory({ serverId, visible, onClose, onInsertCommand }) {
  const [history, setHistory] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    if (!serverId) return
    setLoading(true)
    const result = await electron.commandHistoryGet({ serverId })
    if (result.success) setHistory(result.data || [])
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    if (visible) loadHistory()
  }, [visible, loadHistory])

  const handleClear = async () => {
    if (!window.confirm('Clear all command history for this server?')) return
    await electron.commandHistoryClear({ serverId })
    setHistory([])
  }

  const filtered = search
    ? history.filter(h => h.command.toLowerCase().includes(search.toLowerCase()))
    : history

  if (!visible) return null

  return (
    <div style={{
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: '300px',
      background: 'var(--color-bg, #0a0a0a)',
      borderLeft: '1px solid var(--color-border)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 10,
      opacity: 0.95
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '6px 8px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0
      }}>
        <Clock size={12} style={{ color: 'var(--color-accent)' }} />
        <span style={{ fontSize: '12px', fontWeight: 500, flex: 1 }}>Command History</span>
        <button
          className="btn btn-sm"
          onClick={handleClear}
          title="Clear history"
          style={{ padding: '2px 4px' }}
        >
          <Trash2 size={10} />
        </button>
        <button
          className="btn btn-sm"
          onClick={onClose}
          style={{ padding: '2px 4px' }}
        >
          <X size={10} />
        </button>
      </div>

      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <Search size={11} style={{ position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-dim)' }} />
          <input
            className="form-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search commands..."
            style={{ paddingLeft: '22px', fontSize: '11px', padding: '4px 4px 4px 22px' }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '12px' }}>
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '12px' }}>
            {search ? 'No matching commands' : 'No commands recorded yet'}
          </div>
        ) : (
          filtered.map((entry, i) => (
            <div
              key={i}
              onClick={() => onInsertCommand(entry.command)}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--color-border)',
                fontSize: '11px',
                fontFamily: 'monospace',
                transition: 'background 0.1s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-secondary, #111)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ color: 'var(--color-text)', wordBreak: 'break-all' }}>
                {entry.command}
              </div>
              <div style={{ color: 'var(--color-text-dim)', fontSize: '9px', marginTop: '1px' }}>
                {formatRelativeTime(entry.timestamp)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() - new Date(timestamp).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}
