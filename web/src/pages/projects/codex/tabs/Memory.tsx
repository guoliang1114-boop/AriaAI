import { useMemo, useState } from 'react'
import type { ProjectDetail as ProjectDetailType } from '../../../../types/api'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus } from '../CxPrimitives'
import { CxMemoryRebuildButton, CxMemorySlotEditDialog } from '../CxMemoryActions'
import { formatUpdatedRelative } from '../useProjectsApi'

interface MemoryProps {
  projectId: number
  detail: ProjectDetailType
  refetch: () => Promise<void>
}

/** Structured memory slots — mirrors the backend's _default_project_memory
 * order, with bilingual titles + an icon per the design handoff at
 * direction-codex-project-2.jsx:268+. */
interface SlotMeta {
  key: string
  zh: string
  en: string
  icon: string
  /** How to read the value out of the parsed memory dict:
   *  - 'string': single line
   *  - 'list': flat array of strings
   *  - 'ai_pinned': {ai, pinned} merged into a single list */
  shape: 'string' | 'list' | 'ai_pinned'
}

const SLOT_META: SlotMeta[] = [
  { key: 'project_brief', zh: '项目概述', en: 'Project Brief', icon: 'building', shape: 'string' },
  { key: 'current_objective', zh: '当前目标', en: 'Current Objective', icon: 'target', shape: 'string' },
  { key: 'recent_progress', zh: '近期进展', en: 'Recent Progress', icon: 'check', shape: 'list' },
  { key: 'key_risks', zh: '关键风险', en: 'Key Risks', icon: 'sparkle', shape: 'ai_pinned' },
  { key: 'open_questions', zh: '待确认问题', en: 'Open Questions', icon: 'quote', shape: 'ai_pinned' },
  { key: 'next_actions', zh: '下一步', en: 'Next Steps', icon: 'arrow-right', shape: 'list' },
  { key: 'delivery_signals', zh: '交付信号', en: 'Delivery Signals', icon: 'zap', shape: 'list' },
  { key: 'stakeholder_notes', zh: '干系人提示', en: 'Stakeholder Notes', icon: 'user', shape: 'ai_pinned' },
  { key: 'financial_status', zh: '财务状态', en: 'Financial Status', icon: 'tag', shape: 'string' },
]

interface ReadSlot {
  meta: SlotMeta
  /** A flat preformatted display value. Null when empty so the
   * section is hidden / shown as empty placeholder. */
  body: string | null
  /** Raw items (for list / ai_pinned shapes) so the inline edit
   * dialog can round-trip the original lines. */
  items: string[]
}

interface PinnedBlock {
  key: 'key_risks' | 'open_questions' | 'stakeholder_notes'
  title: string
  tone: 'bad' | 'warn' | 'info'
  items: string[]
}

const PINNED_BLOCKS: Array<{ key: PinnedBlock['key']; title: string; tone: PinnedBlock['tone'] }> = [
  { key: 'key_risks', title: '风险锚点', tone: 'bad' },
  { key: 'open_questions', title: '待确认问题', tone: 'warn' },
  { key: 'stakeholder_notes', title: '干系人提示', tone: 'info' },
]

function trimStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((s): s is string => !!s)
}

function readMemoryDict(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function readSlotItems(memory: Record<string, unknown>, meta: SlotMeta): string[] {
  const value = memory[meta.key]
  if (meta.shape === 'string') {
    return typeof value === 'string' && value.trim() ? [value.trim()] : []
  }
  if (meta.shape === 'list') {
    return trimStringList(value)
  }
  // ai_pinned shape — merge pinned then ai
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    return [...trimStringList(obj.pinned), ...trimStringList(obj.ai)]
  }
  if (Array.isArray(value)) {
    return trimStringList(value)
  }
  return []
}

function readPinned(memory: Record<string, unknown>, key: PinnedBlock['key']): string[] {
  const value = memory[key]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return trimStringList((value as Record<string, unknown>).pinned)
  }
  return []
}

function formatSlotBody(items: string[], shape: SlotMeta['shape']): string | null {
  if (items.length === 0) return null
  if (shape === 'string') return items[0]
  return items.map((s) => `· ${s}`).join('\n')
}

/** Backend stores a `_coverage` object on the memory dict — keys are
 * slot names, values are 0..1 floats expressing how confident the LLM
 * was. Compute a 0..100 completeness score from filled slots * any
 * coverage hints. */
function computeHealth(memory: Record<string, unknown> | null, slots: ReadSlot[]) {
  const total = SLOT_META.length
  const filled = slots.filter((s) => s.items.length > 0).length
  const coverage = memory?._coverage as Record<string, number> | undefined
  let coverageScore = 0
  let coverageDenom = 0
  if (coverage) {
    for (const k of Object.keys(coverage)) {
      const v = Number(coverage[k])
      if (Number.isFinite(v)) {
        coverageScore += Math.max(0, Math.min(1, v))
        coverageDenom += 1
      }
    }
  }
  const coverageRatio = coverageDenom > 0 ? coverageScore / coverageDenom : filled / Math.max(total, 1)
  const score = Math.round(coverageRatio * 100)
  return { score, filled, total }
}

export function CxProjectMemory({ projectId, detail, refetch }: MemoryProps) {
  const { project } = detail
  const stale = !!project.memory_stale
  const [editingSlot, setEditingSlot] = useState<{ key: string; value: string } | null>(null)

  const memory = useMemo(() => readMemoryDict(project.context_memory_json), [project.context_memory_json])

  const slots: ReadSlot[] = useMemo(() => {
    if (!memory) return []
    return SLOT_META.map((meta) => {
      const items = readSlotItems(memory, meta)
      return { meta, items, body: formatSlotBody(items, meta.shape) }
    })
  }, [memory])

  const pinned: PinnedBlock[] = useMemo(() => {
    if (!memory) return []
    return PINNED_BLOCKS.map(({ key, title, tone }) => ({
      key,
      title,
      tone,
      items: readPinned(memory, key),
    })).filter((b) => b.items.length > 0)
  }, [memory])

  const pinnedTotal = pinned.reduce((s, b) => s + b.items.length, 0)
  const health = useMemo(() => computeHealth(memory, slots), [memory, slots])

  return (
    <CxProjectShell activeTab="memory" projectId={projectId} project={project}>
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
          {/* Header strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div>
                <div className="ui" style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500 }}>
                  项目记忆 {project.memory_version != null ? `v${project.memory_version}` : '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>
                  {project.memory_updated_at
                    ? `更新于 ${formatUpdatedRelative(project.memory_updated_at)}`
                    : '尚未建立记忆'}
                  {memory && pinnedTotal > 0 ? ` · ${pinnedTotal} 个锚点` : ''}
                </div>
              </div>
              {project.memory_version != null && (
                <CxStatus tone={stale ? 'warn' : 'good'}>
                  {stale ? '需刷新' : '已同步'}
                </CxStatus>
              )}
              {project.memory_rebuild_status && project.memory_rebuild_status !== 'idle' && (
                <CxStatus tone="accent" pulse>
                  {project.memory_rebuild_status}
                </CxStatus>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <CxMemoryRebuildButton projectId={projectId} onTriggered={refetch} />
            </div>
          </div>

          {/* Pinned anchors block — only when there ARE pinned items so we
           * don't render an empty highlight card. */}
          {pinned.length > 0 && (
            <div
              style={{
                background: 'linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)',
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
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--accent)', fontSize: 13 }}>★</span>
                  <h3
                    className="ui"
                    style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}
                  >
                    固定锚点 · {pinnedTotal} 项
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                    会优先参与 AI 总结、风险判断与会前简报
                  </span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                {pinned.map((g) => {
                  const c =
                    g.tone === 'bad'
                      ? 'var(--bad)'
                      : g.tone === 'warn'
                        ? 'var(--warn)'
                        : 'var(--info)'
                  return (
                    <div key={g.key}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                        <span style={{ width: 5, height: 5, borderRadius: 99, background: c }} />
                        <span
                          style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500 }}
                        >
                          {g.title}
                        </span>
                        <span
                          className="num"
                          style={{
                            fontSize: 11,
                            color: c,
                            fontWeight: 500,
                            marginLeft: 'auto',
                          }}
                        >
                          {g.items.length}
                        </span>
                      </div>
                      {g.items.map((t, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: 7,
                            padding: '4px 0',
                            alignItems: 'flex-start',
                          }}
                        >
                          <span
                            style={{
                              width: 3,
                              height: 3,
                              marginTop: 7,
                              borderRadius: 99,
                              background: c,
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
                            {t}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Section divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--ink-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              结构化记忆 · Structured Memory
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--line-soft)' }} />
          </div>

          {!memory ? (
            <CxPanel title="尚未建立结构化记忆">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.7 }}>
                项目还没有结构化记忆。在「项目对话」中讨论后,系统会自动抽取关键信息形成槽位;
                也可点右上「重新汇总」让 AI 立即从已有数据生成一份。
              </p>
              {project.context_summary && (
                <div
                  style={{
                    marginTop: 14,
                    padding: '12px 14px',
                    background: 'var(--bg-tint)',
                    borderRadius: 'var(--r-sm)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4 }}>
                    当前自动摘要
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>
                    {project.context_summary}
                  </div>
                </div>
              )}
            </CxPanel>
          ) : (
            slots.map((s) => (
              <SlotSection
                key={s.meta.key}
                slot={s}
                onEdit={() =>
                  setEditingSlot({
                    key: s.meta.key,
                    value: s.items.join('\n'),
                  })
                }
              />
            ))
          )}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel title="记忆健康度">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginBottom: 4 }}>
                  完整度
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                  <span
                    className="num"
                    style={{ fontSize: 22, color: 'var(--ink)', fontWeight: 500 }}
                  >
                    {health.score}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>/ 100</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginBottom: 4 }}>
                  新鲜度
                </div>
                <CxStatus tone={stale ? 'warn' : 'good'}>
                  {project.memory_updated_at
                    ? formatUpdatedRelative(project.memory_updated_at)
                    : '—'}
                </CxStatus>
              </div>
            </div>
            <div
              style={{
                paddingTop: 10,
                borderTop: '1px solid var(--line-soft)',
                fontSize: 12.5,
                color: 'var(--ink-soft)',
                lineHeight: 1.85,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>已填写槽位</span>
                <span className="num">
                  {health.filled} / {health.total}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>固定锚点</span>
                <span className="num" style={{ color: pinnedTotal > 0 ? 'var(--accent)' : 'var(--ink-mute)' }}>
                  {pinnedTotal}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>版本</span>
                <span className="num">
                  {project.memory_version != null ? `v${project.memory_version}` : '—'}
                </span>
              </div>
            </div>
          </CxPanel>

          <CxPanel
            title="重建状态"
            subtitle={project.memory_rebuild_status ?? 'idle'}
          >
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: 'var(--ink-soft)',
                lineHeight: 1.7,
              }}
            >
              {project.memory_rebuild_failed_at
                ? `上次重建失败于 ${formatUpdatedRelative(project.memory_rebuild_failed_at)},可重试。`
                : '点击右上「重新汇总」让 AI 综合最新对话与文档,重新写入结构化记忆。'}
            </p>
          </CxPanel>
        </aside>
      </div>

      <CxMemorySlotEditDialog
        open={editingSlot !== null}
        projectId={projectId}
        slotName={editingSlot?.key ?? null}
        initialValue={editingSlot?.value ?? ''}
        onClose={() => setEditingSlot(null)}
        onSaved={refetch}
      />
    </CxProjectShell>
  )
}

interface SlotSectionProps {
  slot: ReadSlot
  onEdit: () => void
}

function SlotSection({ slot, onEdit }: SlotSectionProps) {
  const { meta, items, body } = slot
  const empty = items.length === 0
  return (
    <section
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
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 'var(--r-sm)',
              background: empty ? 'var(--bg-tint)' : 'var(--accent-bg)',
              color: empty ? 'var(--ink-mute)' : 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CxIcon name={meta.icon} size={13} />
          </span>
          <h3
            className="ui"
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink)',
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
            }}
          >
            <span>{meta.zh}</span>
            <span
              style={{ fontSize: 11.5, color: 'var(--ink-faint)', fontWeight: 400 }}
            >
              · {meta.en}
            </span>
          </h3>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={onEdit}
            style={{ fontSize: 12, color: 'var(--accent)', padding: '4px 8px' }}
          >
            {empty ? '+ 补充' : '编辑'}
          </button>
        </div>
      </div>
      {empty ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
          暂未填写。点「补充」手动添加,或通过项目对话沉淀后让 AI 自动写入。
        </p>
      ) : meta.shape === 'string' ? (
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: 'var(--ink)',
            lineHeight: 1.75,
            whiteSpace: 'pre-wrap',
          }}
        >
          {body}
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((t, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                padding: '5px 0',
                fontSize: 13.5,
                color: 'var(--ink)',
                lineHeight: 1.65,
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  marginTop: 9,
                  borderRadius: 99,
                  background: 'var(--accent)',
                  flexShrink: 0,
                }}
              />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
