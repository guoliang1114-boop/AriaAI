import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'
import type { ProjectProgressUpdate } from '../../../types/api'

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

interface ProgressUpdateDialogProps {
  open: boolean
  projectId: number
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function CxProgressUpdateDialog(props: ProgressUpdateDialogProps) {
  if (!props.open) return null
  return <ProgressUpdateDialogContent key={props.projectId} {...props} />
}

function ProgressUpdateDialogContent({
  open,
  projectId,
  onClose,
  onSaved,
}: ProgressUpdateDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    content: '',
    next_step: '',
    risk: '',
  })

  const update =
    (k: 'content' | 'next_step' | 'risk') =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((s) => ({ ...s, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!form.content.trim()) {
      toast.warning({ title: '进展内容不能为空' })
      return
    }
    setBusy(true)
    try {
      await api.post<ProjectProgressUpdate>(`/projects/${projectId}/progress-updates`, {
        content: form.content.trim(),
        next_step: form.next_step.trim(),
        risk: form.risk.trim(),
      })
      toast.success({ title: '项目进展已更新' })
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
      title="更新项目进展"
      description="补一句最新情况，让团队知道项目推进到哪了"
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
            form="cx-progress-update-form"
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
      <form id="cx-progress-update-form" onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={LABEL_STYLE}>这次有什么新进展？</label>
            <textarea
              rows={4}
              value={form.content}
              onChange={update('content')}
              required
              autoFocus
              placeholder="例: 已和客户确认讲标时间，客户仍在内部评审，预计本周五反馈。"
              className="codex-input"
              style={{ ...INPUT_STYLE, resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>下一步是什么？（可选）</label>
            <input
              value={form.next_step}
              onChange={update('next_step')}
              placeholder="例: 本周内跟进预算审批和评审时间"
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>有没有风险或卡点？（可选）</label>
            <input
              value={form.risk}
              onChange={update('risk')}
              placeholder="例: 客户预算审批时间不确定"
              className="codex-input"
              style={INPUT_STYLE}
            />
          </div>
        </div>
      </form>
    </CxDialog>
  )
}
