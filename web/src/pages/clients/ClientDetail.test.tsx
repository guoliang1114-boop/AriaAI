import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ClientDetail } from './ClientDetail'

const mockGet = vi.fn()
const mockPut = vi.fn()
const mockDelete = vi.fn()
const mockPost = vi.fn()
const mockNavigate = vi.fn()
let mockClientId = '1'

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: mockClientId }),
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), () => {}],
  Link: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children: ReactNode }) => children,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function clientData(id: number, name: string) {
  return { id, name, industry: 'IT', contact: '张三', notes: '', created_at: '2025-01-01', document_count: 0, project_names: [] }
}

describe('ClientDetail', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPut.mockClear()
    mockDelete.mockClear()
    mockPost.mockClear()
    mockNavigate.mockClear()
    mockClientId = '1'
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

  it('keeps the newest client when route requests finish out of order', async () => {
    const firstClient = deferred<ReturnType<typeof clientData>>()
    const secondClient = deferred<ReturnType<typeof clientData>>()
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients/1') return firstClient.promise
      if (url === '/clients/2') return secondClient.promise
      if (url.endsWith('/projects') || url.endsWith('/stakeholders')) return Promise.resolve([])
      if (url.endsWith('/memory/status')) return Promise.resolve({ has_memory: false })
      return Promise.resolve({})
    })

    const { rerender } = render(<ClientDetail />)
    mockClientId = '2'
    rerender(<ClientDetail />)

    await act(async () => secondClient.resolve(clientData(2, '最新客户')))
    await screen.findByRole('heading', { name: '最新客户' })
    await act(async () => firstClient.resolve(clientData(1, '过期客户')))
    expect(screen.getByRole('heading', { name: '最新客户' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '过期客户' })).not.toBeInTheDocument()
  })
})
