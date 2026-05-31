import { useMemo, useState } from 'react'
import { api } from '../../../api/client'
import { MarkdownRenderer } from '../../../components/MarkdownRenderer'
import { useToast } from '../../../contexts/ToastContext'
import type { GeneratedArtifact, Message } from '../../../types/api'
import { CxIcon } from './CxIcons'
import { formatUpdatedRelative } from './useProjectsApi'

/** Project-chat-tab message bubble.
 *
 * We deliberately keep this isolated from the global `/chat` page's
 * `MessageBubble` (which is ~150 LOC entangled with live-streaming
 * state) and instead reimplement a leaner, read-only version here.
 * Three structured pieces parsed out of `metadata_json` get rendered
 * around the markdown body:
 *
 *   - skill_progress[]   → compact "执行清单" pill (collapsed by default)
 *   - artifacts[]        → file-style cards with size / type badge
 *   - references[]       → numbered [N] citation chips
 *
 * Bottom of each Aria message: hover-only action chips. Per scope
 * decision we only ship the two that have real backend support today
 * (复制 + 沉淀到项目记忆). 重新生成 / 加到笔记 / 固定为锚点 will
 * land in a follow-up when their backends exist.
 */

interface ReferenceRef {
  type: string
  id: number
  title: string
}

interface ProgressStep {
  key?: string
  label: string
  description?: string
  status?: 'pending' | 'active' | 'done' | 'error' | string
  logs?: string[]
}

interface ParsedMeta {
  references: ReferenceRef[]
  artifacts: GeneratedArtifact[]
  progress: ProgressStep[]
}

function parseMeta(raw: string | undefined): ParsedMeta {
  if (!raw) return { references: [], artifacts: [], progress: [] }
  try {
    const meta = JSON.parse(raw) as Record<string, unknown>
    const refs = Array.isArray(meta.references) ? (meta.references as ReferenceRef[]) : []
    const arts = Array.isArray(meta.artifacts) ? (meta.artifacts as GeneratedArtifact[]) : []
    const prog = Array.isArray(meta.skill_progress) ? (meta.skill_progress as ProgressStep[]) : []
    return { references: refs, artifacts: arts, progress: prog }
  } catch {
    return { references: [], artifacts: [], progress: [] }
  }
}

interface MessageBubbleProps {
  message: Message
  projectId: number
}

export function ProjectChatMessage({ message, projectId }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const meta = useMemo(() => parseMeta(message.metadata_json), [message.metadata_json])

  return (
    <div
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
          <span className="num">{formatUpdatedRelative(message.created_at)}</span>
        </div>

        {isUser ? (
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
        ) : (
          <>
            {meta.progress.length > 0 && <SkillProgressPill steps={meta.progress} />}
            {meta.artifacts.map((a, i) => (
              <ArtifactCard key={`${a.id ?? a.path}-${i}`} artifact={a} />
            ))}
            <div
              className="md-root"
              style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--ink)' }}
            >
              <MarkdownRenderer content={message.content} />
            </div>
            {meta.references.length > 0 && <ReferenceChips refs={meta.references} />}
            <AriaActionChips content={message.content} projectId={projectId} />
          </>
        )}
      </div>
    </div>
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
function ArtifactCard({ artifact }: { artifact: GeneratedArtifact }) {
  const ext = (artifact.file_type || artifact.name.split('.').pop() || '')
    .replace('.', '')
    .toUpperCase()
    .slice(0, 4)
  const isMd = ext === 'MD'
  const sizeKb = artifact.size_bytes ? Math.round(artifact.size_bytes / 1024) : null

  return (
    <div
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)',
        padding: '10px 12px',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
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
      <div style={{ flex: 1, minWidth: 0 }}>
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
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
 * Reference chips — numbered citations. Matches /chat's R19 chip
 * style (mono [N] + lucide icon + title).
 * ──────────────────────────────────────────────────────────────── */
function ReferenceChips({ refs }: { refs: ReferenceRef[] }) {
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
            [{i + 1}]
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
 * Aria action chips — hover-revealed pill row. Two wired actions:
 *   - 复制      → copy message content to clipboard
 *   - 沉淀到记忆 → POST /projects/:id/memory/rebuild (debounced)
 * Other chips in the design (重新生成 / 加到笔记 / 固定为锚点) need
 * backend endpoints that don't exist yet; we leave them out rather
 * than ship dead buttons.
 * ──────────────────────────────────────────────────────────────── */
function AriaActionChips({
  content,
  projectId,
}: {
  content: string
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
      await api.post(`/projects/${projectId}/memory/rebuild`, {}, { timeout: 180000 })
      toast.success({
        title: '已沉淀到项目记忆',
        description: '稍后到「项目记忆」查看更新',
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
        {memBusy ? '沉淀中…' : '沉淀到项目记忆'}
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
