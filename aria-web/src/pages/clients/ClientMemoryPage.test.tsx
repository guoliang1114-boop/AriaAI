import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ClientMemoryPage } from './ClientMemoryPage'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: '1' }),
  useNavigate: () => mockNavigate,
  Link: ({ children }: any) => children,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: any) => children,
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))

describe('ClientMemoryPage', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
    mockNavigate.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<ClientMemoryPage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders client memory after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients/1') return Promise.resolve({ id: 1, name: '客户A', industry: 'IT' })
      if (url === '/clients/1/memory/status') return Promise.resolve({ status: 'ready', version: 1 })
      if (url === '/clients/1/memory') return Promise.resolve({ summary: '记忆摘要', insights: [] })
      if (url === '/clients/1/projects') return Promise.resolve([])
      if (url === '/clients/1/memory/snapshots') return Promise.resolve([])
      return Promise.resolve({})
    })
    render(<ClientMemoryPage />)
    await waitFor(() => {
      expect(screen.getByText('客户A')).toBeInTheDocument()
    })
  })
})
