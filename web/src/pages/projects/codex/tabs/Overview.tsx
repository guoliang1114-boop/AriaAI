import { useState } from 'react'
import type {
  ProjectDetail as ProjectDetailType,
  ProjectMember,
} from '../../../../types/api'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel } from '../CxPrimitives'
import {
  CxArchiveProjectDialog,
  CxDeleteProjectDialog,
  CxEditProjectDialog,
} from '../CxProjectActions'
import {
  CxMemberInviteDialog,
  CxMemberRemoveDialog,
} from '../CxMemberActions'
import {
  STATUS_LABEL,
  firstGlyph,
  formatAmountWan,
  formatUpdatedRelative,
} from '../useProjectsApi'

interface OverviewProps {
  projectId: number
  detail: ProjectDetailType
  refetch: () => Promise<void>
}

type DialogKey = 'archive' | 'delete' | null

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

export function CxProjectOverview({ detail, refetch }: OverviewProps) {
  const { project, members, todos, milestones, financials } = detail
  const projectId = project.id
  const [dialog, setDialog] = useState<DialogKey>(null)
  const [editing, setEditing] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [removingMember, setRemovingMember] = useState<ProjectMember | null>(null)
  const closeDialog = () => setDialog(null)
  const ownerName = members.find((m) => m.role === 'owner')?.user.display_name ?? '—'
  const milestoneDone = milestones.filter((m) => m.is_done).length
  const milestoneTotal = milestones.length

  const KEY_FACTS: Array<[string, string]> = [
    ['客户', project.client || '—'],
    ['状态', STATUS_LABEL[project.status] ?? project.status],
    ['合同金额', formatAmountWan(project.contract_amount)],
    ['更新时间', formatUpdatedRelative(project.updated_at)],
    ['创建时间', formatDate(project.created_at)],
    ['负责人', ownerName],
  ]

  // Memory summary slot list — pulled from project.context_memory_json if
  // present (object with arbitrary slot keys), else show a single
  // context_summary line, else empty.
  const memorySlots = readMemorySlots(project.context_memory_json)

  const openTodos = todos.filter((t) => !t.is_done)
  const recentTodos = openTodos.slice(0, 4)

  return (
    <CxProjectShell activeTab="overview" projectId={projectId} project={project}>
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '24px 40px 32px',
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 20,
          minWidth: 0,
        }}
      >
        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <CxPanel
            title="项目快照"
            subtitle={
              project.context_summary
                ? `自动生成 · ${formatUpdatedRelative(project.memory_updated_at)}`
                : '尚未生成快照'
            }
          >
            <p
              className="ui"
              style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--ink)', lineHeight: 1.75 }}
            >
              {project.context_summary || project.description || (
                <span style={{ color: 'var(--ink-faint)' }}>
                  暂无描述。可在「项目记忆」中补充背景与目标,自动生成快照。
                </span>
              )}
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 14,
                paddingTop: 14,
                borderTop: '1px solid var(--line-soft)',
              }}
            >
              <SnapshotTile
                label="里程碑进度"
                value={`${milestoneDone} / ${milestoneTotal || '—'}`}
                icon="check"
              />
              <SnapshotTile
                label="合同金额"
                value={formatAmountWan(project.contract_amount)}
                icon="target"
              />
              <SnapshotTile
                label="待办"
                value={`${openTodos.length} 项待处理`}
                icon="arrow-right"
              />
            </div>
          </CxPanel>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <CxPanel
              title="项目记忆摘要"
              subtitle={
                project.memory_version != null
                  ? `v${project.memory_version} · ${
                      project.memory_stale ? '需刷新' : '已同步'
                    }`
                  : '尚未建立记忆'
              }
              action={
                <a
                  style={{ fontSize: 11.5, color: 'var(--accent)' }}
                  href={`/projects/${projectId}/memory`}
                >
                  查看完整 →
                </a>
              }
            >
              {memorySlots.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--ink-faint)', padding: '8px 0' }}>
                  暂无结构化记忆。在「项目记忆」中编辑槽位后会出现摘要。
                </div>
              ) : (
                memorySlots.map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '90px 1fr',
                      padding: '9px 0',
                      borderBottom: '1px solid var(--line-soft)',
                      gap: 12,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>{k}</div>
                    <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6 }}>{v}</div>
                  </div>
                ))
              )}
            </CxPanel>

            <CxPanel
              title="近期待办"
              subtitle={`${openTodos.length} 项待处理`}
              action={
                <a
                  style={{ fontSize: 11.5, color: 'var(--accent)' }}
                  href={`/projects/${projectId}/milestones`}
                >
                  全部 →
                </a>
              }
            >
              {recentTodos.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
                  当前没有未完成的待办。
                </div>
              ) : (
                recentTodos.map((t, i) => (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '9px 0',
                      borderBottom:
                        i === recentTodos.length - 1 ? 'none' : '1px solid var(--line-soft)',
                    }}
                  >
                    <span
                      style={{
                        width: 13,
                        height: 13,
                        marginTop: 3,
                        borderRadius: 3,
                        border: '1.5px solid var(--line-strong)',
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}>
                        {t.content}
                      </div>
                      {t.assigned_user && (
                        <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                          {t.assigned_user.display_name}
                          {t.due_date ? ` · ${t.due_date}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CxPanel>
          </div>

          <CxPanel
            title="最近里程碑"
            subtitle={`${milestoneDone} / ${milestoneTotal} 完成`}
            action={
              <a
                style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}
                href={`/projects/${projectId}/milestones`}
              >
                全部 →
              </a>
            }
          >
            {milestones.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
                还没有里程碑。
              </div>
            ) : (
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
                {milestones.slice(0, 5).map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '74px auto 1fr',
                      gap: 12,
                      padding: '9px 0',
                      alignItems: 'flex-start',
                      position: 'relative',
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: 'var(--ink-mute)', paddingTop: 1 }}>
                      {m.due_date ?? '—'}
                    </span>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: m.is_done ? 'var(--good)' : 'var(--bg-elev)',
                        border: `1.5px solid ${m.is_done ? 'var(--good)' : 'var(--line-strong)'}`,
                        marginTop: 6,
                        position: 'relative',
                        left: -14,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ marginLeft: -10 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 500 }}>
                        {m.title}
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginLeft: 8 }}>
                        {m.is_done ? '已完成' : '进行中'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CxPanel>
        </div>

        {/* Right rail */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel
            title="项目档案"
            action={
              <button
                type="button"
                onClick={() => setEditing(true)}
                style={{
                  fontSize: 12.5,
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CxIcon name="edit" size={12} /> 编辑
              </button>
            }
          >
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.85 }}>
              {KEY_FACTS.map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '5px 0',
                  }}
                >
                  <span style={{ color: 'var(--ink-mute)' }}>{k}</span>
                  <span style={{ color: 'var(--ink)', textAlign: 'right', minWidth: 0 }}>{v}</span>
                </div>
              ))}
            </div>
            {project.description?.trim() && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 12,
                  borderTop: '1px solid var(--line-soft)',
                }}
              >
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginBottom: 6 }}>
                  项目描述
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: 'var(--ink)',
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {project.description}
                </p>
              </div>
            )}
          </CxPanel>

          <CxPanel
            title="项目财务"
            subtitle={`合同 ${formatAmountWan(financials.contract_amount)}`}
            action={
              <a
                style={{ fontSize: 11.5, color: 'var(--accent)' }}
                href={`/projects/${projectId}/finance`}
              >
                详细 →
              </a>
            }
          >
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.85 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>已回款</span>
                <span className="num" style={{ color: 'var(--good)' }}>
                  {formatAmountWan(financials.total_received)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>已开票待回款</span>
                <span className="num" style={{ color: 'var(--warn)' }}>
                  {formatAmountWan(financials.uncollected)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>剩余</span>
                <span className="num" style={{ color: 'var(--ink)' }}>
                  {formatAmountWan(financials.remaining)}
                </span>
              </div>
            </div>
          </CxPanel>

          <CxPanel
            title="项目成员"
            subtitle={`${members.length} 人`}
            action={
              <button
                type="button"
                onClick={() => setInviting(true)}
                style={{
                  fontSize: 12,
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CxIcon name="plus" size={11} stroke={1.6} /> 邀请
              </button>
            }
          >
            {members.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-faint)', padding: '8px 0' }}>
                暂未邀请成员。
              </div>
            ) : (
              members.map((p) => (
                <div
                  key={p.id}
                  className="row-hov"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 6px',
                    margin: '0 -6px',
                    borderRadius: 'var(--r-sm)',
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 99,
                      background: 'var(--bg-tint)',
                      color: 'var(--ink-soft)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12.5,
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {firstGlyph(p.user.display_name)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 13.5, color: 'var(--ink)' }}>
                      {p.user.display_name}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                      {p.role ?? 'member'}
                    </div>
                  </div>
                  {p.role !== 'owner' && (
                    <button
                      type="button"
                      onClick={() => setRemovingMember(p)}
                      title="移除"
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
                  )}
                </div>
              ))
            )}
          </CxPanel>

          <CxPanel title="项目管理">
            {(
              [
                { l: '归档项目', d: '移入归档,保留全部记忆', icon: 'archive', tone: 'soft', key: 'archive' },
                { l: '删除项目', d: '不可恢复,谨慎操作', icon: 'trash', tone: 'bad', key: 'delete' },
              ] as Array<{ l: string; d: string; icon: string; tone: 'soft' | 'bad'; key: Exclude<DialogKey, null> }>
            ).map((a, i) => (
              <button
                key={a.l}
                type="button"
                onClick={() => setDialog(a.key)}
                className="row-hov"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '9px 8px',
                  borderRadius: 'var(--r-sm)',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                  textAlign: 'left',
                  background: 'transparent',
                }}
              >
                <span
                  style={{
                    color: a.tone === 'bad' ? 'var(--bad)' : 'var(--ink-mute)',
                    display: 'inline-flex',
                    flexShrink: 0,
                  }}
                >
                  <CxIcon name={a.icon} size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="ui"
                    style={{
                      fontSize: 13.5,
                      color: a.tone === 'bad' ? 'var(--bad)' : 'var(--ink)',
                      fontWeight: 500,
                    }}
                  >
                    {a.l}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>
                    {a.d}
                  </div>
                </div>
                <CxIcon
                  name="chevron-right"
                  size={12}
                  style={{ color: 'var(--ink-faint)', flexShrink: 0 }}
                />
              </button>
            ))}
          </CxPanel>
        </aside>
      </div>

      <CxEditProjectDialog
        open={editing}
        project={project}
        onClose={() => setEditing(false)}
        onSaved={refetch}
      />
      <CxArchiveProjectDialog
        open={dialog === 'archive'}
        project={project}
        onClose={closeDialog}
        onArchived={refetch}
      />
      <CxDeleteProjectDialog
        open={dialog === 'delete'}
        project={project}
        onClose={closeDialog}
      />
      <CxMemberInviteDialog
        open={inviting}
        projectId={projectId}
        existingMemberIds={new Set(members.map((m) => m.user_id))}
        onClose={() => setInviting(false)}
        onInvited={refetch}
      />
      <CxMemberRemoveDialog
        open={removingMember !== null}
        projectId={projectId}
        member={removingMember}
        onClose={() => setRemovingMember(null)}
        onRemoved={refetch}
      />
    </CxProjectShell>
  )
}

function SnapshotTile({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 'var(--r-sm)',
          background: 'var(--accent-bg)',
          color: 'var(--accent)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <CxIcon name={icon} size={12} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 2 }}>{label}</div>
        <div
          className="ui"
          style={{
            fontSize: 13,
            color: 'var(--ink)',
            fontWeight: 500,
            lineHeight: 1.45,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

/** Friendly label + display order for the structured slots written by
 * backend `_default_project_memory`. Keys not in this list are
 * skipped (they're meta like `_coverage` / `stale` / `memory_version`
 * — those are NOT user-facing memory slots and rendering "false" for
 * `stale` was the bug the user spotted). */
const SLOT_LABELS: Array<[string, string]> = [
  ['project_brief', '项目概述'],
  ['current_objective', '当前目标'],
  ['recent_progress', '近期进展'],
  ['key_risks', '关键风险'],
  ['open_questions', '待确认问题'],
  ['next_actions', '下一步'],
  ['delivery_signals', '交付信号'],
  ['financial_status', '财务状态'],
]

function readMemorySlots(raw: string | null | undefined): Array<[string, string]> {
  if (!raw) return []
  let parsed: Record<string, unknown>
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return []
    parsed = data as Record<string, unknown>
  } catch {
    return []
  }
  const out: Array<[string, string]> = []
  for (const [k, label] of SLOT_LABELS) {
    const text = formatSlotValue(parsed[k])
    if (text) out.push([label, text])
    if (out.length >= 6) break
  }
  return out
}

/** Render a slot value into a human string. Handles:
 *  - plain strings
 *  - flat string lists (joins with " · ")
 *  - the {ai, pinned} shape backend uses for risks / questions /
 *    stakeholder notes (flattens both, dedupes empties)
 *  Returns null for empties / unrenderable shapes so the caller can
 *  hide the row entirely. */
function formatSlotValue(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return null
  if (Array.isArray(v)) {
    const items = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
    return items.length ? items.join(' · ') : null
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    const merged: string[] = []
    for (const key of ['pinned', 'ai']) {
      const list = obj[key]
      if (Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === 'string' && item.trim()) merged.push(item.trim())
        }
      }
    }
    return merged.length ? merged.join(' · ') : null
  }
  return null
}
