import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AnswerDetails } from './AnswerDetails'

describe('AnswerDetails', () => {
  it('is collapsed by default and supports keyboard expansion and collapse', async () => {
    const user = userEvent.setup()
    render(<AnswerDetails><p>阶段耗时</p></AnswerDetails>)
    const toggle = screen.getByRole('button', { name: '查看回答详情' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('阶段耗时')).not.toBeInTheDocument()
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveAttribute('hidden')
    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('region', { name: '回答详情' })).toBeVisible()
    expect(screen.getByText('阶段耗时')).toBeVisible()
    await user.keyboard(' ')
    expect(screen.queryByText('阶段耗时')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
  })

  it('keeps adjacent messages independent', async () => {
    const user = userEvent.setup()
    render(<><AnswerDetails>第一轮</AnswerDetails><AnswerDetails>第二轮</AnswerDetails></>)
    const buttons = screen.getAllByRole('button', { name: '查看回答详情' })
    expect(buttons[0].getAttribute('aria-controls')).not.toEqual(buttons[1].getAttribute('aria-controls'))
    await user.click(buttons[0])
    expect(screen.getByText('第一轮')).toBeVisible()
    expect(screen.queryByText('第二轮')).not.toBeInTheDocument()
  })
})
