import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../../../api/client'
import { CxDialog, CxConfirmDialog } from '../../../components/codex'
import { useToast } from '../../../contexts/ToastContext'
import type { ProjectFile, ProjectFolder } from '../../../types/api'

/** Documents tab CRUD — file upload, folder create, folder delete. */

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

interface FolderCreateDialogProps {
  open: boolean
  projectId: number
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function CxFolderCreateDialog({
  open,
  projectId,
  onClose,
  onSaved,
}: FolderCreateDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName('')
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) {
      toast.warning({ title: '文件夹名不能为空' })
      return
    }
    setBusy(true)
    try {
      await api.post<ProjectFolder>(`/projects/${projectId}/folders`, {
        name: name.trim(),
      })
      toast.success({ title: '文件夹已创建' })
      onClose()
      await onSaved()
    } catch (err) {
      toast.error({
        title: '创建失败',
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
      title="新建文件夹"
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
            form="cx-folder-form"
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
            {busy ? '创建中…' : '创建'}
          </button>
        </>
      }
    >
      <form id="cx-folder-form" onSubmit={submit}>
        <label style={LABEL_STYLE}>名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          placeholder="例:客户访谈、方案文档"
          className="codex-input"
          style={INPUT_STYLE}
        />
      </form>
    </CxDialog>
  )
}

interface FolderDeleteDialogProps {
  open: boolean
  projectId: number
  folder: ProjectFolder | null
  fileCount: number
  onClose: () => void
  onDeleted: () => void | Promise<void>
}

export function CxFolderDeleteDialog({
  open,
  projectId,
  folder,
  fileCount,
  onClose,
  onDeleted,
}: FolderDeleteDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!folder) return null
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.delete(`/projects/${projectId}/folders/${folder.id}`)
      toast.success({ title: '文件夹已删除' })
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
      title={`删除「${folder.name}」`}
      description={
        fileCount > 0
          ? `此文件夹包含 ${fileCount} 份文件,删除后文件会移到「未分类」。`
          : '该文件夹为空,可安全删除。'
      }
      confirmLabel="删除"
      tone="danger"
      busy={busy}
    />
  )
}

interface UploadDropzoneProps {
  projectId: number
  folderId?: number | null
  onUploaded: () => void | Promise<void>
}

/** A file input dressed up as a drag-and-drop dropzone. Uploads
 * multiple files sequentially via POST /projects/:id/files. */
export function CxUploadDropzone({ projectId, folderId, onUploaded }: UploadDropzoneProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const uploadOne = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    if (folderId != null && folderId >= 0) {
      fd.append('folder_id', String(folderId))
    }
    await api.post<ProjectFile>(`/projects/${projectId}/files`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  }

  const uploadAll = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return
    setBusy(true)
    let ok = 0
    let failed = 0
    for (const f of Array.from(files)) {
      try {
        await uploadOne(f)
        ok += 1
      } catch {
        failed += 1
      }
    }
    setBusy(false)
    if (ok > 0) {
      toast.success({
        title: `已上传 ${ok} 份`,
        description: failed > 0 ? `${failed} 份失败` : undefined,
      })
    } else {
      toast.error({ title: '上传失败' })
    }
    await onUploaded()
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void uploadAll(e.target.files)
    e.target.value = ''
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer.files) void uploadAll(e.dataTransfer.files)
      }}
      style={{
        padding: '9px 11px',
        border: `1.5px dashed ${
          dragging ? 'var(--color-codex-accent)' : 'var(--color-codex-line-strong)'
        }`,
        borderRadius: 'var(--codex-r-sm, 3px)',
        background: dragging
          ? 'color-mix(in oklch, var(--color-codex-accent) 8%, transparent)'
          : 'color-mix(in oklch, var(--color-codex-accent) 4%, transparent)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <input type="file" multiple onChange={onChange} disabled={busy} style={{ display: 'none' }} />
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 'var(--codex-r-sm, 3px)',
          background: 'var(--color-codex-accent-bg)',
          color: 'var(--color-codex-accent)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        +
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          className="ui"
          style={{
            fontSize: 12,
            color: 'var(--color-codex-ink)',
            fontWeight: 500,
          }}
        >
          {busy ? '上传中…' : '拖入或点击上传'}
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--color-codex-ink-mute)',
            marginTop: 1,
          }}
        >
          PDF · DOC · MD · 多选
        </div>
      </div>
    </label>
  )
}
