import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryOperationsSettings } from './MemoryOperationsSettings'

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

function operationsSummary(jobName?: string) {
  const jobs = jobName
    ? [{
        scope: 'project',
        job_id: `job-${jobName}`,
        project_id: 1,
        project_name: jobName,
        client: '测试客户',
        job_type: 'rebuild',
        memory_version: 1,
        next_run_at: '2025-01-01T00:00:00Z',
      }]
    : []
  return {
    counts: { jobs: jobs.length, rebuild_jobs: jobs.length, summary_warm_jobs: 0, retrying_jobs: 0, recent_failures: 0, recent_successes: 0, manual_attention: 0 },
    failure_summary: { category_counts: {}, scope_counts: { project: 0, client: 0 }, top_category: '', top_category_count: 0, manual_attention_categories: [] },
    budget: { project_low: false, client_low: false, project: { used: 0, limit: 100, remaining: 100 }, client: { used: 0, limit: 100, remaining: 100 } },
    recent_failures: [],
    recent_successes: [],
    pages: {
      jobs: { items: jobs, total: jobs.length, limit: 10, offset: 0 },
      failures: { items: [], total: 0, limit: 10, offset: 0 },
      successes: { items: [], total: 0, limit: 10, offset: 0 },
    },
  }
}

describe('MemoryOperationsSettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
    Object.values(mockToast).forEach((mock) => mock.mockClear())
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<MemoryOperationsSettings />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders operations data after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/memory/jobs') {
        return Promise.resolve({ jobs: [], budget: { used: 0, limit: 100, remaining: 100 }, recent_failures: [] })
      }
      if (url === '/clients/memory/jobs') {
        return Promise.resolve({ jobs: [], budget: { used: 0, limit: 100, remaining: 100 }, recent_failures: [] })
      }
      if (url === '/memory/operations/summary') {
        return Promise.resolve(operationsSummary())
      }
      return Promise.resolve({})
    })
    render(<MemoryOperationsSettings />)
    await waitFor(() => {
      expect(screen.getByText('暂无失败记录')).toBeInTheDocument()
    })
  })

  it('keeps the newest filters when summary requests finish out of order', async () => {
    const oldSearch = deferred<ReturnType<typeof operationsSummary>>()
    const newSearch = deferred<ReturnType<typeof operationsSummary>>()
    mockGet
      .mockResolvedValueOnce(operationsSummary('初始任务'))
      .mockReturnValueOnce(oldSearch.promise)
      .mockReturnValueOnce(newSearch.promise)

    render(<MemoryOperationsSettings />)
    await screen.findByText('项目 / 初始任务')
    const input = screen.getByPlaceholderText(/搜索项目/)
    fireEvent.change(input, { target: { value: '旧' } })
    fireEvent.change(input, { target: { value: '新' } })
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3))

    await act(async () => newSearch.resolve(operationsSummary('最新任务')))
    await screen.findByText('项目 / 最新任务')
    await act(async () => oldSearch.resolve(operationsSummary('过期任务')))

    expect(screen.getByText('项目 / 最新任务')).toBeInTheDocument()
    expect(screen.queryByText('项目 / 过期任务')).not.toBeInTheDocument()
  })
})
