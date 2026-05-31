import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'
import type { ClientStakeholder } from '../../../types/api'

/** Inline add-stakeholder dialog from the project's Stakeholders tab.
 * POSTs /clients/:client_id/stakeholders with a minimal subset of the
 * full schema — name + role + organization_level + relationship_status
 * + concerns. The rest of the structured fields are still edited from
 * the client space. */

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

const LEVEL_OPTIONS = [
  { value: '', label: '— 未指定 —' },
  { value: '决策', label: '决策层' },
  { value: '影响', label: '影响层' },
  { value: '执行', label: '执行层' },
]

const RELATIONSHIP_OPTIONS = [
  { value: 'unknown', label: '未知' },
  { value: '支持', label: '支持' },
  { value: '积极', label: '积极' },
  { value: '推动', label: '推动' },
  { value: '中立', label: '中立' },
  { value: '反对', label: '反对' },
]

interface StakeholderCreateDialogProps {
  open: boolean
  clientId: number | null
  clientName: string | null
  onClose: () => void
  onCreated: () => void | Promise<void>
}

export function CxStakeholderCreateDialog({
  open,
  clientId,
  clientName,
  onClose,
  onCreated,
}: StakeholderCreateDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: '',
    role: '',
    organization_level: '',
    relationship_status: 'unknown',
    concerns: '',
  })

  useEffect(() => {
    if (open) {
      setForm({
        name: '',
        role: '',
        organization_level: '',
        relationship_status: 'unknown',
        concerns: '',
      })
    }
  }, [open])

  const update =
    (k: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((s) => ({ ...s, [k]: e.target.value }))

  if (clientId == null) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!form.name.trim()) {
      toast.warning({ title: '姓名不能为空' })
      return
    }
    setBusy(true)
    try {
      await api.post<ClientStakeholder>(`/clients/${clientId}/stakeholders`, {
        name: form.name.trim(),
        role: form.role.trim(),
        organization_level: form.organization_level,
        relationship_status: form.relationship_status,
        concerns: form.concerns.trim(),
      })
      toast.success({ title: '已添加干系人' })
      onClose()
      await onCreated()
    } catch (err) {
      toast.error({
        title: '添加失败',
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
      title="添加干系人"
      description={`将存入${clientName ? `「${clientName}」` : '客户档案'}的客户记忆`}
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
            form="cx-stakeholder-form"
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
      <form id="cx-stakeholder-form" onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={LABEL_STYLE}>姓名</label>
            <input
              type="text"
              value={form.name}
              onChange={update('name')}
              required
              autoFocus
              placeholder="例:王浩"
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>角色</label>
            <input
              type="text"
              value={form.role}
              onChange={update('role')}
              placeholder="例:CTO、续保业务负责人"
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>层级</label>
            <select
              value={form.organization_level}
              onChange={update('organization_level')}
              className="codex-input"
              style={INPUT_STYLE}
            >
              {LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL_STYLE}>关系</label>
            <select
              value={form.relationship_status}
              onChange={update('relationship_status')}
              className="codex-input"
              style={INPUT_STYLE}
            >
              {RELATIONSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={LABEL_STYLE}>关注点 / 备注(可选)</label>
            <textarea
              rows={3}
              value={form.concerns}
              onChange={update('concerns')}
              placeholder="例:技术方案的可控性,偏好先做小范围验证"
              className="codex-input"
              style={{ ...INPUT_STYLE, resize: 'vertical' }}
            />
          </div>
        </div>
      </form>
    </CxDialog>
  )
}
