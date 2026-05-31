import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectDetail as ProjectDetailType } from '../../../../types/api'
import { api } from '../../../../api/client'
import { useToast } from '../../../../contexts/ToastContext'
import { CxSkeleton } from '../../../../components/codex'
import { MarkdownRenderer } from '../../../../components/MarkdownRenderer'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus } from '../CxPrimitives'
import { STATUS_LABEL, firstGlyph, formatUpdatedRelative, useProjectBriefing } from '../useProjectsApi'

const CARD_FOLD_THRESHOLD = 4

interface FocusChip {
  label: string
  value: string
  tone: 'accent' | 'warn' | 'good' | 'neutral'
}

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

  // Persist the last generated script per memory_version in localStorage
  // so the user doesn't see an empty placeholder on every revisit. The
  // backend caches by (project, meeting_type, language, memory_version)
  // too — this is just the UI-side mirror so we don't even have to ask.
  // When memory_version bumps (someone clicked 重新生成), the stored
  // script is dropped automatically.
  const scriptStorageKey = `cx:briefing-script:${projectId}`
  const currentMemoryVersion = briefing?.project.memory_version ?? null

  useEffect(() => {
    if (currentMemoryVersion == null) return
    try {
      const raw = localStorage.getItem(scriptStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        memory_version?: number
        language?: string
        content?: string
      }
      if (
        parsed.memory_version === currentMemoryVersion &&
        parsed.language === i18n.language &&
        typeof parsed.content === 'string'
      ) {
        setScript(parsed.content)
      } else if (parsed.memory_version !== currentMemoryVersion) {
        // Memory has been rebuilt — old script no longer reflects it.
        localStorage.removeItem(scriptStorageKey)
        setScript(null)
      }
    } catch {
      // Bad JSON in storage — just ignore it.
    }
  }, [scriptStorageKey, currentMemoryVersion, i18n.language])

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
      if (currentMemoryVersion != null) {
        try {
          localStorage.setItem(
            scriptStorageKey,
            JSON.stringify({
              memory_version: currentMemoryVersion,
              language: i18n.language,
              content: res.content,
              saved_at: Date.now(),
            }),
          )
        } catch {
          // Storage full / disabled — fine, we still have it in state.
        }
      }
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

        {!loading && !error && briefing && (() => {
          // Derive 会议指北 chips from the deterministic briefing data so
          // the user can read the meeting tenor in 3 seconds without
          // wading through the cards.
          const statusLabel =
            STATUS_LABEL[briefing.project.status as keyof typeof STATUS_LABEL] ??
            briefing.project.status
          const objectiveShort = briefing.memory.current_objective?.trim() || '—'
          const riskCount = briefing.memory.key_risks?.length ?? 0
          const focusChips: FocusChip[] = [
            { label: '阶段', value: statusLabel || '—', tone: 'accent' },
            { label: '目标', value: clampInline(objectiveShort, 24), tone: 'neutral' },
            {
              label: '风险',
              value: riskCount > 0 ? `${riskCount} 项需注意` : '无标注',
              tone: riskCount > 0 ? 'warn' : 'good',
            },
          ]
          return (
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
                  <div style={{ minWidth: 0, flex: 1 }}>
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
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as CSSProperties['WebkitBoxOrient'],
                        overflow: 'hidden',
                        lineHeight: 1.35,
                      }}
                    >
                      {briefing.memory.current_objective ||
                        briefing.memory.project_brief ||
                        '准备下次会议'}
                    </h2>
                    {/* 会议指北 chip row */}
                    <div
                      style={{
                        marginTop: 12,
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      {focusChips.map((c) => (
                        <FocusChipBadge key={c.label} chip={c} />
                      ))}
                    </div>
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

              {/* Cards now flow as a single column — no more forced
               * equal-height 2-col grid that left one side empty.
               * Empty cards render as a compact single-line note row
               * so they don't take a full card slot. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(() => {
                  const cardsWithItems = CARD_KEYS.map((c) => ({
                    cfg: c,
                    items: briefing.meeting_card[c.key] ?? [],
                  }))
                  const emptyCards = cardsWithItems.filter((c) => c.items.length === 0)
                  const filledCards = cardsWithItems.filter((c) => c.items.length > 0)
                  return (
                    <>
                      {filledCards.map(({ cfg, items }) => (
                        <MeetingCard key={cfg.key} cfg={cfg} items={items} />
                      ))}
                      {emptyCards.length > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 8,
                            padding: '10px 14px',
                            border: '1px dashed var(--line)',
                            borderRadius: 'var(--r-sm)',
                            background: 'transparent',
                            fontSize: 12.5,
                            color: 'var(--ink-mute)',
                          }}
                        >
                          <span style={{ color: 'var(--ink-faint)' }}>暂无内容:</span>
                          {emptyCards.map((c) => (
                            <span key={c.cfg.key} style={{ color: 'var(--ink-soft)' }}>
                              {c.cfg.title}
                            </span>
                          ))}
                          <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)' }}>
                            补充项目记忆后会自动生成
                          </span>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>

              <ScriptPanel
                script={script}
                refining={refining}
                onGenerate={() => generateScript(script != null)}
              />
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
          )
        })()}
      </div>
    </CxProjectShell>
  )
}

/** Short helper — trim a string to N chars and ellipsis-suffix it
 * without breaking mid-word for the few inline contexts that need it.
 * Used by the 会议指北 chips so a 100-char objective doesn't blow up
 * the row. */
function clampInline(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function FocusChipBadge({ chip }: { chip: FocusChip }) {
  const tone =
    chip.tone === 'accent'
      ? { bg: 'var(--accent-bg)', fg: 'var(--accent-ink)' }
      : chip.tone === 'warn'
        ? {
            bg: 'color-mix(in oklch, var(--warn) 14%, var(--bg-elev))',
            fg: 'var(--warn)',
          }
        : chip.tone === 'good'
          ? {
              bg: 'color-mix(in oklch, var(--good) 14%, var(--bg-elev))',
              fg: 'var(--good)',
            }
          : { bg: 'var(--bg-elev)', fg: 'var(--ink-soft)' }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 12,
        background: tone.bg,
        color: tone.fg,
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-pill)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 11, opacity: 0.7 }}>{chip.label}</span>
      <span style={{ fontWeight: 500 }}>{chip.value}</span>
    </span>
  )
}

interface MeetingCardCfg {
  key: 'say' | 'avoid' | 'confirm' | 'experience'
  title: string
  en: string
  tone: 'good' | 'warn' | 'neutral' | 'info'
}

function MeetingCard({ cfg, items }: { cfg: MeetingCardCfg; items: string[] }) {
  const color = TONE_COLOR[cfg.tone]
  const [expanded, setExpanded] = useState(false)
  const folded = !expanded && items.length > CARD_FOLD_THRESHOLD
  const visible = folded ? items.slice(0, CARD_FOLD_THRESHOLD) : items
  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '14px 18px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 99, background: color }} />
        <h3
          className="ui"
          style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}
        >
          {cfg.title}
        </h3>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)', marginLeft: 4 }}>
          {cfg.en}
        </span>
        <span
          className="num"
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: 'var(--ink-faint)',
          }}
        >
          {items.length}
        </span>
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {visible.map((item, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              fontSize: 13,
              color: 'var(--ink)',
              lineHeight: 1.55,
            }}
          >
            <span
              className="num"
              style={{
                fontSize: 11,
                color: color,
                paddingTop: 2,
                fontWeight: 600,
                minWidth: 18,
                flexShrink: 0,
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {items.length > CARD_FOLD_THRESHOLD && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: 8,
            padding: '2px 0',
            fontSize: 11.5,
            color: 'var(--ink-mute)',
            background: 'transparent',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {folded ? `展开剩余 ${items.length - CARD_FOLD_THRESHOLD} 项` : '收起'}
          <span style={{ fontSize: 9 }}>{folded ? '▾' : '▴'}</span>
        </button>
      )}
    </section>
  )
}

interface ScriptPanelProps {
  script: string | null
  refining: boolean
  onGenerate: () => void
}

function ScriptPanel({ script, refining, onGenerate }: ScriptPanelProps) {
  const [copied, setCopied] = useState(false)
  const toast = useToast()
  const handleCopy = async () => {
    if (!script) return
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error({ title: '复制失败,请手动选中' })
    }
  }
  return (
    <CxPanel
      title="开场话术(AI 生成)"
      subtitle="基于上面四张卡片 + 项目记忆 · 可直接用于会议开场"
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          {script && (
            <button
              type="button"
              onClick={handleCopy}
              style={{
                fontSize: 12,
                color: copied ? 'var(--good)' : 'var(--ink-mute)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'transparent',
              }}
            >
              <CxIcon name={copied ? 'check' : 'file'} size={11} />
              {copied ? '已复制' : '复制'}
            </button>
          )}
          <button
            type="button"
            onClick={onGenerate}
            disabled={refining}
            style={{
              fontSize: 12,
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: refining ? 'wait' : 'pointer',
              opacity: refining ? 0.6 : 1,
              background: 'transparent',
            }}
          >
            <CxIcon name="sparkle" size={11} />{' '}
            {refining ? '生成中…' : script ? '重新生成' : '生成话术'}
          </button>
        </div>
      }
    >
      {refining && !script ? (
        <ScriptGeneratingState />
      ) : !script ? (
        <div
          style={{
            fontSize: 13,
            color: 'var(--accent-ink)',
            padding: '14px 16px',
            background: 'color-mix(in oklch, var(--accent-bg) 60%, var(--bg-elev))',
            border: '1px dashed color-mix(in oklch, var(--accent) 35%, transparent)',
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
            点击右上「生成话术」,AI 会综合四张卡片 + 客户记忆 +
            干系人偏好,产出一段可直接用于会议开场的脚本(约 30-60s,你可以一边看一边等)。
          </span>
        </div>
      ) : (
        <div
          className="theme-codex"
          style={{
            background: 'var(--bg-elev)',
            borderLeft: '3px solid var(--accent)',
            padding: '4px 18px 8px 20px',
            borderRadius: '0 var(--r-sm) var(--r-sm) 0',
            fontSize: 13.5,
            lineHeight: 1.85,
            color: 'var(--ink)',
          }}
        >
          <MarkdownRenderer content={script} />
        </div>
      )}
    </CxPanel>
  )
}

/** Filled while we're waiting on the (non-streamed) refine endpoint
 * to come back. Without this the panel just stays on the empty card
 * for 30-60s and feels frozen. */
function ScriptGeneratingState() {
  return (
    <div
      style={{
        padding: '18px 20px',
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: '0 var(--r-sm) var(--r-sm) 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 14,
          fontSize: 13,
          color: 'var(--accent-ink)',
        }}
      >
        <span className="dot-pulse" style={{ display: 'inline-flex' }}>
          <CxIcon name="sparkle" size={14} />
        </span>
        AI 正在综合上面的卡片 + 项目记忆,通常 30-60 秒…
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {['92%', '78%', '85%', '60%', '70%', '50%'].map((w, i) => (
          <CxSkeleton key={i} w={w} h={10} />
        ))}
      </div>
    </div>
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
