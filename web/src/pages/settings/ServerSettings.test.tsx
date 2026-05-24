import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ServerSettings } from './ServerSettings'

const mockGet = vi.fn()
const mockPut = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    put: (...args: any[]) => mockPut(...args),
  },
}))

vi.mock('../../config/api', () => ({
  getApiConfig: () => ({ url: 'http://127.0.0.1:8000', source: 'default' as const }),
  saveApiBaseUrl: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('ServerSettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPut.mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<ServerSettings />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders server settings after loading', async () => {
    mockGet.mockResolvedValue({ api_base_url: 'http://localhost:8000' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '1.0', status: 'healthy' }) })))
    render(<ServerSettings />)
    await waitFor(() => {
      expect(screen.getByText('settings.server.title')).toBeInTheDocument()
    })
  })

  it('shows offline status when connection fails', async () => {
    mockGet.mockResolvedValue({})
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })))
    render(<ServerSettings />)
    await waitFor(() => {
      expect(screen.getByText('settings.server.disconnected')).toBeInTheDocument()
    })
  })

  it('allows typing server URL', async () => {
    mockGet.mockResolvedValue({})
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })))
    render(<ServerSettings />)
    await waitFor(() => screen.getByPlaceholderText('http://127.0.0.1:8000'))
    const input = screen.getByPlaceholderText('http://127.0.0.1:8000')
    fireEvent.change(input, { target: { value: 'http://new-server:8000' } })
    expect(input).toHaveValue('http://new-server:8000')
  })
})
