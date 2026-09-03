import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client'
import type {
  ChatTraceDiagnostic,
  ChatTraceDiagnosticComparison,
  ChatTraceDiagnosticList,
} from '../../../types/api'
import { ConversationTraceInspector } from './ConversationTraceInspector'

vi.mock('../../../api/client', () => ({ api: { get: vi.fn() } }))

function diagnostic(overrides: Partial<ChatTraceDiagnostic> = {}): ChatTraceDiagnostic {
  return {
    schema_version: 1,
    id: 8,
    trace_id: 'trace-current',
    conversation_id: 12,
    message_id: 42,
    project_id: 9,
    created_at: '2026-09-03T10:00:00Z',
    routing: {
      chat_mode: 'project_deep_dive',
      action_policy: 'read_only_tool',
      intent_method: 'policy_guard',
      intent_reason: 'project_question',
      model_used: 'glm-5.1',
    },
    context: {
      manifest_valid: true,
      manifest_reason: 'valid',
      compacted: true,
      system_compacted: false,
      history_compacted: true,
      source_count: 8,
      included_source_count: 7,
      history_messages_before: 18,
      history_messages_after: 6,
      summarized_messages: 12,
      truncated_recent_messages: 1,
      estimated_total_before: 22_000,
      estimated_total_after: 12_000,
      context_window_tokens: 16_000,
      compaction_strategy: 'recent_turns_with_bounded_excerpts',
      summary_injected: true,
      oldest_retained_message_index: 12,
    },
    execution: {
      tool_decision_count: 2,
      tool_status_counts: { success: 1, blocked: 1 },
      artifact_count: 1,
      fallback_count: 1,
      fallback_types: ['tool_blocked'],
      timings: { total_stream_ms: 1420 },
    },
    privacy: {
      includes_prompt_content: false,
      includes_message_content: false,
      includes_tool_inputs: false,
      includes_tool_outputs: false,
      includes_hidden_reasoning: false,
    },
    ...overrides,
  }
}

describe('ConversationTraceInspector', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('loads only on demand and explains routing, compaction, and execution safely', async () => {
    const current = diagnostic()
    const list: ChatTraceDiagnosticList = {
      schema_version: 1,
      conversation_id: 12,
      items: [current],
      has_more: false,
      next_before_id: null,
    }
    vi.mocked(api.get).mockImplementation(async (path) => (
      path === '/chat/messages/42/trace' ? current : list
    ))

    render(<ConversationTraceInspector conversationId={12} messageId={42} />)
    expect(api.get).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '查看回答诊断' }))

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/项目深挖 · 只读工具 · glm-5\.1/)).toBeInTheDocument()
    expect(screen.getByText(/历史 18 → 6 条 · 摘要化 12 条 · 截短近期 1 条/)).toBeInTheDocument()
    expect(screen.getByText(/工具决策 2 次 · 交付物 1 个 · 降级\/拦截 1 次 · 1420 ms/)).toBeInTheDocument()
    expect(screen.getByText(/不包含消息正文、Prompt、工具输入输出或隐藏推理/)).toBeInTheDocument()
    expect(screen.getByText('暂无其他可对比轮次')).toBeInTheDocument()
  })

  it('compares the selected prior turn with the exact current trace', async () => {
    const current = diagnostic()
    const previous = diagnostic({
      id: 7,
      trace_id: 'trace-previous',
      message_id: 40,
      routing: {
        ...current.routing,
        chat_mode: 'standalone_qa',
        model_used: 'glm-previous',
      },
      context: {
        ...current.context,
        compacted: false,
        history_compacted: false,
        history_messages_before: 4,
        history_messages_after: 4,
        summarized_messages: 0,
        truncated_recent_messages: 0,
      },
    })
    const list: ChatTraceDiagnosticList = {
      schema_version: 1,
      conversation_id: 12,
      items: [current, previous],
      has_more: false,
    }
    const comparison: ChatTraceDiagnosticComparison = {
      schema_version: 1,
      conversation_id: 12,
      base: previous,
      target: current,
      warnings: ['route_changed', 'model_changed', 'target_history_compacted'],
      changes: [
        { field: 'chat_mode', before: 'standalone_qa', after: 'project_deep_dive' },
        { field: 'context.history_messages_after', before: 4, after: 6 },
      ],
      privacy: current.privacy,
    }
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/chat/messages/42/trace') return current
      if (path.includes('trace-compare')) return comparison
      return list
    })

    render(<ConversationTraceInspector conversationId={12} messageId={42} />)
    await userEvent.click(screen.getByRole('button', { name: '查看回答诊断' }))
    await screen.findByText(/项目深挖/)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '选择对照轮次' }), 'trace-previous')

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      '/chat/conversations/12/trace-compare',
      { params: { base_trace_id: 'trace-previous', target_trace_id: 'trace-current' } },
    ))
    expect(await screen.findByText('本轮对话路由与对照轮不同')).toBeInTheDocument()
    expect(screen.getByText(/对话路由 · 独立问答 → 项目深挖/)).toBeInTheDocument()
    expect(screen.getByText(/保留历史消息数 · 4 → 6/)).toBeInTheDocument()
  })
})
