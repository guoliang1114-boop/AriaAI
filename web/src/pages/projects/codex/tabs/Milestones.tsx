import { useMemo, useState } from 'react'
import type {
  Milestone,
  ProjectDetail as ProjectDetailType,
  ProjectTodo,
} from '../../../../types/api'
import { useToast } from '../../../../contexts/ToastContext'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus } from '../CxPrimitives'
import { firstGlyph } from '../useProjectsApi'
import {
  feedToneColor,
  formatFeedTime,
  groupFeedByDay,
  synthesizeActivityFeed,
  type FeedEvent,
} from '../activityFeed'
import {
  CxMilestoneDeleteDialog,
  CxMilestoneFormDialog,
  toggleMilestoneDone,
} from '../CxMilestoneActions'
import {
  CxTodoDeleteDialog,
  CxTodoFormDialog,
  toggleTodoDone,
} from '../CxTodoActions'

interface MilestonesProps {
  projectId: number
  detail: ProjectDetailType
  refetch: () => Promise<void>
}

function dueColor(due: string | null | undefined) {
  if (!due) return 'var(--ink-mute)'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return 'var(--ink-mute)'
  d.setHours(0, 0, 0, 0)
  const diff = d.getTime() - today.getTime()
  if (diff < 0) return 'var(--bad)'
  if (diff < 86400000) return 'var(--warn)'
  if (diff < 7 * 86400000) return 'var(--accent)'
  return 'var(--ink-mute)'
}

export function CxProjectMilestones({ projectId, detail, refetch }: MilestonesProps) {
  const { project, milestones, todos } = detail
  const toast = useToast()
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Milestone | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [todoEditing, setTodoEditing] = useState<ProjectTodo | null>(null)
  const [todoCreating, setTodoCreating] = useState(false)
  const [todoDeleting, setTodoDeleting] = useState<ProjectTodo | null>(null)
  const [todoTogglingId, setTodoTogglingId] = useState<number | null>(null)

  const toggleTodo = async (t: ProjectTodo) => {
    if (todoTogglingId === t.id) return
    setTodoTogglingId(t.id)
    try {
      await toggleTodoDone(projectId, t)
      toast.success({ title: t.is_done ? '已标记为未完成' : '已标记完成' })
      await refetch()
    } catch (err) {
      toast.error({
        title: '更新失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setTodoTogglingId(null)
    }
  }

  const sortedMs = useMemo(() => {
    return [...milestones].sort((a, b) => {
      const da = a.due_date ? new Date(a.due_date).getTime() : 0
      const db = b.due_date ? new Date(b.due_date).getTime() : 0
      return da - db
    })
  }, [milestones])

  const done = sortedMs.filter((m) => m.is_done).length
  const total = sortedMs.length

  const openTodos = todos.filter((t) => !t.is_done)
  const doneTodos = todos.filter((t) => t.is_done)

  const toggle = async (m: Milestone) => {
    if (togglingId === m.id) return
    setTogglingId(m.id)
    try {
      await toggleMilestoneDone(projectId, m)
      toast.success({ title: m.is_done ? '已标记为未完成' : '已标记完成' })
      await refetch()
    } catch (err) {
      toast.error({
        title: '更新失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setTogglingId(null)
    }
  }

  // Build the expanded activity feed shown in the left column. Up to
  // 50 events grouped by day; same synth as the Overview rail (memory
  // updates, milestone add/done, file uploads, todo add/done, project
  // edits) so the two views agree.
  const feed = useMemo(
    () =>
      synthesizeActivityFeed({
        project,
        milestones,
        files: detail.files,
        todos,
        projectId,
        limit: 50,
      }),
    [project, milestones, detail.files, todos, projectId],
  )
  const grouped = useMemo(() => groupFeedByDay(feed), [feed])

  return (
    <CxProjectShell activeTab="milestones" projectId={projectId} project={project}>
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '24px 40px 32px',
          display: 'grid',
          // 60/40 split. The right column hosts milestones + todos +
          // metrics — todos in particular have long titles + assignee
          // chip that need real horizontal room. minmax(420, 2fr) so a
          // narrow viewport doesn't collapse the right panel into a
          // 200px sliver.
          gridTemplateColumns: 'minmax(0, 3fr) minmax(420px, 2fr)',
          gap: 28,
          minWidth: 0,
        }}
      >
        {/* LEFT — activity feed becomes the centerpiece */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <div>
            <h2
              className="ui"
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 500,
                color: 'var(--ink)',
                letterSpacing: '-0.015em',
              }}
            >
              最近动态 · {feed.length}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-mute)' }}>
              从对话、文档、里程碑、待办、项目记忆等数据自动汇总
            </p>
          </div>

          {feed.length === 0 ? (
            <CxPanel title="还没有动态">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.7 }}>
                上传文档、添加里程碑或更新项目记忆后会出现在这里。
              </p>
            </CxPanel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {grouped.map((g) => (
                <DayGroup key={g.label} label={g.label} events={g.events} />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — milestones + todos panels stacked */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <CxPanel
            title="里程碑"
            subtitle={`${done} / ${total} 完成`}
            action={
              <button
                type="button"
                onClick={() => setCreating(true)}
                style={{
                  fontSize: 12,
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CxIcon name="plus" size={11} stroke={1.6} /> 添加
              </button>
            }
          >
            {sortedMs.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
                还没有里程碑。
              </div>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 18 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 4,
                    top: 4,
                    bottom: 4,
                    width: 1,
                    background: 'var(--line)',
                  }}
                />
                {sortedMs.map((m, i) => (
                  <MilestoneRow
                    key={m.id}
                    m={m}
                    last={i === sortedMs.length - 1}
                    busy={togglingId === m.id}
                    onToggle={() => toggle(m)}
                    onEdit={() => setEditing(m)}
                    onDelete={() => setDeleting(m)}
                  />
                ))}
              </div>
            )}
          </CxPanel>

          <CxPanel
            title="待办"
            subtitle={`${openTodos.length} 进行中 · ${doneTodos.length} 完成`}
            action={
              <button
                type="button"
                onClick={() => setTodoCreating(true)}
                style={{
                  fontSize: 12,
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CxIcon name="plus" size={11} stroke={1.6} /> 添加
              </button>
            }
          >
            {openTodos.length === 0 && doneTodos.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
                还没有待办。
              </div>
            ) : (
              <>
                {openTodos.map((t, i) => (
                  <TodoRow
                    key={t.id}
                    t={t}
                    last={i === openTodos.length - 1}
                    busy={todoTogglingId === t.id}
                    onToggle={() => toggleTodo(t)}
                    onEdit={() => setTodoEditing(t)}
                    onDelete={() => setTodoDeleting(t)}
                  />
                ))}
                {doneTodos.length > 0 && (
                  <div
                    style={{
                      paddingTop: 12,
                      marginTop: 8,
                      borderTop: '1px solid var(--line-soft)',
                      fontSize: 11,
                      color: 'var(--ink-faint)',
                    }}
                  >
                    已完成 {doneTodos.length} 项
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column' }}>
                      {doneTodos.slice(0, 5).map((t) => (
                        <TodoRow
                          key={t.id}
                          t={t}
                          last
                          busy={todoTogglingId === t.id}
                          onToggle={() => toggleTodo(t)}
                          onEdit={() => setTodoEditing(t)}
                          onDelete={() => setTodoDeleting(t)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CxPanel>

          <CxPanel title="速度指标">
            <div style={{ fontSize: 12.5, lineHeight: 1.85 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>里程碑数</span>
                <span className="num">{total}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>已完成</span>
                <span className="num" style={{ color: 'var(--good)' }}>
                  {done}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>进行中待办</span>
                <span className="num">{openTodos.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>已完成待办</span>
                <span className="num">{doneTodos.length}</span>
              </div>
            </div>
          </CxPanel>
        </aside>
      </div>

      <CxMilestoneFormDialog
        open={creating}
        projectId={projectId}
        onClose={() => setCreating(false)}
        onSaved={refetch}
      />
      <CxMilestoneFormDialog
        open={editing !== null}
        projectId={projectId}
        milestone={editing}
        onClose={() => setEditing(null)}
        onSaved={refetch}
      />
      <CxMilestoneDeleteDialog
        open={deleting !== null}
        projectId={projectId}
        milestone={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={refetch}
      />
      <CxTodoFormDialog
        open={todoCreating}
        projectId={projectId}
        onClose={() => setTodoCreating(false)}
        onSaved={refetch}
      />
      <CxTodoFormDialog
        open={todoEditing !== null}
        projectId={projectId}
        todo={todoEditing}
        onClose={() => setTodoEditing(null)}
        onSaved={refetch}
      />
      <CxTodoDeleteDialog
        open={todoDeleting !== null}
        projectId={projectId}
        todo={todoDeleting}
        onClose={() => setTodoDeleting(null)}
        onDeleted={refetch}
      />
    </CxProjectShell>
  )
}

interface TodoRowProps {
  t: ProjectTodo
  last: boolean
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}

function TodoRow({ t, last, busy, onToggle, onEdit, onDelete }: TodoRowProps) {
  // Stacked layout so long titles never collide with the meta row.
  // Row 1: checkbox + title (wraps freely)
  // Row 2: due chip · assignee chip · edit · delete   (small, neutral)
  // This scales from a 380px panel up to a wide deck without
  // truncating in either direction.
  return (
    <div
      className="row-hov"
      style={{
        padding: '10px 8px',
        margin: '0 -8px',
        borderRadius: 'var(--r-sm)',
        borderBottom: last ? 'none' : '1px solid var(--line-soft)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          title={t.is_done ? '标记为未完成' : '标记完成'}
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            border: `1.5px solid ${t.is_done ? 'var(--good)' : 'var(--line-strong)'}`,
            background: t.is_done ? 'var(--good)' : 'transparent',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.5 : 1,
            flexShrink: 0,
            marginTop: 4,
          }}
        >
          {t.is_done && (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
          )}
        </button>
        <div
          className="ui"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13.5,
            color: t.is_done ? 'var(--ink-mute)' : 'var(--ink)',
            lineHeight: 1.55,
            textDecoration: t.is_done ? 'line-through' : 'none',
            textDecorationColor: 'var(--ink-faint)',
            wordBreak: 'break-word',
          }}
        >
          {t.content}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 24,
          fontSize: 11.5,
          color: 'var(--ink-mute)',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: dueColor(t.due_date),
          }}
        >
          <CxIcon name="calendar" size={11} />
          {t.due_date ?? '—'}
        </span>
        <span style={{ color: 'var(--ink-faint)' }}>·</span>
        {t.assigned_user ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 99,
                background: 'var(--accent-bg)',
                color: 'var(--accent-ink)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                flexShrink: 0,
              }}
            >
              {firstGlyph(t.assigned_user.display_name)}
            </span>
            <span style={{ color: 'var(--ink-soft)' }}>{t.assigned_user.display_name}</span>
          </span>
        ) : (
          <span style={{ color: 'var(--ink-faint)' }}>未指派</span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onEdit}
          title="编辑"
          style={{
            padding: 4,
            color: 'var(--ink-mute)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CxIcon name="edit" size={12} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="删除"
          style={{
            padding: 4,
            color: 'var(--ink-faint)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CxIcon name="trash" size={12} />
        </button>
      </div>
    </div>
  )
}

interface MilestoneRowProps {
  m: Milestone
  last: boolean
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}

function MilestoneRow({ m, last, busy, onToggle, onEdit, onDelete }: MilestoneRowProps) {
  const color = m.is_done ? 'var(--good)' : 'var(--accent)'
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 90px 1fr auto auto auto',
        gap: 14,
        padding: '11px 0',
        borderBottom: last ? 'none' : '1px solid var(--line-soft)',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: -22,
          top: 17,
          width: 13,
          height: 13,
          borderRadius: 99,
          background: m.is_done ? color : 'var(--bg-elev)',
          border: `1.5px solid ${color}`,
        }}
      />
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        title={m.is_done ? '标记为未完成' : '标记完成'}
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          border: `1.5px solid ${m.is_done ? 'var(--good)' : 'var(--line-strong)'}`,
          background: m.is_done ? 'var(--good)' : 'transparent',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        {m.is_done && (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        )}
      </button>
      <span
        className="num"
        style={{
          fontSize: 12.5,
          color: m.is_done ? 'var(--ink-mute)' : 'var(--accent)',
          fontWeight: 500,
        }}
      >
        {m.due_date ?? '—'}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          className="ui"
          style={{
            fontSize: 14,
            color: 'var(--ink)',
            fontWeight: 500,
            textDecoration: m.is_done ? 'line-through' : 'none',
            textDecorationColor: 'var(--ink-faint)',
          }}
        >
          {m.title}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
          优先级 {m.priority || '—'}
        </div>
      </div>
      {m.is_done ? <CxStatus tone="good">已完成</CxStatus> : <CxStatus tone="accent">进行中</CxStatus>}
      <button
        type="button"
        onClick={onEdit}
        title="编辑"
        style={{
          padding: 4,
          color: 'var(--ink-mute)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CxIcon name="edit" size={13} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="删除"
        style={{
          padding: 4,
          color: 'var(--ink-faint)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CxIcon name="trash" size={13} />
      </button>
    </div>
  )
}

/** A day-bucket label (今天 / 昨天 / 2025-04-12) plus its event rows
 * for the expanded activity feed. Matches the look of the per-day
 * sections in the design's "活动" 视图 — sticky-feeling day header,
 * then a vertical line with timestamps + colored dots + content. */
function DayGroup({ label, events }: { label: string; events: FeedEvent[] }) {
  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '14px 18px 4px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 8,
        }}
      >
        <h3
          className="ui"
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink)',
            letterSpacing: '-0.005em',
          }}
        >
          {label}
        </h3>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
          · {events.length} 项变更
        </span>
      </div>
      <div style={{ position: 'relative', paddingLeft: 14 }}>
        <div
          style={{
            position: 'absolute',
            left: 4,
            top: 4,
            bottom: 4,
            width: 1,
            background: 'var(--line)',
          }}
        />
        {events.map((e) => (
          <ActivityRow key={e.id} event={e} />
        ))}
      </div>
    </section>
  )
}

function ActivityRow({ event }: { event: FeedEvent }) {
  const color = feedToneColor(event.tone)
  const body = (
    <>
      <span style={{ fontSize: 12, color: 'var(--ink-mute)', paddingTop: 1, fontVariantNumeric: 'tabular-nums' }}>
        {formatFeedTime(event.ts)}
      </span>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: 'var(--bg-elev)',
          border: `1.5px solid ${color}`,
          marginTop: 6,
          position: 'relative',
          left: -14,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          marginLeft: -10,
          fontSize: 13,
          color: 'var(--ink-soft)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: 6,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            padding: '1px 6px',
            borderRadius: 'var(--r-pill)',
            background: 'var(--bg-tint)',
            color: 'var(--ink-mute)',
            flexShrink: 0,
            letterSpacing: '0.04em',
          }}
        >
          {event.category}
        </span>
        {event.who && event.who !== '—' && (
          <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{event.who}</span>
        )}
        <span style={{ color: 'var(--ink-soft)', lineHeight: 1.55 }}>{event.what}</span>
      </span>
    </>
  )
  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '60px auto 1fr',
    gap: 12,
    padding: '10px 0',
    alignItems: 'flex-start',
    position: 'relative',
    textDecoration: 'none',
    color: 'inherit',
  }
  return event.href ? (
    <a href={event.href} style={rowStyle} className="row-hov">
      {body}
    </a>
  ) : (
    <div style={rowStyle}>{body}</div>
  )
}
