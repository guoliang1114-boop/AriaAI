import { useMemo, useRef, useState } from 'react'
import { api } from '../../../api/client'
import { MarkdownRenderer } from '../../../components/MarkdownRenderer'
import { useToast } from '../../../contexts/ToastContext'
import type {
  GeneratedArtifact,
  MemoryCandidateCreateResponse,
  Message,
  MessageFeedback,
  MessageFeedbackRating,
  MessageFeedbackReason,
  Reference,
  TurnRecoveryPreview,
  TurnRecoveryPreviewV2,
} from '../../../types/api'
import type { ContextReceiptEvent } from '../../../types/productRunEvent'
import { parseChatStreamEvent, toContextReceiptEvent } from '../../../types/chatStreamEvent'
import type { RunActivityTimeline } from '../../../stores/runActivityReducer'
import { knowledgeReferenceLabel, normalizeKnowledgeReferences } from '../../../utils/knowledgeEvidence'
import { contextHistoryEvidenceLabel, contextMemoryLayerLabel } from '../../../utils/contextReceipt'
import { CxIcon } from './CxIcons'
import { ProjectChatActivityTimeline } from './ProjectChatActivityTimeline'
import { SkillCandidateButtons } from './SkillCandidateButtons'
import {
  parseProjectTurnRevision,
  parseProjectTurnMetadata,
  projectTurnFingerprint,
  type ParsedProjectTurnRevision,
  type ParsedProjectTurnMetadata,
  type ProjectTurnReusePayload,
} from './turnBrief'
import { PROJECT_TURN_REVISION_FIELD_LABELS } from './ProjectTurnSetupControl'
import { formatUpdatedRelative } from './useProjectsApi'
import { artifactVerificationLabel } from '../../../utils/artifactVerification'
import { ConversationTraceInspector } from './ConversationTraceInspector'

/** Project-chat-tab message bubble.
 *
 * We deliberately keep this isolated from the global `/chat` page's
 * `MessageBubble` (which is ~150 LOC entangled with live-streaming
 * state) and instead reimplement a leaner, read-only version here.
 * Structured evidence, run controls, and outputs parsed from `metadata_json`
 * are rendered
 * around the markdown body:
 *
 *   - skill_progress[]   → compact "执行清单" pill (collapsed by default)
 *   - artifacts[]        → file-style cards with size / type badge
 *   - references[]       → canonical [K*] / legacy [N] citation chips
 *   - turn_brief / turn_contract → visible, reusable turn boundary
 *
 * Bottom of each Aria message: hover-only action chips. Just two —
 * 复制 and 沉淀到项目记忆.
 */

interface ProgressStep {
  key?: string
  label: string
  description?: string
  status?: 'pending' | 'active' | 'done' | 'error' | string
  logs?: string[]
}

interface ParsedMeta {
  references: Reference[]
  artifacts: GeneratedArtifact[]
  progress: ProgressStep[]
  contextReceipt: ContextReceiptEvent | null
  turn: ParsedProjectTurnMetadata | undefined
  revision: ParsedProjectTurnRevision | undefined
  feedback: MessageFeedback | null
  rollout: { run_id: string; status: string } | null
  interrupted: boolean
  locallyStopped: boolean
  persistedMessageId: number | null
  activityTimeline: RunActivityTimeline | null
}

function parseActivityTimeline(value: unknown): RunActivityTimeline | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<RunActivityTimeline>
  if (typeof raw.run_id !== 'string' || !raw.run_id.trim()) return null
  const steps = Array.isArray(raw.steps)
    ? raw.steps
      .filter((step) => step && Number.isInteger(Number(step.index)))
      .map((step) => ({
        ...step,
        index: Number(step.index),
        title: String(step.title || `第 ${step.index} 步`),
        status: step.status || 'pending',
        items: Array.isArray(step.items) ? step.items : [],
      }))
    : []
  const contextReceiptEvent = parseChatStreamEvent(raw.context_receipt)
  const contextReceipt = contextReceiptEvent
    ? toContextReceiptEvent(contextReceiptEvent)
    : undefined
  return {
    ...raw,
    run_id: raw.run_id,
    steps,
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    memory_candidates: Array.isArray(raw.memory_candidates) ? raw.memory_candidates : [],
    steering: Array.isArray(raw.steering) ? raw.steering : [],
    context_receipt: contextReceipt || undefined,
    text: typeof raw.text === 'string' ? raw.text : '',
  }
}

function parseMeta(raw: string | undefined): ParsedMeta {
  const empty: ParsedMeta = {
    references: [], artifacts: [], progress: [], contextReceipt: null, turn: undefined, revision: undefined,
    feedback: null, rollout: null, interrupted: false, locallyStopped: false, persistedMessageId: null,
    activityTimeline: null,
  }
  if (!raw) return empty
  try {
    const meta = JSON.parse(raw) as Record<string, unknown>
    const refs = normalizeKnowledgeReferences(meta.references)
    const arts = Array.isArray(meta.artifacts) ? (meta.artifacts as GeneratedArtifact[]) : []
    const prog = Array.isArray(meta.skill_progress) ? (meta.skill_progress as ProgressStep[]) : []
    const receiptEvent = parseChatStreamEvent(meta.context_receipt)
    const receipt = receiptEvent ? toContextReceiptEvent(receiptEvent) : null
    const rawFeedback = meta.interaction_feedback && typeof meta.interaction_feedback === 'object'
      ? meta.interaction_feedback as Record<string, unknown>
      : null
    const feedbackRating = rawFeedback?.rating
    const feedback = rawFeedback?.schema_version === 1
      && (feedbackRating === 'helpful' || feedbackRating === 'unhelpful')
      ? {
        schema_version: 1 as const,
        rating: feedbackRating as MessageFeedbackRating,
        reasons: Array.isArray(rawFeedback.reasons)
          ? rawFeedback.reasons.filter(
            (reason): reason is MessageFeedbackReason => typeof reason === 'string'
              && Object.prototype.hasOwnProperty.call(FEEDBACK_REASON_LABELS, reason),
          ).slice(0, 3)
          : [],
        updated_at: String(rawFeedback.updated_at || ''),
      }
      : null
    const rawRollout = meta.run_rollout && typeof meta.run_rollout === 'object'
      ? meta.run_rollout as Record<string, unknown>
      : null
    const rollout = rawRollout
      && typeof rawRollout.run_id === 'string'
      && /^run_[A-Za-z0-9_-]{1,76}$/u.test(rawRollout.run_id)
      ? { run_id: rawRollout.run_id, status: String(rawRollout.status || '') }
      : null
    return {
      references: refs,
      artifacts: arts,
      progress: prog,
      contextReceipt: receipt,
      turn: parseProjectTurnMetadata(meta),
      revision: parseProjectTurnRevision(meta),
      feedback,
      rollout,
      interrupted: Boolean(
        meta.turn_interrupted
        || meta.phase_error
        || meta.stopped
        || (rollout && ['cancelled', 'failed', 'interrupted'].includes(rollout.status)),
      ),
      locallyStopped: Boolean(meta.stopped),
      persistedMessageId: Number.isInteger(Number(meta.persisted_message_id))
        && Number(meta.persisted_message_id) > 0
        ? Number(meta.persisted_message_id)
        : null,
      activityTimeline: parseActivityTimeline(meta.activity_timeline),
    }
  } catch {
    return empty
  }
}

interface MessageBubbleProps {
  message: Message
  projectId: number
  onArtifactClick?: (artifact: GeneratedArtifact) => void
  /** Render as the in-flight reply: live Markdown body + a "生成中"
   * header pulse, with artifact / reference / action chrome suppressed
   * (none of it is available until the stream's `done` event). The
   * caller keeps the React key stable across the streaming→final
   * transition so this node updates in place instead of remounting. */
  isStreaming?: boolean
  streamingStatus?: string | null
  activityTimeline?: RunActivityTimeline | null
  onSkillSelect?: (skillId: number, name: string) => void
  onTurnBriefReuse?: (payload: ProjectTurnReusePayload) => void
  onTurnRevisionSourceOpen?: (sourceMessageId: number, sourceFingerprint: string) => void
  onTurnRecovery?: (preview: TurnRecoveryPreview) => Promise<void>
}

export function ProjectChatMessage({
  message,
  projectId,
  onArtifactClick,
  isStreaming = false,
  streamingStatus = null,
  activityTimeline = null,
  onSkillSelect,
  onTurnBriefReuse,
  onTurnRevisionSourceOpen,
  onTurnRecovery,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const meta = useMemo(() => parseMeta(message.metadata_json), [message.metadata_json])
  const effectiveTimeline = activityTimeline || meta.activityTimeline

  return (
    <div
      id={`project-chat-message-${message.id}`}
      className="group"
      style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          marginTop: 3,
          borderRadius: isUser ? 99 : 'var(--r-sm)',
          background: isUser ? 'var(--bg-tint)' : 'var(--accent-bg)',
          color: isUser ? 'var(--ink-soft)' : 'var(--accent)',
          border: isUser
            ? '1px solid var(--line)'
            : '1px solid color-mix(in oklch, var(--accent) 22%, transparent)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {isUser ? '你' : <CxIcon name="sparkle" size={14} />}
      </span>
      <div style={{ flex: 1, paddingTop: 3, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--ink-mute)',
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              color: isUser ? 'var(--ink-soft)' : 'var(--accent-ink)',
              fontWeight: 500,
            }}
          >
            {isUser ? '我' : 'Aria'}
          </span>
          {isStreaming ? (
            <>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: 'var(--accent)',
                  animation: 'pulse 1.2s ease-in-out infinite',
                }}
              />
              <span>{streamingStatus || '生成中…'}</span>
            </>
          ) : (
            <span className="num">{formatUpdatedRelative(message.created_at)}</span>
          )}
        </div>

        {isUser ? (
          <>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.7,
                color: 'var(--ink)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {message.content}
            </p>
            {meta.revision && (
              <HistoricalTurnRevision
                revision={meta.revision}
                isAssistant={false}
                onSourceOpen={onTurnRevisionSourceOpen}
              />
            )}
            {meta.turn && (
              <HistoricalTurnContract
                turn={meta.turn}
                isUser
                messageContent={message.content}
                messageId={message.id}
                onReuse={onTurnBriefReuse}
              />
            )}
          </>
        ) : (
          <>
            {effectiveTimeline && (
              <ProjectChatActivityTimeline
                timeline={effectiveTimeline}
                isStreaming={isStreaming}
              />
            )}
            {!effectiveTimeline && !isStreaming && meta.progress.length > 0 && (
              <SkillProgressPill steps={meta.progress} />
            )}
            {!isStreaming &&
              meta.artifacts.map((a, i) => (
                <ArtifactCard
                  key={`${a.id ?? a.path}-${i}`}
                  artifact={a}
                  onClick={onArtifactClick}
                />
              ))}
            {message.content && (
              <div
                key="aria-md-body"
                className="md-root"
                style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--ink)' }}
              >
                <MarkdownRenderer content={message.content} />
              </div>
            )}
            {!isStreaming && meta.turn && (
              <HistoricalTurnContract
                turn={meta.turn}
                isUser={false}
                messageContent={message.content}
                messageId={message.id}
                onReuse={onTurnBriefReuse}
              />
            )}
            {!isStreaming && meta.revision && (
              <HistoricalTurnRevision
                revision={meta.revision}
                isAssistant
                onSourceOpen={onTurnRevisionSourceOpen}
              />
            )}
            {!isStreaming && meta.interrupted && meta.rollout && onTurnRecovery && (
              <InterruptedTurnRecovery
                conversationId={message.conversation_id}
                runId={meta.rollout.run_id}
                sourceMessageId={meta.locallyStopped
                  ? undefined
                  : meta.persistedMessageId || message.id}
                onContinue={onTurnRecovery}
              />
            )}
            {!isStreaming && meta.contextReceipt && (
              <PersistentContextReceipt
                receipt={meta.contextReceipt}
                onSkillSelect={onSkillSelect}
              />
            )}
            {!isStreaming && !meta.locallyStopped && (meta.persistedMessageId || message.id) > 0 && (
              <ConversationTraceInspector
                conversationId={message.conversation_id}
                messageId={meta.persistedMessageId || message.id}
              />
            )}
            {!isStreaming && meta.references.length > 0 && <ReferenceChips refs={meta.references} />}
            {!isStreaming && (
              <AriaActionChips
                content={message.content}
                messageId={meta.persistedMessageId || message.id}
                projectId={projectId}
                initialFeedback={meta.feedback}
                persistedActions={!meta.locallyStopped}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function InterruptedTurnRecovery({
  conversationId,
  runId,
  sourceMessageId,
  onContinue,
}: {
  conversationId: number
  runId: string
  sourceMessageId?: number
  onContinue: (preview: TurnRecoveryPreview) => Promise<void>
}) {
  const [preview, setPreview] = useState<TurnRecoveryPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewNotice, setPreviewNotice] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const previewRequestInFlight = useRef(false)
  const confirmationInFlight = useRef(false)

  const loadPreview = async (notice = '') => {
    if (previewRequestInFlight.current) return
    previewRequestInFlight.current = true
    setPreview(null)
    setPreviewError('')
    setPreviewNotice(notice)
    setPreviewLoading(true)
    try {
      const result = await api.get<TurnRecoveryPreview>(
        `/chat/conversations/${conversationId}/recovery-preview`,
        {
          params: {
            run_id: runId,
            ...(sourceMessageId ? { message_id: sourceMessageId } : {}),
          },
        },
      )
      setPreview(result)
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '暂时无法核对中断状态')
    } finally {
      previewRequestInFlight.current = false
      setPreviewLoading(false)
    }
  }

  const continueTurn = async () => {
    if (confirmationInFlight.current || !preview || !preview.can_continue) return
    confirmationInFlight.current = true
    setBusy(true)
    try {
      await onContinue(preview)
    } catch (error) {
      if (getHttpStatus(error) === 409) {
        confirmationInFlight.current = false
        setBusy(false)
        await loadPreview('状态已变化，请重新核对')
        return
      }
    } finally {
      confirmationInFlight.current = false
      setBusy(false)
    }
  }
  return (
    <div
      aria-label="中断轮次恢复"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 9,
        padding: '8px 10px',
        color: 'var(--ink-soft)',
        background: 'color-mix(in oklch, var(--warn) 10%, var(--bg-tint))',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)',
        fontSize: 11,
      }}
    >
      <span style={{ color: 'var(--warn)', fontWeight: 600 }}>本轮未完成</span>
      {previewNotice && (
        <span style={{ flexBasis: '100%', color: 'var(--warn)', fontWeight: 600 }}>
          {previewNotice}
        </span>
      )}
      {previewLoading ? (
        <span>正在读取已保存检查点并核对可验证范围…</span>
      ) : previewError ? (
        <>
          <span style={{ color: 'var(--bad)' }}>{previewError}</span>
          <button
            type="button"
            onClick={() => { void loadPreview() }}
            style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 11 }}
          >
            重新核对
          </button>
        </>
      ) : preview ? (
        <>
          <RecoveryPreviewDetails preview={preview} />
          {preview.can_continue && (
            <button
              type="button"
              aria-label={recoveryActionLabel(preview)}
              onClick={() => { void continueTurn() }}
              disabled={busy}
              style={{
                marginLeft: 'auto',
                padding: '4px 9px',
                color: 'var(--bg-elev)',
                background: 'var(--accent)',
                borderRadius: 'var(--r-sm)',
                fontSize: 11,
                opacity: busy ? 0.65 : 1,
              }}
            >
              {busy ? '正在准备新轮次…' : recoveryActionLabel(preview)}
            </button>
          )}
          {!preview.can_continue && (
            <span style={{ flexBasis: '100%', color: 'var(--bad)' }}>
              当前预览不允许继续，请保留本轮并重新核对项目状态。
            </span>
          )}
        </>
      ) : (
        <>
          <span>先读取恢复预览，核对已完成影响、待处理影响和项目状态；此操作不会创建新轮次。</span>
          <button
            type="button"
            aria-label="核对恢复状态"
            onClick={() => { void loadPreview() }}
            style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 11 }}
          >
            核对恢复状态
          </button>
        </>
      )}
    </div>
  )
}

function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const response = (error as { response?: unknown }).response
  if (!response || typeof response !== 'object') return null
  const status = (response as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function isTurnRecoveryPreviewV2(preview: TurnRecoveryPreview): preview is TurnRecoveryPreviewV2 {
  return preview.schema_version === 2
}

function recoveryActionLabel(preview: TurnRecoveryPreview): '核对并继续' | '重新规划' {
  return isTurnRecoveryPreviewV2(preview) && preview.strategy === 'replan_from_checkpoint'
    ? '重新规划'
    : '核对并继续'
}

const RECOVERY_WARNING_LABELS: Record<string, string> = {
  preserve_completed_steps: '保留已完成步骤',
  inspect_before_side_effects: '执行前核对既有副作用',
  no_unsafe_tool_replay: '禁止直接重放历史工具',
  world_state_changed: '项目状态已经变化',
  project_world_state_changed: '项目状态已经变化',
  completed_effects_present: '存在已完成副作用',
  pending_effects_present: '仍有待处理副作用',
  verify_effect_ledger_before_write: '写入前核对副作用账本',
  manual_review_required: '需要人工核对',
  legacy_recovery_unverified: '旧版恢复信息无法验证副作用',
}

const RECOVERY_DUPLICATE_POLICY_LABELS: Record<string, string> = {
  verified_persisted_artifact_only: '仅保留可验证的已持久化结果',
  block_completed_effects: '跳过已完成动作',
  retry_read_only: '仅重试只读步骤',
  manual_review_required: '人工核对后处理',
}

function recoveryDuplicatePolicyLabel(policy: string): string {
  return RECOVERY_DUPLICATE_POLICY_LABELS[policy] || '保守核对'
}

function RecoveryWarnings({ warningCodes }: { warningCodes: string[] }) {
  if (warningCodes.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flexBasis: '100%' }}>
      {warningCodes.map((code) => (
        <span
          key={code}
          title={code}
          style={{
            padding: '2px 5px',
            color: 'var(--warn)',
            background: 'color-mix(in oklch, var(--warn) 8%, transparent)',
            borderRadius: 'var(--r-sm)',
            fontSize: 10,
          }}
        >
          {RECOVERY_WARNING_LABELS[code] || '需核对恢复状态'}
        </span>
      ))}
    </div>
  )
}

function RecoveryPreviewDetails({ preview }: { preview: TurnRecoveryPreview }) {
  if (!isTurnRecoveryPreviewV2(preview)) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, flex: '1 1 420px' }}>
        <span style={{ flexBasis: '100%' }}>
          旧版恢复记录无法验证已发生的副作用；新轮次必须先核对当前状态，不会直接重放历史动作。
        </span>
        <span>历史已完成工具调用 · {preview.completed_tool_call_count}</span>
        <span>· 副作用状态 · {preview.side_effects_possible ? '可能存在' : '无法确认'}</span>
        <RecoveryWarnings warningCodes={preview.warning_codes} />
      </div>
    )
  }

  const strategyCopy = preview.strategy === 'replan_from_checkpoint'
    ? '将按当前状态重新规划，不直接重放历史动作。'
    : preview.strategy === 'retry_read_step'
      ? '仅按恢复契约处理可重试的只读步骤。'
      : '需要人工核对后再决定下一步，不会自动重放历史动作。'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, flex: '1 1 420px' }}>
      <span style={{ flexBasis: '100%' }}>{strategyCopy}</span>
      <span>已完成副作用 · {preview.completed_effect_count}</span>
      <span>· 待处理副作用 · {preview.pending_effect_count}</span>
      <span>· 项目状态 · {preview.world_state_change.changed ? '已变化' : '未检测到变化'}</span>
      <span style={{ flexBasis: '100%' }}>
        重复动作策略 · {recoveryDuplicatePolicyLabel(preview.duplicate_policy)}
      </span>
      <RecoveryWarnings warningCodes={preview.warning_codes} />
    </div>
  )
}

function HistoricalTurnContract({
  turn,
  isUser,
  messageContent,
  messageId,
  onReuse,
}: {
  turn: ParsedProjectTurnMetadata
  isUser: boolean
  messageContent: string
  messageId: number
  onReuse?: (payload: ProjectTurnReusePayload) => void
}) {
  const constraints = turn.draft.constraintsText.split('\n').filter(Boolean)
  const modeLabel = {
    answer_only: '直接回答',
    plan_only: '只做规划',
    execute_now: '立即执行',
    plan_then_execute: '规划后执行',
  }[turn.mode || '']
  const summary = isUser
    ? `本轮 Brief${constraints.length > 0 ? ` · ${constraints.length} 项约束` : ''}`
    : `本轮执行契约${modeLabel ? ` · ${modeLabel}` : ''}${turn.writeAllowed === true ? ' · 可写入' : turn.writeAllowed === false ? ' · 只读' : ''}`
  return (
    <details
      aria-label={isUser ? '历史本轮 Brief' : '历史本轮执行契约'}
      style={{
        marginTop: 8,
        maxWidth: 720,
        padding: '5px 8px',
        color: 'var(--ink-mute)',
        background: 'var(--bg-tint)',
        border: '1px solid var(--line-soft)',
        borderRadius: 'var(--r-sm)',
        fontSize: 11,
      }}
    >
      <summary style={{ cursor: 'pointer', userSelect: 'none', color: 'var(--ink-soft)' }}>
        {summary}
      </summary>
      <div style={{ marginTop: 6, lineHeight: 1.55 }}>
        <div>
          <span style={{ color: 'var(--ink-faint)' }}>目标 · </span>
          {turn.draft.goal || '使用消息正文作为本轮目标'}
        </div>
        {constraints.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
            {constraints.map((constraint) => (
              <span
                key={constraint}
                style={{ padding: '2px 6px', color: 'var(--accent-ink)', background: 'var(--accent-bg)', borderRadius: 'var(--r-sm)' }}
              >
                {constraint}
              </span>
            ))}
          </div>
        )}
        {onReuse && (
          <button
            type="button"
            aria-label={isUser ? '复用此历史 Brief' : '基于此执行契约修订并重试'}
            onClick={() => onReuse({
              content: isUser ? messageContent : turn.draft.goal,
              draft: turn.draft,
              mentionContext: turn.mentionContext,
              skillId: turn.skillId,
              sourceMessageId: messageId,
              sourceRole: isUser ? 'user' : 'assistant',
              sourceFingerprint: projectTurnFingerprint({
                content: messageContent,
                draft: turn.draft,
                sourceRole: isUser ? 'user' : 'assistant',
                skillId: turn.skillId,
                mentionContext: turn.mentionContext,
              }),
            })}
            style={{
              marginTop: 7,
              padding: '3px 8px',
              color: 'var(--accent)',
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              fontSize: 10.5,
            }}
          >
            {isUser ? '复用到输入框' : '修订并重试'}
          </button>
        )}
      </div>
    </details>
  )
}

function HistoricalTurnRevision({
  revision,
  isAssistant,
  onSourceOpen,
}: {
  revision: ParsedProjectTurnRevision
  isAssistant: boolean
  onSourceOpen?: (sourceMessageId: number, sourceFingerprint: string) => void
}) {
  return (
    <div
      aria-label={isAssistant ? '本轮修订效果归因' : '历史契约修订轨迹'}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 5,
        marginTop: 7,
        maxWidth: 720,
        padding: '5px 8px',
        color: 'var(--ink-mute)',
        background: 'color-mix(in oklch, var(--accent-bg) 50%, var(--bg-tint))',
        border: '1px solid var(--line-soft)',
        borderRadius: 'var(--r-sm)',
        fontSize: 10.5,
      }}
    >
      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
        {isAssistant ? '回应修订' : '修订轨迹'}
      </span>
      <span>
        {revision.changedFields.length > 0
          ? `已调整 ${revision.changedFields.map((field) => PROJECT_TURN_REVISION_FIELD_LABELS[field]).join(' / ')}`
          : '按原契约重试'}
      </span>
      {onSourceOpen && (
        <button
          type="button"
          aria-label="定位修订来源消息"
          onClick={() => onSourceOpen(revision.sourceMessageId, revision.sourceFingerprint)}
          style={{ color: 'var(--accent)', fontSize: 10.5 }}
        >
          查看来源
        </button>
      )}
    </div>
  )
}

function PersistentContextReceipt({
  receipt,
  onSkillSelect,
}: {
  receipt: ContextReceiptEvent
  onSkillSelect?: (skillId: number, name: string) => void
}) {
  const memoryLabel = {
    not_applicable: '不依赖单项目记忆',
    missing: '项目记忆缺失，使用当前项目原始信息',
    stale: `项目记忆 v${receipt.memory.version} 待刷新`,
    ready: `项目记忆 v${receipt.memory.version} 已同步`,
  }[receipt.memory.status]
  const skillLabel = receipt.skill.status === 'applied' && receipt.skill.name
    ? `${receipt.skill.usage_mode === 'advisory' ? '专业问答' : '工作流'}：${receipt.skill.name}`
    : receipt.skill.status === 'ambiguous'
      ? `Skill 待选择：${(receipt.skill.candidates || []).map((item) => item.name).join(' / ')}`
      : '未额外启用 Skill'
  const evidenceCount = receipt.evidence.knowledge_reference_count
    + receipt.evidence.attached_file_count
  const historyLabel = contextHistoryEvidenceLabel(receipt.evidence)
  const retrievalLabel = receipt.memory.selected_item_count > 0
    ? ` · ${receipt.memory.retrieval_mode === 'full' ? '全量' : '按问题'}召回 ${receipt.memory.selected_item_count} 条记忆`
    : ''
  const memoryLayerLabels = (receipt.memory.layers || []).map(contextMemoryLayerLabel)
  const skillRuntime = receipt.skill.runtime
  const worldStateLabel = receipt.world_state
    ? ` · 项目状态 ${receipt.world_state.current_version}${receipt.world_state.changed ? ' 有变化' : ''}`
    : ''
  return (
    <details style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-mute)' }}>
      <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
        本轮依据 · {memoryLabel}{retrievalLabel}{worldStateLabel} · {skillLabel}
      </summary>
      <div style={{ marginTop: 4, paddingLeft: 14 }}>
        {evidenceCount > 0 ? `${evidenceCount} 项文件/知识证据` : '未附加文件或知识证据'}
        {historyLabel ? ` · ${historyLabel}` : ''}
      </div>
      {memoryLayerLabels.length > 0 && (
        <div style={{ marginTop: 4, paddingLeft: 14 }}>
          {memoryLayerLabels.map((label) => <div key={label}>{label}</div>)}
        </div>
      )}
      {skillRuntime && (
        <div
          aria-label="Skill 本轮加载回执"
          style={{ marginTop: 4, paddingLeft: 14 }}
        >
          <div style={{ color: skillRuntime.load_status === 'loaded' ? 'var(--ink-mute)' : 'var(--warn)' }}>
            Skill 发布 v{skillRuntime.version || '未记录'}
            {skillRuntime.release_status ? ` · ${SKILL_RELEASE_STATUS_LABELS[skillRuntime.release_status] || skillRuntime.release_status}` : ''}
            {skillRuntime.release_sha256 ? ` · ${skillRuntime.release_sha256.slice(0, 8)}` : ''}
            {skillRuntime.load_status === 'compacted' ? ' · Skill 上下文未完整保留' : ''}
            {skillRuntime.load_status === 'degraded' ? ' · Skill 加载降级' : ''}
          </div>
          <div>
            本轮按需加载 {skillRuntime.instruction_loaded ? '1 份指令' : '0 份指令'}
            {` + ${skillRuntime.resource_count} 项资源`}
            {skillRuntime.declared_tool_count > 0
              ? ` · Skill 工具 ${skillRuntime.granted_tool_count}/${skillRuntime.declared_tool_count} 可用`
              : ' · 未声明 Skill 专属工具'}
          </div>
          <div style={{ color: skillRuntime.verification_context_complete ? 'var(--good)' : 'var(--warn)' }}>
            {skillRuntime.verification_status === 'available' && skillRuntime.verification_context_complete
              ? `完成校验已声明${skillRuntime.verification_step_count > 0 ? ` · ${skillRuntime.verification_step_count} 项检查` : ''}`
              : skillRuntime.verification_status === 'available'
                ? '已声明完成校验，但 Skill 上下文未完整保留，不能宣称已经通过验证'
                : '未声明包级完成校验，系统不会宣称已经通过 Skill 验证'}
            {' · 包内脚本不会自动执行'}
          </div>
          {skillRuntime.deliverable && (
            <div style={{ color: 'var(--accent-ink)' }}>
              本轮交付物 · {skillRuntime.deliverable.name}
              {skillRuntime.deliverable.default_format
                ? ` · ${skillRuntime.deliverable.default_format.toUpperCase()}`
                : ''}
              {skillRuntime.deliverable.contract_sha256
                ? ` · 合同 ${skillRuntime.deliverable.contract_sha256.slice(0, 8)}`
                : ''}
            </div>
          )}
          {skillRuntime.resource_names.length > 0 && (
            <div title={skillRuntime.resource_names.join(' · ')}>
              已加载资源 · {skillRuntime.resource_names.join(' · ')}
            </div>
          )}
        </div>
      )}
      {receipt.world_state?.changed && (
        <div style={{ marginTop: 4, paddingLeft: 14, color: 'var(--warn)' }}>
          项目状态变更 · {receipt.world_state.changed_categories.map((category) => {
            const counts = receipt.world_state?.categories[category]
            return `${PROJECT_WORLD_STATE_LABELS[category] || category} +${counts?.added || 0} / -${counts?.removed || 0} / 更新 ${counts?.updated || 0}`
          }).join(' · ')}
        </div>
      )}
      {receipt.skill.status === 'ambiguous' && onSkillSelect && (
        <SkillCandidateButtons
          candidates={receipt.skill.candidates || []}
          onSelect={onSkillSelect}
        />
      )}
    </details>
  )
}

const PROJECT_WORLD_STATE_LABELS: Record<string, string> = {
  project: '项目',
  milestones: '里程碑',
  todos: '待办',
  files: '文件',
  progress: '进展',
  financials: '财务',
  stakeholders: '干系人',
  deliverables: '交付物',
}

const SKILL_RELEASE_STATUS_LABELS: Record<string, string> = {
  stable: '稳定版',
  preview: '预览版',
  deprecated: '已弃用',
}

/* ────────────────────────────────────────────────────────────────
 * Skill progress pill — compact "Aria 执行清单 · N/M 已完成" with
 * an expandable detail list. Collapsed by default since most users
 * don't need to read internal step-by-step status line by line.
 * ──────────────────────────────────────────────────────────────── */
function SkillProgressPill({ steps }: { steps: ProgressStep[] }) {
  const [expanded, setExpanded] = useState(false)
  const total = steps.length
  const done = steps.filter((s) => s.status === 'done').length
  const active = steps.find((s) => s.status === 'active')
  const failed = steps.find((s) => s.status === 'error')
  const isRunning = !!active
  const headlineLabel = isRunning
    ? active?.label || 'Aria 执行中'
    : failed
      ? failed.label || '执行失败'
      : 'Aria 执行清单'
  const headlineTone = failed ? 'var(--bad)' : isRunning ? 'var(--accent)' : 'var(--good)'

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'inline-flex',
          width: '100%',
          alignItems: 'center',
          gap: 10,
          padding: '7px 12px',
          fontSize: 12,
          color: 'var(--ink-soft)',
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 99,
            background: headlineTone,
            flexShrink: 0,
          }}
        />
        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{headlineLabel}</span>
        <span className="num" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
          {done}/{total} 已完成
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>
          {expanded ? '收起 ▴' : '展开 ▾'}
        </span>
      </button>
      {expanded && (
        <ul
          style={{
            margin: '8px 0 0',
            padding: '8px 14px',
            background: 'var(--bg-tint)',
            border: '1px solid var(--line-soft)',
            borderRadius: 'var(--r-sm)',
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 12.5,
            color: 'var(--ink)',
            lineHeight: 1.55,
          }}
        >
          {steps.map((s, i) => {
            const tone =
              s.status === 'done'
                ? 'var(--good)'
                : s.status === 'active'
                  ? 'var(--accent)'
                  : s.status === 'error'
                    ? 'var(--bad)'
                    : 'var(--ink-faint)'
            return (
              <li
                key={s.key ?? `s-${i}`}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    marginTop: 6,
                    borderRadius: 99,
                    background: tone,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{ color: s.status === 'done' ? 'var(--ink-mute)' : 'var(--ink)' }}
                >
                  {s.label}
                  {s.description && (
                    <span style={{ color: 'var(--ink-mute)', marginLeft: 6 }}>
                      · {s.description}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
 * Artifact card — generated file row. Matches the design's "MD ·
 * 战略框架草稿.md · 已生成" pattern. We only show metadata; saving /
 * previewing requires the live conversation context that lives on
 * /chat, so the row deep-links there.
 * ──────────────────────────────────────────────────────────────── */
function ArtifactCard({
  artifact,
  onClick,
}: {
  artifact: GeneratedArtifact
  onClick?: (a: GeneratedArtifact) => void
}) {
  const ext = (artifact.file_type || artifact.name.split('.').pop() || '')
    .replace('.', '')
    .toUpperCase()
    .slice(0, 4)
  const isMd = ext === 'MD'
  const sizeKb = artifact.size_bytes ? Math.round(artifact.size_bytes / 1024) : null
  const hasGeneratedDownload = (
    (Number.isInteger(artifact.id) && Number(artifact.id) > 0)
    || (typeof artifact.path === 'string' && artifact.path.trim() !== '')
  )
  // Project files open their normal preview. A persisted GeneratedFile
  // without project_file_id opens the same panel with a secure download
  // fallback instead of becoming an inert card.
  const actionable = !!onClick && (artifact.project_file_id != null || hasGeneratedDownload)
  const actionLabel = artifact.project_file_id != null ? '预览 →' : '下载 →'
  const verificationLabel = artifactVerificationLabel(artifact.verification)

  const body = (
    <>
      <span
        style={{
          width: 36,
          height: 44,
          borderRadius: 'var(--r-sm)',
          background: isMd ? 'var(--accent-bg)' : 'var(--bg-tint)',
          color: isMd ? 'var(--accent)' : 'var(--ink-mute)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 9.5,
          fontWeight: 500,
          letterSpacing: '0.04em',
        }}
      >
        {ext || 'FILE'}
      </span>
      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <div
          className="ui"
          style={{
            fontSize: 13,
            color: 'var(--ink)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {artifact.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
          {sizeKb != null && <span className="num">{sizeKb} KB · </span>}
          {artifact.description || 'Aria 生成的产出'}
        </div>
        {verificationLabel && (
          <div
            style={{
              fontSize: 10.5,
              marginTop: 3,
              color: artifact.verification?.status === 'failed'
                ? 'var(--bad)'
                : artifact.verification?.status === 'passed'
                  ? 'var(--good)'
                  : 'var(--warn)',
            }}
          >
            {verificationLabel}
          </div>
        )}
      </div>
      {actionable && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--accent)',
            padding: '2px 8px',
            background: 'var(--accent-bg)',
            borderRadius: 'var(--r-sm)',
            flexShrink: 0,
          }}
        >
          {actionLabel}
        </span>
      )}
    </>
  )

  const sharedStyle = {
    background: 'var(--bg-elev)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--r-sm)',
    padding: '10px 12px',
    marginBottom: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  } as const

  if (actionable) {
    return (
      <button
        type="button"
        className="row-hov"
        onClick={() => onClick?.(artifact)}
        style={{ ...sharedStyle, cursor: 'pointer' }}
      >
        {body}
      </button>
    )
  }
  return <div style={sharedStyle}>{body}</div>
}

/* ────────────────────────────────────────────────────────────────
 * Reference chips — canonical evidence citations. Matches /chat's R19 chip
 * style (mono [K*] / legacy [N] + lucide icon + title).
 * ──────────────────────────────────────────────────────────────── */
function ReferenceChips({ refs }: { refs: Reference[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 10,
      }}
    >
      {refs.map((r, i) => (
        <span
          key={`${r.type}-${r.id}-${i}`}
          title={r.chunk_index != null ? `${r.title} · 片段 ${r.chunk_index + 1}` : r.title}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 8px',
            fontSize: 11.5,
            background: 'var(--bg-elev)',
            color: 'var(--ink-soft)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
          }}
        >
          <span
            className="num"
            style={{
              fontSize: 10,
              color: 'var(--accent)',
              fontWeight: 500,
            }}
          >
            {knowledgeReferenceLabel(r, i)}
          </span>
          <CxIcon
            name={
              r.type === 'skill'
                ? 'wrench'
                : r.type === 'doc' || r.type === 'file'
                  ? 'file'
                  : 'tag'
            }
            size={11}
            style={{ color: 'var(--ink-mute)' }}
          />
          <span
            style={{
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.title}
          </span>
        </span>
      ))}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
 * Aria action chips — hover-revealed pill row. Two actions:
 *   - 复制       → copy message content to clipboard
 *   - 沉淀到记忆 → create a source-linked candidate for human review
 * ──────────────────────────────────────────────────────────────── */
function AriaActionChips({
  content,
  messageId,
  projectId,
  initialFeedback,
  persistedActions,
}: {
  content: string
  messageId: number
  projectId: number
  initialFeedback: MessageFeedback | null
  persistedActions: boolean
}) {
  const toast = useToast()
  const [copying, setCopying] = useState(false)
  const [memBusy, setMemBusy] = useState(false)
  const [feedback, setFeedback] = useState<MessageFeedback | null>(initialFeedback)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [showReasons, setShowReasons] = useState(
    initialFeedback?.rating === 'unhelpful' && initialFeedback.reasons.length === 0,
  )

  const saveFeedback = async (
    rating: MessageFeedbackRating,
    reasons: MessageFeedbackReason[] = [],
  ) => {
    if (feedbackBusy) return
    setFeedbackBusy(true)
    try {
      const response = await api.post<{ feedback: MessageFeedback }>(
        `/chat/messages/${messageId}/feedback`,
        { rating, reasons },
      )
      setFeedback(response.feedback)
      setShowReasons(response.feedback.rating === 'unhelpful')
    } catch (err) {
      toast.error({
        title: '反馈未保存',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setFeedbackBusy(false)
    }
  }

  const toggleFeedbackReason = (reason: MessageFeedbackReason) => {
    const current = feedback?.rating === 'unhelpful' ? feedback.reasons : []
    const reasons = current.includes(reason)
      ? current.filter((item) => item !== reason)
      : [...current, reason].slice(0, 3)
    void saveFeedback('unhelpful', reasons)
  }

  const copy = async () => {
    if (copying) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(content)
      toast.success({ title: '已复制' })
    } catch {
      toast.error({ title: '复制失败', description: '浏览器拒绝了剪贴板写入' })
    } finally {
      setCopying(false)
    }
  }

  const sinkToMemory = async () => {
    if (memBusy) return
    setMemBusy(true)
    try {
      const response = await api.post<MemoryCandidateCreateResponse>('/memory-candidates', {
        scope: 'project',
        candidate_type: 'project_fact',
        content: content.trim().slice(0, 4000),
        source_type: 'chat_message',
        source_id: String(messageId),
        project_id: projectId,
        confidence: 1,
      })
      toast.success({
        title: response.created
          ? '已加入记忆候选'
          : response.candidate.status === 'accepted'
            ? '这条内容已在正式记忆中'
            : '候选已经存在',
        description:
          response.candidate.status === 'pending'
            ? '到「项目记忆」确认后才会写入正式记忆'
            : '无需重复提交',
      })
    } catch (err) {
      toast.error({
        title: '沉淀失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setMemBusy(false)
    }
  }

  return (
    <div
      className={feedback || showReasons ? '' : 'opacity-0 group-hover:opacity-100'}
      style={{
        display: 'flex',
        gap: 6,
        marginTop: 12,
        flexWrap: 'wrap',
        transition: 'opacity 120ms',
      }}
    >
      <Chip onClick={copy} disabled={copying}>
        {copying ? '复制中…' : '复制'}
      </Chip>
      {persistedActions && (
        <Chip onClick={sinkToMemory} disabled={memBusy} tone="accent">
          <CxIcon name="sparkle" size={11} stroke={1.6} />
          {memBusy ? '提交中…' : '提交记忆候选'}
        </Chip>
      )}
      {persistedActions && (
        <Chip
          onClick={() => { void saveFeedback('helpful') }}
          disabled={feedbackBusy}
          active={feedback?.rating === 'helpful'}
        >
          有帮助
        </Chip>
      )}
      {persistedActions && (
        <Chip
          onClick={() => {
            setShowReasons(true)
            void saveFeedback('unhelpful', feedback?.rating === 'unhelpful' ? feedback.reasons : [])
          }}
          disabled={feedbackBusy}
          active={feedback?.rating === 'unhelpful'}
        >
          没帮助
        </Chip>
      )}
      {persistedActions && showReasons && feedback?.rating === 'unhelpful' && (
        <div
          aria-label="没帮助的原因"
          style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flexBasis: '100%' }}
        >
          {(Object.entries(FEEDBACK_REASON_LABELS) as Array<[MessageFeedbackReason, string]>).map(
            ([reason, label]) => (
              <Chip
                key={reason}
                onClick={() => toggleFeedbackReason(reason)}
                disabled={feedbackBusy}
                active={feedback.reasons.includes(reason)}
              >
                {label}
              </Chip>
            ),
          )}
          <span style={{ alignSelf: 'center', fontSize: 10.5, color: 'var(--ink-faint)' }}>
            仅保存标签，不保存反馈文字
          </span>
        </div>
      )}
    </div>
  )
}

const FEEDBACK_REASON_LABELS: Record<MessageFeedbackReason, string> = {
  inaccurate: '事实不准',
  missing_context: '缺少上下文',
  wrong_skill: 'Skill 不合适',
  wrong_action: '行动不对',
  unclear: '表达不清',
  incomplete: '结果不完整',
}

function Chip({
  children,
  onClick,
  disabled,
  tone,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'accent'
  active?: boolean
}) {
  const accent = tone === 'accent' || active
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        fontSize: 11.5,
        color: accent ? 'var(--accent)' : 'var(--ink-soft)',
        background: accent ? 'var(--accent-bg)' : 'transparent',
        border: `1px solid ${accent ? 'var(--accent-bg)' : 'var(--line)'}`,
        borderRadius: 'var(--r-pill)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}
