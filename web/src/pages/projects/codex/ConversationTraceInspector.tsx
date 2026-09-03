import { useMemo, useState } from 'react'
import { api } from '../../../api/client'
import type {
  ChatTraceDiagnostic,
  ChatTraceDiagnosticComparison,
  ChatTraceDiagnosticList,
} from '../../../types/api'

const MODE_LABELS: Record<string, string> = {
  standalone_qa: '独立问答',
  project_deep_dive: '项目深挖',
  cross_project_portfolio: '跨项目分析',
  workspace_inventory: '工作台盘点',
  skill_execution: 'Skill 执行',
  task_orchestration: '任务编排',
}

const POLICY_LABELS: Record<string, string> = {
  direct_answer: '直接回答',
  read_only_tool: '只读工具',
  write_artifact: '生成交付物',
  modify_existing_file: '修改文件',
  durable_task: '持久任务',
  destructive_action: '高风险动作',
}

const WARNING_LABELS: Record<string, string> = {
  target_context_manifest_invalid: '本轮上下文清单未通过完整性校验',
  target_history_compacted: '本轮因上下文空间不足压缩了较早对话',
  target_recent_messages_truncated: '本轮有近期消息被截短',
  target_more_fallbacks: '本轮降级或拦截事件比对照轮更多',
  route_changed: '本轮对话路由与对照轮不同',
  model_changed: '本轮模型与对照轮不同',
}

const COMPACTION_LABELS: Record<string, string> = {
  none: '无需压缩',
  recent_turns_with_bounded_excerpts: '保留近期轮次并生成较早对话摘录',
  recent_turns_truncated: '保留并截短近期轮次',
  system_middle_truncated: '系统上下文中段压缩',
  unknown: '压缩策略不可验证',
}

const CHANGE_LABELS: Record<string, string> = {
  chat_mode: '对话路由',
  action_policy: '动作权限',
  intent_method: '路由方法',
  model_used: '模型',
  'context.manifest_valid': '上下文完整性',
  'context.compacted': '上下文压缩',
  'context.system_compacted': '系统上下文压缩',
  'context.history_compacted': '历史对话压缩',
  'context.history_messages_before': '原历史消息数',
  'context.history_messages_after': '保留历史消息数',
  'context.summarized_messages': '摘要化消息数',
  'context.truncated_recent_messages': '截短近期消息数',
  'context.estimated_total_after': '最终估算 Token',
  'execution.tool_decision_count': '工具决策数',
  'execution.artifact_count': '交付物数',
  'execution.fallback_count': '降级事件数',
}

function diagnosticLabel(trace: ChatTraceDiagnostic): string {
  const mode = MODE_LABELS[trace.routing.chat_mode] || trace.routing.chat_mode || '未记录路由'
  return `消息 #${trace.message_id || '—'} · ${mode}`
}

function displayValue(field: string, value: string | number | boolean | null): string {
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (field === 'chat_mode') return MODE_LABELS[String(value)] || String(value || '未记录')
  if (field === 'action_policy') return POLICY_LABELS[String(value)] || String(value || '未记录')
  return value == null || value === '' ? '未记录' : String(value)
}

function intentReasonLabel(reason: string): string {
  if (reason === 'router_explanation_withheld') return '详细说明已隐藏（防止复述正文）'
  return reason
}

export function ConversationTraceInspector({
  conversationId,
  messageId,
}: {
  conversationId: number
  messageId: number
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<ChatTraceDiagnostic | null>(null)
  const [history, setHistory] = useState<ChatTraceDiagnostic[]>([])
  const [baseTraceId, setBaseTraceId] = useState('')
  const [comparison, setComparison] = useState<ChatTraceDiagnosticComparison | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)

  const candidates = useMemo(
    () => history.filter((item) => item.trace_id !== current?.trace_id),
    [current?.trace_id, history],
  )

  const load = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const [diagnostic, traceList] = await Promise.all([
        api.get<ChatTraceDiagnostic>(`/chat/messages/${messageId}/trace`),
        api.get<ChatTraceDiagnosticList>(
          `/chat/conversations/${conversationId}/traces`,
          { params: { limit: 30 } },
        ),
      ])
      if (diagnostic.conversation_id !== conversationId || diagnostic.message_id !== messageId) {
        throw new Error('诊断记录与当前消息不匹配')
      }
      setCurrent(diagnostic)
      setHistory(traceList.conversation_id === conversationId ? traceList.items : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '暂时无法读取回答诊断')
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !current && !loading) void load()
  }

  const compareWith = async (traceId: string) => {
    setBaseTraceId(traceId)
    setComparison(null)
    if (!traceId || !current) return
    setCompareLoading(true)
    setError('')
    try {
      const result = await api.get<ChatTraceDiagnosticComparison>(
        `/chat/conversations/${conversationId}/trace-compare`,
        { params: { base_trace_id: traceId, target_trace_id: current.trace_id } },
      )
      if (result.conversation_id !== conversationId || result.target.trace_id !== current.trace_id) {
        throw new Error('对比记录与当前消息不匹配')
      }
      setComparison(result)
    } catch (compareError) {
      setError(compareError instanceof Error ? compareError.message : '暂时无法对比两轮回答')
    } finally {
      setCompareLoading(false)
    }
  }

  const context = current?.context
  const execution = current?.execution
  return (
    <div style={{ marginTop: 7, fontSize: 11, color: 'var(--ink-mute)' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="查看回答诊断"
        onClick={toggle}
        style={{ color: 'var(--ink-mute)', fontSize: 11 }}
      >
        {open ? '收起回答诊断' : '查看回答诊断'}
      </button>
      {open && (
        <div
          aria-label="回答诊断详情"
          style={{
            marginTop: 6,
            maxWidth: 720,
            padding: '9px 11px',
            border: '1px solid var(--line-soft)',
            borderRadius: 'var(--r-sm)',
            background: 'var(--bg-tint)',
            lineHeight: 1.55,
          }}
        >
          {loading && <div>正在核对本轮路由、上下文和执行记录…</div>}
          {error && (
            <div style={{ color: 'var(--bad)' }}>
              {error}
              {!current && (
                <button type="button" onClick={() => { void load() }} style={{ marginLeft: 8, color: 'var(--accent)' }}>
                  重试
                </button>
              )}
            </div>
          )}
          {current && context && execution && (
            <>
              <div style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>
                {MODE_LABELS[current.routing.chat_mode] || current.routing.chat_mode || '未记录路由'}
                {' · '}{POLICY_LABELS[current.routing.action_policy] || current.routing.action_policy || '未记录权限'}
                {current.routing.model_used ? ` · ${current.routing.model_used}` : ''}
              </div>
              <div>
                路由依据 · {current.routing.intent_method || '未记录'}
                {current.routing.intent_reason ? ` / ${intentReasonLabel(current.routing.intent_reason)}` : ''}
              </div>
              <div style={{ color: context.manifest_valid ? 'var(--ink-mute)' : 'var(--warn)' }}>
                上下文 · {context.manifest_valid ? '清单已校验' : '清单不可验证'}
                {context.history_messages_before > 0
                  ? ` · 历史 ${context.history_messages_before} → ${context.history_messages_after} 条`
                  : ''}
                {context.summarized_messages > 0 ? ` · 摘要化 ${context.summarized_messages} 条` : ''}
                {context.truncated_recent_messages > 0 ? ` · 截短近期 ${context.truncated_recent_messages} 条` : ''}
              </div>
              {context.compacted && (
                <div>压缩策略 · {COMPACTION_LABELS[context.compaction_strategy] || context.compaction_strategy}</div>
              )}
              <div>
                执行 · 工具决策 {execution.tool_decision_count} 次
                {` · 交付物 ${execution.artifact_count} 个 · 降级/拦截 ${execution.fallback_count} 次`}
                {typeof execution.timings.total_stream_ms === 'number'
                  ? ` · ${Math.round(execution.timings.total_stream_ms)} ms`
                  : ''}
              </div>
              <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <label htmlFor={`trace-compare-${messageId}`}>与其他轮次对比</label>
                <select
                  id={`trace-compare-${messageId}`}
                  aria-label="选择对照轮次"
                  value={baseTraceId}
                  onChange={(event) => { void compareWith(event.target.value) }}
                  style={{ maxWidth: 260, padding: '2px 5px', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', background: 'var(--bg)' }}
                >
                  <option value="">选择一轮</option>
                  {candidates.map((item) => (
                    <option key={item.trace_id} value={item.trace_id}>{diagnosticLabel(item)}</option>
                  ))}
                </select>
                {compareLoading && <span>对比中…</span>}
                {!compareLoading && candidates.length === 0 && <span>暂无其他可对比轮次</span>}
              </div>
              {comparison && (
                <div aria-label="回答诊断对比" style={{ marginTop: 7 }}>
                  {comparison.warnings.map((warning) => (
                    <div key={warning} style={{ color: 'var(--warn)' }}>
                      {WARNING_LABELS[warning] || warning}
                    </div>
                  ))}
                  {comparison.changes.length > 0 ? comparison.changes.slice(0, 16).map((change) => (
                    <div key={change.field}>
                      {CHANGE_LABELS[change.field] || change.field} · {displayValue(change.field, change.before)} → {displayValue(change.field, change.after)}
                    </div>
                  )) : <div>两轮诊断字段一致</div>}
                </div>
              )}
              <div style={{ marginTop: 7, color: 'var(--ink-faint)' }}>
                诊断不包含消息正文、Prompt、工具输入输出或隐藏推理。
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
