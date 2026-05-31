import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'
import type { Conversation } from '../../../types/api'

const INPUT_STYLE = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13.5,
  background: 'var(--color-codex-bg)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  color: 'var(--color-codex-ink)',
  outline: 'none',
} as const

const LABEL_STYLE = {
  display: 'block',
  fontSize: 11.5,
  color: 'var(--color-codex-ink-mute)',
  marginBottom: 6,
  fontWeight: 500,
} as const

interface RenameDialogProps {
  open: boolean
  conversation: Conversation | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

/** Rename a chat conversation — PATCH /chat/conversations/:id { title }. */
export function CxConversationRenameDialog({
  open,
  conversation,
  onClose,
  onSaved,
}: RenameDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')

  useEffect(() => {
    if (open) setTitle(conversation?.title ?? '')
  }, [open, conversation?.id, conversation?.title])

  if (!conversation) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const trimmed = title.trim()
    if (!trimmed) {
      toast.warning({ title: '标题不能为空' })
      return
    }
    if (trimmed === conversation.title) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await api.patch<Conversation>(`/chat/conversations/${conversation.id}`, {
        title: trimmed,
      })
      toast.success({ title: '已重命名' })
      onClose()
      await onSaved()
    } catch (err) {
      toast.error({
        title: '重命名失败',
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
      title="重命名对话"
      size="sm"
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
            form="cx-conv-rename-form"
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
      <form id="cx-conv-rename-form" onSubmit={submit}>
        <label style={LABEL_STYLE}>标题</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
          className="codex-input"
          style={INPUT_STYLE}
        />
      </form>
    </CxDialog>
  )
}
