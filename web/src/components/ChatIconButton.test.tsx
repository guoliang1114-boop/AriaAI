import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Info } from 'lucide-react'
import { ChatIconButton } from './ChatIconButton'

describe('ChatIconButton', () => {
  it('shows a keyboard tooltip, supports Escape and leaves action semantics intact', async () => {
    const user = userEvent.setup()
    const click = vi.fn()
    render(<ChatIconButton label="查看回答详情" aria-expanded={false} aria-controls="details" onClick={click}><Info aria-hidden="true" /></ChatIconButton>)
    const button = screen.getByRole('button', { name: '查看回答详情' })
    expect(button.textContent).toBe('')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.tab()
    expect(button).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('查看回答详情')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(click).toHaveBeenCalledTimes(1)
    expect(button).toHaveAttribute('aria-controls', 'details')
  })

  it('keeps hover tips outside the scrolling message and dismisses them on scroll or blur', async () => {
    const user = userEvent.setup()
    const { container } = render(<ChatIconButton label="复制"><Info aria-hidden="true" /></ChatIconButton>)
    const button = screen.getByRole('button', { name: '复制' })
    await user.hover(button)
    expect(container).not.toContainElement(screen.getByRole('tooltip'))
    fireEvent.scroll(window)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.unhover(button)
    await user.tab()
    expect(screen.getByRole('tooltip')).toBeVisible()
    await user.tab()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
