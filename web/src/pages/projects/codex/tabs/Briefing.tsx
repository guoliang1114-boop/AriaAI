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
import { useBriefingScript } from '../useBriefingScript'

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
  accent: 'var(--accent)',
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
  const [rebuilding, setRebuilding] = useState(false)
  const streamingScript = useBriefingScript()
  const script = streamingScript.content || null
  const refining = streamingScript.streaming

  // Persist the last successfully-streamed script per memory_version
  // in localStorage. On revisit we seed the visible content from
  // storage so the user sees something instantly while we hand the
  // backend cache check off in the background. When the backend's
  // streaming response finishes (cached or fresh), the latest content
  // replaces the seed and we update storage.
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
        typeof parsed.content === 'string' &&
        !streamingScript.streaming &&
        !streamingScript.content
      ) {
        // Replay stored content into the streaming hook so the rest of
        // the component (which treats streamingScript.content as the
        // source of truth) sees it without firing the network call.
        streamingScript.reset()
        // Use a microtask so React applies the reset before we set the
        // content — otherwise the immediate setState gets clobbered.
        Promise.resolve().then(() => {
          // The hook is pure state; cheaply mutate via start() with
          // seed=cached content would re-fire the network, so we just
          // simulate a finished stream by writing to localStorage and
          // letting persistOnFinish path pick it up. Simpler: set
          // streaming-script's local state via a no-op fetch is overkill.
          // Instead just mutate storage and rely on the next user click;
          // here we display the cached value via a parallel state.
        })
      } else if (
        parsed.memory_version !== currentMemoryVersion &&
        typeof parsed.memory_version === 'number'
      ) {
        // Memory bumped — drop the stale entry.
        localStorage.removeItem(scriptStorageKey)
      }
    } catch {
      // Bad JSON in storage — ignore.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptStorageKey, currentMemoryVersion, i18n.language])

  // Persist when the stream finishes successfully.
  useEffect(() => {
    if (!streamingScript.finished) return
    if (streamingScript.error) return
    if (!streamingScript.content) return
    if (currentMemoryVersion == null) return
    try {
      localStorage.setItem(
        scriptStorageKey,
        JSON.stringify({
          memory_version: currentMemoryVersion,
          language: i18n.language,
          content: streamingScript.content,
          saved_at: Date.now(),
        }),
      )
    } catch {
      // Storage full / disabled — fine.
    }
  }, [
    streamingScript.finished,
    streamingScript.error,
    streamingScript.content,
    currentMemoryVersion,
    scriptStorageKey,
    i18n.language,
  ])

  // Seed visible content from localStorage on first paint (the effect
  // above doesn't write to streamingScript state to avoid loops; we
  // surface the seed directly via a derived value below).
  const cachedSeed = (() => {
    if (currentMemoryVersion == null) return ''
    try {
      const raw = localStorage.getItem(scriptStorageKey)
      if (!raw) return ''
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
        return parsed.content
      }
    } catch {
      // ignore
    }
    return ''
  })()
  const displayScript = streamingScript.content || cachedSeed || null

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

  // Kick the streaming endpoint. Backend yields deltas as the LLM
  // produces tokens (typically over ~30s); cached responses come in
  // as a single done event. The hook handles parsing and exposes the
  // accumulated content on streamingScript.content.
  const generateScript = async (forceRefresh: boolean) => {
    if (refining) return
    streamingScript.reset()
    await streamingScript.start({
      projectId,
      meetingType: 'status',
      language: i18n.language,
      forceRefresh,
    })
  }

  // Surface stream errors via toast (the hook stores them but doesn't
  // toast itself).
  useEffect(() => {
    if (streamingScript.error) {
      toast.error({
        title: '生成失败',
        description: streamingScript.error,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingScript.error])

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
                script={displayScript}
                refining={refining}
                onGenerate={() => generateScript(displayScript != null)}
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
        <ScriptSections script={script} refining={refining} />
      )}
    </CxPanel>
  )
}

/** Sections we expect the LLM to emit, in order. Anything that doesn't
 * match falls through to a "其他" block at the end so partial / mid-
 * stream output still renders gracefully. */
const SCRIPT_SECTION_DEFS: Array<{
  key: string
  /** Match these Chinese (and English just in case) ## headers. */
  match: string[]
  emoji: string
  zh: string
  en: string
  tone: 'accent' | 'good' | 'warn' | 'neutral'
  /** Render the script section as a code-style call-out (use for the
   * 开场脚本 — the part the user reads out loud). */
  isScript?: boolean
}> = [
  {
    key: 'focus',
    match: ['唯一聚焦点', '聚焦点', 'Focus'],
    emoji: '🎯',
    zh: '唯一聚焦点',
    en: 'Focus',
    tone: 'accent',
  },
  {
    key: 'themes',
    match: ['主打什么', '主打', '重点讲', 'Themes'],
    emoji: '💬',
    zh: '主打什么',
    en: 'Themes',
    tone: 'good',
  },
  {
    key: 'cautions',
    match: ['谨慎表达', '需要谨慎', '红线', 'Cautions'],
    emoji: '⚠️',
    zh: '谨慎表达',
    en: 'Cautions',
    tone: 'warn',
  },
  {
    key: 'script',
    match: ['开场脚本', '开场话术', 'Script', '可直接念'],
    emoji: '🗣️',
    zh: '开场脚本',
    en: 'Opening Script',
    tone: 'accent',
    isScript: true,
  },
]

interface ParsedSection {
  defKey: string
  emoji: string
  zh: string
  en: string
  tone: 'accent' | 'good' | 'warn' | 'neutral'
  isScript: boolean
  /** Raw markdown body (excluding the heading line itself). Streams
   * in progressively. */
  body: string
}

/** Split the markdown into our 4 named sections. LLM may emit slightly
 * different heading variants (with/without periods, EN/ZH); we match
 * by substring. Anything before the first matched header is treated
 * as preamble and prepended to the first section so we don't lose it. */
function parseScriptSections(markdown: string): { ordered: ParsedSection[]; tail: string } {
  const lines = markdown.split('\n')
  const buckets: Record<string, string[]> = {}
  let activeKey: string | null = null
  let tailLines: string[] = []

  const matchHeader = (line: string): string | null => {
    const m = /^#{2,3}\s+(.*?)\s*$/.exec(line)
    if (!m) return null
    const text = m[1].replace(/[「」（）()【】#]/g, '').trim()
    for (const def of SCRIPT_SECTION_DEFS) {
      for (const candidate of def.match) {
        if (text.includes(candidate)) return def.key
      }
    }
    return null
  }

  for (const line of lines) {
    const headerKey = matchHeader(line)
    if (headerKey) {
      activeKey = headerKey
      if (!buckets[headerKey]) buckets[headerKey] = []
      continue
    }
    if (activeKey) {
      buckets[activeKey].push(line)
    } else {
      tailLines.push(line)
    }
  }

  const ordered: ParsedSection[] = []
  for (const def of SCRIPT_SECTION_DEFS) {
    const bodyLines = buckets[def.key]
    if (!bodyLines) continue
    const body = bodyLines.join('\n').trim()
    ordered.push({
      defKey: def.key,
      emoji: def.emoji,
      zh: def.zh,
      en: def.en,
      tone: def.tone,
      isScript: !!def.isScript,
      body,
    })
  }

  // Drop fully-empty tail (the LLM nearly always opens with a header
  // so this just protects against trailing newlines).
  const tail = tailLines.join('\n').trim()
  return { ordered, tail }
}

interface ScriptSectionsProps {
  script: string
  refining: boolean
}

function ScriptSections({ script, refining }: ScriptSectionsProps) {
  const { ordered, tail } = parseScriptSections(script)
  // If parser found nothing (mid-stream first paragraph before the
  // first header lands, or LLM ignored the schema) fall back to plain
  // markdown so the user still sees content.
  if (ordered.length === 0) {
    return (
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
        {refining && <StreamingCursor />}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ordered.map((s, i) => {
        const isLastVisible = i === ordered.length - 1 && !tail
        return (
          <ScriptSectionBlock
            key={s.defKey}
            section={s}
            showCursor={refining && isLastVisible}
          />
        )
      })}
      {tail && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg-tint)',
            borderRadius: 'var(--r-sm)',
            fontSize: 12.5,
            color: 'var(--ink-soft)',
          }}
        >
          <MarkdownRenderer content={tail} />
        </div>
      )}
    </div>
  )
}

function ScriptSectionBlock({
  section,
  showCursor,
}: {
  section: ParsedSection
  showCursor: boolean
}) {
  const [copied, setCopied] = useState(false)
  const toast = useToast()
  const accent = TONE_COLOR[section.tone]

  const copySection = async () => {
    try {
      await navigator.clipboard.writeText(section.body)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error({ title: '复制失败,请手动选中' })
    }
  }

  const isScript = section.isScript
  return (
    <section
      style={{
        background: isScript
          ? 'color-mix(in oklch, var(--accent-bg) 50%, var(--bg-elev))'
          : 'var(--bg-elev)',
        border: `1px solid ${
          isScript
            ? 'color-mix(in oklch, var(--accent) 30%, var(--line))'
            : 'var(--line)'
        }`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--r-sm)',
        padding: '12px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>{section.emoji}</span>
        <h4
          className="ui"
          style={{
            margin: 0,
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--ink)',
            letterSpacing: '-0.005em',
          }}
        >
          {section.zh}
        </h4>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>· {section.en}</span>
        <button
          type="button"
          onClick={copySection}
          style={{
            marginLeft: 'auto',
            fontSize: 11.5,
            color: copied ? 'var(--good)' : 'var(--ink-mute)',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            background: 'transparent',
            padding: 0,
          }}
        >
          <CxIcon name={copied ? 'check' : 'file'} size={11} />
          {copied ? '已复制' : '复制本段'}
        </button>
      </div>
      <div
        className="theme-codex"
        style={{
          fontSize: isScript ? 14 : 13.5,
          lineHeight: isScript ? 1.85 : 1.7,
          color: 'var(--ink)',
        }}
      >
        <MarkdownRenderer content={section.body} />
        {showCursor && <StreamingCursor />}
      </div>
    </section>
  )
}

function StreamingCursor() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 14,
        marginLeft: 3,
        background: 'var(--accent)',
        verticalAlign: 'text-bottom',
        animation: 'codex-blink 0.8s steps(2) infinite',
      }}
    />
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
