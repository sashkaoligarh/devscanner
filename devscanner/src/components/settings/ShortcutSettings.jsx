import React, { useState, useCallback, useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'

const DEFAULT_SHORTCUTS = {
  copy: 'Ctrl+Shift+C',
  paste: 'Ctrl+Shift+V',
  clear: 'Ctrl+L',
  search: 'Ctrl+Shift+F',
  scrollUp: 'Shift+PageUp',
  scrollDown: 'Shift+PageDown',
  scrollToTop: 'Ctrl+Home',
  scrollToBottom: 'Ctrl+End',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0'
}

const ACTION_LABELS = {
  copy: 'Copy',
  paste: 'Paste',
  clear: 'Clear Screen',
  search: 'Search',
  scrollUp: 'Scroll Up',
  scrollDown: 'Scroll Down',
  scrollToTop: 'Scroll to Top',
  scrollToBottom: 'Scroll to Bottom',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  zoomReset: 'Zoom Reset'
}

export default function ShortcutSettings({ terminalHook }) {
  const { shortcuts, updateSettings } = terminalHook || {}
  const [editingAction, setEditingAction] = useState(null)
  const [capturedCombo, setCapturedCombo] = useState(null)
  const [conflict, setConflict] = useState(null)
  const captureRef = useRef(null)

  const currentShortcuts = { ...DEFAULT_SHORTCUTS, ...(shortcuts || {}) }

  const handleStartEdit = (action) => {
    setEditingAction(action)
    setCapturedCombo(null)
    setConflict(null)
  }

  const handleKeyCapture = useCallback((event) => {
    if (!editingAction) return
    event.preventDefault()
    event.stopPropagation()

    // Ignore modifier-only presses
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return

    const parts = []
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
    if (event.shiftKey) parts.push('Shift')
    if (event.altKey) parts.push('Alt')
    parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key)
    const combo = parts.join('+')
    setCapturedCombo(combo)

    // Check for conflicts
    const normalized = normalizeCombo(combo)
    for (const [action, binding] of Object.entries(currentShortcuts)) {
      if (action !== editingAction && normalizeCombo(binding) === normalized) {
        setConflict(action)
        return
      }
    }
    setConflict(null)
  }, [editingAction, currentShortcuts])

  useEffect(() => {
    if (editingAction) {
      const handler = (e) => handleKeyCapture(e)
      window.addEventListener('keydown', handler, true)
      return () => window.removeEventListener('keydown', handler, true)
    }
  }, [editingAction, handleKeyCapture])

  const handleSave = async () => {
    if (!capturedCombo || !editingAction) return
    const newShortcuts = { ...currentShortcuts, [editingAction]: capturedCombo }
    // If overriding a conflict, clear the conflicting action
    if (conflict) {
      newShortcuts[conflict] = ''
    }
    await updateSettings?.(null, undefined, newShortcuts)
    setEditingAction(null)
    setCapturedCombo(null)
    setConflict(null)
  }

  const handleCancel = () => {
    setEditingAction(null)
    setCapturedCombo(null)
    setConflict(null)
  }

  const handleResetAll = async () => {
    if (!window.confirm('Reset all shortcuts to defaults?')) return
    await updateSettings?.(null, undefined, DEFAULT_SHORTCUTS)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '13px', fontWeight: 500 }}>Keyboard Shortcuts</span>
        <button className="btn btn-sm" onClick={handleResetAll}>
          <RotateCcw size={11} /> Reset All
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {Object.entries(ACTION_LABELS).map(([action, label]) => (
          <div key={action} style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0.4rem 0.5rem',
            borderBottom: '1px solid var(--color-border)',
            fontSize: '12px'
          }}>
            <span style={{ flex: 1 }}>{label}</span>
            {editingAction === action ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: capturedCombo ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
                  color: capturedCombo ? '#000' : 'var(--color-text-dim)',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  minWidth: '100px',
                  textAlign: 'center'
                }}>
                  {capturedCombo || 'Press keys...'}
                </span>
                {conflict && (
                  <span style={{ fontSize: '10px', color: '#ff5555' }}>
                    Conflicts with {ACTION_LABELS[conflict]}
                  </span>
                )}
                <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={!capturedCombo} style={{ fontSize: '10px', padding: '1px 6px' }}>
                  {conflict ? 'Override' : 'Save'}
                </button>
                <button className="btn btn-sm" onClick={handleCancel} style={{ fontSize: '10px', padding: '1px 6px' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <code style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: 'var(--color-bg-secondary, #111)',
                  fontSize: '11px',
                  color: 'var(--color-text-dim)'
                }}>
                  {currentShortcuts[action] || 'Not set'}
                </code>
                <button
                  className="btn btn-sm"
                  onClick={() => handleStartEdit(action)}
                  style={{ fontSize: '10px', padding: '1px 6px' }}
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function normalizeCombo(combo) {
  if (!combo) return ''
  return combo.split('+').map(p => p.trim().toLowerCase()).sort().join('+')
}
