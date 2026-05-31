import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'

/** Memory tab actions — rebuild + slot edit. The backend exposes
 * - POST /projects/:id/memory/rebuild — kick off async rebuild
 * - PATCH /projects/:id/memory/slots/:slot_name — edit a single slot
 */

interface RebuildButtonProps {
  projectId: number
  onTriggered: () => void | Promise<void>
}

/** Rebuild kick-off is one-shot; we don't keep the modal open while
 * the background job runs — we just toast that it was queued. */
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
      {busy ? '排队中…' : '重新汇总'}
    </button>
  )
}

interface SlotEditDialogProps {
  open: boolean
  projectId: number
  slotName: string | null
  initialValue: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function CxMemorySlotEditDialog({
  open,
  projectId,
  slotName,
  initialValue,
  onClose,
  onSaved,
}: SlotEditDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  if (!slotName) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api.patch(
        `/projects/${projectId}/memory/slots/${encodeURIComponent(slotName)}`,
        { value },
      )
      toast.success({ title: '槽位已保存' })
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
      title={`编辑「${slotName}」`}
      description="结构化记忆槽位 · 支持多行"
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
            form="cx-slot-form"
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
            {busy ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <form id="cx-slot-form" onSubmit={submit}>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={10}
          autoFocus
          className="codex-input"
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 13.5,
            background: 'var(--color-codex-bg)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-ink)',
            resize: 'vertical',
            fontFamily: 'var(--font-ui)',
            lineHeight: 1.7,
          }}
        />
      </form>
    </CxDialog>
  )
}
