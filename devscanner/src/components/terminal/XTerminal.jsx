import React, { useRef, useEffect, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import electron from '../../electronApi'

export default function XTerminal({
  serverId, theme, shortcuts, fontSize, scrollbackLimit,
  cursorBlink, cursorStyle, onDisconnect, onReconnect
}) {
  const containerRef = useRef(null)
  const terminalRef = useRef(null)
  const fitAddonRef = useRef(null)
  const searchAddonRef = useRef(null)
  const initializedRef = useRef(false)
  const disconnectedRef = useRef(false)

  // Initialize terminal
  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return
    initializedRef.current = true

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: fontSize || 14,
      scrollback: scrollbackLimit || 5000,
      cursorBlink: cursorBlink !== false,
      cursorStyle: cursorStyle || 'block',
      theme: theme || undefined,
      allowProposedApi: true,
      convertEol: false,
      allowTransparency: true
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon()
    const unicode11Addon = new Unicode11Addon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.loadAddon(unicode11Addon)
    terminal.unicode.activeVersion = '11'

    terminal.open(containerRef.current)

    // Delay fit to ensure container has dimensions
    requestAnimationFrame(() => {
      try { fitAddon.fit() } catch { /* container may not be visible yet */ }
    })

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    // Wire terminal input → IPC with large paste protection
    const dataDisposable = terminal.onData((data) => {
      if (disconnectedRef.current) return
      if (data.length > 5000) {
        if (!window.confirm(`You are about to paste ${data.length} characters. Continue?`)) return
      }
      electron.sendTerminalInput(serverId, data)
    })

    // Wire terminal resize → IPC
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      electron.sendTerminalResize(serverId, cols, rows)
    })

    // Wire IPC output → terminal
    const handleOutput = (payload) => {
      if (payload.sessionId === serverId) {
        terminal.write(payload.data)
      }
    }
    electron.onTerminalOutput(handleOutput)

    // Wire IPC closed → show disconnect
    const handleClosed = (payload) => {
      if (payload.sessionId === serverId) {
        disconnectedRef.current = true
        terminal.write('\r\n\x1b[33m[Connection closed: ' + (payload.reason || 'unknown') + ']\x1b[0m\r\n')
        if (onDisconnect) onDisconnect(payload.reason)
      }
    }
    electron.onTerminalClosed(handleClosed)

    // Wire IPC error → show in terminal
    const handleError = (payload) => {
      if (payload.sessionId === serverId) {
        terminal.write('\r\n\x1b[31m[Error: ' + payload.error + ']\x1b[0m\r\n')
      }
    }
    electron.onTerminalError(handleError)

    // ResizeObserver for container resize
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { fitAddon.fit() } catch { /* ignore */ }
      })
    })
    resizeObserver.observe(containerRef.current)

    // Keyboard shortcut handler
    terminal.attachCustomKeyEventHandler((event) => {
      if (!shortcuts || event.type !== 'keydown') return true
      const combo = buildCombo(event)
      for (const [action, binding] of Object.entries(shortcuts)) {
        if (normalizeCombo(combo) === normalizeCombo(binding)) {
          executeAction(action, terminal, searchAddon)
          return false
        }
      }
      return true
    })

    // Focus terminal
    terminal.focus()

    return () => {
      dataDisposable.dispose()
      resizeDisposable.dispose()
      resizeObserver.disconnect()
      electron.removeTerminalOutputListener()
      electron.removeTerminalClosedListener()
      electron.removeTerminalErrorListener()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      initializedRef.current = false
    }
  }, [serverId])

  // Apply theme changes
  useEffect(() => {
    if (terminalRef.current && theme) {
      terminalRef.current.options.theme = theme
    }
  }, [theme])

  // Apply font size changes
  useEffect(() => {
    if (terminalRef.current && fontSize) {
      terminalRef.current.options.fontSize = fontSize
      try { fitAddonRef.current?.fit() } catch {}
    }
  }, [fontSize])

  // Apply cursor settings
  useEffect(() => {
    if (terminalRef.current) {
      if (cursorBlink !== undefined) terminalRef.current.options.cursorBlink = cursorBlink
      if (cursorStyle) terminalRef.current.options.cursorStyle = cursorStyle
    }
  }, [cursorBlink, cursorStyle])

  // Focus on click
  const handleClick = useCallback(() => {
    terminalRef.current?.focus()
  }, [])

  return (
    <div
      ref={containerRef}
      className="xterminal-container"
      onClick={handleClick}
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  )
}

function buildCombo(event) {
  const parts = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  const key = event.key
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key)
  }
  return parts.join('+')
}

function normalizeCombo(combo) {
  if (!combo) return ''
  return combo.split('+').map(p => p.trim().toLowerCase()).sort().join('+')
}

function executeAction(action, terminal, searchAddon) {
  switch (action) {
    case 'copy': {
      const sel = terminal.getSelection()
      if (sel) navigator.clipboard.writeText(sel)
      break
    }
    case 'paste':
      navigator.clipboard.readText().then(text => {
        if (text) terminal.paste(text)
      })
      break
    case 'clear':
      terminal.clear()
      break
    case 'search':
      // Toggle search — xterm search addon doesn't have built-in UI,
      // just trigger find with prompt for now
      searchAddon.findNext('')
      break
    case 'scrollUp':
      terminal.scrollPages(-1)
      break
    case 'scrollDown':
      terminal.scrollPages(1)
      break
    case 'scrollToTop':
      terminal.scrollToTop()
      break
    case 'scrollToBottom':
      terminal.scrollToBottom()
      break
    case 'zoomIn':
      terminal.options.fontSize = Math.min((terminal.options.fontSize || 14) + 1, 32)
      break
    case 'zoomOut':
      terminal.options.fontSize = Math.max((terminal.options.fontSize || 14) - 1, 8)
      break
    case 'zoomReset':
      terminal.options.fontSize = 14
      break
  }
}
