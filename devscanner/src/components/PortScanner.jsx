import React, { useState, useMemo } from 'react'
import {
  Search, RefreshCw, Zap, Globe, ExternalLink, Square, Skull, Radio
} from 'lucide-react'

export default function PortScanner({ ports, scanning, scanMode, error, killingPids, onScan, onSetMode, onKill, onOpenBrowser }) {
  const [portSearch, setPortSearch] = useState('')

  const filteredPorts = useMemo(() => {
    if (!portSearch.trim()) return ports
    const q = portSearch.toLowerCase()
    return ports.filter(e =>
      String(e.port).includes(q) ||
      (e.processName && e.processName.toLowerCase().includes(q)) ||
      (e.address && e.address.toLowerCase().includes(q)) ||
      (e.pid && String(e.pid).includes(q))
    )
  }, [ports, portSearch])

  return (
    <div className="port-scanner">
      <div className="port-scanner-toolbar">
        <div className="port-scanner-controls">
          <div className="port-mode-toggle">
            <button
              className={`port-mode-btn${scanMode === 'common' ? ' active' : ''}`}
              onClick={() => onSetMode('common')}
            >
              <Zap size={12} />
              Common Ports
            </button>
            <button
              className={`port-mode-btn${scanMode === 'all' ? ' active' : ''}`}
              onClick={() => onSetMode('all')}
            >
              <Globe size={12} />
              All Ports
            </button>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => onScan(scanMode)}
            disabled={scanning}
          >
            <RefreshCw size={13} className={scanning ? 'spin' : ''} />
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        </div>
        <div className="port-scanner-right">
          {ports.length > 0 && (
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, color: 'var(--color-text-dim)' }} />
              <input
                className="search-input search-input-sm"
                style={{ paddingLeft: '1.75rem' }}
                type="text"
                placeholder="Filter ports..."
                value={portSearch}
                onChange={e => setPortSearch(e.target.value)}
              />
            </div>
          )}
          <span className="port-scanner-count">
            {filteredPorts.length}{filteredPorts.length !== ports.length ? `/${ports.length}` : ''} port{filteredPorts.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {error && <div className="port-scanner-error">{error}</div>}

      {scanning && ports.length === 0 ? (
        <div className="scanning-indicator">
          <div className="spinner" />
          Scanning ports...
        </div>
      ) : ports.length === 0 ? (
        <div className="empty-state">
          <Radio size={48} className="empty-state-icon" />
          <div className="empty-state-text">
            No listening ports found
          </div>
          <button className="btn btn-primary" onClick={() => onScan(scanMode)}>
            <RefreshCw size={14} />
            Scan Ports
          </button>
        </div>
      ) : filteredPorts.length === 0 ? (
        <div className="empty-state">
          <Search size={48} className="empty-state-icon" />
          <div className="empty-state-text">No ports match "{portSearch}"</div>
        </div>
      ) : (
        <div className="port-table-wrapper">
          <table className="port-table">
            <thead>
              <tr>
                <th>Port</th>
                <th>Address</th>
                <th>PID</th>
                <th>Process</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPorts.map((entry) => (
                <tr key={`${entry.port}-${entry.pid}`} className="port-row">
                  <td className="port-number">:{entry.port}</td>
                  <td className="port-address">{entry.address || '*'}</td>
                  <td className="port-pid">{entry.pid || '\u2014'}</td>
                  <td className="port-process">
                    {entry.processName || '\u2014'}
                    {entry.processName && entry.processName.toLowerCase().includes('wslrelay') && (
                      <span className="wsl-badge">WSL</span>
                    )}
                  </td>
                  <td className="port-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => onOpenBrowser(entry.port)}
                      title="Open in browser"
                    >
                      <ExternalLink size={11} />
                    </button>
                    {entry.pid && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => onKill(entry.pid, 'SIGTERM')}
                        disabled={killingPids.has(entry.pid)}
                        title="Kill process (SIGTERM)"
                      >
                        <Square size={11} />
                        {killingPids.has(entry.pid) ? 'Killing...' : 'Stop'}
                      </button>
                    )}
                    {entry.pid && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => onKill(entry.pid, 'SIGKILL')}
                        disabled={killingPids.has(entry.pid)}
                        title="Force kill (SIGKILL)"
                      >
                        <Skull size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
