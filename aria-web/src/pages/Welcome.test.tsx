import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Welcome } from './Welcome'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}))

describe('Welcome', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockNavigate.mockClear()
    mockGet.mockClear()
    mockPost.mockClear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Welcome />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders dashboard after data loads', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/meta/dashboard-summary') {
        return Promise.resolve([
          { id: 1, name: '项目A', client: '客户A', status: 'won', contract_amount: 1000000, updated_at: '2025-01-01T00:00:00Z' },
        ])
      }
      if (url === '/projects/todos/my') {
        return Promise.resolve([])
      }
      if (url === '/clients') {
        return Promise.resolve([])
      }
      if (url === '/skills/meta/summary') {
        return Promise.resolve([])
      }
      if (url === '/chat/conversations') {
        return Promise.resolve([])
      }
      if (url === '/messages') {
        return Promise.resolve({ items: [], unread_count: 0 })
      }
      return Promise.resolve([])
    })

    render(<Welcome />)
    await waitFor(() => {
      expect(screen.getByText('今日工作台')).toBeInTheDocument()
    })
  })

  it('shows greeting and user name when cached user exists', async () => {
    localStorage.setItem('user', JSON.stringify({ display_name: '张三' }))

    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/meta/dashboard-summary') return Promise.resolve([])
      if (url === '/projects/todos/my') return Promise.resolve([])
      if (url === '/clients') return Promise.resolve([])
      if (url === '/skills/meta/summary') return Promise.resolve([])
      if (url === '/chat/conversations') return Promise.resolve([])
      if (url === '/messages') return Promise.resolve({ items: [], unread_count: 0 })
      return Promise.resolve([])
    })

    render(<Welcome />)
    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument()
    })
  })

  it('shows default welcome when no cached user', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/meta/dashboard-summary') return Promise.resolve([])
      if (url === '/projects/todos/my') return Promise.resolve([])
      if (url === '/clients') return Promise.resolve([])
      if (url === '/skills/meta/summary') return Promise.resolve([])
      if (url === '/chat/conversations') return Promise.resolve([])
      if (url === '/messages') return Promise.resolve({ items: [], unread_count: 0 })
      return Promise.resolve([])
    })

    render(<Welcome />)
    await waitFor(() => {
      expect(screen.getByText('欢迎回来')).toBeInTheDocument()
    })
  })

  it('renders error state on API failure', async () => {
    mockGet.mockRejectedValue({ response: { status: 500, data: { detail: 'Server error' } } })

    render(<Welcome />)
    await waitFor(() => {
      expect(screen.getByText(/Server error/)).toBeInTheDocument()
    })
  })

  it('renders service unavailable error with 502', async () => {
    mockGet.mockRejectedValue({ response: { status: 502, data: {} } })

    render(<Welcome />)
    await waitFor(() => {
      expect(screen.getByText('工作台正在恢复中')).toBeInTheDocument()
    })
  })

  it('navigates to chat when start chat clicked', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/meta/dashboard-summary') return Promise.resolve([])
      if (url === '/projects/todos/my') return Promise.resolve([])
      if (url === '/clients') return Promise.resolve([])
      if (url === '/skills/meta/summary') return Promise.resolve([])
      if (url === '/chat/conversations') return Promise.resolve([])
      if (url === '/messages') return Promise.resolve({ items: [], unread_count: 0 })
      return Promise.resolve([])
    })

    render(<Welcome />)
    await waitFor(() => screen.getByText('开始新对话'))
    fireEvent.click(screen.getByText('开始新对话'))
    expect(mockNavigate).toHaveBeenCalledWith('/chat')
  })

  it('shows announcement when unread published message exists', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/meta/dashboard-summary') return Promise.resolve([])
      if (url === '/projects/todos/my') return Promise.resolve([])
      if (url === '/clients') return Promise.resolve([])
      if (url === '/skills/meta/summary') return Promise.resolve([])
      if (url === '/chat/conversations') return Promise.resolve([])
      if (url === '/messages') {
        return Promise.resolve({
          items: [
            { id: 1, title: 'New feature', content: 'We updated', is_read: false, is_published: true, link: '/settings/ai' },
          ],
          unread_count: 1,
        })
      }
      return Promise.resolve([])
    })

    render(<Welcome />)
    await waitFor(() => {
      expect(screen.getByText('New feature')).toBeInTheDocument()
      expect(screen.getByText('知道了')).toBeInTheDocument()
    })
  })

  it('shows overdue and due-soon todos in today actions', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString()
    const tomorrow = new Date(Date.now() + 86400000).toISOString()

    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/meta/dashboard-summary') return Promise.resolve([])
      if (url === '/projects/todos/my') {
        return Promise.resolve([
          { id: 1, content: '逾期任务', project_id: 1, project_name: '项目A', due_date: yesterday },
          { id: 2, content: '临期任务', project_id: 1, project_name: '项目A', due_date: tomorrow },
        ])
      }
      if (url === '/clients') return Promise.resolve([])
      if (url === '/skills/meta/summary') return Promise.resolve([])
      if (url === '/chat/conversations') return Promise.resolve([])
      if (url === '/messages') return Promise.resolve({ items: [], unread_count: 0 })
      return Promise.resolve([])
    })

    render(<Welcome />)
    await waitFor(() => {
      expect(screen.getByText('逾期任务')).toBeInTheDocument()
      expect(screen.getByText('临期任务')).toBeInTheDocument()
    })
  })

  it('shows active project count badge', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/projects/meta/dashboard-summary') {
        return Promise.resolve([
          { id: 1, name: '项目A', client: '客户A', status: 'won', contract_amount: 100000, updated_at: '2025-01-01T00:00:00Z' },
          { id: 2, name: '项目B', client: '客户B', status: 'archived', contract_amount: 0, updated_at: '2025-01-01T00:00:00Z' },
        ])
      }
      if (url === '/projects/todos/my') return Promise.resolve([])
      if (url === '/clients') return Promise.resolve([])
      if (url === '/skills/meta/summary') return Promise.resolve([])
      if (url === '/chat/conversations') return Promise.resolve([])
      if (url === '/messages') return Promise.resolve({ items: [], unread_count: 0 })
      return Promise.resolve([])
    })

    render(<Welcome />)
    await waitFor(() => {
      const matches = screen.getAllByText(/活跃项目/)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })
})
