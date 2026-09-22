import React from 'react'
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import NginxManager from '../../../src/components/servers/NginxManager'

const api = vi.hoisted(() => ({ sshNginxList: vi.fn(), sshListeningPorts: vi.fn(), sshNginxRead: vi.fn(), sshNginxSave: vi.fn(), sshNginxDisable: vi.fn() }))
vi.mock('../../../src/electronApi', () => ({ default: api }))
const raw = 'upstream cms { server 127.0.0.1:1337; }\nserver { listen 80; server_name app.test; location /admin { allow 127.0.0.1; deny all; proxy_pass http://cms; } }'
beforeEach(() => {
  vi.resetAllMocks()
  api.sshNginxList.mockResolvedValue({ success: true, data: [
    { name: 'app.conf', source: 'sites-available', path: '/etc/nginx/sites-available/app.conf', enabled: false },
    { name: 'app.conf', source: 'conf.d', path: '/etc/nginx/conf.d/app.conf', enabled: true }
  ] })
  api.sshListeningPorts.mockResolvedValue({ success: true, data: [] })
  api.sshNginxRead.mockImplementation(async ({ source }) => ({ success: true, data: { raw: source === 'conf.d' ? raw : 'server { listen 8080; }', parsed: { serverName: 'app.test', locations: [] }, path: '/etc/nginx/' + source + '/app.conf' } }))
  api.sshNginxSave.mockResolvedValue({ success: true })
  api.sshNginxDisable.mockResolvedValue({ success: true })
})
afterEach(cleanup)

it('opens the selected directory in raw mode, displays its path and preserves full content on save', async () => {
  render(<NginxManager serverId="srv1" />)
  fireEvent.click(await screen.findByTitle('/etc/nginx/conf.d/app.conf'))
  await waitFor(() => expect(screen.getByLabelText('Nginx configuration')).toHaveValue(raw))
  expect(screen.getByText('/etc/nginx/conf.d/app.conf')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.sshNginxSave).toHaveBeenCalledWith({ serverId: 'srv1', siteName: 'app.conf', source: 'conf.d', content: raw }))
  fireEvent.click(screen.getByTitle('/etc/nginx/sites-available/app.conf'))
  await waitFor(() => expect(screen.getByLabelText('Nginx configuration')).toHaveValue('server { listen 8080; }'))
  expect(api.sshNginxRead).toHaveBeenLastCalledWith({ serverId: 'srv1', siteName: 'app.conf', source: 'sites-available' })
})

it('passes the selected source when toggling and shows operation failures', async () => {
  api.sshNginxDisable.mockResolvedValue({ success: false, error: 'Permission denied' })
  render(<NginxManager serverId="srv1" />)
  fireEvent.click(await screen.findByTitle('Disable'))
  expect(api.sshNginxDisable).toHaveBeenCalledWith({ serverId: 'srv1', siteName: 'app.conf', source: 'conf.d' })
  expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied')
})
