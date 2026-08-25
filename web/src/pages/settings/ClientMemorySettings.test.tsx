import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ClientMemorySettings } from './ClientMemorySettings'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockToast = { showToast: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() }

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' } }),
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => mockToast,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function jobsResponse(clientName: string) {
  return {
    jobs: [{
      client_id: 1,
      client_name: clientName,
      industry: 'IT',
      job_type: 'rebuild',
      job_id: `job-${clientName}`,
      next_run_at: '2025-01-01T00:00:00Z',
      memory_stale: true,
      memory_version: 1,
    }],
    count: 1,
  }
}

describe('ClientMemorySettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
    Object.values(mockToast).forEach((mock) => mock.mockClear())
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

  it('keeps the newest queue refresh when job requests finish out of order', async () => {
    const oldRefresh = deferred<ReturnType<typeof jobsResponse>>()
    const newRefresh = deferred<ReturnType<typeof jobsResponse>>()
    let jobRequest = 0
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') return Promise.resolve([])
      if (url === '/clients/memory/jobs') {
        jobRequest += 1
        if (jobRequest === 1) return Promise.resolve(jobsResponse('初始队列'))
        if (jobRequest === 2) return oldRefresh.promise
        return newRefresh.promise
      }
      return Promise.resolve({})
    })

    render(<ClientMemorySettings />)
    await screen.findByText('初始队列')
    const refresh = screen.getByRole('button', { name: /刷新队列/ })
    fireEvent.click(refresh)
    fireEvent.click(refresh)
    await waitFor(() => expect(jobRequest).toBe(3))

    await act(async () => newRefresh.resolve(jobsResponse('最新队列')))
    await screen.findByText('最新队列')
    await act(async () => oldRefresh.resolve(jobsResponse('过期队列')))

    expect(screen.getByText('最新队列')).toBeInTheDocument()
    expect(screen.queryByText('过期队列')).not.toBeInTheDocument()
  })
})
