import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ClientMemorySettings } from './ClientMemorySettings'

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' } }),
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() }),
}))

describe('ClientMemorySettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<ClientMemorySettings />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders clients after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') {
        return Promise.resolve([
          { id: 1, name: '客户A', industry: 'IT', contact: '张三', notes: '', created_at: '2025-01-01', document_count: 2, project_names: ['P1'] },
        ])
      }
      if (url === '/clients/memory/jobs') {
        return Promise.resolve({ jobs: [], batch_rebuild: null })
      }
      return Promise.resolve({})
    })
    render(<ClientMemorySettings />)
    await waitFor(() => {
      expect(screen.getByText('客户A')).toBeInTheDocument()
    })
  })

  it('filters clients by search query', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') {
        return Promise.resolve([
          { id: 1, name: '客户A', industry: 'IT', contact: '张三', notes: '', created_at: '2025-01-01', document_count: 2, project_names: ['P1'] },
          { id: 2, name: '客户B', industry: 'Finance', contact: '李四', notes: '', created_at: '2025-01-01', document_count: 0, project_names: [] },
        ])
      }
      if (url === '/clients/memory/jobs') {
        return Promise.resolve({ jobs: [], batch_rebuild: null })
      }
      return Promise.resolve({})
    })
    render(<ClientMemorySettings />)
    await waitFor(() => screen.getByText('客户A'))
    const searchInput = screen.getByPlaceholderText(/搜索客户/)
    fireEvent.change(searchInput, { target: { value: '客户B' } })
    expect(screen.queryByText('客户A')).not.toBeInTheDocument()
    expect(screen.getByText('客户B')).toBeInTheDocument()
  })
})
