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
      if (url === '/projects/memory/jobs') {
        return Promise.resolve({ jobs: [], budget: { used: 0, limit: 100, remaining: 100 }, recent_failures: [] })
      }
      if (url === '/clients/memory/jobs') {
        return Promise.resolve({ jobs: [], budget: { used: 0, limit: 100, remaining: 100 }, recent_failures: [] })
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
      if (url === '/projects/memory/jobs') {
        return Promise.resolve({
          jobs: [{ id: 1, retry_count: 1 }],
          budget: { used: 90, limit: 100, remaining: 10 },
          recent_failures: [{ scope: 'project', project_id: 1, project_name: 'P1', stage: 'build', message: '429', failed_at: '2025-01-01', category: 'rate_limit' }],
        })
      }
      if (url === '/clients/memory/jobs') {
        return Promise.resolve({ jobs: [], budget: null, recent_failures: [] })
      }
      return Promise.resolve({})
    })
    render(<ApiLimitsSettings />)
    await waitFor(() => {
      expect(screen.getByText('需要关注')).toBeInTheDocument()
    })
  })
})
