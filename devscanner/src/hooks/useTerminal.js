import { useState, useCallback, useEffect, useRef } from 'react'
import electron from '../electronApi'

const PRESET_THEMES = {
  dark: {
    background: '#0a0a0a', foreground: '#e8e8e8', cursor: '#00ff88', cursorAccent: '#0a0a0a',
    selectionBackground: 'rgba(0, 255, 136, 0.2)',
    black: '#1a1a1a', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#6272a4', magenta: '#ff79c6', cyan: '#8be9fd', white: '#e8e8e8',
    brightBlack: '#555555', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
    brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff'
  },
  light: {
    background: '#fafafa', foreground: '#383a42', cursor: '#526eff', cursorAccent: '#fafafa',
    selectionBackground: 'rgba(82, 110, 255, 0.2)',
    black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
    blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#fafafa',
    brightBlack: '#4f525e', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
    brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff'
  },
  monokai: {
    background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', cursorAccent: '#272822',
    selectionBackground: 'rgba(73, 72, 62, 0.6)',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75',
    brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5'
  },
  'solarized-dark': {
    background: '#002b36', foreground: '#839496', cursor: '#93a1a1', cursorAccent: '#002b36',
    selectionBackground: 'rgba(147, 161, 161, 0.2)',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
    brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
  },
  'solarized-light': {
    background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', cursorAccent: '#fdf6e3',
    selectionBackground: 'rgba(88, 110, 117, 0.2)',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
    brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
  }
}

const DEFAULT_SETTINGS = {
  activeThemeId: 'dark',
  scrollbackLimit: 5000,
  commandHistoryLimit: 1000,
  fontSize: 14,
  cursorBlink: true,
  cursorStyle: 'block'
}

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

export default function useTerminal() {
  const [sessionStatus, setSessionStatus] = useState({}) // serverId -> 'connecting' | 'connected' | 'disconnected' | 'error'
  const [terminalSettings, setTerminalSettings] = useState(DEFAULT_SETTINGS)
  const [customThemes, setCustomThemes] = useState([])
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS)
  const settingsLoaded = useRef(false)

  // Load settings on mount
  useEffect(() => {
    if (settingsLoaded.current) return
    settingsLoaded.current = true

    electron.terminalSettingsGet().then(result => {
      if (result.success && result.data) {
        if (result.data.settings) {
          setTerminalSettings(prev => ({ ...prev, ...result.data.settings }))
        }
        if (result.data.customThemes) {
          setCustomThemes(result.data.customThemes)
        }
        if (result.data.shortcuts) {
          setShortcuts(prev => ({ ...prev, ...result.data.shortcuts }))
        }
      }
    })
  }, [])

  const resolveTheme = useCallback((themeId) => {
    if (PRESET_THEMES[themeId]) return PRESET_THEMES[themeId]
    const custom = customThemes.find(t => t.id === themeId)
    if (custom) {
      const { id, name, ...themeColors } = custom
      return themeColors
    }
    return PRESET_THEMES.dark
  }, [customThemes])

  const activeTheme = resolveTheme(terminalSettings.activeThemeId)

  const openTerminal = useCallback(async (serverId) => {
    setSessionStatus(prev => ({ ...prev, [serverId]: 'connecting' }))
    const result = await electron.terminalOpen({ serverId })
    if (result.success) {
      setSessionStatus(prev => ({ ...prev, [serverId]: 'connected' }))
    } else {
      setSessionStatus(prev => ({ ...prev, [serverId]: 'error' }))
    }
    return result
  }, [])

  const closeTerminal = useCallback(async (serverId) => {
    const result = await electron.terminalClose({ sessionId: serverId })
    setSessionStatus(prev => ({ ...prev, [serverId]: 'disconnected' }))
    return result
  }, [])

  const updateSettings = useCallback(async (newSettings, newThemes, newShortcuts) => {
    const payload = {}
    if (newSettings) {
      payload.settings = newSettings
      setTerminalSettings(prev => ({ ...prev, ...newSettings }))
    }
    if (newThemes !== undefined) {
      payload.customThemes = newThemes
      setCustomThemes(newThemes)
    }
    if (newShortcuts) {
      payload.shortcuts = newShortcuts
      setShortcuts(prev => ({ ...prev, ...newShortcuts }))
    }
    return electron.terminalSettingsSave(payload)
  }, [])

  const reloadSettings = useCallback(async () => {
    const result = await electron.terminalSettingsGet()
    if (result.success && result.data) {
      if (result.data.settings) setTerminalSettings(prev => ({ ...prev, ...result.data.settings }))
      if (result.data.customThemes) setCustomThemes(result.data.customThemes)
      if (result.data.shortcuts) setShortcuts(prev => ({ ...prev, ...result.data.shortcuts }))
    }
  }, [])

  return {
    sessionStatus,
    setSessionStatus,
    terminalSettings,
    customThemes,
    shortcuts,
    activeTheme,
    resolveTheme,
    openTerminal,
    closeTerminal,
    updateSettings,
    reloadSettings,
    PRESET_THEMES
  }
}
