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

  // useToast falls back to a console-only noop when there's no
  // provider so tests rendering pages in isolation don't have to
  // mount the full app shell. The fallback should still expose all
  // four methods so callers don't blow up at the call site.
  it('useToast returns a console-only fallback outside ToastProvider', () => {
    function Probe({ onReady }: { onReady: (ctx: ReturnType<typeof useToast>) => void }) {
      const ctx = useToast()
      onReady(ctx)
      return null
    }
    let captured: ReturnType<typeof useToast> | null = null
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    render(<Probe onReady={(c) => (captured = c)} />)
    expect(captured).not.toBeNull()
    expect(typeof captured!.success).toBe('function')
    expect(typeof captured!.error).toBe('function')
    expect(typeof captured!.warning).toBe('function')
    expect(typeof captured!.info).toBe('function')
    captured!.success('hello')
    expect(spy).toHaveBeenCalledWith('[toast:success]', 'hello')
    spy.mockRestore()
  })
})
