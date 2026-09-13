import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageCopyButton } from './MessageCopyButton'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('MessageCopyButton', () => {
  it('copies exact content once and shows an accessible success state', async () => {
    userEvent.setup()
    let finish!: () => void
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    render(<MessageCopyButton text="正文 **含格式** [K1]" />)
    const button = screen.getByRole('button', { name: '复制' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(write).toHaveBeenCalledExactlyOnceWith('正文 **含格式** [K1]')
    expect(button).toBeDisabled()
    await act(async () => finish())
    expect(screen.getByRole('button', { name: '已复制' })).toHaveAttribute('data-tone', 'success')
    expect(screen.getByRole('status')).toHaveTextContent('已复制')
    expect(button.textContent).toBe('')
  })

  it('handles clipboard rejection without claiming success and allows retry', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined)
    render(<MessageCopyButton text="正文" />)
    await user.click(screen.getByRole('button', { name: '复制' }))
    const retry = screen.getByRole('button', { name: '复制失败，请重试' })
    expect(retry).toHaveAttribute('data-tone', 'error')
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument()
    await user.click(retry)
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeEnabled())
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('resets the success icon after its short acknowledgement', async () => {
    userEvent.setup()
    vi.useFakeTimers()
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<MessageCopyButton text="正文" />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '复制' })))
    expect(screen.getByRole('button', { name: '已复制' })).toBeVisible()
    act(() => vi.advanceTimersByTime(1800))
    expect(screen.getByRole('button', { name: '复制' })).toBeVisible()
  })
})
