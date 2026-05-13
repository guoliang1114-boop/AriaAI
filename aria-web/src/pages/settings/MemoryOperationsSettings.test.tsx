import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryOperationsSettings } from './MemoryOperationsSettings'

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

describe('MemoryOperationsSettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
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
        return Promise.resolve({
          counts: { jobs: 0, rebuild_jobs: 0, summary_warm_jobs: 0, retrying_jobs: 0, recent_failures: 0, recent_successes: 0, manual_attention: 0 },
          failure_summary: { category_counts: {}, scope_counts: { project: 0, client: 0 }, top_category: '', top_category_count: 0, manual_attention_categories: [] },
          budget: { project_low: false, client_low: false, project: { used: 0, limit: 100, remaining: 100 }, client: { used: 0, limit: 100, remaining: 100 } },
          recent_failures: [],
          recent_successes: [],
        })
      }
      return Promise.resolve({})
    })
    render(<MemoryOperationsSettings />)
    await waitFor(() => {
      expect(screen.getByText('暂无失败记录')).toBeInTheDocument()
    })
  })
})
