import React from 'react'
import { Settings, RefreshCw, Maximize2, Minimize2, Clock, WifiOff } from 'lucide-react'

export default function TerminalToolbar({
  serverName, connected, onReconnect, onToggleFullscreen,
  onOpenSettings, onToggleHistory, isFullscreen, showHistory
}) {
  return (
    <div className="terminal-toolbar" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '4px 8px',
      background: 'var(--color-bg-secondary, #111)',
      borderBottom: '1px solid var(--color-border, #333)',
      fontSize: '12px',
      flexShrink: 0
    }}>
      <span style={{ color: 'var(--color-text-dim)', marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: connected ? 'var(--color-accent, #00ff88)' : '#ff5555',
          display: 'inline-block'
        }} />
        {serverName}
      </span>

      {!connected && (
        <button
          className="btn btn-sm"
          onClick={onReconnect}
          style={{ fontSize: '11px', padding: '2px 8px' }}
        >
          <RefreshCw size={10} /> Reconnect
        </button>
      )}

      {onToggleHistory && (
        <button
          className={`btn btn-sm${showHistory ? ' btn-primary' : ''}`}
          onClick={onToggleHistory}
          title="Command History"
          style={{ padding: '2px 6px' }}
        >
          <Clock size={11} />
        </button>
      )}

      <button
        className="btn btn-sm"
        onClick={onOpenSettings}
        title="Terminal Settings"
        style={{ padding: '2px 6px' }}
      >
        <Settings size={11} />
      </button>

      <button
        className="btn btn-sm"
        onClick={onToggleFullscreen}
        title={isFullscreen ? 'Collapse' : 'Expand'}
        style={{ padding: '2px 6px' }}
      >
        {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
      </button>
    </div>
  )
}
