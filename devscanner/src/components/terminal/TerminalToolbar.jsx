import React, { useState } from 'react'
import { Settings, RefreshCw, Maximize2, Minimize2, Clock, Copy, Clipboard, Search, Trash2 } from 'lucide-react'

export default function TerminalToolbar({
  serverName, connected, onReconnect, onToggleFullscreen,
  onOpenSettings, onToggleHistory, isFullscreen, showHistory,
  onAction, onSearch
}) {
  const [query, setQuery] = useState('')

  const submitSearch = (event) => {
    event.preventDefault()
    if (query.trim()) onSearch?.(query.trim(), 'next')
  }

  return (
    <div className="terminal-toolbar">
      <span className="terminal-status">
        <span className={`terminal-status-dot${connected ? ' connected' : ''}`} />
        {serverName}
      </span>

      <form className="terminal-search" onSubmit={submitSearch}>
        <Search size={11} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search terminal"
        />
        <button type="button" className="terminal-tool-btn" onClick={() => query.trim() && onSearch?.(query.trim(), 'previous')} title="Previous match">
          Prev
        </button>
        <button type="submit" className="terminal-tool-btn" title="Next match">
          Next
        </button>
      </form>

      {!connected && (
        <button
          className="btn btn-sm"
          onClick={onReconnect}
        >
          <RefreshCw size={10} /> Reconnect
        </button>
      )}

      <button className="terminal-tool-btn" onClick={() => onAction?.('copy')} title="Copy selection">
        <Copy size={11} />
      </button>

      <button className="terminal-tool-btn" onClick={() => onAction?.('paste')} title="Paste from clipboard">
        <Clipboard size={11} />
      </button>

      <button className="terminal-tool-btn" onClick={() => onAction?.('clear')} title="Clear terminal">
        <Trash2 size={11} />
      </button>

      {onToggleHistory && (
        <button
          className={`btn btn-sm${showHistory ? ' btn-primary' : ''}`}
          onClick={onToggleHistory}
          title="Command History"
        >
          <Clock size={11} />
        </button>
      )}

      <button
        className="btn btn-sm"
        onClick={onOpenSettings}
        title="Terminal Settings"
      >
        <Settings size={11} />
      </button>

      <button
        className="btn btn-sm"
        onClick={onToggleFullscreen}
        title={isFullscreen ? 'Collapse' : 'Expand'}
      >
        {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
      </button>
    </div>
  )
}
