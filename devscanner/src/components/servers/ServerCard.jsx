import React from 'react'
import { Terminal, Wifi, WifiOff, Key, Trash2, Loader } from 'lucide-react'
import { SERVER_TAG_COLORS } from '../../constants'

export default function ServerCard({ server, connection, discovering, onConnect, onDisconnect, onDelete, onSelect }) {
  const isConnected = connection === 'connected'
  const isConnecting = connection === 'connecting'
  return (
    <div
      className={`server-card${isConnected ? ' server-card-connected' : ''}`}
      onClick={isConnected ? onSelect : undefined}
      style={isConnected ? { cursor: 'pointer' } : undefined}
    >
      <div className="server-card-header">
        <div className="server-card-name">{server.name}</div>
        <span className={`server-conn-badge server-conn-${connection}`}>
          {isConnecting && <Loader size={10} className="spin" />}
          {isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}
        </span>
      </div>
      <div className="server-card-info">
        <span>{server.username}@{server.host}:{server.port || 22}</span>
        <span className="server-auth-badge">
          {server.authType === 'key' ? <Key size={10} /> : <span>***</span>}
          {server.authType === 'key' ? ' key' : ' password'}
        </span>
      </div>
      {(server.tags?.length > 0) && (
        <div className="tags" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
          {server.tags.map(tag => (
            <span
              key={tag}
              className={`tag server-tag-${tag.toLowerCase().replace(/[^a-z0-9]/g, '')}`}
              style={{
                backgroundColor: `${SERVER_TAG_COLORS[tag] || '#888'}26`,
                borderColor: SERVER_TAG_COLORS[tag] || '#888',
                color: SERVER_TAG_COLORS[tag] || '#888'
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="server-card-footer">
        {isConnected ? (
          <>
            <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onSelect() }}>
              <Terminal size={11} /> Open
            </button>
            <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDisconnect() }}>
              <WifiOff size={11} />
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={onConnect}
            disabled={isConnecting}
          >
            {isConnecting ? <Loader size={11} className="spin" /> : <Wifi size={11} />}
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        )}
        <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete() }}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}
