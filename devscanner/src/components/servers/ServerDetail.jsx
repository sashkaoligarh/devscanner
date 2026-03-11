import React, { useRef, useEffect, useState, useCallback } from 'react'
import { Package, RefreshCw, Wifi, WifiOff, Play, Square, RotateCcw, Trash2, FileText, Loader, Settings } from 'lucide-react'
import RemoteProjectManager from './RemoteProjectManager'
import NginxManager from './NginxManager'
import QuickDeploy from './QuickDeploy'
import AuthorizedKeys from './AuthorizedKeys'
import XTerminal from '../terminal/XTerminal'
import TerminalToolbar from '../terminal/TerminalToolbar'
import CommandHistory from '../terminal/CommandHistory'
import SSHKeysSettings from '../settings/SSHKeysSettings'
import ThemeSettings from '../settings/ThemeSettings'
import ShortcutSettings from '../settings/ShortcutSettings'
import electron from '../../electronApi'

export default function ServerDetail({
  server, disc, isConnected, discovering, connections, serverSubTab,
  terminalOutput, terminalInput, remoteRunning, remoteLogs,
  onSetActiveServer, onSetSubTab, onConnect, onDisconnect, onDiscover,
  onExec, onSetTerminalInput, terminalHook, onOpenSettings
}) {
  const [terminalConnected, setTerminalConnected] = useState(false)
  const [terminalLoading, setTerminalLoading] = useState(false)
  const [terminalError, setTerminalError] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [settingsSubTab, setSettingsSubTab] = useState('keys')
  const terminalInitRef = useRef(false)

  // Open terminal session when terminal tab is selected
  useEffect(() => {
    if (serverSubTab !== 'terminal' || !isConnected) return
    if (terminalHook?.sessionStatus?.[server.id] === 'connected') {
      setTerminalConnected(true)
      return
    }
    if (terminalInitRef.current) return
    terminalInitRef.current = true

    setTerminalLoading(true)
    setTerminalError(null)
    terminalHook?.openTerminal(server.id).then(result => {
      setTerminalLoading(false)
      if (result.success) {
        setTerminalConnected(true)
      } else {
        setTerminalError(result.error)
        setTerminalConnected(false)
      }
      terminalInitRef.current = false
    })
  }, [serverSubTab, isConnected, server.id])

  // Reset terminal state when switching away
  useEffect(() => {
    if (serverSubTab !== 'terminal') {
      terminalInitRef.current = false
    }
  }, [serverSubTab])

  const handleReconnect = useCallback(async () => {
    setTerminalLoading(true)
    setTerminalError(null)
    setTerminalConnected(false)
    await terminalHook?.closeTerminal(server.id)
    const result = await terminalHook?.openTerminal(server.id)
    setTerminalLoading(false)
    if (result?.success) {
      setTerminalConnected(true)
    } else {
      setTerminalError(result?.error || 'Reconnection failed')
    }
  }, [server.id, terminalHook])

  const handleDisconnect = useCallback((reason) => {
    setTerminalConnected(false)
  }, [])
  return (
    <div className="port-scanner">
      <div className="port-scanner-toolbar">
        <div className="port-scanner-controls">
          <button className="btn" onClick={() => onSetActiveServer(null)}>
            <Package size={12} /> Back
          </button>
          <span className="server-detail-name">{server.name}</span>
          <span className="server-detail-host">{server.username}@{server.host}:{server.port || 22}</span>
          {disc?.os && <span className="server-os-badge">{disc.os.name}</span>}
        </div>
        <div className="port-scanner-right">
          {isConnected ? (
            <>
              <button className="btn btn-sm" onClick={() => onDiscover(server.id)} disabled={discovering[server.id]}>
                <RefreshCw size={11} className={discovering[server.id] ? 'spin' : ''} /> Rediscover
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => onDisconnect(server.id)}>
                <WifiOff size={11} /> Disconnect
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => onConnect(server)}>
              <Wifi size={11} /> Connect
            </button>
          )}
        </div>
      </div>

      {isConnected && (
        <div className="server-sub-tabs">
          {['services', 'nginx', 'projects', 'deploy', 'keys', 'ports', 'terminal', 'settings'].map(tab => (
            <button
              key={tab}
              className={`server-sub-tab${serverSubTab === tab ? ' active' : ''}`}
              onClick={() => onSetSubTab(tab)}
            >
              {tab === 'settings' && <Settings size={11} style={{ marginRight: '3px' }} />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      )}

      {!isConnected ? (
        <div className="empty-state">
          <WifiOff size={48} className="empty-state-icon" />
          <div className="empty-state-text">Not connected to this server</div>
          <button className="btn btn-primary" onClick={() => onConnect(server)}>
            <Wifi size={14} /> Connect
          </button>
        </div>
      ) : discovering[server.id] ? (
        <div className="scanning-indicator"><div className="spinner" /> Discovering services...</div>
      ) : serverSubTab === 'services' ? (
        <ServerServices discovery={disc} serverId={server.id} onRefresh={() => onDiscover(server.id)} />
      ) : serverSubTab === 'nginx' ? (
        <NginxManager serverId={server.id} />
      ) : serverSubTab === 'projects' ? (
        <RemoteProjectManager
          serverId={server.id}
          projects={disc?.projects || []}
          remoteRunning={remoteRunning?.[server.id] || {}}
          remoteLogs={remoteLogs}
          onRefresh={() => onDiscover(server.id)}
        />
      ) : serverSubTab === 'deploy' ? (
        <QuickDeploy serverId={server.id} onRefresh={() => onDiscover(server.id)} />
      ) : serverSubTab === 'keys' ? (
        <AuthorizedKeys serverId={server.id} />
      ) : serverSubTab === 'ports' ? (
        <ServerPorts ports={disc?.ports || []} />
      ) : serverSubTab === 'terminal' ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <TerminalToolbar
            serverName={server.name}
            connected={terminalConnected}
            onReconnect={handleReconnect}
            onToggleFullscreen={() => setIsFullscreen(f => !f)}
            onOpenSettings={() => onSetSubTab('settings')}
            onToggleHistory={() => setShowHistory(h => !h)}
            isFullscreen={isFullscreen}
            showHistory={showHistory}
          />
          {terminalLoading ? (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="spinner" />
              <div className="empty-state-text">Connecting to terminal...</div>
            </div>
          ) : terminalError ? (
            <div className="empty-state" style={{ flex: 1 }}>
              <WifiOff size={48} className="empty-state-icon" />
              <div className="empty-state-text">{terminalError}</div>
              <button className="btn btn-primary" onClick={handleReconnect}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : terminalConnected ? (
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <XTerminal
                serverId={server.id}
                theme={terminalHook?.activeTheme}
                shortcuts={terminalHook?.shortcuts}
                fontSize={terminalHook?.terminalSettings?.fontSize}
                scrollbackLimit={terminalHook?.terminalSettings?.scrollbackLimit}
                cursorBlink={terminalHook?.terminalSettings?.cursorBlink}
                cursorStyle={terminalHook?.terminalSettings?.cursorStyle}
                onDisconnect={handleDisconnect}
                onReconnect={handleReconnect}
              />
              <CommandHistory
                serverId={server.id}
                visible={showHistory}
                onClose={() => setShowHistory(false)}
                onInsertCommand={(cmd) => {
                  electron.sendTerminalInput(server.id, cmd)
                  setShowHistory(false)
                }}
              />
            </div>
          ) : null}
        </div>
      ) : serverSubTab === 'settings' ? (
        <div className="main" style={{ overflow: 'auto' }}>
          <div className="settings-inline-tabs">
            {[
              { id: 'keys', label: 'SSH Keys' },
              { id: 'themes', label: 'Themes' },
              { id: 'shortcuts', label: 'Shortcuts' }
            ].map(tab => (
              <button
                key={tab.id}
                className={`settings-inline-tab${settingsSubTab === tab.id ? ' active' : ''}`}
                onClick={() => setSettingsSubTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="settings-inline-content">
            {settingsSubTab === 'keys' && <SSHKeysSettings />}
            {settingsSubTab === 'themes' && <ThemeSettings terminalHook={terminalHook} />}
            {settingsSubTab === 'shortcuts' && <ShortcutSettings terminalHook={terminalHook} />}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SvcActionBtn({ icon: Icon, title, onClick, loading, danger }) {
  return (
    <button
      className={`svc-action-btn${danger ? ' svc-action-danger' : ''}`}
      onClick={onClick}
      disabled={loading}
      title={title}
    >
      {loading ? <Loader size={10} className="spin" /> : <Icon size={10} />}
    </button>
  )
}

function SvcLogPanel({ logs, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs])
  return (
    <div className="svc-log-panel">
      <div className="svc-log-header">
        <span>Logs</span>
        <button className="svc-action-btn" onClick={onClose} title="Close"><Square size={8} /></button>
      </div>
      <div className="svc-log-content" ref={ref}>
        {logs || 'Loading...'}
      </div>
    </div>
  )
}

export function ServerServices({ discovery, serverId, onRefresh }) {
  if (!discovery) return <div className="empty-state"><div className="empty-state-text">No discovery data</div></div>

  const [busy, setBusy] = useState({})
  const [openLogs, setOpenLogs] = useState(null) // { type, name, data }
  const [actionMsg, setActionMsg] = useState(null) // { text, error }

  const doAction = useCallback(async (type, name, action) => {
    const key = `${type}-${name}-${action}`
    setBusy(prev => ({ ...prev, [key]: true }))
    setActionMsg(null)
    let res
    if (type === 'pm2') res = await electron.sshPm2Action({ serverId, name, action })
    else if (type === 'docker') res = await electron.sshDockerAction({ serverId, name, action })
    else if (type === 'systemd') res = await electron.sshSystemdAction({ serverId, unit: name, action })
    setBusy(prev => ({ ...prev, [key]: false }))
    if (res?.success) {
      setActionMsg({ text: `${action} ${name}: OK` })
      if (onRefresh) onRefresh()
    } else {
      setActionMsg({ text: `${action} ${name}: ${res?.error || 'Failed'}`, error: true })
    }
    return res
  }, [serverId, onRefresh])

  const showLogs = useCallback(async (type, name) => {
    const logKey = `${type}:${name}`
    if (openLogs?.key === logKey) { setOpenLogs(null); return }
    setOpenLogs({ key: logKey, type, name, data: null })
    let res
    if (type === 'pm2') res = await electron.sshPm2Logs({ serverId, name, lines: 80 })
    else if (type === 'docker') res = await electron.sshDockerLogs({ serverId, name, lines: 80 })
    else if (type === 'systemd') res = await electron.sshSystemdLogs({ serverId, unit: name, lines: 80 })
    setOpenLogs(prev => prev?.key === logKey ? { ...prev, data: res?.success ? res.data : res?.error || 'Failed' } : prev)
  }, [serverId, openLogs])

  const isBusy = (type, name, action) => !!busy[`${type}-${name}-${action}`]

  const hasSomething = discovery.docker?.length > 0 || discovery.pm2?.length > 0 ||
    discovery.screen?.length > 0 || discovery.systemd?.length > 0
  if (!hasSomething) {
    return <div className="empty-state"><div className="empty-state-text">No services discovered</div></div>
  }

  return (
    <div className="main" style={{ overflow: 'auto' }}>
      {actionMsg && (
        <div className={`svc-action-msg${actionMsg.error ? ' svc-action-msg-error' : ''}`}>
          {actionMsg.text}
        </div>
      )}
      {discovery.docker?.length > 0 && (
        <div className="server-section">
          <div className="server-section-title">Docker Containers ({discovery.docker.length})</div>
          <div className="server-section-list">
            {discovery.docker.map((c, i) => {
              const name = c.Names
              const isRunning = c.State === 'running'
              return (
                <React.Fragment key={i}>
                  <div className="server-svc-row">
                    <span className={`container-state-badge container-state-${c.State}`}>{c.State}</span>
                    <span className="server-svc-name">{name}</span>
                    <span className="server-svc-detail">{c.Image}</span>
                    {c.Ports && <span className="server-svc-port">{c.Ports}</span>}
                    <span className="svc-actions">
                      {!isRunning && <SvcActionBtn icon={Play} title="Start" onClick={() => doAction('docker', name, 'start')} loading={isBusy('docker', name, 'start')} />}
                      {isRunning && <SvcActionBtn icon={Square} title="Stop" onClick={() => doAction('docker', name, 'stop')} loading={isBusy('docker', name, 'stop')} />}
                      {isRunning && <SvcActionBtn icon={RotateCcw} title="Restart" onClick={() => doAction('docker', name, 'restart')} loading={isBusy('docker', name, 'restart')} />}
                      <SvcActionBtn icon={FileText} title="Logs" onClick={() => showLogs('docker', name)} />
                    </span>
                  </div>
                  {openLogs?.key === `docker:${name}` && <SvcLogPanel logs={openLogs.data} onClose={() => setOpenLogs(null)} />}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}

      {discovery.pm2?.length > 0 && (
        <div className="server-section">
          <div className="server-section-title">PM2 Processes ({discovery.pm2.length})</div>
          <div className="server-section-list">
            {discovery.pm2.map((p, i) => {
              const isOnline = p.pm2_env?.status === 'online'
              return (
                <React.Fragment key={i}>
                  <div className="server-svc-row">
                    <span className={`container-state-badge container-state-${isOnline ? 'running' : 'exited'}`}>
                      {p.pm2_env?.status || 'unknown'}
                    </span>
                    <span className="server-svc-name">{p.name}</span>
                    <span className="server-svc-detail">pid: {p.pid}</span>
                    <span className="svc-actions">
                      <SvcActionBtn icon={RotateCcw} title="Restart" onClick={() => doAction('pm2', p.name, 'restart')} loading={isBusy('pm2', p.name, 'restart')} />
                      {isOnline && <SvcActionBtn icon={Square} title="Stop" onClick={() => doAction('pm2', p.name, 'stop')} loading={isBusy('pm2', p.name, 'stop')} />}
                      <SvcActionBtn icon={Trash2} title="Delete" onClick={() => doAction('pm2', p.name, 'delete')} loading={isBusy('pm2', p.name, 'delete')} danger />
                      <SvcActionBtn icon={FileText} title="Logs" onClick={() => showLogs('pm2', p.name)} />
                    </span>
                  </div>
                  {openLogs?.key === `pm2:${p.name}` && <SvcLogPanel logs={openLogs.data} onClose={() => setOpenLogs(null)} />}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}

      {discovery.screen?.length > 0 && (
        <div className="server-section">
          <div className="server-section-title">Screen Sessions ({discovery.screen.length})</div>
          <div className="server-section-list">
            {discovery.screen.map((s, i) => (
              <div key={i} className="server-svc-row">
                <span className={`container-state-badge container-state-${s.state === 'Attached' ? 'running' : 'exited'}`}>{s.state}</span>
                <span className="server-svc-name">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {discovery.systemd?.length > 0 && (
        <div className="server-section">
          <div className="server-section-title">Systemd Services ({discovery.systemd.length})</div>
          <div className="server-section-list">
            {discovery.systemd.map((s, i) => {
              const isRunning = s.sub === 'running'
              return (
                <React.Fragment key={i}>
                  <div className="server-svc-row">
                    <span className={`container-state-badge container-state-${isRunning ? 'running' : 'exited'}`}>{s.sub}</span>
                    <span className="server-svc-name">{s.unit}</span>
                    <span className="server-svc-detail">{s.description}</span>
                    <span className="svc-actions">
                      {!isRunning && <SvcActionBtn icon={Play} title="Start" onClick={() => doAction('systemd', s.unit, 'start')} loading={isBusy('systemd', s.unit, 'start')} />}
                      {isRunning && <SvcActionBtn icon={Square} title="Stop" onClick={() => doAction('systemd', s.unit, 'stop')} loading={isBusy('systemd', s.unit, 'stop')} />}
                      <SvcActionBtn icon={RotateCcw} title="Restart" onClick={() => doAction('systemd', s.unit, 'restart')} loading={isBusy('systemd', s.unit, 'restart')} />
                      <SvcActionBtn icon={FileText} title="Logs" onClick={() => showLogs('systemd', s.unit)} />
                    </span>
                  </div>
                  {openLogs?.key === `systemd:${s.unit}` && <SvcLogPanel logs={openLogs.data} onClose={() => setOpenLogs(null)} />}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function ServerNginxSites({ sites }) {
  if (sites.length === 0) {
    return <div className="empty-state"><div className="empty-state-text">No nginx sites found</div></div>
  }
  return (
    <div className="port-table-wrapper">
      <table className="port-table">
        <thead>
          <tr><th>Server Name</th><th>Root</th><th>Proxy Pass</th></tr>
        </thead>
        <tbody>
          {sites.map((site, i) => (
            <tr key={i} className="port-row">
              <td className="port-process">{site.serverName || '\u2014'}</td>
              <td className="port-address">{site.root || '\u2014'}</td>
              <td className="port-address">{site.proxyPass || '\u2014'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ServerProjects({ projects }) {
  if (projects.length === 0) {
    return <div className="empty-state"><div className="empty-state-text">No project roots found</div></div>
  }
  return (
    <div className="port-table-wrapper">
      <table className="port-table">
        <thead>
          <tr><th>Path</th><th>Manifests</th></tr>
        </thead>
        <tbody>
          {projects.map((p, i) => (
            <tr key={i} className="port-row">
              <td className="port-process">{p.path}</td>
              <td className="port-address">{p.manifests.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ServerPorts({ ports }) {
  if (ports.length === 0) {
    return <div className="empty-state"><div className="empty-state-text">No listening ports found</div></div>
  }
  return (
    <div className="port-table-wrapper">
      <table className="port-table">
        <thead>
          <tr><th>Port</th><th>Address</th><th>PID</th><th>Process</th></tr>
        </thead>
        <tbody>
          {ports.map((p, i) => (
            <tr key={i} className="port-row">
              <td className="port-number">:{p.port}</td>
              <td className="port-address">{p.address || '*'}</td>
              <td className="port-pid">{p.pid || '\u2014'}</td>
              <td className="port-process">{p.processName || '\u2014'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ServerTerminal({ serverId, output, input, onSetInput, onExec }) {
  const outputRef = useRef(null)

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim()) return
    onExec(serverId, input.trim())
    onSetInput('')
  }

  return (
    <div className="console-view">
      <div className="console-output" ref={outputRef}>
        {output.map((line, i) => (
          <div
            key={i}
            className={`log-line${line.startsWith('[stderr]') || line.startsWith('[error]') ? ' log-line-error' : line.startsWith('$') ? ' log-line-warn' : ''}`}
          >
            {line}
          </div>
        ))}
        {output.length === 0 && (
          <div className="log-line" style={{ color: 'var(--color-text-dim)' }}>
            Type a command below and press Enter...
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="server-terminal-input">
        <span className="server-terminal-prompt">$</span>
        <input
          className="server-terminal-cmd"
          value={input}
          onChange={e => onSetInput(e.target.value)}
          placeholder="Enter command..."
          autoFocus
        />
      </form>
    </div>
  )
}
