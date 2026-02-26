import React from 'react'
import {
  Play, Square, RefreshCw, Container, ScrollText, RotateCcw
} from 'lucide-react'

export default function DockerContainers({ containers, loading, error, dockerInfo, actionLoading, onRefresh, onAction, onViewLogs }) {
  const runningCount = containers.filter(c => c.State === 'running').length

  return (
    <div className="port-scanner">
      <div className="port-scanner-toolbar">
        <div className="port-scanner-controls">
          <button
            className="btn btn-primary"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          {dockerInfo && (
            <div className="docker-info-badges">
              <span className={`docker-badge ${dockerInfo.docker ? 'docker-badge-ok' : 'docker-badge-err'}`}>
                Docker {dockerInfo.docker ? '\u2713' : '\u2717'}
              </span>
              {dockerInfo.docker && (
                <span className={`docker-badge ${dockerInfo.compose ? 'docker-badge-ok' : 'docker-badge-warn'}`}>
                  Compose: {dockerInfo.compose || 'not found'}
                </span>
              )}
            </div>
          )}
        </div>
        <span className="port-scanner-count">
          {runningCount > 0 && `${runningCount} running / `}{containers.length} container{containers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <div className="port-scanner-error">{error}</div>}

      {loading && containers.length === 0 ? (
        <div className="scanning-indicator">
          <div className="spinner" />
          Loading containers...
        </div>
      ) : containers.length === 0 ? (
        <div className="empty-state">
          <Container size={48} className="empty-state-icon" />
          <div className="empty-state-text">
            {dockerInfo && !dockerInfo.docker
              ? 'Docker is not installed or not running'
              : 'No Docker containers found'}
          </div>
          <button className="btn btn-primary" onClick={onRefresh}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      ) : (
        <div className="port-table-wrapper">
          <table className="port-table docker-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Image</th>
                <th>Status</th>
                <th>Ports</th>
                <th className="docker-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {containers.map(c => {
                const busy = actionLoading.has(c.ID)
                const isRunning = c.State === 'running'
                return (
                  <tr key={c.ID} className={`port-row${isRunning ? ' docker-row-running' : ''}`}>
                    <td className="docker-name">{c.Names}</td>
                    <td className="docker-image" title={c.Image}>{c.Image}</td>
                    <td>
                      <span className={`container-state-badge container-state-${c.State}`}>
                        {c.Status}
                      </span>
                    </td>
                    <td className="docker-ports">{c.Ports || '\u2014'}</td>
                    <td className="docker-actions-cell">
                      <button
                        className="btn btn-sm"
                        onClick={() => onViewLogs(c)}
                        title="View logs"
                      >
                        <ScrollText size={11} />
                      </button>
                      {isRunning ? (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => onAction(c.ID, 'stop')}
                          disabled={busy}
                          title="Stop"
                        >
                          <Square size={11} />
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          onClick={() => onAction(c.ID, 'start')}
                          disabled={busy}
                          title="Start"
                        >
                          <Play size={11} />
                        </button>
                      )}
                      <button
                        className="btn btn-sm"
                        onClick={() => onAction(c.ID, 'restart')}
                        disabled={busy}
                        title="Restart"
                      >
                        <RotateCcw size={11} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
