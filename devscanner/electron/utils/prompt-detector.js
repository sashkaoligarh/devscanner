class PromptDetector {
  constructor() {
    this.mode = 'detecting' // 'detecting' | 'osc133' | 'regex'
    this.osc133Active = false
    this.buffer = ''
    this.state = 'idle' // idle | prompt | command | executing
    this.currentCommand = ''
    this.fallbackTimer = null
    this.lastPromptLine = ''
  }

  getOSC133InitScript() {
    // Shell integration script that injects OSC 133 markers
    // Works with bash and zsh
    return [
      '# OSC 133 shell integration',
      'if [ -n "$BASH_VERSION" ]; then',
      '  _osc133_prompt_cmd() { printf "\\033]133;A\\007"; }',
      '  _osc133_preexec() { printf "\\033]133;C\\007"; }',
      '  PROMPT_COMMAND="_osc133_prompt_cmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
      '  trap \'_osc133_preexec\' DEBUG',
      'elif [ -n "$ZSH_VERSION" ]; then',
      '  _osc133_precmd() { printf "\\033]133;A\\007"; }',
      '  _osc133_preexec() { printf "\\033]133;C\\007"; }',
      '  precmd_functions+=(_osc133_precmd)',
      '  preexec_functions+=(_osc133_preexec)',
      'fi',
      ''
    ].join('\n')
  }

  processData(data) {
    const str = typeof data === 'string' ? data : data.toString('binary')
    const commands = []

    // Check for OSC 133 markers
    if (str.includes('\x1b]133;')) {
      this.osc133Active = true
      this.mode = 'osc133'
      return this._processOSC133(str)
    }

    // If we detected OSC 133 before, keep using it
    if (this.mode === 'osc133') {
      return this._processOSC133(str)
    }

    // Fallback to regex prompt detection
    if (this.mode === 'regex' || this.mode === 'detecting') {
      // Switch to regex after 5s if no OSC 133 detected
      if (this.mode === 'detecting') {
        if (!this.fallbackTimer) {
          this.fallbackTimer = setTimeout(() => {
            this.mode = 'regex'
          }, 5000)
        }
      }

      if (this.mode === 'regex') {
        return this._processRegex(str)
      }
    }

    return { commands, osc133Active: this.osc133Active }
  }

  _processOSC133(data) {
    const commands = []
    // Split by OSC 133 markers
    const parts = data.split(/\x1b\]133;([A-D])\x07/)

    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'A') {
        // Prompt start
        this.state = 'prompt'
        this.currentCommand = ''
      } else if (parts[i] === 'B') {
        // Command start (user pressed enter after typing)
        this.state = 'command'
      } else if (parts[i] === 'C') {
        // Command execution begins
        if (this.state === 'command' || this.state === 'prompt') {
          // Extract command from the text between A and C
          const cmd = this.currentCommand.trim()
          if (cmd && !this._isInitScript(cmd)) {
            commands.push(cmd)
          }
        }
        this.state = 'executing'
        this.currentCommand = ''
      } else if (parts[i] === 'D') {
        // Command finished
        this.state = 'idle'
      } else if (this.state === 'prompt' || this.state === 'command') {
        // Accumulate text as potential command
        // Strip ANSI escapes and prompt characters
        const clean = this._stripAnsi(parts[i]).trim()
        // The command text is after the last prompt indicator
        const afterPrompt = this._extractAfterPrompt(clean)
        if (afterPrompt) {
          this.currentCommand = afterPrompt
        }
      }
    }

    return { commands, osc133Active: this.osc133Active }
  }

  _processRegex(data) {
    const commands = []
    this.buffer += data

    // Split buffer by newlines
    const lines = this.buffer.split(/\r?\n/)
    // Keep last (possibly incomplete) line in buffer
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      const clean = this._stripAnsi(line).trim()
      if (!clean) continue

      // Match common prompt patterns and extract command after them
      const cmd = this._extractAfterPrompt(clean)
      if (cmd && !this._isInitScript(cmd) && cmd.length < 500) {
        commands.push(cmd)
      }
    }

    return { commands, osc133Active: false }
  }

  _extractAfterPrompt(line) {
    // Common prompt patterns:
    // user@host:path$ command
    // [user@host dir]$ command
    // $ command
    // # command
    // > command
    // % command
    const patterns = [
      /^[^@]+@[^:]+:[^$#%>]*[$#%>]\s+(.+)$/,    // user@host:path$ cmd
      /^\[[^\]]+\]\s*[$#%>]\s+(.+)$/,              // [user@host dir]$ cmd
      /^[$#%>]\s+(.+)$/,                            // $ cmd
      /^[^$#%>]*[$#%>]\s+(.+)$/                     // anything$ cmd
    ]

    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (match && match[1]) {
        return match[1].trim()
      }
    }
    return null
  }

  _stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
              .replace(/\x1b\][^\x07]*\x07/g, '')
              .replace(/\x1b\[[^@-~]*[@-~]/g, '')
  }

  _isInitScript(cmd) {
    return cmd.includes('_osc133_') || cmd.includes('PROMPT_COMMAND') || cmd.includes('precmd_functions')
  }

  reset() {
    this.mode = 'detecting'
    this.osc133Active = false
    this.buffer = ''
    this.state = 'idle'
    this.currentCommand = ''
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }
  }
}

module.exports = { PromptDetector }
