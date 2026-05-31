import { useState } from 'react'
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

function readSlots(raw: string | null | undefined): Array<{ key: string; value: string }> {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const out: Array<{ key: string; value: string }> = []
    for (const [k, v] of Object.entries(parsed)) {
      const text = stringify(v)
      if (text) out.push({ key: k, value: text })
    }
    return out
  } catch {
    return []
  }
}

function stringify(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    const parts = v.map(stringify).filter((s): s is string => !!s)
    return parts.length ? parts.join(' · ') : null
  }
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => {
        const s = stringify(val)
        return s ? `${k}: ${s}` : null
      })
      .filter((s): s is string => !!s)
      .join(' · ') || null
  }
  return null
}

export function CxProjectMemory({ projectId, detail, refetch }: MemoryProps) {
  const { project } = detail
  const slots = readSlots(project.context_memory_json)
  const stale = !!project.memory_stale
  const [editingSlot, setEditingSlot] = useState<{ key: string; value: string } | null>(
    null,
  )

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
          {/* Memory header strip */}
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
                <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                  项目记忆 {project.memory_version != null ? `v${project.memory_version}` : '—'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                  {project.memory_updated_at
                    ? `更新于 ${formatUpdatedRelative(project.memory_updated_at)}`
                    : '尚未建立记忆'}
                </div>
              </div>
              {project.memory_version != null && (
                <CxStatus tone={stale ? 'warn' : 'good'}>
                  {stale ? '需刷新' : '已同步'}
                </CxStatus>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <CxMemoryRebuildButton projectId={projectId} onTriggered={refetch} />
            </div>
          </div>

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
              结构化记忆
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--line-soft)' }} />
          </div>

          {slots.length === 0 ? (
            <CxPanel title="尚未建立结构化记忆">
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  lineHeight: 1.7,
                }}
              >
                项目还没有结构化记忆。在「项目对话」中讨论后,系统会自动抽取关键信息形成槽位;
                也可手动添加。
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
              <section
                key={s.key}
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
                        background: 'var(--accent-bg)',
                        color: 'var(--accent)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CxIcon name="sparkle" size={13} />
                    </span>
                    <h3
                      className="ui"
                      style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}
                    >
                      {s.key}
                    </h3>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => setEditingSlot(s)}
                      style={{ fontSize: 11.5, color: 'var(--accent)', padding: '4px 8px' }}
                    >
                      编辑
                    </button>
                  </div>
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13.5,
                    color: 'var(--ink)',
                    lineHeight: 1.75,
                  }}
                >
                  {s.value}
                </p>
              </section>
            ))
          )}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel title="记忆健康度">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4 }}>槽位数</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                  <span
                    className="num"
                    style={{ fontSize: 22, color: 'var(--ink)', fontWeight: 500 }}
                  >
                    {slots.length}
                  </span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4 }}>新鲜度</div>
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
                fontSize: 12,
                color: 'var(--ink-soft)',
                lineHeight: 1.7,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>版本</span>
                <span className="num">
                  {project.memory_version != null ? `v${project.memory_version}` : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>状态</span>
                <span className="num">{project.memory_rebuild_status ?? '—'}</span>
              </div>
            </div>
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
