import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ProjectMemorySettings } from './ProjectMemorySettings'

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
  useToast: () => ({ showToast: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))

describe('ProjectMemorySettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<ProjectMemorySettings />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders projects after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects') {
        return Promise.resolve([
          { id: 1, name: '项目A', client_id: 1, status: 'active', stage: 'execution', category: 'SaaS', created_at: '2025-01-01' },
        ])
      }
      if (url === '/projects/memory/jobs') {
        return Promise.resolve({ jobs: [], batch_rebuild: null })
      }
      return Promise.resolve({})
    })
    render(<ProjectMemorySettings />)
    await waitFor(() => {
      expect(screen.getByText('项目A')).toBeInTheDocument()
    })
  })

  it('filters projects by search query', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects') {
        return Promise.resolve([
          { id: 1, name: '项目A', client_id: 1, client: '客户A', status: 'active', stage: 'execution', category: 'SaaS', created_at: '2025-01-01' },
          { id: 2, name: '项目B', client_id: 2, client: '客户B', status: 'active', stage: 'planning', category: 'Finance', created_at: '2025-01-01' },
        ])
      }
      if (url === '/projects/memory/jobs') {
        return Promise.resolve({ jobs: [], batch_rebuild: null })
      }
      return Promise.resolve({})
    })
    render(<ProjectMemorySettings />)
    await waitFor(() => screen.getByText('项目A'))
    const searchInput = screen.getByPlaceholderText(/搜索项目/)
    fireEvent.change(searchInput, { target: { value: '项目B' } })
    expect(screen.queryByText('项目A')).not.toBeInTheDocument()
    expect(screen.getByText('项目B')).toBeInTheDocument()
  })
})
