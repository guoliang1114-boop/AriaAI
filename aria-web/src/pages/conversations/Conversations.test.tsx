import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Conversations } from './Conversations'

const mockGet = vi.fn()
const mockDelete = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

describe('Conversations', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockDelete.mockClear()
    mockNavigate.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Conversations />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders conversations after loading', async () => {
    mockGet.mockResolvedValue([
      { id: 1, title: '对话1', updated_at: '2025-01-01T00:00:00Z' },
      { id: 2, title: '对话2', updated_at: '2025-01-02T00:00:00Z' },
    ])
    render(<Conversations />)
    await waitFor(() => {
      expect(screen.getByText('对话1')).toBeInTheDocument()
      expect(screen.getByText('对话2')).toBeInTheDocument()
    })
  })

  it('shows empty state when no conversations', async () => {
    mockGet.mockResolvedValue([])
    render(<Conversations />)
    await waitFor(() => {
      expect(screen.getByText('暂无对话')).toBeInTheDocument()
    })
  })

  it('navigates to conversation on click', async () => {
    mockGet.mockResolvedValue([
      { id: 1, title: '对话1', updated_at: '2025-01-01T00:00:00Z' },
    ])
    render(<Conversations />)
    await waitFor(() => screen.getByText('对话1'))
    const row = screen.getByText('对话1').closest('div[class*="flex-1"]') as HTMLElement
    fireEvent.click(row)
    expect(mockNavigate).toHaveBeenCalledWith('/chat/1')
  })

  it('deletes a conversation', async () => {
    mockGet.mockResolvedValue([
      { id: 1, title: '对话1', updated_at: '2025-01-01T00:00:00Z' },
    ])
    mockDelete.mockResolvedValue({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Conversations />)
    await waitFor(() => screen.getByText('对话1'))
    const deleteBtn = screen.getByRole('button')
    fireEvent.click(deleteBtn)
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/chat/conversations/1')
    })
    confirmSpy.mockRestore()
  })
})
