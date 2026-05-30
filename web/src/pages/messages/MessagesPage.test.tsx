import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}))

describe('MessagesPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockGet.mockClear()
    mockPost.mockClear()
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
      expect(screen.getByText('System update')).toBeInTheDocument()
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

  it('marks a message as read', async () => {
    mockGet.mockResolvedValue({
      items: [{ id: 1, title: 'Msg', content: 'Content', level: 'info', is_read: false, created_at: '2025-01-01T00:00:00Z' }],
      unread_count: 1,
    })
    mockPost.mockResolvedValue({})
    render(<MessagesPage />)
    // The "标记已读" button lives in the detail pane and only appears
    // once the auto-select effect picks the first message. Use the
    // async findByRole so the test isn't sensitive to that extra tick.
    const markReadBtn = await screen.findByRole('button', { name: '标记已读' })
    fireEvent.click(markReadBtn)
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/messages/1/read')
    })
  })
})
