import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { LiveTurnDetails } from './LiveTurnDetails'
import { liveContextReceipt, liveTurnReceipt } from '../test/turnReceipts'

describe('LiveTurnDetails', () => {
  it('keeps routine receipts out of the default view and technical counts behind diagnostics', async () => {
    const user = userEvent.setup()
    render(<LiveTurnDetails status="正在思考…" receipt={liveTurnReceipt} contextReceipt={liveContextReceipt} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在思考…')
    expect(screen.queryByText(liveTurnReceipt.summary)).not.toBeInTheDocument()
    expect(screen.queryByText(/槽位|94690a22986e|部分记忆尚待核实/)).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: '本轮详情' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    const panel = screen.getByRole('region', { name: '本轮详情' })
    expect(within(panel).getByText(liveTurnReceipt.summary)).toBeVisible()
    expect(within(panel).getByText('项目记忆 · 个人偏好 · 历史对话')).toBeVisible()
    const diagnostics = within(panel).getByText('诊断信息').closest('details')!
    expect(diagnostics).not.toHaveAttribute('open')
    fireEvent.click(within(panel).getByText('诊断信息'))
    expect(diagnostics).toHaveAttribute('open')
    expect(within(panel).getByText(/项目状态版本 · 94690a22986e/)).toBeVisible()
    await user.click(trigger)
    expect(screen.queryByRole('region', { name: '本轮详情' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    expect(screen.getByText('诊断信息').closest('details')).not.toHaveAttribute('open')
  })

  it('leaves required confirmation and retrieval problems visible even when collapsed', () => {
    render(<LiveTurnDetails status="准备执行" receipt={{ ...liveTurnReceipt, requires_confirmation: true, write_allowed: true }}
      contextReceipt={{ ...liveContextReceipt, evidence: { ...liveContextReceipt.evidence, knowledge_source_scoped_unavailable: true } }} />)
    expect(screen.getByText(/尚未获得确认的操作不会执行/)).toBeVisible()
    expect(screen.getByText(/知识检索暂不可用/)).toBeVisible()
    expect(screen.queryByRole('region', { name: '本轮详情' })).not.toBeInTheDocument()
  })

  it('keeps unresolved memory and unavailable tools visible without treating scoped provenance as failure', () => {
    const { rerender } = render(<LiveTurnDetails status="生成中" contextReceipt={liveContextReceipt} />)
    expect(screen.queryByText('部分记忆尚待核实')).not.toBeInTheDocument()
    rerender(<LiveTurnDetails status="生成中" contextReceipt={{ ...liveContextReceipt,
      memory: { ...liveContextReceipt.memory, unresolved_fact_count: 1 }, warnings: ['skill_tool_contract_invalid'] }} />)
    expect(screen.getByText(/部分记忆尚待核实/)).toBeVisible()
    expect(screen.getByText(/技能工具不可用/)).toBeVisible()
  })

  it('shows only status before receipts arrive and uses unique per-message controls', () => {
    const { rerender } = render(<LiveTurnDetails status="正在连接模型…" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<><LiveTurnDetails status="准备回答" receipt={liveTurnReceipt} />
      <LiveTurnDetails status="准备回答" receipt={{ ...liveTurnReceipt, run_id: 'run-2' }} /></>)
    const buttons = screen.getAllByRole('button', { name: '本轮详情' })
    expect(new Set(buttons.map(button => button.getAttribute('aria-controls'))).size).toBe(2)
    fireEvent.click(buttons[0])
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'false')
  })
})
