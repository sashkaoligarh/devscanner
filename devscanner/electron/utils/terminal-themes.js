const PRESET_THEMES = {
  dark: {
    id: 'dark',
    name: 'Dark',
    background: '#0a0a0a',
    foreground: '#e8e8e8',
    cursor: '#00ff88',
    cursorAccent: '#0a0a0a',
    selectionBackground: 'rgba(0, 255, 136, 0.2)',
    black: '#1a1a1a', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#6272a4', magenta: '#ff79c6', cyan: '#8be9fd', white: '#e8e8e8',
    brightBlack: '#555555', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
    brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff'
  },
  light: {
    id: 'light',
    name: 'Light',
    background: '#fafafa',
    foreground: '#383a42',
    cursor: '#526eff',
    cursorAccent: '#fafafa',
    selectionBackground: 'rgba(82, 110, 255, 0.2)',
    black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
    blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#fafafa',
    brightBlack: '#4f525e', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
    brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff'
  },
  monokai: {
    id: 'monokai',
    name: 'Monokai',
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    cursorAccent: '#272822',
    selectionBackground: 'rgba(73, 72, 62, 0.6)',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75',
    brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5'
  },
  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    cursorAccent: '#002b36',
    selectionBackground: 'rgba(147, 161, 161, 0.2)',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
    brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
  },
  'solarized-light': {
    id: 'solarized-light',
    name: 'Solarized Light',
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#586e75',
    cursorAccent: '#fdf6e3',
    selectionBackground: 'rgba(88, 110, 117, 0.2)',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
    brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
  }
}

function getThemeById(id, customThemes = []) {
  if (PRESET_THEMES[id]) return PRESET_THEMES[id]
  const custom = customThemes.find(t => t.id === id)
  return custom || PRESET_THEMES.dark
}

module.exports = { PRESET_THEMES, getThemeById }
