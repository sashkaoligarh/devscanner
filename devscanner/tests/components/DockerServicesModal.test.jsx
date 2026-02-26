import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const lucideMock = vi.hoisted(() => require('../lucide-mock'))
vi.mock('lucide-react', () => lucideMock)

const mockElectron = vi.hoisted(() => ({
  dockerServicesConfig: vi.fn(),
  dockerServicesStatus: vi.fn(),
  dockerServicesSave: vi.fn(),
  dockerServicesStart: vi.fn(),
  dockerServicesStop: vi.fn(),
  dockerServicesInjectEnv: vi.fn(),
  openBrowser: vi.fn()
}))
vi.mock('../../src/electronApi', () => ({ default: mockElectron }))

import DockerServicesModal from '../../src/components/DockerServicesModal'

function makeProject(overrides = {}) {
  return {
    name: 'my-app',
    path: '/home/user/projects/my-app',
    ...overrides
  }
}

function makeCatalog() {
  return {
    postgres: {
      label: 'PostgreSQL',
      defaultPort: 5432,
      connectionTemplate: 'postgresql://postgres@localhost:{port}/mydb',
      envKey: 'DATABASE_URL',
      env: {}
    },
    redis: {
      label: 'Redis',
      defaultPort: 6379,
      connectionTemplate: 'redis://localhost:{port}',
      envKey: 'REDIS_URL',
      env: {}
    }
  }
}

describe('DockerServicesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    // Never resolve so it stays in loading state
    mockElectron.dockerServicesConfig.mockReturnValue(new Promise(() => {}))

    render(
      <DockerServicesModal
        project={makeProject()}
        catalog={makeCatalog()}
        healthStatus={{}}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders with selection view after loading', async () => {
    mockElectron.dockerServicesConfig.mockResolvedValue({ success: false })

    render(
      <DockerServicesModal
        project={makeProject()}
        catalog={makeCatalog()}
        healthStatus={{}}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('PostgreSQL')).toBeInTheDocument()
    })
    expect(screen.getByText('Redis')).toBeInTheDocument()
  })

  it('shows the project name in the title', async () => {
    mockElectron.dockerServicesConfig.mockResolvedValue({ success: false })

    render(
      <DockerServicesModal
        project={makeProject()}
        catalog={makeCatalog()}
        healthStatus={{}}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/my-app/)).toBeInTheDocument()
    })
  })

  it('shows service toggles (checkboxes) from catalog', async () => {
    mockElectron.dockerServicesConfig.mockResolvedValue({ success: false })

    render(
      <DockerServicesModal
        project={makeProject()}
        catalog={makeCatalog()}
        healthStatus={{}}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('PostgreSQL')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    // Both should be unchecked initially
    checkboxes.forEach(cb => expect(cb).not.toBeChecked())
  })

  it('toggles service checkbox when clicked', async () => {
    mockElectron.dockerServicesConfig.mockResolvedValue({ success: false })

    render(
      <DockerServicesModal
        project={makeProject()}
        catalog={makeCatalog()}
        healthStatus={{}}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('PostgreSQL')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    expect(checkboxes[0]).toBeChecked()
  })

  it('calls onClose when close button is clicked', async () => {
    mockElectron.dockerServicesConfig.mockResolvedValue({ success: false })

    const onClose = vi.fn()
    render(
      <DockerServicesModal
        project={makeProject()}
        catalog={makeCatalog()}
        healthStatus={{}}
        onClose={onClose}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('PostgreSQL')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows Start button disabled when no services are enabled', async () => {
    mockElectron.dockerServicesConfig.mockResolvedValue({ success: false })

    render(
      <DockerServicesModal
        project={makeProject()}
        catalog={makeCatalog()}
        healthStatus={{}}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Start')).toBeInTheDocument()
    })

    expect(screen.getByText('Start').closest('button')).toBeDisabled()
  })

  it('enables Start button when a service is enabled', async () => {
    mockElectron.dockerServicesConfig.mockResolvedValue({ success: false })

    render(
      <DockerServicesModal
        project={makeProject()}
        catalog={makeCatalog()}
        healthStatus={{}}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('PostgreSQL')).toBeInTheDocument()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    expect(screen.getByText('Start').closest('button')).not.toBeDisabled()
  })

  it('loads saved config and switches to running view if services are running', async () => {
    mockElectron.dockerServicesConfig.mockResolvedValue({
      success: true,
      data: {
        services: {
          postgres: { enabled: true, port: 5432 },
          redis: { enabled: false, port: 6379 }
        }
      }
    })
    mockElectron.dockerServicesStatus.mockResolvedValue({
      success: true,
      data: { postgres: { running: true } }
    })

    render(
      <DockerServicesModal
        project={makeProject()}
        catalog={makeCatalog()}
        healthStatus={{}}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      // In running view, title shows "Services" instead of "Docker Services"
      expect(screen.getByText(/Services — my-app/)).toBeInTheDocument()
    })
  })
})
