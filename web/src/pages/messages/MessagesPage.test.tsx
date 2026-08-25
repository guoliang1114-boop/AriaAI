import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MessagesPage } from './MessagesPage'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' }, t: (k: string) => k }),
}))

vi.mock('../../hooks/useAppTimeZone', () => ({
  useAppTimeZone: () => ({ resolvedTimeZone: 'Asia/Shanghai' }),
}))

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('MessagesPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockGet.mockClear()
    mockPost.mockClear()
    mockPost.mockResolvedValue({})
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<MessagesPage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders messages after loading', async () => {
    mockGet.mockResolvedValue({
      items: [
        { id: 1, title: 'System update', content: 'Update available', level: 'info', is_read: false, created_at: '2025-01-01T00:00:00Z' },
        { id: 2, title: 'Warning', content: 'Low disk space', level: 'warning', is_read: true, created_at: '2025-01-02T00:00:00Z' },
      ],
      unread_count: 1,
    })
    render(<MessagesPage />)
    await waitFor(() => {
      expect(screen.getAllByText('System update').length).toBeGreaterThan(0)
      expect(screen.getByText('Warning')).toBeInTheDocument()
    })
  })

  it('shows error when load fails', async () => {
    mockGet.mockRejectedValue({ response: { data: { detail: 'Network error' } } })
    render(<MessagesPage />)
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('marks the opened message as read', async () => {
    mockGet.mockResolvedValue({
      items: [{ id: 1, title: 'Msg', content: 'Content', level: 'info', is_read: false, created_at: '2025-01-01T00:00:00Z' }],
      unread_count: 1,
    })
    render(<MessagesPage />)
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/messages/1/read')
    })
  })

  it('does not cascade through every message in the unread filter', async () => {
    mockGet.mockResolvedValue({
      items: [
        { id: 1, title: '已读消息', content: 'Read', level: 'info', is_read: true, created_at: '2025-01-01T00:00:00Z' },
        { id: 2, title: '未读消息 A', content: 'Unread A', level: 'warning', is_read: false, created_at: '2025-01-02T00:00:00Z' },
        { id: 3, title: '未读消息 B', content: 'Unread B', level: 'warning', is_read: false, created_at: '2025-01-03T00:00:00Z' },
      ],
      unread_count: 2,
    })
    render(<MessagesPage />)
    await screen.findAllByText('已读消息')
    fireEvent.click(screen.getByRole('button', { name: /^未读\s*2$/ }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/messages/2/read'))
    expect(mockPost).not.toHaveBeenCalledWith('/messages/3/read')
  })

  it('keeps the newest refresh when message requests finish out of order', async () => {
    const oldRefresh = deferred<{ items: Array<Record<string, unknown>>; unread_count: number }>()
    const newRefresh = deferred<{ items: Array<Record<string, unknown>>; unread_count: number }>()
    mockGet
      .mockResolvedValueOnce({
        items: [{ id: 1, title: '初始消息', content: 'Initial', level: 'info', is_read: true, created_at: '2025-01-01T00:00:00Z' }],
        unread_count: 0,
      })
      .mockReturnValueOnce(oldRefresh.promise)
      .mockReturnValueOnce(newRefresh.promise)

    render(<MessagesPage />)
    await screen.findAllByText('初始消息')
    const refresh = screen.getByRole('button', { name: '刷新' })
    fireEvent.click(refresh)
    fireEvent.click(refresh)

    await act(async () => newRefresh.resolve({
      items: [{ id: 3, title: '最新消息', content: 'Newest', level: 'success', is_read: true, created_at: '2025-01-03T00:00:00Z' }],
      unread_count: 0,
    }))
    await screen.findAllByText('最新消息')
    await act(async () => oldRefresh.resolve({
      items: [{ id: 2, title: '过期消息', content: 'Stale', level: 'info', is_read: true, created_at: '2025-01-02T00:00:00Z' }],
      unread_count: 0,
    }))
    expect(screen.getAllByText('最新消息').length).toBeGreaterThan(0)
    expect(screen.queryByText('过期消息')).not.toBeInTheDocument()
  })

  it('preserves a local read while an older refresh is still pending', async () => {
    const staleRefresh = deferred<{ items: Array<Record<string, unknown>>; unread_count: number }>()
    const staleItems = [
      { id: 1, title: '已读消息', content: 'Read', level: 'info', is_read: true, created_at: '2025-01-01T00:00:00Z' },
      { id: 2, title: '待读消息', content: 'Unread', level: 'warning', is_read: false, created_at: '2025-01-02T00:00:00Z' },
    ]
    mockGet
      .mockResolvedValueOnce({ items: staleItems, unread_count: 1 })
      .mockReturnValueOnce(staleRefresh.promise)

    render(<MessagesPage />)
    await screen.findAllByText('已读消息')
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    fireEvent.click(screen.getByRole('button', { name: /待读消息/ }))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/messages/2/read'))

    await act(async () => staleRefresh.resolve({ items: staleItems, unread_count: 1 }))
    await screen.findByText('2 条消息 · 0 条未读')
    expect(document.querySelector('.animate-spin')).not.toBeInTheDocument()
  })
})
