import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog, CxConfirmDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'
import type { ProjectTodo } from '../../../types/api'

/** Todo CRUD modals — create / edit / delete. Toggle-done is a one-shot
 * mutation with no modal (see `toggleTodoDone` below). */

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

interface TodoFormDialogProps {
  open: boolean
  projectId: number
  /** Pass an existing todo to edit; omit to create. */
  todo?: ProjectTodo | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function CxTodoFormDialog({
  open,
  projectId,
  todo,
  onClose,
  onSaved,
}: TodoFormDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    content: todo?.content ?? '',
    due_date: todo?.due_date ?? '',
  })

  useEffect(() => {
    if (open) {
      setForm({
        content: todo?.content ?? '',
        due_date: todo?.due_date ?? '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update =
    (k: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((s) => ({ ...s, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!form.content.trim()) {
      toast.warning({ title: '待办内容不能为空' })
      return
    }
    setBusy(true)
    try {
      const payload = {
        content: form.content.trim(),
        due_date: form.due_date || null,
      }
      if (todo) {
        await api.patch<ProjectTodo>(`/projects/${projectId}/todos/${todo.id}`, payload)
        toast.success({ title: '已保存' })
      } else {
        await api.post<ProjectTodo>(`/projects/${projectId}/todos`, payload)
        toast.success({ title: '已添加待办' })
      }
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
      title={todo ? '编辑待办' : '添加待办'}
      description="内容 · 截止日期(可选)"
      size="md"
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
            form="cx-todo-form"
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
      <form id="cx-todo-form" onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={LABEL_STYLE}>内容</label>
            <textarea
              rows={3}
              value={form.content}
              onChange={update('content')}
              required
              autoFocus
              placeholder="例:整理周三例会准备材料"
              className="codex-input"
              style={{ ...INPUT_STYLE, resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>截止日期(可选)</label>
            <input
              type="date"
              value={form.due_date ?? ''}
              onChange={update('due_date')}
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
        </div>
      </form>
    </CxDialog>
  )
}

interface TodoDeleteDialogProps {
  open: boolean
  projectId: number
  todo: ProjectTodo | null
  onClose: () => void
  onDeleted: () => void | Promise<void>
}

export function CxTodoDeleteDialog({
  open,
  projectId,
  todo,
  onClose,
  onDeleted,
}: TodoDeleteDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!todo) return null
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.delete(`/projects/${projectId}/todos/${todo.id}`)
      toast.success({ title: '待办已删除' })
      onClose()
      await onDeleted()
    } catch (err) {
      toast.error({
        title: '删除失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setBusy(false)
    }
  }
  const preview = todo.content.length > 30 ? `${todo.content.slice(0, 30)}…` : todo.content
  return (
    <CxConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={confirm}
      title={`删除「${preview}」`}
      description="此待办将被永久移除。"
      confirmLabel="删除"
      tone="danger"
      busy={busy}
    />
  )
}

/** Toggle is_done — one-shot, no dialog. */
export async function toggleTodoDone(
  projectId: number,
  todo: ProjectTodo,
): Promise<void> {
  await api.patch<ProjectTodo>(`/projects/${projectId}/todos/${todo.id}`, {
    is_done: !todo.is_done,
  })
}
