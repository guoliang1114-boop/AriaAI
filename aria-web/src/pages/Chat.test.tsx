import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Chat } from './Chat'

describe('Chat', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders initial messages', () => {
    render(<Chat />)
    expect(screen.getByRole('heading', { name: /Sinopec 2026 Growth Strategy/ })).toBeInTheDocument()
    expect(screen.getByText(/Aria AI Analysis Stream/)).toBeInTheDocument()
    expect(screen.getByText(/Searching DB/)).toBeInTheDocument()
    expect(screen.getByText(/Web Researching/)).toBeInTheDocument()
    expect(screen.getByText(/Generating Model/)).toBeInTheDocument()
  })

  it('renders header buttons', () => {
    render(<Chat />)
    expect(screen.getByRole('button', { name: /Share/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export Report/ })).toBeInTheDocument()
  })

  it('renders input toolbar', () => {
    render(<Chat />)
    expect(screen.getByText('Project Context')).toBeInTheDocument()
    expect(screen.getByText('@ Skills')).toBeInTheDocument()
    expect(screen.getByText('/ Context')).toBeInTheDocument()
  })

  it('sends a message and shows user message', async () => {
    render(<Chat />)
    const input = screen.getByPlaceholderText(/Deepen analysis/)
    fireEvent.change(input, { target: { value: 'Hello AI' } })
    const sendBtn = screen.getAllByRole('button').pop() as HTMLButtonElement
    fireEvent.click(sendBtn)
    await waitFor(() => {
      expect(screen.getByText('Hello AI')).toBeInTheDocument()
    })
  })

  it('disables send button when input is empty', () => {
    render(<Chat />)
    const sendBtn = screen.getAllByRole('button').pop() as HTMLButtonElement
    expect(sendBtn).toBeDisabled()
  })

  it('simulates AI response after sending message', async () => {
    render(<Chat />)
    const input = screen.getByPlaceholderText(/Deepen analysis/)
    fireEvent.change(input, { target: { value: 'Test message' } })
    fireEvent.click(screen.getAllByRole('button').pop() as HTMLButtonElement)
    await waitFor(() => {
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })
    vi.advanceTimersByTime(1600)
    await waitFor(() => {
      expect(screen.getByText(/analyzed the data/)).toBeInTheDocument()
    })
  })
})
