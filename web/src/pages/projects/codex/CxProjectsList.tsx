import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Project } from '../../../types/api'
import { CxIcon } from './CxIcons'
import { CxStatus } from './CxPrimitives'
import { PIPELINE_STAGES } from './mockData'
import {
  firstGlyph,
  formatAmountWan,
  formatUpdatedRelative,
  useProjectsList,
} from './useProjectsApi'

type CategoryKey = 'presale' | 'delivery'

/** Backend status → pipeline stage column. Backend only stores 5
 * statuses, while the design has 5 sub-stage columns inside 商务阶段.
 * Until the project table grows a `sub_stage` field we collapse:
 *   lead        → lead column
 *   opportunity → qualify column (lumped)
 *   won         → contract column
 *   proposal / negotiation stay empty (rendered as "—") */
function presaleStageOf(status: Project['status']): string | null {
  if (status === 'lead') return 'lead'
  if (status === 'opportunity') return 'qualify'
  if (status === 'won') return 'contract'
  return null
}

const sumWan = (list: Project[]) => {
  const total = list.reduce((s, p) => s + (p.contract_amount || 0), 0)
  return total > 0 ? formatAmountWan(total) : '—'
}

const DELIVERY_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px,2.4fr) 84px minmax(120px,1.3fr) 84px 92px minmax(150px,1.6fr)',
  gap: 18,
  alignItems: 'center',
}

/**
 * Project list — fetches `/projects` and renders 商务阶段 (5-column
 * pipeline) or 交付阶段 (single list split into 交付中 / 已归档).
 */
export function CxProjectsList() {
  const [cat, setCat] = useState<CategoryKey>('presale')
  const navigate = useNavigate()
  const { data, loading, error } = useProjectsList()
  const projects = data ?? []

  const presale = useMemo(
    () => projects.filter((p) => p.status === 'lead' || p.status === 'opportunity' || p.status === 'won'),
    [projects],
  )
  const active = useMemo(() => projects.filter((p) => p.status === 'delivering'), [projects])
  const archived = useMemo(() => projects.filter((p) => p.status === 'archived'), [projects])
  const presaleStaleCount = useMemo(
    () => projects.filter((p) => p.memory_stale).length,
    [projects],
  )
  const presaleTotal = useMemo(
    () => presale.reduce((s, p) => s + (p.contract_amount || 0), 0),
    [presale],
  )

  const presaleByStage = useMemo(() => {
    const map: Record<string, Project[]> = {}
    for (const p of presale) {
      const key = presaleStageOf(p.status)
      if (!key) continue
      ;(map[key] ||= []).push(p)
    }
    return map
  }, [presale])

  const goDetail = (id: number) => navigate(`/projects/${id}/overview`)
  const inCatCount = (k: CategoryKey) => (k === 'presale' ? presale.length : active.length + archived.length)

  return (
    <div
      className="theme-codex"
      style={{
        height: '100%',
        background: 'var(--bg)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-ui)',
        fontSize: 13.5,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          flex: 1,
          padding: '24px 32px 0',
          overflow: 'hidden',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 16,
          }}
        >
          <div>
            <h1
              className="ui"
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 500,
                color: 'var(--ink)',
                letterSpacing: '-0.02em',
              }}
            >
              项目空间
            </h1>
            <div
              style={{
                margin: '6px 0 0',
                fontSize: 12.5,
                color: 'var(--ink-mute)',
                display: 'flex',
                alignItems: 'center',
                gap: 9,
              }}
            >
              <span>{presale.length + active.length} 个活跃项目</span>
              <span style={{ color: 'var(--ink-faint)' }}>·</span>
              <span>
                在谈管线{' '}
                <span className="num" style={{ color: 'var(--ink-soft)' }}>
                  {formatAmountWan(presaleTotal)}
                </span>
              </span>
              <span style={{ color: 'var(--ink-faint)' }}>·</span>
              <span
                style={{
                  color: 'var(--warn)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: 'currentColor',
                  }}
                />
                {presaleStaleCount} 个记忆待刷新
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 11px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                fontSize: 12.5,
                color: 'var(--ink-soft)',
              }}
            >
              <CxIcon name="building" size={13} style={{ color: 'var(--ink-mute)' }} /> 全部客户{' '}
              <CxIcon name="chevron-down" size={10} style={{ color: 'var(--ink-faint)' }} />
            </button>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                fontSize: 12.5,
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                color: 'var(--ink-faint)',
                width: 160,
              }}
            >
              <CxIcon name="search" size={12} />
              <span>搜索项目</span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/projects/new')}
              style={{
                padding: '8px 15px',
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--bg-elev)',
                background: 'var(--ink)',
                borderRadius: 'var(--r-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <CxIcon name="plus" size={12} stroke={1.8} /> 新建项目
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            borderBottom: '1px solid var(--line)',
            flexShrink: 0,
          }}
        >
          {(['presale', 'delivery'] as const).map((k) => {
            const c = inCatCount(k)
            const tone = k === 'presale' ? 'var(--accent)' : 'var(--good)'
            const label = k === 'presale' ? '商务阶段' : '交付阶段'
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCat(k)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 18px 14px',
                  borderBottom: cat === k ? `2px solid ${tone}` : '2px solid transparent',
                  marginBottom: -1,
                  color: cat === k ? 'var(--ink)' : 'var(--ink-mute)',
                }}
              >
                <span style={{ fontSize: 14.5, fontWeight: 500, letterSpacing: '-0.01em' }}>
                  {label}
                </span>
                <span
                  className="num"
                  style={{
                    fontSize: 11,
                    color: cat === k ? 'var(--ink-soft)' : 'var(--ink-faint)',
                    background: 'var(--bg-tint)',
                    padding: '1px 8px',
                    borderRadius: 99,
                  }}
                >
                  {c}
                </span>
              </button>
            )
          })}
        </div>

        {/* Category meta */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 2px 4px',
            flexShrink: 0,
            fontSize: 12,
            color: 'var(--ink-mute)',
          }}
        >
          <span style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>
            {cat === 'presale'
              ? '从线索发现到合同签约 — 商务推进管线'
              : '交付中与已归档的项目 — 关注进度、健康度与结果'}
          </span>
          <span style={{ flex: 1 }} />
          {cat === 'presale' ? (
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="num" style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>
                {sumWan(presale)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>在谈金额</span>
            </span>
          ) : (
            <>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span
                  className="num"
                  style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}
                >
                  {active.length}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>交付中</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span
                  className="num"
                  style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}
                >
                  {archived.length}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>已归档</span>
              </span>
            </>
          )}
        </div>

        {loading && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-mute)',
              fontSize: 13,
            }}
          >
            正在加载项目…
          </div>
        )}
        {error && !loading && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--bad)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && cat === 'presale' && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              columnGap: 12,
              padding: '10px 0 22px',
            }}
          >
            {PIPELINE_STAGES.map((s) => {
              const list = presaleByStage[s.key] ?? []
              return (
                <div
                  key={s.key}
                  style={{
                    minHeight: 0,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-md)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '11px 13px',
                      borderBottom: '1px solid var(--line)',
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 99,
                          background: 'var(--accent)',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        className="ui"
                        style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}
                      >
                        {s.name}
                      </span>
                      <span
                        className="num"
                        style={{
                          marginLeft: 'auto',
                          fontSize: 10.5,
                          color: 'var(--ink-faint)',
                          background: 'var(--bg-tint)',
                          padding: '1px 7px',
                          borderRadius: 99,
                        }}
                      >
                        {list.length}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginTop: 5,
                        paddingLeft: 15,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10.5,
                          color: 'var(--ink-faint)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.sub}
                      </span>
                      <span
                        className="num"
                        style={{ fontSize: 10.5, color: 'var(--ink-mute)', flexShrink: 0 }}
                      >
                        {sumWan(list)}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      flex: 1,
                      overflow: 'auto',
                      padding: 11,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    {list.length ? (
                      list.map((p) => (
                        <PipelineCard key={p.id} p={p} onClick={() => goDetail(p.id)} />
                      ))
                    ) : (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'var(--ink-faint)',
                          textAlign: 'center',
                          padding: '18px 0',
                        }}
                      >
                        —
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && !error && cat === 'delivery' && (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 0 26px' }}>
            {/* 交付中 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '8px 6px 10px',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}
              >
                <span
                  style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--good)' }}
                />
                交付中
              </span>
              <span className="num" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                {active.length}
              </span>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              <span className="num" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                {sumWan(active)}
              </span>
            </div>
            <div
              style={{
                ...DELIVERY_GRID,
                padding: '4px 14px 6px',
                fontSize: 10.5,
                color: 'var(--ink-faint)',
              }}
            >
              <span>项目 / 客户</span>
              <span>状态</span>
              <span>进度</span>
              <span>健康</span>
              <span>金额</span>
              <span>更新</span>
            </div>
            {active.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--ink-faint)',
                  padding: '24px 0',
                }}
              >
                — 暂无交付中项目 —
              </div>
            )}
            {active.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => goDetail(p.id)}
                className="row-hov"
                style={{
                  ...DELIVERY_GRID,
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--line-soft)',
                  borderRadius: 'var(--r-md)',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: 'var(--bg-tint)',
                      border: '1px solid var(--line)',
                      color: 'var(--ink-soft)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {firstGlyph(p.client)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span
                        className="ui"
                        style={{
                          fontSize: 13.5,
                          fontWeight: 500,
                          color: 'var(--ink)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.name}
                      </span>
                      {p.memory_stale && (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 99,
                            background: 'var(--warn)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                      {p.client || '—'}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '3px 10px',
                    borderRadius: 99,
                    color: 'var(--good)',
                    background: 'color-mix(in oklch, var(--good) 13%, transparent)',
                    justifySelf: 'start',
                  }}
                >
                  交付中
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>—</span>
                <CxStatus tone="good">正常</CxStatus>
                <span className="num" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  {formatAmountWan(p.contract_amount)}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-soft)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatUpdatedRelative(p.updated_at)}
                </span>
              </button>
            ))}

            {/* 已归档 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '8px 6px 10px',
                marginTop: 18,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: 'var(--ink-faint)',
                  }}
                />
                已归档
              </span>
              <span className="num" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                {archived.length}
              </span>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>
            {archived.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--ink-faint)',
                  padding: '16px 0',
                }}
              >
                — 暂无已归档项目 —
              </div>
            )}
            {archived.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => goDetail(p.id)}
                className="row-hov"
                style={{
                  ...DELIVERY_GRID,
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--line-soft)',
                  borderRadius: 'var(--r-md)',
                  cursor: 'pointer',
                  opacity: 0.8,
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: 'var(--bg-tint)',
                      border: '1px solid var(--line)',
                      color: 'var(--ink-soft)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {firstGlyph(p.client)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="ui"
                      style={{
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: 'var(--ink)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                      {p.client || '—'}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '3px 10px',
                    borderRadius: 99,
                    justifySelf: 'start',
                    color: 'var(--ink-mute)',
                    background: 'var(--bg-tint)',
                  }}
                >
                  已归档
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>已归档</span>
                <span />
                <span className="num" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  {formatAmountWan(p.contract_amount)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                  {formatUpdatedRelative(p.updated_at)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PipelineCard({ p, onClick }: { p: Project; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-hov"
      style={{
        display: 'block',
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '13px 14px',
        cursor: 'pointer',
        textDecoration: 'none',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          className="ui"
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: 'var(--ink)',
            lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as CSSProperties['WebkitBoxOrient'],
          }}
        >
          {p.name}
        </span>
        {p.memory_stale && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: 'var(--warn)',
              flexShrink: 0,
              marginTop: 6,
              boxShadow: '0 0 0 3px color-mix(in oklch, var(--warn) 22%, transparent)',
            }}
          />
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 11.5,
          color: 'var(--ink-mute)',
          marginTop: 6,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 99,
            background: 'var(--bg-tint)',
            border: '1px solid var(--line)',
            color: 'var(--ink-mute)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9.5,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {firstGlyph(p.client)}
        </span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {p.client || '—'} · {formatUpdatedRelative(p.updated_at)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
          marginTop: 12,
          paddingTop: 11,
          borderTop: '1px solid var(--line-soft)',
        }}
      >
        <span
          className="num"
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: p.contract_amount ? 'var(--ink)' : 'var(--ink-faint)',
          }}
        >
          {formatAmountWan(p.contract_amount)}
        </span>
      </div>
    </button>
  )
}
