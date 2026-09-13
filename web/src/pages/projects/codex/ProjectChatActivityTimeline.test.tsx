import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { emptyTimeline } from '../../../stores/runActivityReducer'
import { ProjectChatActivityTimeline } from './ProjectChatActivityTimeline'

describe('ProjectChatActivityTimeline attention visibility', () => {
  it('defaults live steps to collapsed and preserves failed-step and artifact warnings', () => {
    render(<ProjectChatActivityTimeline isStreaming timeline={{ ...emptyTimeline('run_attention'),
      steps: [{ index: 1, title: '读取项目资料', status: 'failed', items: [] }],
      artifacts: [{ id: '1', type: 'pdf', verification: { status: 'failed' } }],
    }} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent('步骤失败 · 读取项目资料')
    expect(screen.getByRole('status')).toHaveTextContent('1 个交付物校验失败')
  })
  it('keeps failure reasons visible after the user collapses the step list', () => {
    render(<ProjectChatActivityTimeline timeline={{ ...emptyTimeline('run_error'), final_status: 'failed',
      error: { code: 'provider_timeout', message: '模型无进展，已停止本轮', retryable: true } }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent('模型无进展，已停止本轮')
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('keeps pending confirmation and its impact visible with collapsed details', () => {
    render(<ProjectChatActivityTimeline timeline={{ ...emptyTimeline('run_confirm'), final_status: 'waiting_confirmation',
      confirmation: { action: '更新项目', impact: '将修改两项项目内容' } }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('status')).toHaveTextContent('等待确认 · 更新项目 · 将修改两项项目内容')
    expect(screen.getByRole('status')).toBeVisible()
  })

  it('does not present a completed historical confirmation as still pending', () => {
    render(<ProjectChatActivityTimeline timeline={{ ...emptyTimeline('run_done'), final_status: 'completed',
      confirmation: { action: '更新项目', impact: '修改两项内容' } }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText(/等待确认 · 更新项目/)).not.toBeInTheDocument()
    expect(screen.getByText('确认记录 · 更新项目 · 修改两项内容')).toBeVisible()
  })
})
