import { useMemo, useState } from 'react'
import type { ProjectDetail as ProjectDetailType } from '../../../../types/api'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus } from '../CxPrimitives'
import {
  CxMemoryAnchorsDialog,
  CxMemoryRebuildButton,
  EDITABLE_SLOT_KEYS,
} from '../CxMemoryActions'
import { formatUpdatedRelative } from '../useProjectsApi'

interface MemoryProps {
  projectId: number
  detail: ProjectDetailType
  refetch: () => Promise<void>
}

/** Slot metadata. The three ai_pinned shapes are the only ones the
 * backend lets the user edit (and edits are limited to managing the
 * pinned array — the AI array is always overwritten on rebuild).
 * Everything else is read-only AI output. */
interface SlotMeta {
  key: string
  zh: string
  en: string
  icon: string
  shape: 'string' | 'list' | 'ai_pinned'
  /** Hint shown in the slot card subtitle to clarify provenance. */
  provenance: string
}

const SLOT_META: SlotMeta[] = [
  {
    key: 'project_brief',
    zh: '项目概述',
    en: 'Project Brief',
    icon: 'building',
    shape: 'string',
    provenance: 'AI 写入',
  },
  {
    key: 'current_objective',
    zh: '当前目标',
    en: 'Current Objective',
    icon: 'target',
    shape: 'string',
    provenance: 'AI 写入',
  },
  {
    key: 'recent_progress',
    zh: '近期进展',
    en: 'Recent Progress',
    icon: 'check',
    shape: 'list',
    provenance: 'AI 写入',
  },
  {
    key: 'key_risks',
    zh: '关键风险',
    en: 'Key Risks',
    icon: 'sparkle',
    shape: 'ai_pinned',
    provenance: 'AI 写入 + 你可固定锚点',
  },
  {
    key: 'open_questions',
    zh: '待确认问题',
    en: 'Open Questions',
    icon: 'quote',
    shape: 'ai_pinned',
    provenance: 'AI 写入 + 你可固定锚点',
  },
  {
    key: 'next_actions',
    zh: '下一步',
    en: 'Next Steps',
    icon: 'arrow-right',
    shape: 'list',
    provenance: 'AI 写入',
  },
  {
    key: 'delivery_signals',
    zh: '交付信号',
    en: 'Delivery Signals',
    icon: 'zap',
    shape: 'list',
    provenance: 'AI 写入',
  },
  {
    key: 'stakeholder_notes',
    zh: '干系人提示',
    en: 'Stakeholder Notes',
    icon: 'user',
    shape: 'ai_pinned',
    provenance: 'AI 写入 + 你可固定锚点',
  },
  {
    key: 'financial_status',
    zh: '财务状态',
    en: 'Financial Status',
    icon: 'tag',
    shape: 'string',
    provenance: 'AI 写入',
  },
]

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

interface SlotData {
  ai: string[]
  pinned: string[]
}

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

function readSlotData(memory: Record<string, unknown>, meta: SlotMeta): SlotData {
  const value = memory[meta.key]
  if (meta.shape === 'string') {
    return {
      ai: typeof value === 'string' && value.trim() ? [value.trim()] : [],
      pinned: [],
    }
  }
  if (meta.shape === 'list') {
    return { ai: trimStringList(value), pinned: [] }
  }
  // ai_pinned
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    return {
      ai: trimStringList(obj.ai),
      pinned: trimStringList(obj.pinned),
    }
  }
  if (Array.isArray(value)) {
    return { ai: trimStringList(value), pinned: [] }
  }
  return { ai: [], pinned: [] }
}

function computeHealth(
  memory: Record<string, unknown> | null,
  slots: Array<{ meta: SlotMeta; data: SlotData }>,
) {
  const total = SLOT_META.length
  const filled = slots.filter((s) => s.data.ai.length + s.data.pinned.length > 0).length
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

  const memory = useMemo(
    () => readMemoryDict(project.context_memory_json),
    [project.context_memory_json],
  )

  const slots = useMemo(() => {
    if (!memory) return [] as Array<{ meta: SlotMeta; data: SlotData }>
    return SLOT_META.map((meta) => ({ meta, data: readSlotData(memory, meta) }))
  }, [memory])

  const pinnedBlocks: PinnedBlock[] = useMemo(() => {
    if (!memory) return []
    return PINNED_BLOCKS.map(({ key, title, tone }) => {
      const v = memory[key]
      const pinned =
        v && typeof v === 'object' && !Array.isArray(v)
          ? trimStringList((v as Record<string, unknown>).pinned)
          : []
      return { key, title, tone, items: pinned }
    }).filter((b) => b.items.length > 0)
  }, [memory])

  const pinnedTotal = pinnedBlocks.reduce((s, b) => s + b.items.length, 0)
  const health = useMemo(() => computeHealth(memory, slots), [memory, slots])

  // Anchor management dialog state — only for the three ai_pinned slots.
  const [activeAnchorSlot, setActiveAnchorSlot] = useState<SlotMeta | null>(null)
  const activeAnchorData =
    activeAnchorSlot && memory ? readSlotData(memory, activeAnchorSlot) : null

  return (
    <CxProjectShell activeTab="memory" projectId={projectId} project={project}>
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '28px 40px 40px',
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 28,
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
          {/* Header strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div>
                <div
                  className="ui"
                  style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}
                >
                  项目记忆 {project.memory_version != null ? `v${project.memory_version}` : '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 3 }}>
                  {project.memory_updated_at
                    ? `更新于 ${formatUpdatedRelative(project.memory_updated_at)}`
                    : '尚未建立记忆'}
                  {memory && pinnedTotal > 0 ? ` · ${pinnedTotal} 个固定锚点` : ''}
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

          {/* Pinned anchors highlight */}
          {pinnedBlocks.length > 0 && (
            <div
              style={{
                background: 'linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                padding: '18px 22px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <span style={{ color: 'var(--accent)', fontSize: 14 }}>★</span>
                <h3
                  className="ui"
                  style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}
                >
                  固定锚点 · {pinnedTotal} 项
                </h3>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                  会优先参与 AI 总结、风险判断与会前简报,重新汇总时不会被覆盖
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {pinnedBlocks.map((g) => {
                  const c =
                    g.tone === 'bad'
                      ? 'var(--bad)'
                      : g.tone === 'warn'
                        ? 'var(--warn)'
                        : 'var(--info)'
                  return (
                    <div key={g.key}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 7,
                          marginBottom: 8,
                        }}
                      >
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
                            gap: 8,
                            padding: '4px 0',
                            alignItems: 'flex-start',
                          }}
                        >
                          <span
                            style={{
                              width: 4,
                              height: 4,
                              marginTop: 7,
                              borderRadius: 99,
                              background: c,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 13,
                              color: 'var(--ink)',
                              lineHeight: 1.6,
                            }}
                          >
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
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0 0' }}
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--ink-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              结构化记忆 · Structured Memory
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--line-soft)' }} />
          </div>

          {!memory ? (
            <CxPanel title="尚未建立结构化记忆">
              <p
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  color: 'var(--ink-soft)',
                  lineHeight: 1.75,
                }}
              >
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
                  <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.7 }}>
                    {project.context_summary}
                  </div>
                </div>
              )}
            </CxPanel>
          ) : (
            slots.map((s) => (
              <SlotSection
                key={s.meta.key}
                meta={s.meta}
                data={s.data}
                onOpenAnchors={() => setActiveAnchorSlot(s.meta)}
              />
            ))
          )}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <CxPanel title="记忆健康度">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginBottom: 4 }}>
                  完整度
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                  <span
                    className="num"
                    style={{ fontSize: 24, color: 'var(--ink)', fontWeight: 500 }}
                  >
                    {health.score}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>/ 100</span>
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
                paddingTop: 12,
                borderTop: '1px solid var(--line-soft)',
                fontSize: 13,
                color: 'var(--ink-soft)',
                lineHeight: 1.95,
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
                <span
                  className="num"
                  style={{ color: pinnedTotal > 0 ? 'var(--accent)' : 'var(--ink-mute)' }}
                >
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

          <CxPanel title="如何修改记忆" subtitle="数据来源 / 编辑边界">
            <ul
              style={{
                margin: 0,
                paddingLeft: 16,
                fontSize: 12.5,
                color: 'var(--ink-soft)',
                lineHeight: 1.95,
              }}
            >
              <li>
                <strong style={{ color: 'var(--ink)' }}>AI 写入</strong>
                的部分:通过项目对话讨论 + 上传文档,然后点「重新汇总」由 AI 重写
              </li>
              <li>
                <strong style={{ color: 'var(--ink)' }}>风险 / 问题 / 干系人</strong>
                三栏:可点「管理锚点」固定你认为重要的条目,重建时会保留
              </li>
              <li>会前简报、项目对话上下文都会读取这里的内容</li>
            </ul>
          </CxPanel>

          {project.memory_rebuild_failed_at && (
            <CxPanel title="上次重建失败">
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: 'var(--bad)',
                  lineHeight: 1.7,
                }}
              >
                {formatUpdatedRelative(project.memory_rebuild_failed_at)} ·
                可点右上「重新汇总」重试
              </p>
            </CxPanel>
          )}
        </aside>
      </div>

      {activeAnchorSlot && activeAnchorData && (
        <CxMemoryAnchorsDialog
          open
          projectId={projectId}
          slotKey={activeAnchorSlot.key}
          title={`管理锚点 · ${activeAnchorSlot.zh}`}
          description={`${activeAnchorSlot.zh} · ${activeAnchorSlot.en}`}
          aiItems={activeAnchorData.ai}
          pinnedItems={activeAnchorData.pinned}
          onClose={() => setActiveAnchorSlot(null)}
          onSaved={refetch}
        />
      )}
    </CxProjectShell>
  )
}

interface SlotSectionProps {
  meta: SlotMeta
  data: SlotData
  onOpenAnchors: () => void
}

function SlotSection({ meta, data, onOpenAnchors }: SlotSectionProps) {
  const empty = data.ai.length + data.pinned.length === 0
  const isAnchorable = EDITABLE_SLOT_KEYS.has(meta.key)

  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '18px 22px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--r-sm)',
              background: empty ? 'var(--bg-tint)' : 'var(--accent-bg)',
              color: empty ? 'var(--ink-mute)' : 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CxIcon name={meta.icon} size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h3
              className="ui"
              style={{
                margin: 0,
                fontSize: 14.5,
                fontWeight: 600,
                color: 'var(--ink)',
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span>{meta.zh}</span>
              <span
                style={{ fontSize: 12, color: 'var(--ink-faint)', fontWeight: 400 }}
              >
                · {meta.en}
              </span>
            </h3>
            <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
              {meta.provenance}
              {isAnchorable && data.pinned.length > 0
                ? ` · ${data.pinned.length} 项已固定`
                : ''}
            </div>
          </div>
        </div>
        {isAnchorable && (
          <button
            type="button"
            onClick={onOpenAnchors}
            style={{
              fontSize: 12.5,
              color: 'var(--accent)',
              padding: '5px 10px',
              border: '1px solid var(--accent-bg)',
              background: 'var(--accent-bg)',
              borderRadius: 'var(--r-sm)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 12 }}>★</span> 管理锚点
          </button>
        )}
      </div>

      {empty ? (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: 'var(--ink-faint)',
            lineHeight: 1.65,
          }}
        >
          {isAnchorable
            ? '暂无内容。可在「管理锚点」里手动添加,或通过项目对话沉淀后让 AI 自动写入。'
            : '暂无内容。通过项目对话讨论或上传文档后,点「重新汇总」让 AI 写入。'}
        </p>
      ) : meta.shape === 'string' ? (
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: 'var(--ink)',
            lineHeight: 1.85,
            whiteSpace: 'pre-wrap',
          }}
        >
          {data.ai[0]}
        </p>
      ) : (
        <>
          {/* Pinned first — they should be visually distinct */}
          {data.pinned.length > 0 && (
            <ul style={{ margin: '0 0 8px', padding: 0, listStyle: 'none' }}>
              {data.pinned.map((t, i) => (
                <li
                  key={`p-${i}`}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '6px 0',
                    fontSize: 13.5,
                    color: 'var(--ink)',
                    lineHeight: 1.7,
                  }}
                >
                  <span
                    style={{
                      color: 'var(--accent)',
                      fontSize: 13,
                      flexShrink: 0,
                      width: 14,
                      textAlign: 'center',
                    }}
                  >
                    ★
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
          {data.ai.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {data.ai.map((t, i) => (
                <li
                  key={`a-${i}`}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '6px 0',
                    fontSize: 13.5,
                    color: 'var(--ink)',
                    lineHeight: 1.7,
                  }}
                >
                  <span
                    style={{
                      width: 4,
                      height: 4,
                      marginTop: 10,
                      borderRadius: 99,
                      background: 'var(--ink-mute)',
                      flexShrink: 0,
                    }}
                  />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
