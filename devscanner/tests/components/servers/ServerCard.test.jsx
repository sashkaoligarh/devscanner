import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const lucideMock = vi.hoisted(() => require('../../lucide-mock'))
vi.mock('lucide-react', () => lucideMock)

import ServerCard from '../../../src/components/servers/ServerCard'

function makeServer(overrides = {}) {
  return {
    name: 'Production Server',
    host: '192.168.1.100',
    port: 22,
    username: 'deploy',
    authType: 'key',
    tags: ['Docker', 'nginx'],
    ...overrides
  }
}

function defaultProps(overrides = {}) {
  return {
    server: makeServer(),
    connection: 'disconnected',
    discovering: false,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onDelete: vi.fn(),
    onSelect: vi.fn(),
    ...overrides
  }
}

describe('ServerCard', () => {
  it('shows server name, host, port, and username', () => {
    render(<ServerCard {...defaultProps()} />)
    expect(screen.getByText('Production Server')).toBeInTheDocument()
    expect(screen.getByText('deploy@192.168.1.100:22')).toBeInTheDocument()
  })

  it('shows "connected" badge when connection is connected', () => {
    render(<ServerCard {...defaultProps({ connection: 'connected' })} />)
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('shows "disconnected" badge when connection is disconnected', () => {
    render(<ServerCard {...defaultProps({ connection: 'disconnected' })} />)
    expect(screen.getByText('disconnected')).toBeInTheDocument()
  })

  it('shows "connecting" badge when connection is connecting', () => {
    render(<ServerCard {...defaultProps({ connection: 'connecting' })} />)
    expect(screen.getByText('connecting')).toBeInTheDocument()
  })

  it('shows Connect button when disconnected', () => {
    render(<ServerCard {...defaultProps({ connection: 'disconnected' })} />)
    expect(screen.getByText('Connect')).toBeInTheDocument()
  })

  it('shows Open and Disconnect buttons when connected', () => {
    render(<ServerCard {...defaultProps({ connection: 'connected' })} />)
    expect(screen.getByText('Open')).toBeInTheDocument()
    // The disconnect button has a WifiOff icon but no text; it exists in footer
    const buttons = screen.getAllByRole('button')
    const disconnectBtn = buttons.find(b => b.classList.contains('btn-danger') && b.closest('.server-card-footer'))
    expect(disconnectBtn).toBeTruthy()
  })

  it('calls onConnect when Connect is clicked', () => {
    const props = defaultProps({ connection: 'disconnected' })
    render(<ServerCard {...props} />)
    fireEvent.click(screen.getByText('Connect'))
    expect(props.onConnect).toHaveBeenCalledTimes(1)
  })

  it('calls onSelect when card is clicked while connected', () => {
    const props = defaultProps({ connection: 'connected' })
    const { container } = render(<ServerCard {...props} />)
    fireEvent.click(container.querySelector('.server-card'))
    expect(props.onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not call onSelect when card is clicked while disconnected', () => {
    const props = defaultProps({ connection: 'disconnected' })
    const { container } = render(<ServerCard {...props} />)
    fireEvent.click(container.querySelector('.server-card'))
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('shows auth type badge for key auth', () => {
    render(<ServerCard {...defaultProps({ server: makeServer({ authType: 'key' }) })} />)
    expect(screen.getByText('key', { exact: false })).toBeInTheDocument()
  })

  it('shows auth type badge for password auth', () => {
    render(<ServerCard {...defaultProps({ server: makeServer({ authType: 'password' }) })} />)
    expect(screen.getByText('password', { exact: false })).toBeInTheDocument()
  })

  it('shows server tags', () => {
    render(<ServerCard {...defaultProps()} />)
    expect(screen.getByText('Docker')).toBeInTheDocument()
    expect(screen.getByText('nginx')).toBeInTheDocument()
  })

  it('does not render tags section when tags is empty', () => {
    const { container } = render(
      <ServerCard {...defaultProps({ server: makeServer({ tags: [] }) })} />
    )
    expect(container.querySelector('.tags')).not.toBeInTheDocument()
  })

  it('shows Connecting... text when connection is connecting', () => {
    render(<ServerCard {...defaultProps({ connection: 'connecting' })} />)
    expect(screen.getByText('Connecting...')).toBeInTheDocument()
  })
})
