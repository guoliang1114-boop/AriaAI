import { useMemo, useState } from 'react'
import type {
  ClientStakeholder,
  ProjectDetail as ProjectDetailType,
  ProjectMember,
} from '../../../../types/api'
import { CxSkeleton } from '../../../../components/codex'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus, type CxTone } from '../CxPrimitives'
import { firstGlyph, useClientStakeholders } from '../useProjectsApi'
import { CxMemberInviteDialog, CxMemberRemoveDialog } from '../CxMemberActions'
import { CxStakeholderCreateDialog } from '../CxStakeholderActions'

interface StakeholdersProps {
  projectId: number
  detail: ProjectDetailType
  refetch: () => Promise<void>
}

interface NormalizedStakeholder {
  id: number
  name: string
  role: string
  level: '决策' | '影响' | '执行' | '其他'
  relationship: '支持' | '积极' | '推动' | '中立' | '反对'
  influence: number
  concerns: string
  lastAction: string
}

function readLevel(s: ClientStakeholder): NormalizedStakeholder['level'] {
  const v = (s.organization_level || s.influence_type || '').trim()
  if (/决策|高层|核心|关键|sponsor|decision/i.test(v)) return '决策'
  if (/影响|协调|推动|influence|champion/i.test(v)) return '影响'
  if (/执行|operator|user|执行层/i.test(v)) return '执行'
  return '其他'
}

function readRelationship(s: ClientStakeholder): NormalizedStakeholder['relationship'] {
  const v = (s.relationship_status || '').trim()
  if (/反对|阻碍|opposed/i.test(v)) return '反对'
  if (/中立|neutral/i.test(v)) return '中立'
  if (/推动|driver/i.test(v)) return '推动'
  if (/积极|supporter|阳/i.test(v)) return '积极'
  if (/支持|友好|supportive/i.test(v)) return '支持'
  return '中立'
}

function influenceScore(level: NormalizedStakeholder['level'], rel: NormalizedStakeholder['relationship']) {
  const base = level === '决策' ? 80 : level === '影响' ? 55 : level === '执行' ? 30 : 20
  const adj = rel === '反对' ? -10 : rel === '中立' ? 0 : 10
  return Math.max(5, Math.min(95, base + adj))
}

function levelTone(l: NormalizedStakeholder['level']): CxTone {
  if (l === '决策') return 'accent'
  if (l === '影响') return 'neutral'
  if (l === '执行') return 'mute'
  return 'mute'
}

function relColor(rel: NormalizedStakeholder['relationship']) {
  if (rel === '支持' || rel === '积极') return 'var(--good)'
  if (rel === '中立' || rel === '推动') return 'var(--ink-mute)'
  return 'var(--warn)'
}

const GRID = '1.4fr 0.7fr 0.6fr 0.7fr 1.4fr 0.8fr 14px'

export function CxProjectStakeholders({ projectId, detail, refetch }: StakeholdersProps) {
  const { project, members } = detail
  const {
    matchedClientId,
    matchedClientName,
    stakeholders,
    loading,
    error,
    refetch: refetchStakeholders,
  } = useClientStakeholders(project.client)
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<ProjectMember | null>(null)
  const [creatingStakeholder, setCreatingStakeholder] = useState(false)
  const existingMemberIds = useMemo(
    () => new Set(members.map((m) => m.user_id)),
    [members],
  )

  const rows: NormalizedStakeholder[] = useMemo(
    () =>
      stakeholders.map((s) => {
        const level = readLevel(s)
        const relationship = readRelationship(s)
        return {
          id: s.id,
          name: s.name || '—',
          role: s.role || s.organization_level || '—',
          level,
          relationship,
          influence: influenceScore(level, relationship),
          concerns: s.concerns || s.sensitivities || s.communication_preference || '',
          lastAction: s.last_action || '',
        }
      }),
    [stakeholders],
  )

  const decisionCount = rows.filter((r) => r.level === '决策').length
  const influenceCount = rows.filter((r) => r.level === '影响').length
  const executionCount = rows.filter((r) => r.level === '执行').length

  return (
    <CxProjectShell activeTab="stakeholders" projectId={projectId} project={project}>
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
                客户侧干系人 · {rows.length} 人
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-mute)' }}>
                {matchedClientName ? (
                  <>
                    {decisionCount} 决策 · {influenceCount} 影响 · {executionCount} 执行 ·
                    数据来自{' '}
                    <a
                      style={{ color: 'var(--accent)' }}
                      href={`/clients/${matchedClientId}`}
                    >
                      {matchedClientName}
                    </a>{' '}
                    的客户档案
                  </>
                ) : (
                  '客户档案未关联,无法展示客户侧干系人'
                )}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {matchedClientId && (
                <>
                  <a
                    href={`/clients/${matchedClientId}`}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      color: 'var(--ink-soft)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-sm)',
                      textDecoration: 'none',
                    }}
                  >
                    到客户空间编辑 →
                  </a>
                  <button
                    type="button"
                    onClick={() => setCreatingStakeholder(true)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      background: 'var(--ink)',
                      color: 'var(--bg-elev)',
                      borderRadius: 'var(--r-sm)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <CxIcon name="plus" size={11} stroke={1.6} /> 添加干系人
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Stakeholders block */}
          {loading ? (
            <div
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                padding: '14px 16px',
              }}
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: GRID,
                    gap: 12,
                    padding: '14px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CxSkeleton w={30} h={30} radius={99} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <CxSkeleton w={80} h={11} />
                      <CxSkeleton w={50} h={9} />
                    </div>
                  </div>
                  <CxSkeleton w={48} h={11} />
                  <CxSkeleton w={36} h={11} />
                  <CxSkeleton w={70} h={11} />
                  <CxSkeleton w={180} h={11} />
                  <CxSkeleton w={70} h={11} />
                  <span />
                </div>
              ))}
            </div>
          ) : error ? (
            <CxPanel title="加载失败">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--bad)' }}>{error}</p>
            </CxPanel>
          ) : !matchedClientName ? (
            <CxPanel title="未关联客户档案" subtitle={`项目客户名「${project.client || '—'}」`}>
              <p
                style={{
                  margin: '0 0 14px',
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  lineHeight: 1.7,
                }}
              >
                在「<a href="/clients" style={{ color: 'var(--accent)' }}>客户空间</a>
                」里新建或编辑一个同名客户档案后,客户侧干系人(CTO、COO、决策链等)会自动出现在此处。
              </p>
              <a
                href="/clients"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 12px',
                  fontSize: 12.5,
                  background: 'var(--ink)',
                  color: 'var(--bg-elev)',
                  borderRadius: 'var(--r-sm)',
                  textDecoration: 'none',
                }}
              >
                去客户空间 <CxIcon name="arrow-right" size={11} />
              </a>
            </CxPanel>
          ) : rows.length === 0 ? (
            <CxPanel title="尚未录入干系人" subtitle={`客户:${matchedClientName}`}>
              <p
                style={{
                  margin: '0 0 14px',
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  lineHeight: 1.7,
                }}
              >
                客户档案已关联,还没有录入干系人。添加 CTO / COO / 业务负责人等关键人物后会同步存入客户记忆。
              </p>
              <button
                type="button"
                onClick={() => setCreatingStakeholder(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 12px',
                  fontSize: 12.5,
                  background: 'var(--ink)',
                  color: 'var(--bg-elev)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                <CxIcon name="plus" size={11} stroke={1.6} /> 添加干系人
              </button>
            </CxPanel>
          ) : (
            <>
              {/* Influence map */}
              <div
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)',
                  padding: '16px 20px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <h3
                    className="ui"
                    style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}
                  >
                    影响力地图
                  </h3>
                  <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                    横轴:影响力 · 圆点大小:支持度
                  </span>
                </div>
                <div
                  style={{
                    position: 'relative',
                    height: 80,
                    borderBottom: '1px solid var(--line-soft)',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: '50%',
                      height: 1,
                      background: 'var(--line-soft)',
                    }}
                  />
                  {rows.map((s) => {
                    const support =
                      s.relationship === '支持'
                        ? 80
                        : s.relationship === '积极'
                          ? 75
                          : s.relationship === '推动'
                            ? 60
                            : s.relationship === '中立'
                              ? 45
                              : 25
                    const size = s.relationship === '支持' ? 22 : s.relationship === '积极' ? 18 : 16
                    const positive = s.relationship === '支持' || s.relationship === '积极'
                    return (
                      <div
                        key={s.id}
                        style={{
                          position: 'absolute',
                          left: `${s.influence}%`,
                          bottom: `${support}%`,
                          transform: 'translate(-50%, 50%)',
                        }}
                      >
                        <span
                          title={`${s.name} · ${s.level} · ${s.relationship}`}
                          style={{
                            width: size,
                            height: size,
                            borderRadius: 99,
                            background: positive ? 'var(--accent-bg)' : 'var(--bg-tint)',
                            color: positive ? 'var(--accent-ink)' : 'var(--ink-soft)',
                            border: `1.5px solid ${
                              positive ? 'var(--accent)' : 'var(--line-strong)'
                            }`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 500,
                          }}
                        >
                          {firstGlyph(s.name)}
                        </span>
                      </div>
                    )
                  })}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -16,
                      left: 0,
                      fontSize: 10,
                      color: 'var(--ink-faint)',
                    }}
                  >
                    低影响
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -16,
                      right: 0,
                      fontSize: 10,
                      color: 'var(--ink-faint)',
                    }}
                  >
                    高影响
                  </div>
                </div>
              </div>

              {/* Table */}
              <div
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: GRID,
                    padding: '12px 16px',
                    fontSize: 11,
                    color: 'var(--ink-faint)',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <span>姓名 · 角色</span>
                  <span>层级</span>
                  <span>关系</span>
                  <span>影响</span>
                  <span>关注点</span>
                  <span>最近接触</span>
                  <span />
                </div>
                {rows.map((s, i) => (
                  <a
                    key={s.id}
                    href={matchedClientId ? `/clients/${matchedClientId}` : '#'}
                    className="row-hov"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: GRID,
                      padding: '14px 16px',
                      gap: 12,
                      alignItems: 'center',
                      borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                      textDecoration: 'none',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 99,
                          background: 'var(--accent-bg)',
                          color: 'var(--accent-ink)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 500,
                          flexShrink: 0,
                        }}
                      >
                        {firstGlyph(s.name)}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                          {s.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{s.role}</div>
                      </div>
                    </div>
                    <CxStatus tone={levelTone(s.level)}>{s.level}</CxStatus>
                    <span style={{ fontSize: 12, color: relColor(s.relationship) }}>
                      {s.relationship}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div
                        style={{
                          flex: 1,
                          height: 3,
                          background: 'var(--bg-sunken)',
                          borderRadius: 99,
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${s.influence}%`,
                            background: 'var(--accent)',
                            borderRadius: 99,
                          }}
                        />
                      </div>
                      <span className="num" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                        {s.influence}
                      </span>
                    </div>
                    <div
                      className="ui"
                      style={{
                        fontSize: 12.5,
                        color: 'var(--ink-soft)',
                        lineHeight: 1.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as const,
                      }}
                    >
                      {s.concerns || '—'}
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                      {s.lastAction || '—'}
                    </span>
                    <CxIcon name="arrow-right" size={12} style={{ color: 'var(--ink-faint)' }} />
                  </a>
                ))}
              </div>
            </>
          )}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel
            title="项目团队"
            subtitle={`内部 ${members.length} 人`}
            action={
              <button
                type="button"
                onClick={() => setInviting(true)}
                style={{
                  fontSize: 11.5,
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
              <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '8px 0' }}>
                还没有邀请内部成员。
              </div>
            ) : (
              members.map((m) => (
                <div
                  key={m.id}
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
                      width: 26,
                      height: 26,
                      borderRadius: 99,
                      background: 'var(--bg-tint)',
                      color: 'var(--ink-soft)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {firstGlyph(m.user.display_name)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 13, color: 'var(--ink)' }}>
                      {m.user.display_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                      {m.role ?? 'member'}
                    </div>
                  </div>
                  {m.role !== 'owner' && (
                    <button
                      type="button"
                      onClick={() => setRemoving(m)}
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

          <CxPanel title="客户档案" subtitle="客户记忆联动">
            {matchedClientName ? (
              <a
                href={`/clients/${matchedClientId}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 0',
                  textDecoration: 'none',
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--accent-bg)',
                    color: 'var(--accent-ink)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {firstGlyph(matchedClientName)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                    {matchedClientName}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--accent)' }}>查看客户档案 →</div>
                </div>
              </a>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
                项目的客户字段「{project.client || '—'}
                」未匹配到任何客户档案。可在客户空间新建同名档案。
              </div>
            )}
          </CxPanel>
        </aside>
      </div>

      <CxMemberInviteDialog
        open={inviting}
        projectId={projectId}
        existingMemberIds={existingMemberIds}
        onClose={() => setInviting(false)}
        onInvited={refetch}
      />
      <CxMemberRemoveDialog
        open={removing !== null}
        projectId={projectId}
        member={removing}
        onClose={() => setRemoving(null)}
        onRemoved={refetch}
      />
      <CxStakeholderCreateDialog
        open={creatingStakeholder}
        clientId={matchedClientId}
        clientName={matchedClientName}
        onClose={() => setCreatingStakeholder(false)}
        onCreated={refetchStakeholders}
      />
    </CxProjectShell>
  )
}
