import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog, CxConfirmDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'
import type { Milestone } from '../../../types/api'

/** Milestone CRUD modals — create / edit / delete. Toggle-done is a
 * one-shot mutation so it has no modal; see the helper exported below. */

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

const PRIORITY_OPTIONS: Array<{ value: Milestone['priority']; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

interface MilestoneFormDialogProps {
  open: boolean
  projectId: number
  /** Pass an existing milestone to edit, omit to create. */
  milestone?: Milestone | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function CxMilestoneFormDialog(props: MilestoneFormDialogProps) {
  if (!props.open) return null
  return (
    <MilestoneFormDialogContent
      key={props.milestone?.id ?? `new:${props.projectId}`}
      {...props}
    />
  )
}

function MilestoneFormDialogContent({
  open,
  projectId,
  milestone,
  onClose,
  onSaved,
}: MilestoneFormDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    title: milestone?.title ?? '',
    priority: milestone?.priority ?? 'medium',
    due_date: milestone?.due_date ?? '',
  })

  const update =
    (k: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((s) => ({ ...s, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!form.title.trim()) {
      toast.warning({ title: '里程碑标题不能为空' })
      return
    }
    setBusy(true)
    try {
      const payload = {
        title: form.title.trim(),
        priority: form.priority,
        due_date: form.due_date || null,
      }
      if (milestone) {
        await api.patch<Milestone>(
          `/projects/${projectId}/milestones/${milestone.id}`,
          payload,
        )
        toast.success({ title: '已保存' })
      } else {
        await api.post<Milestone>(`/projects/${projectId}/milestones`, payload)
        toast.success({ title: '已添加里程碑' })
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
      title={milestone ? '编辑里程碑' : '添加里程碑'}
      description="标题 · 优先级 · 计划日期"
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
              opacity: busy ? 0.5 : 1,
            }}
          >
            取消
          </button>
          <button
            type="submit"
            form="cx-milestone-form"
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
      <form id="cx-milestone-form" onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={LABEL_STYLE}>标题</label>
            <input
              type="text"
              value={form.title}
              onChange={update('title')}
              required
              autoFocus
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>优先级</label>
            <select
              value={form.priority}
              onChange={update('priority')}
              className="codex-input"
              style={INPUT_STYLE}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL_STYLE}>计划日期</label>
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

interface MilestoneDeleteDialogProps {
  open: boolean
  projectId: number
  milestone: Milestone | null
  onClose: () => void
  onDeleted: () => void | Promise<void>
}

export function CxMilestoneDeleteDialog({
  open,
  projectId,
  milestone,
  onClose,
  onDeleted,
}: MilestoneDeleteDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!milestone) return null
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.delete(`/projects/${projectId}/milestones/${milestone.id}`)
      toast.success({ title: '里程碑已删除' })
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
  return (
    <CxConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={confirm}
      title={`删除「${milestone.title}」`}
      description="此里程碑将被永久移除。"
      confirmLabel="删除"
      tone="danger"
      busy={busy}
    />
  )
}
