import React, { useState, useCallback } from 'react'
import { Plus, Trash2, Check } from 'lucide-react'
import CustomSelect from '../CustomSelect'

const ANSI_COLORS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
]

export default function ThemeSettings({ terminalHook }) {
  const { terminalSettings, customThemes, activeTheme, updateSettings, PRESET_THEMES } = terminalHook || {}
  const [editingTheme, setEditingTheme] = useState(null) // null or theme object being edited
  const [themeName, setThemeName] = useState('')

  const presetList = Object.entries(PRESET_THEMES || {}).map(([id, theme]) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1).replace('-', ' '), ...theme }))
  const allThemes = [...presetList, ...(customThemes || [])]

  const activeThemeId = terminalSettings?.activeThemeId || 'dark'

  const handleSelectTheme = useCallback(async (themeId) => {
    await updateSettings?.({ activeThemeId: themeId })
  }, [updateSettings])

  const handleNewCustomTheme = () => {
    const base = activeTheme || PRESET_THEMES?.dark || {}
    setEditingTheme({
      id: `custom_${Date.now()}`,
      name: 'My Theme',
      background: base.background || '#0a0a0a',
      foreground: base.foreground || '#e8e8e8',
      cursor: base.cursor || '#00ff88',
      cursorAccent: base.cursorAccent || '#0a0a0a',
      selectionBackground: base.selectionBackground || 'rgba(0,255,136,0.2)',
      ...Object.fromEntries(ANSI_COLORS.map(c => [c, base[c] || '#888888']))
    })
    setThemeName('My Theme')
  }

  const handleSaveCustomTheme = async () => {
    if (!editingTheme) return
    const saved = { ...editingTheme, name: themeName || 'My Theme' }
    const existing = (customThemes || []).filter(t => t.id !== saved.id)
    const newThemes = [...existing, saved]
    await updateSettings?.(null, newThemes)
    setEditingTheme(null)
  }

  const handleDeleteCustomTheme = async (themeId) => {
    const newThemes = (customThemes || []).filter(t => t.id !== themeId)
    const updates = {}
    if (activeThemeId === themeId) updates.activeThemeId = 'dark'
    await updateSettings?.(Object.keys(updates).length ? updates : null, newThemes)
  }

  const updateColor = (key, value) => {
    setEditingTheme(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div>
      {/* General terminal settings */}
      <div style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '0.5rem' }}>Terminal Settings</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Font Size</label>
            <input
              className="form-input"
              type="number"
              min={8} max={32}
              value={terminalSettings?.fontSize || 14}
              onChange={e => updateSettings?.({ fontSize: parseInt(e.target.value, 10) || 14 })}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Scrollback Lines</label>
            <input
              className="form-input"
              type="number"
              min={500} max={50000} step={500}
              value={terminalSettings?.scrollbackLimit || 5000}
              onChange={e => updateSettings?.({ scrollbackLimit: parseInt(e.target.value, 10) || 5000 })}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Cursor Style</label>
            <CustomSelect
              value={terminalSettings?.cursorStyle || 'block'}
              onChange={v => updateSettings?.({ cursorStyle: v })}
              options={[
                { value: 'block', label: 'Block' },
                { value: 'underline', label: 'Underline' },
                { value: 'bar', label: 'Bar' }
              ]}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Cursor Blink</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', marginTop: '4px' }}>
              <input
                type="checkbox"
                checked={terminalSettings?.cursorBlink !== false}
                onChange={e => updateSettings?.({ cursorBlink: e.target.checked })}
              />
              Enabled
            </label>
          </div>
        </div>
      </div>

      {/* Theme selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '13px', fontWeight: 500 }}>Themes</span>
        <button className="btn btn-sm" onClick={handleNewCustomTheme}>
          <Plus size={11} /> Custom Theme
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
        {allThemes.map(theme => (
          <div
            key={theme.id}
            onClick={() => handleSelectTheme(theme.id)}
            style={{
              padding: '0.5rem',
              borderRadius: '6px',
              border: activeThemeId === theme.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
              cursor: 'pointer',
              position: 'relative'
            }}
          >
            <div style={{
              height: '40px',
              borderRadius: '4px',
              background: theme.background,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              padding: '4px',
              marginBottom: '4px'
            }}>
              <span style={{ color: theme.foreground, fontSize: '10px', fontFamily: 'monospace' }}>$&nbsp;</span>
              <span style={{ color: theme.green, fontSize: '10px', fontFamily: 'monospace' }}>ls</span>
              <span style={{ color: theme.blue, fontSize: '10px', fontFamily: 'monospace' }}>&nbsp;-la</span>
            </div>
            <div style={{ fontSize: '11px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
              {activeThemeId === theme.id && <Check size={10} style={{ color: 'var(--color-accent)' }} />}
              {theme.name}
              {!PRESET_THEMES?.[theme.id] && (
                <button
                  className="btn btn-sm"
                  onClick={e => { e.stopPropagation(); handleDeleteCustomTheme(theme.id) }}
                  style={{ padding: '1px 3px', marginLeft: 'auto' }}
                  title="Delete"
                >
                  <Trash2 size={9} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Custom theme editor */}
      {editingTheme && (
        <div style={{
          background: 'var(--color-bg-secondary, #111)',
          border: '1px solid var(--color-border)',
          borderRadius: '6px',
          padding: '0.75rem'
        }}>
          <div className="form-group">
            <label className="form-label">Theme Name</label>
            <input className="form-input" value={themeName} onChange={e => setThemeName(e.target.value)} />
          </div>

          {/* Preview */}
          <div style={{
            height: '60px',
            borderRadius: '4px',
            background: editingTheme.background,
            padding: '8px',
            fontFamily: 'monospace',
            fontSize: '11px',
            marginBottom: '0.5rem',
            overflow: 'hidden'
          }}>
            <div><span style={{ color: editingTheme.green }}>user@host</span><span style={{ color: editingTheme.foreground }}>:</span><span style={{ color: editingTheme.blue }}>~</span><span style={{ color: editingTheme.foreground }}>$ ls -la</span></div>
            <div><span style={{ color: editingTheme.cyan }}>drwxr-xr-x</span> <span style={{ color: editingTheme.yellow }}>3</span> <span style={{ color: editingTheme.foreground }}>user user 4096</span> <span style={{ color: editingTheme.magenta }}>file.txt</span></div>
            <div style={{ color: editingTheme.red }}>Error: permission denied</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem', marginBottom: '0.5rem' }}>
            <ColorInput label="Background" value={editingTheme.background} onChange={v => updateColor('background', v)} />
            <ColorInput label="Foreground" value={editingTheme.foreground} onChange={v => updateColor('foreground', v)} />
            <ColorInput label="Cursor" value={editingTheme.cursor} onChange={v => updateColor('cursor', v)} />
          </div>

          <div style={{ fontSize: '11px', color: 'var(--color-text-dim)', marginBottom: '0.25rem' }}>ANSI Colors</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '0.25rem', marginBottom: '0.5rem' }}>
            {ANSI_COLORS.map(c => (
              <ColorInput key={c} label={c.replace('bright', 'br')} value={editingTheme[c]} onChange={v => updateColor(c, v)} compact />
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => setEditingTheme(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleSaveCustomTheme}>Save Theme</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ColorInput({ label, value, onChange, compact }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <label style={{ fontSize: compact ? '9px' : '10px', color: 'var(--color-text-dim)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{label}</label>
      <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
        <input
          type="color"
          value={value?.startsWith('rgba') ? '#888888' : (value || '#000000')}
          onChange={e => onChange(e.target.value)}
          style={{ width: compact ? '20px' : '24px', height: compact ? '20px' : '24px', padding: 0, border: 'none', cursor: 'pointer' }}
        />
        {!compact && (
          <input
            className="form-input"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            style={{ fontSize: '10px', padding: '2px 4px', flex: 1 }}
          />
        )}
      </div>
    </div>
  )
}
