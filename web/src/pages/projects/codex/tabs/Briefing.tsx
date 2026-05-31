import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectDetail as ProjectDetailType } from '../../../../types/api'
import { api } from '../../../../api/client'
import { useToast } from '../../../../contexts/ToastContext'
import { CxSkeleton } from '../../../../components/codex'
import { MarkdownRenderer } from '../../../../components/MarkdownRenderer'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus } from '../CxPrimitives'
import { firstGlyph, formatUpdatedRelative, useProjectBriefing } from '../useProjectsApi'

interface BriefingProps {
  projectId: number
  detail: ProjectDetailType
}

const CARD_KEYS = [
  { key: 'say' as const, title: '建议说什么', en: 'Say', tone: 'good' as const },
  { key: 'avoid' as const, title: '尽量避开', en: 'Avoid', tone: 'warn' as const },
  { key: 'confirm' as const, title: '需要确认', en: 'Confirm', tone: 'neutral' as const },
  { key: 'experience' as const, title: '历史经验', en: 'Lessons', tone: 'info' as const },
]

const TONE_COLOR = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  neutral: 'var(--ink-soft)',
  info: 'var(--info)',
} as const

const TWO_COL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 320px',
  gap: 20,
  minWidth: 0,
}

export function CxProjectBriefing({ projectId, detail }: BriefingProps) {
  const { project } = detail
  const { data: briefing, loading, error, refetch } = useProjectBriefing(projectId)
  const toast = useToast()
  const { i18n } = useTranslation()
  const [refining, setRefining] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [script, setScript] = useState<string | null>(null)

  // "Regenerate briefing" is a heavier operation than the GET that
  // backs the page. The briefing is deterministic from the project
  // memory + signals, so to actually change what shows up we kick a
  // memory rebuild (POSTs to /projects/:id/memory/rebuild) and then
  // refetch the briefing once the LLM has had a moment to write the
  // new slot values.
  const regenerateBriefing = async () => {
    if (rebuilding) return
    setRebuilding(true)
    try {
      // Backend's /memory/rebuild is synchronous: it runs the LLM
      // across every slot then returns. Default axios timeout is 15s
      // which is well under the typical 30–90s LLM round-trip, so we
      // bump per-call to 3min and refetch the briefing afterward.
      await api.post(`/projects/${projectId}/memory/rebuild`, {}, { timeout: 180000 })
      toast.success({
        title: '项目记忆已重建',
        description: '简报即将刷新',
      })
      await refetch()
    } catch (err) {
      toast.error({
        title: '重建失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setRebuilding(false)
    }
  }

  // The refine endpoint is cached per (project, meeting_type, language,
  // memory_version). First click renders the cached or freshly-built
  // script; explicit re-clicks pass force_refresh=true so the backend
  // actually re-runs the LLM instead of returning the same content.
  //
  // Language follows the user's current i18n setting — backend's
  // normalize_summary_language() accepts "zh-CN" / "en-US" / etc. and
  // maps them to the right system-prompt branch. Hardcoding 'zh'
  // ignored anyone on an English UI.
  const generateScript = async (forceRefresh: boolean) => {
    if (refining) return
    setRefining(true)
    try {
      const res = await api.post<{ content: string; cached?: boolean }>(
        `/projects/${projectId}/briefing/refine`,
        {
          meeting_type: 'status',
          language: i18n.language,
          force_refresh: forceRefresh,
        },
        // LLM refine endpoint commonly takes 20-60s, well past the
        // 15s default. Bumping per-call to 2min.
        { timeout: 120000 },
      )
      setScript(res.content)
      toast.success({
        title: forceRefresh ? '话术已重新生成' : '话术已生成',
      })
    } catch (err) {
      toast.error({
        title: '生成失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setRefining(false)
    }
  }

  return (
    <CxProjectShell activeTab="briefing" projectId={projectId} project={project}>
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '24px 40px 32px',
          ...TWO_COL,
        }}
      >
        {loading && <BriefingSkeleton />}

        {!loading && error && (
          <CxPanel title="加载失败">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--bad)' }}>{error}</p>
            <button
              type="button"
              onClick={refetch}
              style={{
                marginTop: 12,
                padding: '6px 12px',
                fontSize: 12.5,
                color: 'var(--ink-soft)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
              }}
            >
              重试
            </button>
          </CxPanel>
        )}

        {!loading && !error && briefing && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
              <div
                style={{
                  background: 'linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)',
                  padding: '20px 24px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 6 }}>
                      30 秒会前卡 · 自动生成于 {formatUpdatedRelative(briefing.generated_at)}
                    </div>
                    <h2
                      className="ui"
                      style={{
                        margin: 0,
                        fontSize: 22,
                        fontWeight: 500,
                        color: 'var(--ink)',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {briefing.memory.current_objective ||
                        briefing.memory.project_brief ||
                        '准备下次会议'}
                    </h2>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-soft)' }}>
                      打开就看四件事 — 说什么、避开什么、确认什么、过去的教训
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={refetch}
                      title="拉取最新的简报快照"
                      style={{
                        padding: '7px 10px',
                        fontSize: 12.5,
                        color: 'var(--ink-mute)',
                        background: 'transparent',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 12a9 9 0 1 1-3-6.7" />
                        <path d="M21 3v6h-6" />
                      </svg>
                      刷新
                    </button>
                    <button
                      type="button"
                      onClick={regenerateBriefing}
                      disabled={rebuilding}
                      title="重新跑一次项目记忆汇总,几秒后简报会自动更新"
                      style={{
                        padding: '7px 12px',
                        fontSize: 12.5,
                        color: 'var(--bg-elev)',
                        background: 'var(--accent)',
                        border: '1px solid var(--accent)',
                        borderRadius: 'var(--r-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: rebuilding ? 'wait' : 'pointer',
                        opacity: rebuilding ? 0.7 : 1,
                      }}
                    >
                      <CxIcon name="sparkle" size={12} />{' '}
                      {rebuilding ? '排队中…' : '重新生成'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {CARD_KEYS.map((c) => {
                  const items = briefing.meeting_card[c.key] ?? []
                  const color = TONE_COLOR[c.tone]
                  return (
                    <section
                      key={c.key}
                      style={{
                        background: 'var(--bg-elev)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-md)',
                        padding: '16px 18px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 12,
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: 99, background: color }} />
                        <h3
                          className="ui"
                          style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}
                        >
                          {c.title}
                        </h3>
                        <span style={{ fontSize: 11, color: 'var(--ink-faint)', marginLeft: 4 }}>
                          {c.en}
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <div
                          style={{
                            fontSize: 12.5,
                            color: 'var(--ink-faint)',
                            padding: '6px 0',
                          }}
                        >
                          暂无内容,补充项目记忆后将自动生成。
                        </div>
                      ) : (
                        <ul
                          style={{
                            margin: 0,
                            padding: 0,
                            listStyle: 'none',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}
                        >
                          {items.map((item, i) => (
                            <li
                              key={i}
                              style={{
                                display: 'flex',
                                gap: 10,
                                fontSize: 13,
                                color: 'var(--ink)',
                                lineHeight: 1.6,
                              }}
                            >
                              <span
                                className="num"
                                style={{
                                  fontSize: 11,
                                  color: color,
                                  paddingTop: 2,
                                  fontWeight: 600,
                                }}
                              >
                                {String(i + 1).padStart(2, '0')}
                              </span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )
                })}
              </div>

              <CxPanel
                title="开场话术(AI 生成)"
                subtitle="基于上面四张卡片 + 项目记忆"
                action={
                  <button
                    type="button"
                    onClick={() => generateScript(script != null)}
                    disabled={refining}
                    style={{
                      fontSize: 12,
                      color: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: refining ? 'wait' : 'pointer',
                      opacity: refining ? 0.6 : 1,
                    }}
                  >
                    <CxIcon name="sparkle" size={11} />{' '}
                    {refining ? '生成中…' : script ? '重新生成' : '生成话术'}
                  </button>
                }
              >
                {!script ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--accent-ink)',
                      padding: '14px 16px',
                      background:
                        'color-mix(in oklch, var(--accent-bg) 60%, var(--bg-elev))',
                      border:
                        '1px dashed color-mix(in oklch, var(--accent) 35%, transparent)',
                      borderRadius: 'var(--r-sm)',
                      lineHeight: 1.7,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 'var(--r-sm)',
                        background: 'var(--accent-bg)',
                        color: 'var(--accent)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      <CxIcon name="sparkle" size={12} />
                    </span>
                    <span>
                      点击右上「生成话术」,AI
                      会综合四张卡片 + 客户记忆 + 干系人偏好,产出一段可直接用于会议开场的脚本。
                    </span>
                  </div>
                ) : (
                  <div
                    className="theme-codex"
                    style={{
                      background: 'var(--bg-elev)',
                      borderLeft: '3px solid var(--accent)',
                      padding: '6px 18px 6px 20px',
                      borderRadius: '0 var(--r-sm) var(--r-sm) 0',
                      fontSize: 13.5,
                      lineHeight: 1.8,
                      color: 'var(--ink)',
                    }}
                  >
                    <MarkdownRenderer content={script} />
                  </div>
                )}
              </CxPanel>
            </div>

            <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <CxPanel
                title="关键干系人"
                subtitle={`${briefing.stakeholders.length} 人`}
              >
                {briefing.stakeholders.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '8px 0' }}>
                    暂未录入。
                  </div>
                ) : (
                  briefing.stakeholders.slice(0, 5).map((p, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '9px 0',
                        borderBottom:
                          i === briefing.stakeholders.length - 1
                            ? 'none'
                            : '1px solid var(--line-soft)',
                      }}
                    >
                      <span
                        style={{
                          width: 28,
                          height: 28,
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
                        {firstGlyph(p.name)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            className="ui"
                            style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}
                          >
                            {p.name || '—'}
                          </span>
                          {p.role && (
                            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                              · {p.role}
                            </span>
                          )}
                        </div>
                        {(p.concerns || p.communication_preference) && (
                          <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                            {p.concerns || p.communication_preference}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CxPanel>

              <CxPanel
                title="近期节奏"
                subtitle={`${briefing.signals.upcoming_milestones.length} 个里程碑`}
              >
                {briefing.signals.upcoming_milestones.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '8px 0' }}>
                    暂无即将到来的里程碑。
                  </div>
                ) : (
                  briefing.signals.upcoming_milestones.slice(0, 5).map((m, i, arr) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        gap: 10,
                        padding: '8px 0',
                        borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--line-soft)',
                      }}
                    >
                      <span
                        className="num"
                        style={{
                          fontSize: 11.5,
                          color: i === 0 ? 'var(--accent)' : 'var(--ink-mute)',
                          paddingTop: 1,
                          minWidth: 60,
                        }}
                      >
                        {m.due_date ?? '—'}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div
                          className="ui"
                          style={{
                            fontSize: 13,
                            color: 'var(--ink)',
                            fontWeight: i === 0 ? 500 : 400,
                          }}
                        >
                          {m.title}
                        </div>
                      </div>
                      {i === 0 && (
                        <CxStatus tone="accent" pulse>
                          下次
                        </CxStatus>
                      )}
                    </div>
                  ))
                )}
              </CxPanel>

              <CxPanel
                title="资料依据"
                subtitle={`${briefing.signals.recent_documents.length} 份近期文档`}
              >
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--ink-soft)',
                    lineHeight: 1.85,
                  }}
                >
                  <SourceRow label="项目记忆" value={`v${briefing.project.memory_version}`} />
                  <SourceRow
                    label="记忆刷新"
                    value={formatUpdatedRelative(briefing.project.memory_updated_at)}
                  />
                  <SourceRow label="客户记忆" value={`v${briefing.client.memory_version}`} />
                  <SourceRow
                    label="文档"
                    value={`${briefing.signals.recent_documents.length} 份`}
                  />
                  <SourceRow
                    label="待办"
                    value={`${briefing.signals.pending_todos.length} 项待跟进`}
                  />
                </div>
              </CxPanel>
            </aside>
          </>
        )}
      </div>
    </CxProjectShell>
  )
}

function SourceRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--ink-mute)' }}>{label}</span>
      <span className="num">{value}</span>
    </div>
  )
}

function BriefingSkeleton() {
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            background: 'linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: '20px 24px',
          }}
        >
          <CxSkeleton w={140} h={10} />
          <div style={{ height: 8 }} />
          <CxSkeleton w={300} h={20} />
          <div style={{ height: 6 }} />
          <CxSkeleton w={240} h={10} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <CxSkeleton w={80} h={11} />
              <CxSkeleton w="90%" h={10} />
              <CxSkeleton w="75%" h={10} />
              <CxSkeleton w="85%" h={10} />
            </div>
          ))}
        </div>
      </div>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <CxSkeleton w={100} h={11} />
            <CxSkeleton w={60} h={9} />
            <div style={{ height: 6 }} />
            <CxSkeleton w="90%" h={10} />
            <CxSkeleton w="75%" h={10} />
          </div>
        ))}
      </aside>
    </>
  )
}
