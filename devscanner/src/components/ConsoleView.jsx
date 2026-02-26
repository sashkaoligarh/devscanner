import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Square, ExternalLink, Search, Copy, Trash2, ScrollText } from 'lucide-react'
import HealthIndicator from './HealthIndicator'

export function ConsoleView({ tabKey, info, logs, logRef, onStop, onOpenBrowser, healthStatus, onClearLogs, hostIp }) {
  const [logSearch, setLogSearch] = useState('')

  const filteredLogs = useMemo(() => {
    if (!logSearch.trim()) return logs
    const q = logSearch.toLowerCase()
    return logs.filter(l => l.toLowerCase().includes(q))
  }, [logs, logSearch])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(logs.join('\n')).catch(() => {})
  }, [logs])

  return (
    <div className="console-view">
      <div className="console-header">
        <span className="console-title">
          {info.projectName} / {info.instanceId}
          {info.isRunning && <HealthIndicator status={healthStatus} />}
        </span>
        <div className="console-actions">
          {info.isRunning && (
            <>
              <span className="status-badge">{hostIp || 'localhost'}:{info.port}</span>
              <button
                className="btn btn-danger"
                onClick={() => onStop(info.projectPath, info.instanceId)}
              >
                <Square size={12} /> Stop
              </button>
              <button
                className="btn"
                onClick={() => onOpenBrowser(info.port)}
              >
                <ExternalLink size={12} /> Open in Browser
              </button>
            </>
          )}
          {!info.isRunning && (
            <span className="status-badge-stopped">Stopped</span>
          )}
          <button className="btn btn-sm" title="Copy all logs" onClick={handleCopy}>
            <Copy size={11} />
          </button>
          <button className="btn btn-sm" title="Clear logs" onClick={onClearLogs}>
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <div className="console-search-bar">
        <Search size={12} style={{ color: 'var(--color-text-dim)', flexShrink: 0 }} />
        <input
          className="console-search-input"
          type="text"
          placeholder="Search logs..."
          value={logSearch}
          onChange={e => setLogSearch(e.target.value)}
        />
        {logSearch && (
          <span className="console-search-count">
            {filteredLogs.length}/{logs.length}
          </span>
        )}
      </div>
      <div className="console-output" ref={logRef}>
        {filteredLogs.map((line, i) => (
          <div
            key={i}
            className={`log-line${/error|fail|exception/i.test(line) ? ' log-line-error' : /warn/i.test(line) ? ' log-line-warn' : ''}`}
          >
            {line}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="log-line" style={{ color: 'var(--color-text-dim)' }}>
            Waiting for output...
          </div>
        )}
      </div>
    </div>
  )
}

export function DockerConsoleView({ containerId, container, logs }) {
  const logRef = useRef(null)
  const [logSearch, setLogSearch] = useState('')

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const filteredLogs = useMemo(() => {
    if (!logSearch.trim()) return logs
    const q = logSearch.toLowerCase()
    return logs.filter(l => l.toLowerCase().includes(q))
  }, [logs, logSearch])

  const handleCopy = () => {
    navigator.clipboard.writeText(logs.join('\n')).catch(() => {})
  }

  return (
    <div className="console-view">
      <div className="console-header">
        <span className="console-title">
          <ScrollText size={14} />
          {container ? container.Names : containerId}
          {container?.Image && (
            <span className="launch-target-image">{container.Image}</span>
          )}
          {container?.State && (
            <span className={`container-state-badge container-state-${container.State}`}>
              {container.State}
            </span>
          )}
        </span>
        <div className="console-actions">
          <button className="btn btn-sm" title="Copy all logs" onClick={handleCopy}>
            <Copy size={11} />
          </button>
        </div>
      </div>
      <div className="console-search-bar">
        <Search size={12} style={{ color: 'var(--color-text-dim)', flexShrink: 0 }} />
        <input
          className="console-search-input"
          type="text"
          placeholder="Search logs..."
          value={logSearch}
          onChange={e => setLogSearch(e.target.value)}
        />
        {logSearch && (
          <span className="console-search-count">{filteredLogs.length}/{logs.length}</span>
        )}
      </div>
      <div className="console-output" ref={logRef}>
        {filteredLogs.map((line, i) => (
          <div key={i} className="log-line">{line}</div>
        ))}
        {logs.length === 0 && (
          <div className="log-line" style={{ color: 'var(--color-text-dim)' }}>
            Loading logs...
          </div>
        )}
      </div>
    </div>
  )
}
