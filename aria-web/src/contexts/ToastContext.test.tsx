import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ToastProvider, useToast } from './ToastContext'

function TestComponent() {
  const toast = useToast()
  return (
    <div>
      <button onClick={() => toast.success('Success message')}>Success</button>
      <button onClick={() => toast.error('Error message')}>Error</button>
      <button onClick={() => toast.warning('Warning message')}>Warning</button>
      <button onClick={() => toast.info('Info message')}>Info</button>
    </div>
  )
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <TestComponent />
    </ToastProvider>,
  )
}

describe('ToastContext', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders no toasts initially', () => {
    renderWithProvider()
    expect(screen.queryByText('Success message')).not.toBeInTheDocument()
    expect(screen.queryByText('Error message')).not.toBeInTheDocument()
  })

  it('shows success toast when triggered', async () => {
    const { getByText } = renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(getByText('Success'))
    expect(screen.getByText('Success message')).toBeInTheDocument()
  })

  it('shows error toast when triggered', async () => {
    const { getByText } = renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(getByText('Error'))
    expect(screen.getByText('Error message')).toBeInTheDocument()
  })

  it('shows warning toast when triggered', async () => {
    const { getByText } = renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(getByText('Warning'))
    expect(screen.getByText('Warning message')).toBeInTheDocument()
  })

  it('shows info toast when triggered', async () => {
    const { getByText } = renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(getByText('Info'))
    expect(screen.getByText('Info message')).toBeInTheDocument()
  })

  it('auto-dismisses toast after 4 seconds', async () => {
    const { getByText, queryByText } = renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(getByText('Success'))
    expect(queryByText('Success message')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(4000)
    })

    expect(queryByText('Success message')).not.toBeInTheDocument()
  })

  it('can manually close a toast', async () => {
    const { getByText, queryByText } = renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(getByText('Error'))
    expect(queryByText('Error message')).toBeInTheDocument()

    // Find and click the close button (X icon) within the toast
    const closeButton = document.querySelector('.pointer-events-auto button')
    expect(closeButton).toBeTruthy()
    await user.click(closeButton!)

    expect(queryByText('Error message')).not.toBeInTheDocument()
  })

  it('supports multiple simultaneous toasts', async () => {
    const { getByText } = renderWithProvider()
    const user = (await import('@testing-library/user-event')).default.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(getByText('Success'))
    await user.click(getByText('Error'))

    expect(screen.getByText('Success message')).toBeInTheDocument()
    expect(screen.getByText('Error message')).toBeInTheDocument()
  })

  it('useToast throws when used outside ToastProvider', () => {
    function BadComponent() {
      useToast()
      return null
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<BadComponent />)).toThrow('useToast must be used inside ToastProvider')
    spy.mockRestore()
  })
})
