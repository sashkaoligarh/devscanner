import React from 'react'
import { Plus, Server } from 'lucide-react'
import ServerCard from './ServerCard'
import ServerDetail from './ServerDetail'

export default function RemoteServers({
  servers, connections, discovery, discovering, activeServerId, serverSubTab,
  terminalOutput, terminalInput, onSetActiveServer, onSetSubTab,
  onConnect, onDisconnect, onDiscover, onDelete, onAddServer, onExec, onSetTerminalInput,
  remoteRunning, remoteLogs
}) {
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
      />
    )
  }

  return (
    <div className="port-scanner">
      <div className="port-scanner-toolbar">
        <div className="port-scanner-controls">
          <button className="btn btn-primary" onClick={onAddServer}>
            <Plus size={13} /> Add Server
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
                onSelect={() => { onSetActiveServer(server.id); onSetSubTab('services') }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
