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

  return (
    <CxProjectShell activeTab="milestones" projectId={projectId} project={project}>
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '24px 40px 32px',
          display: 'grid',
          gridTemplateColumns: '1fr 300px',
          gap: 24,
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
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
                里程碑 · {done} / {total} 完成
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-mute)' }}>
                按计划日期排序
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setCreating(true)}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  background: 'var(--ink)',
                  color: 'var(--bg-elev)',
                  borderRadius: 'var(--r-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <CxIcon name="plus" size={11} stroke={1.6} /> 添加里程碑
              </button>
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '20px 24px',
            }}
          >
            {sortedMs.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
                还没有里程碑。点击右上「添加里程碑」开始。
              </div>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 22 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 6,
                    top: 8,
                    bottom: 8,
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
          </div>

          <CxPanel
            title="待办"
            subtitle={`${openTodos.length} 项进行中 · ${doneTodos.length} 项已完成`}
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
                <CxIcon name="plus" size={11} stroke={1.6} /> 添加待办
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
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
  return (
    <div
      className="row-hov"
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 1fr 90px 110px auto auto',
        gap: 10,
        padding: '10px 8px',
        margin: '0 -8px',
        borderRadius: 'var(--r-sm)',
        alignItems: 'center',
        borderBottom: last ? 'none' : '1px solid var(--line-soft)',
      }}
    >
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
          fontSize: 13,
          color: t.is_done ? 'var(--ink-mute)' : 'var(--ink)',
          lineHeight: 1.5,
          textDecoration: t.is_done ? 'line-through' : 'none',
          textDecorationColor: 'var(--ink-faint)',
        }}
      >
        {t.content}
      </div>
      <span style={{ fontSize: 11.5, color: dueColor(t.due_date) }}>
        {t.due_date ?? '—'}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        {t.assigned_user ? (
          <>
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
            <span
              style={{
                fontSize: 11.5,
                color: 'var(--ink-mute)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t.assigned_user.display_name}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>未指派</span>
        )}
      </div>
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
