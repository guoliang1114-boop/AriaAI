import { useMemo, useState } from 'react'
import { api } from '../../../api/client'
import { MarkdownRenderer } from '../../../components/MarkdownRenderer'
import { useToast } from '../../../contexts/ToastContext'
import type {
  GeneratedArtifact,
  MemoryCandidateCreateResponse,
  Message,
  Reference,
} from '../../../types/api'
import type { ContextReceiptEvent } from '../../../types/productRunEvent'
import { knowledgeReferenceLabel, normalizeKnowledgeReferences } from '../../../utils/knowledgeEvidence'
import { CxIcon } from './CxIcons'
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
}

function parseMeta(raw: string | undefined): ParsedMeta {
  const empty: ParsedMeta = {
    references: [], artifacts: [], progress: [], contextReceipt: null, turn: undefined, revision: undefined,
  }
  if (!raw) return empty
  try {
    const meta = JSON.parse(raw) as Record<string, unknown>
    const refs = normalizeKnowledgeReferences(meta.references)
    const arts = Array.isArray(meta.artifacts) ? (meta.artifacts as GeneratedArtifact[]) : []
    const prog = Array.isArray(meta.skill_progress) ? (meta.skill_progress as ProgressStep[]) : []
    const receipt = meta.context_receipt && typeof meta.context_receipt === 'object'
      ? (meta.context_receipt as ContextReceiptEvent)
      : null
    return {
      references: refs,
      artifacts: arts,
      progress: prog,
      contextReceipt: receipt,
      turn: parseProjectTurnMetadata(meta),
      revision: parseProjectTurnRevision(meta),
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
  onSkillSelect?: (skillId: number, name: string) => void
  onTurnBriefReuse?: (payload: ProjectTurnReusePayload) => void
  onTurnRevisionSourceOpen?: (sourceMessageId: number, sourceFingerprint: string) => void
}

export function ProjectChatMessage({
  message,
  projectId,
  onArtifactClick,
  isStreaming = false,
  streamingStatus = null,
  onSkillSelect,
  onTurnBriefReuse,
  onTurnRevisionSourceOpen,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const meta = useMemo(() => parseMeta(message.metadata_json), [message.metadata_json])

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
            {!isStreaming && meta.progress.length > 0 && <SkillProgressPill steps={meta.progress} />}
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
            {!isStreaming && meta.contextReceipt && (
              <PersistentContextReceipt
                receipt={meta.contextReceipt}
                onSkillSelect={onSkillSelect}
              />
            )}
            {!isStreaming && meta.references.length > 0 && <ReferenceChips refs={meta.references} />}
            {!isStreaming && (
              <AriaActionChips
                content={message.content}
                messageId={message.id}
                projectId={projectId}
              />
            )}
          </>
        )}
      </div>
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
  const retrievalLabel = receipt.memory.selected_item_count > 0
    ? ` · ${receipt.memory.retrieval_mode === 'full' ? '全量' : '按问题'}召回 ${receipt.memory.selected_item_count} 条记忆`
    : ''
  return (
    <details style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-mute)' }}>
      <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
        本轮依据 · {memoryLabel}{retrievalLabel} · {skillLabel}
      </summary>
      <div style={{ marginTop: 4, paddingLeft: 14 }}>
        {evidenceCount > 0 ? `${evidenceCount} 项文件/知识证据` : '未附加文件或知识证据'}
        {receipt.evidence.history_message_count > 0
          ? ` · ${receipt.evidence.history_message_count} 条近期对话`
          : ''}
      </div>
      {receipt.skill.status === 'ambiguous' && onSkillSelect && (
        <SkillCandidateButtons
          candidates={receipt.skill.candidates || []}
          onSelect={onSkillSelect}
        />
      )}
    </details>
  )
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
  // Only previewable when the backend has actually saved a file row
  // for this artifact — without project_file_id we have nothing to
  // fetch.
  const previewable = !!onClick && artifact.project_file_id != null

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
      </div>
      {previewable && (
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
          预览 →
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

  if (previewable) {
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
}: {
  content: string
  messageId: number
  projectId: number
}) {
  const toast = useToast()
  const [copying, setCopying] = useState(false)
  const [memBusy, setMemBusy] = useState(false)

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
      className="opacity-0 group-hover:opacity-100"
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
      <Chip onClick={sinkToMemory} disabled={memBusy} tone="accent">
        <CxIcon name="sparkle" size={11} stroke={1.6} />
        {memBusy ? '提交中…' : '提交记忆候选'}
      </Chip>
    </div>
  )
}

function Chip({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'accent'
}) {
  const accent = tone === 'accent'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
