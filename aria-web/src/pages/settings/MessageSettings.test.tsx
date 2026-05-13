import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MessageSettings } from './MessageSettings'

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh' } }),
}))

describe('MessageSettings', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockPost.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<MessageSettings />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders messages after loading', async () => {
    mockGet.mockResolvedValue([
      { id: 1, title: '通知1', content: '内容1', level: 'info', is_published: true, read_count: 5, created_at: '2025-01-01T00:00:00Z' },
    ])
    render(<MessageSettings />)
    await waitFor(() => {
      expect(screen.getByText('通知1')).toBeInTheDocument()
      expect(screen.getByText('内容1')).toBeInTheDocument()
    })
  })

  it('shows empty state when no messages', async () => {
    mockGet.mockResolvedValue([])
    render(<MessageSettings />)
    await waitFor(() => {
      expect(screen.getByText(/还没有发布过系统消息/)).toBeInTheDocument()
    })
  })

  it('shows validation error when submitting empty form', async () => {
    mockGet.mockResolvedValue([])
    render(<MessageSettings />)
    await waitFor(() => screen.getByText(/发布消息/))
    fireEvent.click(screen.getByRole('button', { name: /发布消息/ }))
    await waitFor(() => {
      expect(screen.getByText(/标题和内容不能为空/)).toBeInTheDocument()
    })
  })

  it('submits message form successfully', async () => {
    mockGet.mockResolvedValue([])
    mockPost.mockResolvedValue({ id: 1, title: '新通知', content: '新内容', level: 'info', is_published: true, read_count: 0, created_at: '2025-01-01T00:00:00Z' })
    render(<MessageSettings />)
    await waitFor(() => screen.getByPlaceholderText(/本周系统维护安排/))
    const titleInput = screen.getByPlaceholderText(/本周系统维护安排/)
    fireEvent.change(titleInput, { target: { value: '新通知' } })
    const contentInput = screen.getByPlaceholderText(/输入消息正文/)
    fireEvent.change(contentInput, { target: { value: '新内容' } })
    fireEvent.click(screen.getByRole('button', { name: /发布消息/ }))
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/messages/admin', expect.objectContaining({ title: '新通知', content: '新内容' }))
    })
  })
})
