import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ClientDetail } from './ClientDetail'

const mockGet = vi.fn()
const mockPut = vi.fn()
const mockDelete = vi.fn()
const mockPost = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    put: (...args: any[]) => mockPut(...args),
    delete: (...args: any[]) => mockDelete(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: '1' }),
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), () => {}],
  Link: ({ children }: any) => children,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: any) => children,
}))

describe('ClientDetail', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPut.mockClear()
    mockDelete.mockClear()
    mockPost.mockClear()
    mockNavigate.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<ClientDetail />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders client data after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients/1') return Promise.resolve({ id: 1, name: '客户A', industry: 'IT', contact: '张三', notes: '备注', created_at: '2025-01-01', document_count: 2, project_names: ['P1'] })
      if (url === '/clients/1/memory/status') return Promise.resolve({ status: 'ready', version: 1 })
      if (url === '/clients/1/projects') return Promise.resolve([{ id: 1, name: '项目1', status: 'active', contract_amount: 1000 }])
      if (url === '/clients/1/stakeholders') return Promise.resolve([])
      return Promise.resolve({})
    })
    render(<ClientDetail />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '客户A' })).toBeInTheDocument()
      expect(screen.getAllByText('IT')[0]).toBeInTheDocument()
    })
  })

  it('shows not found when client does not exist', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients/1') return Promise.resolve(null)
      if (url === '/clients/1/memory/status') return Promise.resolve({})
      if (url === '/clients/1/projects') return Promise.resolve([])
      if (url === '/clients/1/stakeholders') return Promise.resolve([])
      return Promise.resolve({})
    })
    render(<ClientDetail />)
    await waitFor(() => {
      expect(screen.getByText(/未找到/)).toBeInTheDocument()
    })
  })

  it('navigates back on back button click', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients/1') return Promise.resolve({ id: 1, name: '客户A', industry: 'IT', contact: '张三', notes: '', created_at: '2025-01-01', document_count: 0, project_names: [] })
      if (url === '/clients/1/memory/status') return Promise.resolve({ status: 'ready' })
      if (url === '/clients/1/projects') return Promise.resolve([])
      if (url === '/clients/1/stakeholders') return Promise.resolve([])
      return Promise.resolve({})
    })
    render(<ClientDetail />)
    await waitFor(() => screen.getByRole('heading', { name: '客户A' }))
    const backBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('返回')) as HTMLButtonElement
    if (backBtn) {
      fireEvent.click(backBtn)
      expect(mockNavigate).toHaveBeenCalledWith('/clients')
    }
  })
})
