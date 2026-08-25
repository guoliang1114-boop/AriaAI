import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog, CxConfirmDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'
import type { ProjectMember } from '../../../types/api'

/** Internal team member CRUD — invite (from existing users list) and
 * remove. There is no edit-role flow yet; backend supports it but the
 * design didn't ship a UI for it. */

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

/** "Owner" is conferred when the project is created — there's only
 * one owner per project, and the invite flow shouldn't be used to
 * create a second one. Use the upcoming transfer-ownership flow when
 * we need to change owners. */
const ROLE_OPTIONS = [
  { value: 'editor', label: 'Editor · 可读写' },
  { value: 'viewer', label: 'Viewer · 只读' },
]

interface SimpleUser {
  id: number
  display_name: string
}

interface InviteDialogProps {
  open: boolean
  projectId: number
  existingMemberIds: Set<number>
  onClose: () => void
  onInvited: () => void | Promise<void>
}

export function CxMemberInviteDialog(props: InviteDialogProps) {
  if (!props.open) return null
  return <MemberInviteDialogContent key={props.projectId} {...props} />
}

function MemberInviteDialogContent({
  open,
  projectId,
  existingMemberIds,
  onClose,
  onInvited,
}: InviteDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [users, setUsers] = useState<SimpleUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [userId, setUserId] = useState<number | null>(null)
  const [role, setRole] = useState('editor')

  useEffect(() => {
    if (!open) return
    let active = true
    api
      .get<SimpleUser[]>('/auth/users/simple')
      .then((rows) => {
        if (active) setUsers(rows)
      })
      .catch(() => {
        if (active) setUsers([])
      })
      .finally(() => {
        if (active) setLoadingUsers(false)
      })
    return () => {
      active = false
    }
  }, [open])

  const candidates = users.filter((u) => !existingMemberIds.has(u.id))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (userId == null) {
      toast.warning({ title: '请选择一位用户' })
      return
    }
    setBusy(true)
    try {
      await api.post<ProjectMember>(`/projects/${projectId}/members`, {
        user_id: userId,
        role,
      })
      toast.success({ title: '已邀请加入' })
      onClose()
      await onInvited()
    } catch (err) {
      toast.error({
        title: '邀请失败',
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
      title="邀请成员"
      description="从已注册用户中选择,加入项目团队"
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
            form="cx-member-invite-form"
            disabled={busy || userId == null}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 'var(--codex-r-sm, 3px)',
              background: 'var(--color-codex-ink)',
              color: 'var(--color-codex-bg-elev)',
              cursor: busy || userId == null ? 'not-allowed' : 'pointer',
              opacity: busy || userId == null ? 0.55 : 1,
            }}
          >
            {busy ? '邀请中…' : '邀请'}
          </button>
        </>
      }
    >
      <form id="cx-member-invite-form" onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={LABEL_STYLE}>用户</label>
            {loadingUsers ? (
              <div
                style={{
                  ...INPUT_STYLE,
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--color-codex-ink-faint)',
                  cursor: 'default',
                }}
              >
                加载用户列表…
              </div>
            ) : candidates.length === 0 ? (
              <div
                style={{
                  ...INPUT_STYLE,
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--color-codex-ink-faint)',
                  cursor: 'default',
                  lineHeight: 1.5,
                  height: 'auto',
                  minHeight: 36,
                }}
              >
                没有可邀请的用户
              </div>
            ) : (
              <select
                value={userId ?? ''}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)}
                required
                className="codex-input"
                style={INPUT_STYLE}
              >
                <option value="">— 选择用户 —</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label style={LABEL_STYLE}>角色</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="codex-input"
              style={INPUT_STYLE}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>
    </CxDialog>
  )
}

interface MemberRemoveDialogProps {
  open: boolean
  projectId: number
  member: ProjectMember | null
  onClose: () => void
  onRemoved: () => void | Promise<void>
}

export function CxMemberRemoveDialog({
  open,
  projectId,
  member,
  onClose,
  onRemoved,
}: MemberRemoveDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!member) return null
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.delete(`/projects/${projectId}/members/${member.user_id}`)
      toast.success({ title: '已移除' })
      onClose()
      await onRemoved()
    } catch (err) {
      toast.error({
        title: '移除失败',
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
      title={`移除「${member.user.display_name}」`}
      description="移除后该成员将失去本项目的访问权限。可再次邀请。"
      confirmLabel="移除"
      tone="warn"
      busy={busy}
    />
  )
}
