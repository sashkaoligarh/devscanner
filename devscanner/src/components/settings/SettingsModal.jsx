import React, { useState } from 'react'
import { X, Key, Palette, Keyboard } from 'lucide-react'
import SSHKeysSettings from './SSHKeysSettings'
import ThemeSettings from './ThemeSettings'
import ShortcutSettings from './ShortcutSettings'

export default function SettingsModal({ onClose, initialTab = 'keys', terminalHook }) {
  const [activeTab, setActiveTab] = useState(initialTab)

  const tabs = [
    { id: 'keys', label: 'SSH Keys', icon: Key },
    { id: 'themes', label: 'Themes', icon: Palette },
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard }
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px', width: '90%' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div className="modal-title" style={{ margin: 0 }}>Settings</div>
          <button className="btn btn-sm" onClick={onClose} style={{ padding: '4px' }}>
            <X size={14} />
          </button>
        </div>

        <div className="settings-tabs" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`btn btn-sm${activeTab === tab.id ? ' btn-primary' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              style={{ borderRadius: '4px 4px 0 0', borderBottom: 'none' }}
            >
              <tab.icon size={12} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-content" style={{ minHeight: '400px', maxHeight: '60vh', overflow: 'auto' }}>
          {activeTab === 'keys' && <SSHKeysSettings />}
          {activeTab === 'themes' && <ThemeSettings terminalHook={terminalHook} />}
          {activeTab === 'shortcuts' && <ShortcutSettings terminalHook={terminalHook} />}
        </div>
      </div>
    </div>
  )
}
