import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog, CxConfirmDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'
import type { ProjectPayment } from '../../../types/api'

/** Add / delete payments for a project. The financials API only
 * exposes POST (create) and DELETE — there is no PATCH for edits, so
 * an "edit" flow is delete + recreate (not built in this round). */

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

const TYPE_OPTIONS: Array<{ value: ProjectPayment['payment_type']; label: string }> = [
  { value: 'received', label: '已回款' },
  { value: 'invoiced', label: '已开票待回款' },
  { value: 'milestone_payment', label: '里程碑收款' },
  { value: 'expense', label: '支出' },
]

interface PaymentFormDialogProps {
  open: boolean
  projectId: number
  onClose: () => void
  onSaved: () => void | Promise<void>
}

function todayISO() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function CxPaymentFormDialog(props: PaymentFormDialogProps) {
  if (!props.open) return null
  return <PaymentFormDialogContent key={props.projectId} {...props} />
}

function PaymentFormDialogContent({
  open,
  projectId,
  onClose,
  onSaved,
}: PaymentFormDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<{
    amount: number
    payment_date: string
    payment_type: ProjectPayment['payment_type']
    note: string
  }>({
    amount: 0,
    payment_date: todayISO(),
    payment_type: 'received',
    note: '',
  })

  const update =
    (k: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = k === 'amount' ? Number(e.target.value || 0) : e.target.value
      setForm((s) => ({ ...s, [k]: value }))
    }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!form.amount || form.amount <= 0) {
      toast.warning({ title: '金额需大于 0' })
      return
    }
    setBusy(true)
    try {
      await api.post<ProjectPayment>(`/projects/${projectId}/financials`, form)
      toast.success({ title: '已添加记录' })
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
      title="添加收款 / 支出"
      description="金额(元) · 日期 · 类型 · 说明"
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
            form="cx-payment-form"
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
            {busy ? '保存中…' : '添加'}
          </button>
        </>
      }
    >
      <form id="cx-payment-form" onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={LABEL_STYLE}>金额(元)</label>
            <input
              type="number"
              min={0}
              step={100}
              value={form.amount}
              onChange={update('amount')}
              required
              autoFocus
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>日期</label>
            <input
              type="date"
              value={form.payment_date}
              onChange={update('payment_date')}
              required
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={LABEL_STYLE}>类型</label>
            <select
              value={form.payment_type}
              onChange={update('payment_type')}
              className="codex-input"
              style={INPUT_STYLE}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={LABEL_STYLE}>说明</label>
            <input
              type="text"
              value={form.note}
              onChange={update('note')}
              className="codex-input"
              style={INPUT_STYLE}
              placeholder="例:预付款 / 验收款 / 差旅"
            />
          </div>
        </div>
      </form>
    </CxDialog>
  )
}

interface PaymentDeleteDialogProps {
  open: boolean
  projectId: number
  payment: ProjectPayment | null
  onClose: () => void
  onDeleted: () => void | Promise<void>
}

export function CxPaymentDeleteDialog({
  open,
  projectId,
  payment,
  onClose,
  onDeleted,
}: PaymentDeleteDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!payment) return null
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.delete(`/projects/${projectId}/financials/${payment.id}`)
      toast.success({ title: '记录已删除' })
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
      title={`删除「${payment.note || payment.payment_type}」`}
      description="这条收款 / 支出记录会被永久移除。"
      confirmLabel="删除"
      tone="danger"
      busy={busy}
    />
  )
}
