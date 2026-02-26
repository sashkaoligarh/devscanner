// Shared lucide-react mock for component tests
// Must be used with vi.hoisted() since vi.mock() factories are hoisted above imports
const React = require('react')
const stub = (props) => React.createElement('span', { 'data-testid': 'icon', ...props })
const iconNames = [
  'Play', 'Square', 'ExternalLink', 'Terminal', 'GitBranch', 'FileCode',
  'Star', 'Database', 'Copy', 'ArrowUp', 'ArrowDown', 'GitPullRequest',
  'Loader', 'CheckCircle', 'XCircle', 'Clock', 'FileText', 'Container',
  'RefreshCw', 'Server', 'Wifi', 'WifiOff', 'Trash2', 'Plus', 'Minus',
  'Settings', 'X', 'ChevronDown', 'ChevronUp', 'Eye', 'EyeOff', 'Save',
  'AlertTriangle', 'Info', 'Key', 'Lock', 'Unlock', 'Edit', 'MoreVertical',
  'FolderOpen', 'Search', 'Globe', 'Shield', 'Link', 'Upload', 'Download',
  'Zap', 'Maximize2', 'Minimize2', 'ScrollText', 'Package', 'Monitor',
  'HardDrive', 'Activity',
]
const icons = {}
iconNames.forEach(n => { icons[n] = stub })
module.exports = icons
