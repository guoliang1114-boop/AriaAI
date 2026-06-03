import { useMemo } from 'react'
import type { Project, ProjectDetail } from '../../../types/api'
import { CxIcon } from './CxIcons'
import { synthesizeActivityFeed, feedToneColor, formatFeedTime } from './activityFeed'

/** New-conversation orientation canvas.
 *
 * Replaces the prior "这段对话还没有消息" empty state with a richer
 * snapshot of the project. Four sections, all built from data
 * already available in the project detail payload (no extra
 * fetches):
 *
 *   1. Greeting — project-aware welcome
 *   2. Pulse card — phase stepper + 4-fact grid + attention banner
 *      that highlights blockers
 *   3. 最近动态 — top 3 events from the activity-feed synthesizer
 *   4. 从这里开始 — four prompt cards that seed the composer rather
 *      than auto-send, so the user can edit before firing
 *
 * Shown only when `messages.length === 0 && !busy` — once any
 * message exists or a stream is in flight, the normal thread view
 * takes over.
 */

interface EmptyStateProps {
  projectId: number
  detail: ProjectDetail
  onSelectPrompt: (text: string) => void
}

const PHASE_DEFS = [
  { key: 'init', name: '立项' },
  { key: 'lead', name: '线索期' },
  { key: 'opportunity', name: '商机期' },
  { key: 'won', name: '商务期' },
  { key: 'delivering', name: '交付期' },
] as const

const STATUS_TO_PHASE_INDEX: Record<Project['status'], number> = {
  // The index of the CURRENT phase in PHASE_DEFS; everything before
  // is done, everything after is pending. Archived sits "past the
  // end" so all 5 stages render done.
  lead: 1,
  lead_discovery: 1,
  opportunity: 2,
  opportunity_qualified: 2,
  proposal: 2,
  negotiation: 2,
  contracting: 3,
  won: 3,
  delivering: 4,
  kickoff: 4,
  execution: 4,
  delivery: 4,
  support: 4,
  archived: 5,
}

const PROMPTS: Array<{
  key: string
  icon: string
  title: string
  text: string
}> = [
  {
    key: 'progress',
    icon: 'trending',
    title: '项目进展速报',
    text: '请基于当前项目的结构化记忆,给我一份不超过 300 字的进展速报,按 立项/线索期/方案期 三段汇总,并标注关键卡点。',
  },
  {
    key: 'open-questions',
    icon: 'check',
    title: '梳理待确认问题',
    text: '请帮我梳理当前所有待确认问题,按优先级排列,并对每条给出后续处理建议和负责人推测。',
  },
  {
    key: 'client-prep',
    icon: 'chat',
    title: '准备客户沟通',
    text: '我即将和客户进行下一次沟通,请帮我准备一份要点清单,覆盖:背景同步、待确认问题、本次需要客户决策的点。',
  },
  {
    key: 'risks',
    icon: 'zap',
    title: '识别项目风险',
    text: '请基于当前项目记忆和文档,识别可能的项目风险,按"概率 × 影响"排序,每条给出对策建议。',
  },
]

function readOpenQuestionsCount(rawJson: string | null | undefined): number {
  if (!rawJson) return 0
  try {
    const parsed: unknown = JSON.parse(rawJson)
    if (!parsed || typeof parsed !== 'object') return 0
    const slot = (parsed as Record<string, unknown>).open_questions
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return 0
    const obj = slot as Record<string, unknown>
    const ai = Array.isArray(obj.ai) ? obj.ai.length : 0
    const pinned = Array.isArray(obj.pinned) ? obj.pinned.length : 0
    return ai + pinned
  } catch {
    return 0
  }
}

function formatRelativeShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : `${iso}Z`
  const t = new Date(normalized).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(normalized).toLocaleDateString('zh-CN')
}

export function ChatEmptyState({ projectId, detail, onSelectPrompt }: EmptyStateProps) {
  const { project, files, milestones, todos } = detail

  const phaseIndex = STATUS_TO_PHASE_INDEX[project.status] ?? 1
  const visibleFiles = useMemo(() => files.filter((f) => !f.deleted_at), [files])
  const milestonesDone = milestones.filter((m) => m.is_done).length
  const openQuestions = useMemo(
    () => readOpenQuestionsCount(project.context_memory_json),
    [project.context_memory_json],
  )

  const feed = useMemo(
    () =>
      synthesizeActivityFeed({
        project,
        milestones,
        files,
        todos,
        projectId,
        limit: 3,
      }).slice(0, 3),
    [project, milestones, files, todos, projectId],
  )

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        maxWidth: 840,
        margin: '0 auto',
        width: '100%',
        padding: '8px 0 0',
      }}
    >
      <Greeting projectName={project.name} />
      <PulseCard
        project={project}
        phaseIndex={phaseIndex}
        fileCount={visibleFiles.length}
        milestonesDone={milestonesDone}
        milestonesTotal={milestones.length}
        openQuestions={openQuestions}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 28,
        }}
      >
        <RecentActivitySection feed={feed} />
        <PromptsSection onSelect={onSelectPrompt} />
      </div>
    </div>
  )
}

/* ─── Greeting ───────────────────────────────────────────────── */

function Greeting({ projectName }: { projectName: string }) {
  return (
    <div
      style={{
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 4,
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 'var(--r-sm)',
          background: 'var(--accent)',
          color: 'var(--bg-elev)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 10,
        }}
      >
        <CxIcon name="sparkle" size={18} stroke={1.6} />
      </span>
      <h1
        className="ui"
        style={{
          margin: 0,
          fontSize: 19,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
        }}
      >
        从这里继续推进 <span style={{ color: 'var(--accent-ink)' }}>{projectName}</span>
      </h1>
      <p
        style={{
          margin: '6px 0 0',
          fontSize: 13,
          color: 'var(--ink-mute)',
          lineHeight: 1.6,
          maxWidth: 540,
        }}
      >
        这段对话已挂载项目的全部记忆与文档 — 挑一个起点,或直接开始提问。
      </p>
    </div>
  )
}

/* ─── Pulse card ────────────────────────────────────────────── */

interface PulseCardProps {
  project: Project
  phaseIndex: number
  fileCount: number
  milestonesDone: number
  milestonesTotal: number
  openQuestions: number
}

function PulseCard({
  project,
  phaseIndex,
  fileCount,
  milestonesDone,
  milestonesTotal,
  openQuestions,
}: PulseCardProps) {
  const version = project.memory_version != null ? `v${project.memory_version}` : '—'
  const updatedRel = formatRelativeShort(project.memory_updated_at)
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        background: 'var(--bg-elev)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 18px',
          borderBottom: '1px solid var(--line-soft)',
        }}
      >
        <CxIcon name="zap" size={13} style={{ color: 'var(--accent)' }} stroke={1.6} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>
          项目脉搏
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: 'var(--ink-mute)',
          }}
        >
          记忆{' '}
          <b style={{ color: 'var(--accent-ink)', fontWeight: 500 }} className="num">
            {version}
          </b>{' '}
          · {project.memory_updated_at ? `${updatedRel}更新` : '尚未建立'}
        </span>
      </div>

      {/* Phase stepper */}
      <PhaseStepper phaseIndex={phaseIndex} />

      {/* Facts grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          borderTop: '1px solid var(--line-soft)',
        }}
      >
        <Fact label="记忆版本" value={version} valueIsNum />
        <Fact
          label="项目文档"
          value={String(fileCount)}
          unit={fileCount > 0 ? '份' : undefined}
          valueIsNum
        />
        <Fact
          label="里程碑"
          value={`${milestonesDone}/${milestonesTotal || '—'}`}
          unit="完成"
          valueIsNum
        />
        <Fact
          label="待确认"
          value={String(openQuestions)}
          unit={openQuestions > 0 ? '项' : undefined}
          tone={openQuestions > 0 ? 'warn' : undefined}
          valueIsNum
          isLast
        />
      </div>

      {/* Attention banner — only when there are blockers */}
      {openQuestions > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '9px 18px',
            borderTop: '1px solid var(--line-soft)',
            background: 'color-mix(in oklch, var(--warn) 6%, var(--bg-elev))',
          }}
        >
          <CxIcon
            name="quote"
            size={14}
            stroke={1.6}
            style={{ color: 'var(--warn)', marginTop: 1, flexShrink: 0 }}
          />
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            <b style={{ color: 'var(--ink)', fontWeight: 600 }}>
              {openQuestions} 个待确认问题
            </b>{' '}
            可能正在阻塞下一步推进 — 在「项目记忆」里查看具体条目,或让 Aria 帮你梳理。
          </div>
        </div>
      )}
    </div>
  )
}

function PhaseStepper({ phaseIndex }: { phaseIndex: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        padding: '14px 18px 12px',
      }}
    >
      {PHASE_DEFS.map((p, i) => {
        const done = i < phaseIndex
        const now = i === phaseIndex
        const isLast = i === PHASE_DEFS.length - 1
        return (
          <div
            key={p.key}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'relative',
              textAlign: 'center',
            }}
          >
            {!isLast && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 7,
                  height: 2,
                  background: done ? 'var(--accent)' : 'var(--line)',
                  left: '50%',
                  right: '-50%',
                }}
              />
            )}
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 99,
                background: done ? 'var(--accent)' : 'var(--bg-elev)',
                border: `2px solid ${done || now ? 'var(--accent)' : 'var(--line)'}`,
                boxShadow: now ? '0 0 0 4px var(--accent-bg)' : undefined,
                position: 'relative',
                zIndex: 1,
                display: 'inline-block',
              }}
            >
              {now && (
                <span
                  style={{
                    position: 'absolute',
                    inset: 3,
                    borderRadius: 99,
                    background: 'var(--accent)',
                    display: 'inline-block',
                  }}
                />
              )}
            </span>
            <span
              style={{
                fontSize: 12,
                marginTop: 9,
                color: now ? 'var(--ink)' : 'var(--ink-mute)',
                fontWeight: now ? 600 : 400,
              }}
            >
              {p.name}
            </span>
            <span
              style={{
                fontSize: 10.5,
                color: now ? 'var(--accent-ink)' : 'var(--ink-faint)',
                marginTop: 2,
              }}
            >
              {done ? '完成' : now ? '当前' : '未开始'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Fact({
  label,
  value,
  unit,
  tone,
  valueIsNum,
  isLast,
}: {
  label: string
  value: string
  unit?: string
  tone?: 'warn'
  valueIsNum?: boolean
  isLast?: boolean
}) {
  return (
    <div
      style={{
        padding: '10px 18px',
        borderRight: isLast ? 'none' : '1px solid var(--line-soft)',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{label}</div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: tone === 'warn' ? 'var(--warn)' : 'var(--ink)',
          marginTop: 4,
          letterSpacing: '-0.01em',
          display: 'flex',
          alignItems: 'baseline',
          gap: 5,
        }}
        className={valueIsNum ? 'num' : undefined}
      >
        {value}
        {unit && (
          <small
            style={{
              fontSize: 11.5,
              fontWeight: 400,
              color: 'var(--ink-mute)',
            }}
          >
            {unit}
          </small>
        )}
      </div>
    </div>
  )
}

/* ─── Recent activity ──────────────────────────────────────── */

function RecentActivitySection({
  feed,
}: {
  feed: ReturnType<typeof synthesizeActivityFeed>
}) {
  return (
    <div>
      <SectionHeader title="最近动态" />
      {feed.length === 0 ? (
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--ink-faint)',
            padding: '12px 4px',
            lineHeight: 1.6,
          }}
        >
          项目还没有可显示的动态
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {feed.map((ev) => (
            <div
              key={ev.id}
              className="row-hov"
              style={{
                display: 'flex',
                gap: 11,
                padding: '6px 4px',
                borderRadius: 'var(--r-sm)',
                alignItems: 'flex-start',
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 'var(--r-sm)',
                  background:
                    ev.tone === 'accent' ? 'var(--accent-bg)' : 'var(--bg-tint)',
                  color: feedToneColor(ev.tone),
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <CxIcon
                  name={
                    ev.category === '记忆'
                      ? 'sparkle'
                      : ev.category === '文档'
                        ? 'file'
                        : ev.category === '里程碑'
                          ? 'check'
                          : ev.category === '待办'
                            ? 'dot'
                            : 'user'
                  }
                  size={11}
                  stroke={1.5}
                />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
                  {ev.what}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 1 }}>
                  {ev.who} · {ev.category}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--ink-faint)',
                  whiteSpace: 'nowrap',
                  marginTop: 2,
                }}
              >
                {formatFeedTime(ev.ts)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Prompts ──────────────────────────────────────────────── */

function PromptsSection({ onSelect }: { onSelect: (text: string) => void }) {
  return (
    <div>
      <SectionHeader title="从这里开始" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {PROMPTS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onSelect(p.text)}
            className="row-hov"
            style={{
              display: 'flex',
              gap: 11,
              padding: '9px 13px',
              textAlign: 'left',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--bg-elev)',
              alignItems: 'center',
              cursor: 'pointer',
              width: '100%',
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 'var(--r-sm)',
                background: 'var(--bg-tint)',
                color: 'var(--accent)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CxIcon name={p.icon} size={13} stroke={1.5} />
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--ink)',
              }}
            >
              {p.title}
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)' }}>
              <CxIcon name="arrow-right" size={12} stroke={1.5} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '0 0 8px',
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ink-mute)',
          letterSpacing: '0.02em',
        }}
      >
        {title}
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--line-soft)' }} />
    </div>
  )
}
