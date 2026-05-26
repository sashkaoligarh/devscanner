import React, { useState } from 'react'
import { Plus, Server, Settings } from 'lucide-react'
import ServerCard from './ServerCard'
import ServerDetail from './ServerDetail'
import SSHKeysSettings from '../settings/SSHKeysSettings'
import ThemeSettings from '../settings/ThemeSettings'
import ShortcutSettings from '../settings/ShortcutSettings'

function RemoteServers({
  servers, connections, discovery, discovering, activeServerId, serverSubTab,
  terminalOutput, terminalInput, onSetActiveServer, onSetSubTab,
  onConnect, onDisconnect, onDiscover, onDelete, onAddServer, onExec, onSetTerminalInput,
  remoteRunning, remoteLogs, terminalHook
}) {
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState('keys')

  if (activeServerId) {
    const server = servers.find(s => s.id === activeServerId)
    if (!server) { onSetActiveServer(null); return null }
    const disc = discovery[activeServerId]
    const isConnected = connections[activeServerId] === 'connected'
    return (
      <ServerDetail
        server={server}
        disc={disc}
        isConnected={isConnected}
        discovering={discovering}
        connections={connections}
        serverSubTab={serverSubTab}
        terminalOutput={terminalOutput}
        terminalInput={terminalInput}
        onSetActiveServer={onSetActiveServer}
        onSetSubTab={onSetSubTab}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onDiscover={onDiscover}
        onExec={onExec}
        onSetTerminalInput={onSetTerminalInput}
        remoteRunning={remoteRunning}
        remoteLogs={remoteLogs}
        terminalHook={terminalHook}
        onOpenSettings={() => setShowSettings(true)}
      />
    )
  }

  // Settings view
  if (showSettings) {
    return (
      <div className="port-scanner">
        <div className="port-scanner-toolbar">
          <div className="port-scanner-controls">
            <button className="btn" onClick={() => setShowSettings(false)}>
              <Server size={12} /> Back to Servers
            </button>
          </div>
          <span className="port-scanner-count">
            <Settings size={12} /> Terminal Settings
          </span>
        </div>
        <div className="server-sub-tabs">
          {[
            { id: 'keys', label: 'SSH Keys' },
            { id: 'themes', label: 'Themes' },
            { id: 'shortcuts', label: 'Shortcuts' }
          ].map(tab => (
            <button
              key={tab.id}
              className={`server-sub-tab${settingsTab === tab.id ? ' active' : ''}`}
              onClick={() => setSettingsTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="main" style={{ overflow: 'auto' }}>
          <div className="settings-inline-content">
            {settingsTab === 'keys' && <SSHKeysSettings />}
            {settingsTab === 'themes' && <ThemeSettings terminalHook={terminalHook} />}
            {settingsTab === 'shortcuts' && <ShortcutSettings terminalHook={terminalHook} />}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="port-scanner">
      <div className="port-scanner-toolbar">
        <div className="port-scanner-controls">
          <button className="btn btn-primary" onClick={onAddServer}>
            <Plus size={13} /> Add Server
          </button>
          <button className="btn" onClick={() => setShowSettings(true)}>
            <Settings size={13} /> Settings
          </button>
        </div>
        <span className="port-scanner-count">
          {servers.filter(s => connections[s.id] === 'connected').length} connected / {servers.length} server{servers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {servers.length === 0 ? (
        <div className="empty-state">
          <Server size={48} className="empty-state-icon" />
          <div className="empty-state-text">No remote servers configured</div>
          <button className="btn btn-primary" onClick={onAddServer}>
            <Plus size={14} /> Add Server
          </button>
        </div>
      ) : (
        <div className="main">
          <div className="server-grid">
            {servers.map(server => (
              <ServerCard
                key={server.id}
                server={server}
                connection={connections[server.id] || 'disconnected'}
                discovering={discovering[server.id]}
                onConnect={() => onConnect(server)}
                onDisconnect={() => onDisconnect(server.id)}
                onDelete={() => {
                  if (window.confirm(`Delete server "${server.name}"?`)) onDelete(server.id)
                }}
                onSelect={() => { onSetActiveServer(server.id); onSetSubTab('terminal') }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(RemoteServers)
