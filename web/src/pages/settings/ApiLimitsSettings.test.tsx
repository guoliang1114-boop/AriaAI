import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ApiLimitsSettings } from './ApiLimitsSettings'

const mockGet = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' } }),
}))

function summaryResponse(overrides: Record<string, any> = {}) {
  return {
    counts: {
      jobs: 0,
      rebuild_jobs: 0,
      summary_warm_jobs: 0,
      retrying_jobs: 0,
      recent_failures: 0,
      recent_successes: 0,
      manual_attention: 0,
      ...(overrides.counts || {}),
    },
    failure_summary: {
      category_counts: {},
      scope_counts: { project: 0, client: 0 },
      top_category: 'unknown',
      top_category_count: 0,
      manual_attention_categories: [],
      ...(overrides.failure_summary || {}),
    },
    budget: {
      project: { used: 0, limit: 100, remaining: 100 },
      client: { used: 0, limit: 100, remaining: 100 },
      project_low: false,
      client_low: false,
      ...(overrides.budget || {}),
    },
    recent_failures: [],
    recent_successes: [],
    pages: {
      jobs: { items: [], total: 0, limit: 100, offset: 0 },
      failures: { items: [], total: 0, limit: 10, offset: 0 },
      successes: { items: [], total: 0, limit: 1, offset: 0 },
      ...(overrides.pages || {}),
    },
  }
}

describe('ApiLimitsSettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<ApiLimitsSettings />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders healthy state when no failures', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/memory/operations/summary') {
        return Promise.resolve(summaryResponse())
      }
      return Promise.resolve({})
    })
    render(<ApiLimitsSettings />)
    await waitFor(() => {
      expect(screen.getByText('运行平稳')).toBeInTheDocument()
      expect(screen.getAllByText('0')[0]).toBeInTheDocument()
    })
  })

  it('renders alert state with failures', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/memory/operations/summary') {
        const failure = { scope: 'project', project_id: 1, project_name: 'P1', stage: 'build', message: '429', failed_at: '2025-01-01', category: 'rate_limit' }
        return Promise.resolve(summaryResponse({
          counts: { jobs: 1, retrying_jobs: 1, recent_failures: 1 },
          failure_summary: { category_counts: { rate_limit: 1 }, top_category: 'rate_limit', top_category_count: 1 },
          budget: { project: { used: 90, limit: 100, remaining: 10 }, project_low: true },
          recent_failures: [failure],
          pages: {
            jobs: { items: [{ id: 1, retry_count: 1 }], total: 1, limit: 100, offset: 0 },
            failures: { items: [failure], total: 1, limit: 10, offset: 0 },
            successes: { items: [], total: 0, limit: 1, offset: 0 },
          },
        }))
      }
      return Promise.resolve({})
    })
    render(<ApiLimitsSettings />)
    await waitFor(() => {
      expect(screen.getByText('需要关注')).toBeInTheDocument()
    })
  })
})
