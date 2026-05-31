import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'

/** Memory tab actions. Backend constraints:
 *  - POST /projects/:id/memory/rebuild — synchronous, kicks the LLM
 *    across every slot, takes 30-90s.
 *  - PATCH /projects/:id/memory/slots/:slot_name — ONLY accepts
 *    `{ pinned: string[] }`, and ONLY works on three slots:
 *    key_risks, open_questions, stakeholder_notes.
 *
 * That is: the user can't directly edit free-form slots like
 * project_brief / current_objective — those are AI-only. The
 * editable surface is "manage which items survive rebuilds" on the
 * three risk-y slots, via the pinned array. We expose that as an
 * "锚点管理" dialog with separate AI-suggestion and user-pinned
 * sections (see CxMemoryAnchorsDialog below). */

export const EDITABLE_SLOT_KEYS = new Set([
  'key_risks',
  'open_questions',
  'stakeholder_notes',
])

interface RebuildButtonProps {
  projectId: number
  onTriggered: () => void | Promise<void>
}

export function CxMemoryRebuildButton({ projectId, onTriggered }: RebuildButtonProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      // Backend's /memory/rebuild is synchronous (runs the LLM across
      // every slot before returning); default 15s axios timeout would
      // fire before the model finishes. Bump per-call to 3min.
      await api.post(`/projects/${projectId}/memory/rebuild`, {}, { timeout: 180000 })
      toast.success({
        title: '项目记忆已重建',
        description: '页面会自动刷新最新内容',
      })
      await onTriggered()
    } catch (err) {
      toast.error({
        title: '重建失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title="重新跑 LLM 把对话和文档汇总到结构化记忆,你固定的锚点会保留"
      style={{
        padding: '6px 12px',
        fontSize: 12,
        color: 'var(--color-codex-bg-elev)',
        background: 'var(--color-codex-accent)',
        borderRadius: 'var(--codex-r-sm, 3px)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z" />
      </svg>
      {busy ? '重建中…' : '重新汇总'}
    </button>
  )
}

interface AnchorsDialogProps {
  open: boolean
  projectId: number
  /** Backend slot key — must be one of EDITABLE_SLOT_KEYS. */
  slotKey: string | null
  /** Friendly bilingual title for the dialog header. */
  title: string
  description?: string
  aiItems: string[]
  pinnedItems: string[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}

/** Anchor management dialog for ai_pinned-shape slots. Shows the AI
 * suggestions read-only with a "固定" button per item, and the
 * user-pinned list with inline edit / delete / add. Save sends the
 * whole new pinned array to PATCH /memory/slots/:name. */
export function CxMemoryAnchorsDialog({
  open,
  projectId,
  slotKey,
  title,
  description,
  aiItems,
  pinnedItems,
  onClose,
  onSaved,
}: AnchorsDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const [newItem, setNewItem] = useState('')

  useEffect(() => {
    if (open) {
      setDraft([...pinnedItems])
      setNewItem('')
    }
  }, [open, pinnedItems])

  if (!slotKey) return null

  const promoteFromAi = (text: string) => {
    if (draft.includes(text)) return
    setDraft((d) => [...d, text])
  }

  const removePinned = (idx: number) => {
    setDraft((d) => d.filter((_, i) => i !== idx))
  }

  const updatePinned = (idx: number, text: string) => {
    setDraft((d) => d.map((v, i) => (i === idx ? text : v)))
  }

  const addPinned = () => {
    const t = newItem.trim()
    if (!t) return
    if (draft.includes(t)) {
      toast.warning({ title: '这一条已固定' })
      return
    }
    setDraft((d) => [...d, t])
    setNewItem('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const cleaned = draft.map((s) => s.trim()).filter(Boolean)
    setBusy(true)
    try {
      await api.patch(
        `/projects/${projectId}/memory/slots/${encodeURIComponent(slotKey)}`,
        { pinned: cleaned },
      )
      toast.success({
        title: '锚点已保存',
        description: `固定 ${cleaned.length} 项,下次 AI 重建时会保留`,
      })
      onClose()
      await onSaved()
    } catch (err) {
      toast.error({
        title: '保存失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <CxDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description ?? '管理这条记忆的固定锚点 · AI 重建时锚点会保留'}
      size="lg"
      busy={busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
              color: 'var(--color-codex-ink-soft)',
              background: 'transparent',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="submit"
            form="cx-anchors-form"
            disabled={busy}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 'var(--codex-r-sm, 3px)',
              background: 'var(--color-codex-ink)',
              color: 'var(--color-codex-bg-elev)',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? '保存中…' : '保存锚点'}
          </button>
        </>
      }
    >
      <form id="cx-anchors-form" onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* User-pinned section */}
          <section>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--color-codex-ink)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ color: 'var(--color-codex-accent)' }}>★</span>
                我固定的锚点
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--color-codex-ink-mute)',
                    fontWeight: 400,
                  }}
                >
                  · {draft.length} 项
                </span>
              </h3>
            </div>

            {draft.length === 0 ? (
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--color-codex-ink-faint)',
                  padding: '10px 12px',
                  border: '1px dashed var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                还没有固定锚点。从下方 AI 建议中「固定」或在输入框里手动添加。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {draft.map((item, i) => (
                  <PinnedRow
                    key={i}
                    value={item}
                    onChange={(v) => updatePinned(i, v)}
                    onRemove={() => removePinned(i)}
                    busy={busy}
                  />
                ))}
              </div>
            )}

            {/* Manual add */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginTop: 8,
                alignItems: 'stretch',
              }}
            >
              <input
                type="text"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addPinned()
                  }
                }}
                placeholder="手动添加一条锚点…"
                className="codex-input"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: 13,
                  background: 'var(--color-codex-bg)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  color: 'var(--color-codex-ink)',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={addPinned}
                disabled={!newItem.trim()}
                style={{
                  padding: '7px 14px',
                  fontSize: 13,
                  background: 'var(--color-codex-bg-elev)',
                  color: 'var(--color-codex-ink-soft)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  cursor: newItem.trim() ? 'pointer' : 'not-allowed',
                  opacity: newItem.trim() ? 1 : 0.55,
                }}
              >
                添加
              </button>
            </div>
          </section>

          {/* AI suggestions section */}
          <section>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 8,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--color-codex-ink)',
                }}
              >
                AI 写入
              </h3>
              <span style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}>
                · {aiItems.length} 项 · 重新汇总时会被替换
              </span>
            </div>

            {aiItems.length === 0 ? (
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--color-codex-ink-faint)',
                  padding: '10px 12px',
                  background: 'var(--color-codex-bg-tint)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                AI 这一栏还没有建议。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {aiItems.map((item, i) => {
                  const alreadyPinned = draft.includes(item)
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '8px 10px',
                        background: 'var(--color-codex-bg-tint)',
                        borderRadius: 'var(--codex-r-sm, 3px)',
                      }}
                    >
                      <span
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 99,
                          background: 'var(--color-codex-ink-mute)',
                          marginTop: 8,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          fontSize: 13,
                          color: 'var(--color-codex-ink)',
                          lineHeight: 1.6,
                          minWidth: 0,
                        }}
                      >
                        {item}
                      </span>
                      <button
                        type="button"
                        onClick={() => promoteFromAi(item)}
                        disabled={alreadyPinned}
                        style={{
                          fontSize: 11.5,
                          padding: '3px 8px',
                          borderRadius: 'var(--codex-r-sm, 3px)',
                          background: alreadyPinned
                            ? 'transparent'
                            : 'var(--color-codex-accent-bg)',
                          color: alreadyPinned
                            ? 'var(--color-codex-ink-faint)'
                            : 'var(--color-codex-accent-ink)',
                          border: '1px solid transparent',
                          flexShrink: 0,
                          cursor: alreadyPinned ? 'default' : 'pointer',
                        }}
                      >
                        {alreadyPinned ? '已固定' : '★ 固定'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </form>
    </CxDialog>
  )
}

interface PinnedRowProps {
  value: string
  onChange: (v: string) => void
  onRemove: () => void
  busy: boolean
}

function PinnedRow({ value, onChange, onRemove, busy }: PinnedRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 6,
        background: 'color-mix(in oklch, var(--color-codex-accent) 8%, var(--color-codex-bg))',
        border: '1px solid color-mix(in oklch, var(--color-codex-accent) 20%, var(--color-codex-line))',
        borderRadius: 'var(--codex-r-sm, 3px)',
        padding: '4px 6px 4px 10px',
      }}
    >
      <span
        style={{
          color: 'var(--color-codex-accent)',
          fontSize: 13,
          alignSelf: 'flex-start',
          marginTop: 7,
        }}
      >
        ★
      </span>
      <input
        type="text"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        disabled={busy}
        style={{
          flex: 1,
          padding: '6px 6px',
          fontSize: 13,
          background: 'transparent',
          border: 'none',
          color: 'var(--color-codex-ink)',
          outline: 'none',
          fontFamily: 'var(--font-ui)',
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        title="取消固定"
        style={{
          padding: '4px 8px',
          color: 'var(--color-codex-ink-faint)',
          fontSize: 14,
          lineHeight: 1,
          alignSelf: 'center',
          background: 'transparent',
        }}
      >
        ×
      </button>
    </div>
  )
}
