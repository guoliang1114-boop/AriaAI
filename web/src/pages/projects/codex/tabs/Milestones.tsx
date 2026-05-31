import { useMemo } from 'react'
import type { Milestone, ProjectDetail as ProjectDetailType } from '../../../../types/api'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus } from '../CxPrimitives'
import { firstGlyph } from '../useProjectsApi'

interface MilestonesProps {
  projectId: number
  detail: ProjectDetailType
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

export function CxProjectMilestones({ projectId, detail }: MilestonesProps) {
  const { project, milestones, todos } = detail

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
                按计划日期排序 · 项目对话中可自动抽取
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  background: 'var(--ink)',
                  color: 'var(--bg-elev)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                + 添加里程碑
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
                还没有里程碑。点击右上「+ 添加里程碑」开始。
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
                  <MilestoneRow key={m.id} m={m} last={i === sortedMs.length - 1} />
                ))}
              </div>
            )}
          </div>

          <CxPanel
            title="待办"
            subtitle={`${openTodos.length} 项进行中 · ${doneTodos.length} 项已完成`}
          >
            {openTodos.length === 0 && doneTodos.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
                还没有待办。
              </div>
            ) : (
              <>
                {openTodos.map((t, i) => (
                  <div
                    key={t.id}
                    className="row-hov"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '20px 1fr 100px 100px',
                      gap: 12,
                      padding: '10px 8px',
                      margin: '0 -8px',
                      borderRadius: 'var(--r-sm)',
                      alignItems: 'center',
                      borderBottom:
                        i === openTodos.length - 1 ? 'none' : '1px solid var(--line-soft)',
                    }}
                  >
                    <span
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: 3,
                        border: '1.5px solid var(--line-strong)',
                        flexShrink: 0,
                      }}
                    />
                    <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
                      {t.content}
                    </div>
                    <span style={{ fontSize: 11.5, color: dueColor(t.due_date) }}>
                      {t.due_date ?? '—'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {t.assigned_user && (
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
                            }}
                          >
                            {firstGlyph(t.assigned_user.display_name)}
                          </span>
                          <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                            {t.assigned_user.display_name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
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

          <CxPanel title="风险预警">
            <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
              基于待办与里程碑自动生成 — 暂未启用。
            </div>
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  )
}

function MilestoneRow({ m, last }: { m: Milestone; last: boolean }) {
  const color = m.is_done ? 'var(--good)' : 'var(--accent)'
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr auto',
        gap: 18,
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
    </div>
  )
}
