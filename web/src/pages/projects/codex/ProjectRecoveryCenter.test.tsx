import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectRecoveryCenter as RecoveryCenterPayload } from '../../../types/api'
import { ProjectRecoveryCenter } from './ProjectRecoveryCenter'

const payload: RecoveryCenterPayload = {
  schema_version: 1,
  project_id: 9,
  generated_at: '2026-08-31T08:00:00Z',
  summary: {
    returned_count: 2,
    ready_count: 1,
    continued_count: 1,
    projection_missing_count: 0,
    attention_count: 1,
    unapplied_input_count: 2,
    oldest_attention_at: '2026-08-31T07:00:00Z',
    truncated: false,
  },
  items: [
    {
      run_id: 'run_ready',
      conversation_id: 4,
      conversation_title: '交付方案',
      source_message_id: 10,
      assistant_message_id: 11,
      source_status: 'interrupted',
      phase: 'model_stream',
      reason: { category: 'worker_lost', code: 'CHAT_RUN_WORKER_LEASE_EXPIRED' },
      retryable: true,
      recovery_state: 'ready',
      can_review: true,
      projection_available: true,
      child_run: null,
      unapplied_input_count: 2,
      unapplied_input_message_ids: [12, 13],
      applied_input_count: 1,
      started_at: '2026-08-31T06:59:00Z',
      completed_at: '2026-08-31T07:00:00Z',
      updated_at: '2026-08-31T07:00:00Z',
    },
    {
      run_id: 'run_continued',
      conversation_id: 5,
      conversation_title: '风险复盘',
      source_message_id: 20,
      assistant_message_id: 21,
      source_status: 'failed',
      phase: 'tool_execution',
      reason: { category: 'runtime_failure', code: 'TOOL_RUNTIME_FAILED' },
      retryable: false,
      recovery_state: 'continued',
      can_review: false,
      projection_available: true,
      child_run: {
        run_id: 'run_child',
        status: 'completed',
        assistant_message_id: 22,
        updated_at: '2026-08-31T08:00:00Z',
      },
      unapplied_input_count: 0,
      unapplied_input_message_ids: [],
      applied_input_count: 0,
      started_at: '2026-08-31T07:20:00Z',
      completed_at: '2026-08-31T07:21:00Z',
      updated_at: '2026-08-31T07:21:00Z',
    },
  ],
  privacy: {
    includes_message_content: false,
    includes_prompt_content: false,
    includes_worker_lease_token: false,
  },
}

describe('ProjectRecoveryCenter', () => {
  it('shows recovery evidence and opens the selected durable run', async () => {
    const onOpen = vi.fn()
    const onRefresh = vi.fn()
    render(
      <ProjectRecoveryCenter
        data={payload}
        loading={false}
        error={null}
        onRefresh={onRefresh}
        onOpen={onOpen}
      />,
    )

    expect(screen.getByText('交付方案')).toBeInTheDocument()
    expect(screen.getByText('执行进程失联', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('2 条运行中追问尚未应用')).toBeInTheDocument()
    expect(screen.getByText('已保存安全检查点，可打开核对后作为新轮次继续。')).toBeInTheDocument()
    expect(screen.getByText(/不读取消息正文、提示词或工作进程凭证/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '打开并核对' }))
    expect(onOpen).toHaveBeenCalledWith(payload.items[0])

    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders a clear empty state', () => {
    render(
      <ProjectRecoveryCenter
        data={{
          ...payload,
          summary: { ...payload.summary, returned_count: 0, ready_count: 0, continued_count: 0, attention_count: 0 },
          items: [],
        }}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByText('当前没有中断或失败的运行。')).toBeInTheDocument()
  })
})
