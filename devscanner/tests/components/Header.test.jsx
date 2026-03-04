import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const lucideMock = vi.hoisted(() => require('../lucide-mock'))
vi.mock('lucide-react', () => lucideMock)

const mockElectron = vi.hoisted(() => ({
  checkWslLocalhost: vi.fn(),
  fixWslLocalhost: vi.fn(),
  getWslDistros: vi.fn(),
  listWslDirectories: vi.fn(),
  resolveWslFolder: vi.fn(),
}))
vi.mock('../../src/electronApi', () => ({ default: mockElectron }))

vi.mock('../../src/components/WindowControls', () => ({
  default: () => <div data-testid="window-controls" />
}))

import Header from '../../src/components/Header'

function renderHeader(overrides = {}) {
  const props = {
    folderPath: null,
    scanning: false,
    searchQuery: '',
    setSearchQuery: vi.fn(),
    onSelectFolder: vi.fn(),
    activeView: 'projects',
    setActiveView: vi.fn(),
    isMaximized: false,
    projects: [],
    ports: [],
    dockerContainers: [],
    remoteServers: [],
    hostIp: null,
    wslDistros: ['Ubuntu'],
    ...overrides,
  }

  render(<Header {...props} />)
  return props
}

describe('Header folder picker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockElectron.checkWslLocalhost.mockResolvedValue({ available: false })
    mockElectron.fixWslLocalhost.mockResolvedValue({ success: true })
    mockElectron.getWslDistros.mockResolvedValue(['Ubuntu'])
    mockElectron.listWslDirectories.mockResolvedValue({
      success: true,
      data: {
        distro: 'Ubuntu',
        linuxPath: '/home/test',
        parentPath: '/home',
        directories: [{ name: 'projects', linuxPath: '/home/test/projects' }]
      }
    })
    mockElectron.resolveWslFolder.mockResolvedValue({
      success: true,
      data: {
        distro: 'Ubuntu',
        linuxPath: '/home/test',
        windowsPath: '\\\\wsl$\\Ubuntu\\home\\test'
      }
    })
  })

  it('opens source popup with Windows and WSL options', () => {
    renderHeader()

    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }))

    expect(screen.getByText('Choose source')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /windows/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /wsl/i })).toBeInTheDocument()
  })

  it('keeps current Windows flow when Windows is selected', () => {
    const onSelectFolder = vi.fn()
    renderHeader({ onSelectFolder })

    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }))
    fireEvent.click(screen.getByRole('button', { name: /windows/i }))

    expect(onSelectFolder).toHaveBeenCalledWith()
  })

  it('lets user browse WSL and select folder inside popup', async () => {
    const onSelectFolder = vi.fn()
    renderHeader({ onSelectFolder })

    fireEvent.click(screen.getByRole('button', { name: /choose folder/i }))
    fireEvent.click(screen.getByRole('button', { name: /wsl/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ubuntu' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Ubuntu' }))

    await waitFor(() => {
      expect(mockElectron.listWslDirectories).toHaveBeenCalledWith(expect.objectContaining({ distro: 'Ubuntu' }))
      expect(screen.getByText('/home/test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /select this folder/i }))

    await waitFor(() => {
      expect(mockElectron.resolveWslFolder).toHaveBeenCalledWith({ distro: 'Ubuntu', path: '/home/test' })
    })
    expect(onSelectFolder).toHaveBeenCalledWith('\\\\wsl$\\Ubuntu\\home\\test')
  })
})
