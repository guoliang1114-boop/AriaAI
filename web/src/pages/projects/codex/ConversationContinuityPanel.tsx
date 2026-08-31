import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConversationContinuitySnapshot,
  ConversationContinuityState,
  Message,
  ProjectQuestionResolution,
} from '../../../types/api'
import { api } from '../../../api/client'
import { CxIcon } from './CxIcons'
import { useToast } from '../../../contexts/ToastContext'

const MODE_LABELS: Record<ConversationContinuityState['turn_mode'], string> = {
  answer_only: '仅回答',
  plan_only: '仅规划',
  execute_now: '直接执行',
  plan_then_execute: '规划并执行',
}

interface ConversationContinuityPanelProps {
  conversationId: number
  refreshKey: number
  disabled?: boolean
  latestAssistantMessage: Pick<Message, 'id' | 'content'> | null
  onPrepare: (content: string) => void
  onLocateMessage: (messageId: number) => void
}

const actionButtonStyle = {
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-sm)',
  padding: '4px 8px',
  background: 'var(--bg)',
  color: 'var(--accent-ink)',
  fontSize: 10.5,
} as const

function StateList({
  title,
  items,
}: {
  title: string
  items: string[]
}) {
  if (items.length === 0) return null
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-mute)' }}>{title}</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--ink-soft)', fontSize: 11, lineHeight: 1.55 }}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

function blockerSummary(kind: string, summary: string): string {
  if (kind === 'waiting_confirmation') return '需要用户确认后才能继续执行。'
  return summary || '当前步骤尚未完成。'
}

export function ConversationContinuityPanel({
  conversationId,
  refreshKey,
  disabled = false,
  latestAssistantMessage,
  onPrepare,
  onLocateMessage,
}: ConversationContinuityPanelProps) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<ConversationContinuitySnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolveTarget, setResolveTarget] = useState<string | null>(null)
  const [resolutionSummary, setResolutionSummary] = useState('')
  const [reopenTarget, setReopenTarget] = useState<ProjectQuestionResolution | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [mutationBusy, setMutationBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError(null)
    try {
      const result = await api.get<ConversationContinuitySnapshot>(
        `/chat/conversations/${conversationId}/continuity`,
      )
      if (requestRef.current === requestId) setSnapshot(result)
    } catch (err) {
      if (requestRef.current === requestId) {
        setError(err instanceof Error ? err.message : '暂时无法加载协作状态')
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => void load())
    return () => window.cancelAnimationFrame(frame)
  }, [load, open, refreshKey])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [open])

  useEffect(() => () => {
    requestRef.current += 1
  }, [])

  const prepare = (content: string) => {
    if (disabled) return
    onPrepare(content)
    setOpen(false)
  }
  const visibleSnapshot = snapshot?.conversation_id === conversationId ? snapshot : null
  const state = visibleSnapshot?.status === 'ready' ? visibleSnapshot.state : null
  const questions = visibleSnapshot?.project_questions.items ?? []
  const resolutions = visibleSnapshot?.project_questions.resolved ?? []
  const reviewCount = resolutions.filter((item) => item.status === 'needs_review').length
  const attentionCount = (state?.blockers.length ?? 0) + questions.length + reviewCount
  const activeContext = state
    ? [
        state.active_artifact?.name
          ? `当前产物：${String(state.active_artifact.name)}`
          : '',
        state.active_task?.goal
          ? `当前任务：${String(state.active_task.goal)}`
          : state.active_task?.task_type
            ? `当前任务：${String(state.active_task.task_type)}`
            : '',
      ].filter(Boolean)
    : []

  const beginResolve = (question: string) => {
    setReopenTarget(null)
    setReopenReason('')
    setResolveTarget(question)
    setResolutionSummary('')
  }

  const submitResolution = async () => {
    if (
      mutationBusy
      || !visibleSnapshot
      || !resolveTarget
      || !latestAssistantMessage
      || !resolutionSummary.trim()
    ) return
    setMutationBusy(true)
    try {
      const result = await api.post<ConversationContinuitySnapshot>(
        `/chat/conversations/${conversationId}/continuity/questions/resolve`,
        {
          question: resolveTarget,
          answer_message_id: latestAssistantMessage.id,
          resolution_summary: resolutionSummary.trim(),
          expected_memory_version: visibleSnapshot.project_questions.memory_version,
          expected_slot_version: visibleSnapshot.project_questions.slot_version,
        },
      )
      setSnapshot(result)
      setResolveTarget(null)
      setResolutionSummary('')
      toast.success({ title: '项目问题已解决', description: '已绑定当前回答并写入项目问题账本' })
    } catch (err) {
      toast.error({
        title: '无法标记为已解决',
        description: err instanceof Error ? err.message : '请刷新后重试',
      })
    } finally {
      setMutationBusy(false)
    }
  }

  const submitReopen = async () => {
    if (mutationBusy || !visibleSnapshot || !reopenTarget || !reopenReason.trim()) return
    setMutationBusy(true)
    try {
      const result = await api.post<ConversationContinuitySnapshot>(
        `/chat/conversations/${conversationId}/continuity/questions/${reopenTarget.id}/reopen`,
        {
          reason: reopenReason.trim(),
          expected_resolution_revision: reopenTarget.resolution_revision,
          expected_memory_version: visibleSnapshot.project_questions.memory_version,
          expected_slot_version: visibleSnapshot.project_questions.slot_version,
        },
      )
      setSnapshot(result)
      setReopenTarget(null)
      setReopenReason('')
      toast.success({ title: '问题已重新打开', description: '已作为用户锚点放回项目待确认问题' })
    } catch (err) {
      toast.error({
        title: '无法重新打开问题',
        description: err instanceof Error ? err.message : '请刷新后重试',
      })
    } finally {
      setMutationBusy(false)
    }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="查看当前协作状态"
        aria-expanded={open}
        title="当前目标、阻塞与待确认问题"
        style={{
          height: 30,
          padding: '0 9px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: open ? 'var(--accent-ink)' : 'var(--ink-mute)',
          background: open ? 'var(--accent-bg)' : 'transparent',
          border: 'none',
          borderRadius: 'var(--r-sm)',
          cursor: 'pointer',
          fontSize: 11.5,
        }}
      >
        <CxIcon name="target" size={13} />
        进展
        {visibleSnapshot && attentionCount > 0 && (
          <span
            className="num"
            aria-label={`${attentionCount} 个待处理项`}
            style={{
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 99,
              background: 'color-mix(in oklch, var(--warn) 12%, var(--bg-elev))',
              color: 'var(--warn)',
              fontSize: 9,
            }}
          >
            {attentionCount}
          </span>
        )}
      </button>

      {open && (
        <section
          aria-label="当前协作状态"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            width: 430,
            maxWidth: 'calc(100vw - 40px)',
            maxHeight: 'min(650px, calc(100vh - 100px))',
            overflowY: 'auto',
            marginTop: 7,
            padding: 16,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 18px 42px -16px rgba(0,0,0,0.48)',
            zIndex: 65,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>当前协作状态</div>
              <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-faint)' }}>
                来自最近一轮已校验状态与当前项目记忆
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              style={{ ...actionButtonStyle, color: 'var(--ink-mute)', cursor: loading ? 'wait' : 'pointer' }}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>

          {loading && visibleSnapshot == null && (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
              正在核对连续性状态…
            </div>
          )}
          {error && visibleSnapshot == null && (
            <div style={{ padding: '20px 0 8px', color: 'var(--bad)', fontSize: 12 }}>{error}</div>
          )}

          {visibleSnapshot?.status === 'invalid' && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'color-mix(in oklch, var(--bad) 10%, var(--bg-elev))', color: 'var(--bad)', fontSize: 11.5, lineHeight: 1.55 }}>
              连续性状态校验失败，已拒绝展示可疑内容。项目待确认问题仍来自独立校验的项目记忆。
            </div>
          )}
          {visibleSnapshot?.status === 'unavailable' && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--bg-tint)', color: 'var(--ink-mute)', fontSize: 11.5, lineHeight: 1.55 }}>
              完成一轮对话后，Aria 会在这里显示可核对的目标、约束与下一步。
            </div>
          )}

          {state && (
            <>
              <div style={{ marginTop: 14, padding: '11px 12px', background: 'var(--accent-bg)', border: '1px solid var(--line-soft)', borderRadius: 'var(--r-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 10, color: 'var(--accent-ink)' }}>{MODE_LABELS[state.turn_mode]}</span>
                  <span style={{ fontSize: 9.5, color: 'var(--ink-faint)' }}>已校验 · {state.capsule_sha256.slice(0, 7)}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.55 }}>
                  {state.active_goal || '当前轮次未记录明确目标'}
                </div>
                {state.next_goal && (
                  <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
                    下一步：{state.next_goal}
                  </div>
                )}
                <div style={{ marginTop: 9, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {state.next_goal && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => prepare(`继续推进当前目标：${state.next_goal}`)}
                      style={{ ...actionButtonStyle, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}
                    >
                      加入输入框
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onLocateMessage(state.capsule_message_id)}
                    style={{ ...actionButtonStyle, color: 'var(--ink-mute)', cursor: 'pointer' }}
                  >
                    查看来源消息
                  </button>
                </div>
              </div>

              <StateList title="已确认约束" items={state.confirmed_constraints} />
              <StateList title="已形成决策" items={state.decisions} />
              <StateList title="当前工作对象" items={activeContext} />

              {state.blockers.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--warn)' }}>未解决阻塞</div>
                  <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {state.blockers.map((blocker, index) => (
                      <div key={`${blocker.kind}:${blocker.tool_name}:${index}`} style={{ padding: '9px 10px', border: '1px solid var(--line-soft)', borderRadius: 'var(--r-sm)', background: 'color-mix(in oklch, var(--warn) 9%, var(--bg-elev))' }}>
                        <div style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{blockerSummary(blocker.kind, blocker.summary)}</div>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => prepare(`请先处理当前阻塞：${blockerSummary(blocker.kind, blocker.summary)}`)}
                          style={{ ...actionButtonStyle, marginTop: 7, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}
                        >
                          加入输入框
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {visibleSnapshot && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line-soft)', paddingTop: 11 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-mute)' }}>项目待确认问题</div>
                <div style={{ fontSize: 9.5, color: visibleSnapshot.project_questions.stale ? 'var(--warn)' : 'var(--ink-faint)' }}>
                  {visibleSnapshot.project_questions.status === 'missing'
                    ? '项目记忆尚未生成'
                    : visibleSnapshot.project_questions.stale
                      ? `记忆 v${visibleSnapshot.project_questions.memory_version} 待刷新`
                      : `记忆 v${visibleSnapshot.project_questions.memory_version}`}
                </div>
              </div>
              {questions.length === 0 ? (
                <div style={{ marginTop: 7, color: 'var(--ink-faint)', fontSize: 11 }}>当前没有已记录的待确认问题</div>
              ) : (
                <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {questions.map((question) => (
                    <div key={question} style={{ padding: '9px 10px', background: 'var(--bg-tint)', borderRadius: 'var(--r-sm)' }}>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{question}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => prepare(`请基于当前项目事实回答并推进这个待确认问题：${question}`)}
                          style={{ ...actionButtonStyle, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}
                        >
                          加入输入框
                        </button>
                        <button
                          type="button"
                          disabled={disabled || visibleSnapshot.project_questions.stale || visibleSnapshot.project_questions.slot_version < 1 || !latestAssistantMessage || mutationBusy}
                          onClick={() => beginResolve(question)}
                          title={
                            visibleSnapshot.project_questions.stale
                              ? '项目问题记忆待刷新，暂不能关闭'
                              : latestAssistantMessage
                                ? '绑定最近一条已保存的 AI 回答，并由你确认解决摘要'
                                : '当前对话还没有可绑定的 AI 回答'
                          }
                          style={{
                            ...actionButtonStyle,
                            cursor: disabled || visibleSnapshot.project_questions.stale || visibleSnapshot.project_questions.slot_version < 1 || !latestAssistantMessage || mutationBusy ? 'not-allowed' : 'pointer',
                            opacity: disabled || visibleSnapshot.project_questions.stale || visibleSnapshot.project_questions.slot_version < 1 || !latestAssistantMessage ? 0.5 : 1,
                          }}
                        >
                          标记已解决
                        </button>
                      </div>
                      {resolveTarget === question && latestAssistantMessage && (
                        <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--line-soft)' }}>
                          <div style={{ fontSize: 10, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
                            将绑定最近回答 #{latestAssistantMessage.id}：{latestAssistantMessage.content.trim().slice(0, 120) || '（回答正文为空）'}
                          </div>
                          <textarea
                            aria-label="解决摘要"
                            value={resolutionSummary}
                            onChange={(event) => setResolutionSummary(event.target.value)}
                            maxLength={600}
                            placeholder="简要说明为什么这条回答已经解决问题"
                            style={{ width: '100%', minHeight: 58, marginTop: 7, padding: '7px 8px', resize: 'vertical', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 11, lineHeight: 1.5 }}
                          />
                          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <button type="button" disabled={mutationBusy || !resolutionSummary.trim()} onClick={() => void submitResolution()} style={{ ...actionButtonStyle, cursor: mutationBusy ? 'wait' : 'pointer', opacity: resolutionSummary.trim() ? 1 : 0.5 }}>
                              {mutationBusy ? '保存中…' : '确认解决'}
                            </button>
                            <button type="button" disabled={mutationBusy} onClick={() => setResolveTarget(null)} style={{ ...actionButtonStyle, color: 'var(--ink-mute)', cursor: 'pointer' }}>取消</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {visibleSnapshot && resolutions.length > 0 && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line-soft)', paddingTop: 11 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-mute)' }}>最近已解决问题</div>
              <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {resolutions.map((resolution) => (
                  <div key={resolution.id} style={{ padding: '9px 10px', border: '1px solid var(--line-soft)', borderRadius: 'var(--r-sm)', background: resolution.status === 'needs_review' ? 'color-mix(in oklch, var(--warn) 8%, var(--bg-elev))' : 'var(--bg-tint)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 9.5, color: resolution.status === 'needs_review' ? 'var(--warn)' : 'var(--good)' }}>
                        {resolution.status === 'needs_review' ? '待复核' : '已解决'}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--ink-faint)' }}>记忆 v{resolution.resolved_memory_version}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{resolution.question}</div>
                    <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--ink-mute)', lineHeight: 1.5 }}>结论：{resolution.resolution_summary}</div>
                    {resolution.status === 'needs_review' && (
                      <div style={{ marginTop: 4, fontSize: 10, color: 'var(--warn)' }}>
                        项目记忆已变化或问题再次出现，请人工复核。
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                      {resolution.answer_available && resolution.answer_message_id && resolution.answer_conversation_id === conversationId && (
                        <button type="button" onClick={() => onLocateMessage(resolution.answer_message_id as number)} style={{ ...actionButtonStyle, color: 'var(--ink-mute)', cursor: 'pointer' }}>查看绑定回答</button>
                      )}
                      <button
                        type="button"
                        disabled={disabled || visibleSnapshot.project_questions.stale || visibleSnapshot.project_questions.slot_version < 1 || mutationBusy}
                        onClick={() => {
                          setResolveTarget(null)
                          setResolutionSummary('')
                          setReopenTarget(resolution)
                          setReopenReason('')
                        }}
                        style={{ ...actionButtonStyle, cursor: disabled || visibleSnapshot.project_questions.stale || visibleSnapshot.project_questions.slot_version < 1 || mutationBusy ? 'not-allowed' : 'pointer', opacity: disabled || visibleSnapshot.project_questions.stale || visibleSnapshot.project_questions.slot_version < 1 ? 0.5 : 1 }}
                      >
                        重新打开
                      </button>
                    </div>
                    {reopenTarget?.id === resolution.id && (
                      <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--line-soft)' }}>
                        <textarea
                          aria-label="重新打开原因"
                          value={reopenReason}
                          onChange={(event) => setReopenReason(event.target.value)}
                          maxLength={600}
                          placeholder="说明为什么该结论需要重新确认"
                          style={{ width: '100%', minHeight: 54, padding: '7px 8px', resize: 'vertical', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 11, lineHeight: 1.5 }}
                        />
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <button type="button" disabled={mutationBusy || !reopenReason.trim()} onClick={() => void submitReopen()} style={{ ...actionButtonStyle, cursor: mutationBusy ? 'wait' : 'pointer', opacity: reopenReason.trim() ? 1 : 0.5 }}>
                            {mutationBusy ? '保存中…' : '确认重新打开'}
                          </button>
                          <button type="button" disabled={mutationBusy} onClick={() => setReopenTarget(null)} style={{ ...actionButtonStyle, color: 'var(--ink-mute)', cursor: 'pointer' }}>取消</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {disabled && (
            <div style={{ marginTop: 10, color: 'var(--warn)', fontSize: 10.5 }}>
              当前轮次结束后可将下一步加入输入框；不会自动发送或执行。
            </div>
          )}
          {visibleSnapshot && (
            <div style={{ marginTop: 13, padding: '8px 10px', background: 'var(--bg-tint)', borderRadius: 'var(--r-sm)', fontSize: 10.5, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
              边界：这里只展示有范围限制且通过校验的协作状态；不包含回答正文、提示词、工具输入或隐藏推理。解决/重开都需要你明确确认，并经过项目写权限校验。
            </div>
          )}
          {error && visibleSnapshot && (
            <div style={{ marginTop: 7, color: 'var(--warn)', fontSize: 10.5 }}>刷新失败，当前展示上次结果。</div>
          )}
        </section>
      )}
    </div>
  )
}
