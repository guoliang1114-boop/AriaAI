import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../../api/client'
import { CxDialog, CxConfirmDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'
import type { Project } from '../../../types/api'
import type { ProjectStatus } from '../../../types/enums'
import {
  ProjectClientPicker,
  type ProjectClientOption,
} from './ProjectClientPicker'
import { useClientsList } from './useProjectsApi'

/** Project-level mutation modals — edit basics / archive / delete.
 *
 * Kept in one file so the Overview tab's project-management panel can
 * import a single component, and so the form-styling (used in three
 * places) stays consistent.
 */

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

const STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'lead', label: '线索期' },
  { value: 'opportunity', label: '机会期' },
  { value: 'won', label: '已签约' },
  { value: 'delivering', label: '交付中' },
  { value: 'archived', label: '已归档' },
]

interface EditDialogProps {
  open: boolean
  project: Project
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function CxEditProjectDialog(props: EditDialogProps) {
  if (!props.open) return null
  const { project } = props
  return (
    <CxEditProjectDialogContent
      key={`${project.id}:${project.updated_at}:${project.client_id ?? 'unlinked'}`}
      {...props}
    />
  )
}

function CxEditProjectDialogContent({ open, project, onClose, onSaved }: EditDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [clientTouched, setClientTouched] = useState(false)
  const [form, setForm] = useState({
    name: project.name,
    client: project.client,
    client_id: project.client_id ?? null,
    status: project.status,
    description: project.description ?? '',
    contract_amount: project.contract_amount ?? 0,
    notes: project.notes ?? '',
  })
  const { data: clients } = useClientsList()
  const normalizedClientName = form.client.trim().toLowerCase()
  const exactClientMatches = useMemo(
    () =>
      normalizedClientName
        ? clients.filter((client) => client.name.trim().toLowerCase() === normalizedClientName)
        : [],
    [clients, normalizedClientName],
  )
  const matchedClient = useMemo<ProjectClientOption | null>(() => {
    if (form.client_id == null) return null
    return (
      clients.find((client) => client.id === form.client_id) ?? {
        id: form.client_id,
        name: form.client,
      }
    )
  }, [clients, form.client, form.client_id])
  const clientSuggestions = useMemo(() => {
    if (!normalizedClientName || matchedClient) return []
    return clients
      .filter((client) => client.name.toLowerCase().includes(normalizedClientName))
      .slice(0, 8)
  }, [clients, matchedClient, normalizedClientName])

  const update =
    (k: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value =
        k === 'contract_amount' ? Number(e.target.value || 0) : e.target.value
      setForm((s) => ({ ...s, [k]: value }))
    }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!form.name.trim()) {
      toast.warning({ title: '项目名称不能为空' })
      return
    }
    if (clientTouched && form.client_id == null && exactClientMatches.length > 1) {
      toast.warning({
        title: '存在多个同名客户',
        description: '请从客户候选项中明确选择一条客户档案。',
      })
      return
    }
    const resolvedClientId = form.client_id ??
      (exactClientMatches.length === 1 ? exactClientMatches[0].id : null)
    setBusy(true)
    try {
      await api.patch<Project>(`/projects/${project.id}`, {
        name: form.name.trim(),
        status: form.status,
        description: form.description,
        contract_amount: form.contract_amount,
        notes: form.notes,
        ...(clientTouched
          ? {
              client: form.client.trim(),
              client_id: resolvedClientId,
            }
          : {}),
      })
      toast.success({ title: '已保存' })
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
      title="编辑项目信息"
      description="名称、客户、状态、合同金额与描述"
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
              opacity: busy ? 0.5 : 1,
            }}
          >
            取消
          </button>
          <button
            type="submit"
            form="cx-edit-project-form"
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
      <form id="cx-edit-project-form" onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={LABEL_STYLE}>项目名称</label>
            <input
              type="text"
              value={form.name}
              onChange={update('name')}
              required
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>客户</label>
            <ProjectClientPicker
              value={form.client}
              matched={matchedClient}
              suggestions={clientSuggestions}
              onChange={(client) => {
                setClientTouched(true)
                setForm((current) => ({ ...current, client, client_id: null }))
              }}
              onPick={(client) => {
                setClientTouched(true)
                setForm((current) => ({
                  ...current,
                  client: client.name,
                  client_id: client.id,
                }))
              }}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>状态</label>
            <select
              value={form.status}
              onChange={update('status')}
              className="codex-input"
              style={INPUT_STYLE}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={LABEL_STYLE}>合同金额(元)</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={form.contract_amount}
              onChange={update('contract_amount')}
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={LABEL_STYLE}>项目描述</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={update('description')}
              className="codex-input"
              style={{ ...INPUT_STYLE, resize: 'vertical' }}
            />
          </div>
        </div>
      </form>
    </CxDialog>
  )
}

interface ArchiveDialogProps {
  open: boolean
  project: Project
  onClose: () => void
  onArchived: () => void | Promise<void>
}

export function CxArchiveProjectDialog({
  open,
  project,
  onClose,
  onArchived,
}: ArchiveDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.patch<Project>(`/projects/${project.id}`, { status: 'archived' })
      toast.success({ title: '项目已归档' })
      onClose()
      await onArchived()
    } catch (err) {
      toast.error({
        title: '归档失败',
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
      title="归档项目"
      description={`将「${project.name}」移入归档,完整记忆与对话保留。归档后可在「交付阶段 · 已归档」中重新打开。`}
      confirmLabel="归档"
      tone="warn"
      busy={busy}
    />
  )
}

interface DeleteDialogProps {
  open: boolean
  project: Project
  onClose: () => void
}

export function CxDeleteProjectDialog({ open, project, onClose }: DeleteDialogProps) {
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.delete(`/projects/${project.id}`)
      toast.success({ title: '项目已删除' })
      onClose()
      navigate('/projects', { replace: true })
    } catch (err) {
      toast.error({
        title: '删除失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
      setBusy(false)
    }
  }
  return (
    <CxConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={confirm}
      title={`删除项目「${project.name}」`}
      description="此操作不可恢复 — 项目记忆、文档、里程碑、财务记录都会被一并删除。"
      confirmLabel="永久删除"
      tone="danger"
      busy={busy}
    />
  )
}
