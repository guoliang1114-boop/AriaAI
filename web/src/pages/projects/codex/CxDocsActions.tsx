import { useState, type ChangeEvent, type FormEvent } from 'react'
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

export function CxFolderCreateDialog(props: FolderCreateDialogProps) {
  if (!props.open) return null
  return <FolderCreateDialogContent key={props.projectId} {...props} />
}

function FolderCreateDialogContent({
  open,
  projectId,
  onClose,
  onSaved,
}: FolderCreateDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')

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

interface MarkdownCreateDialogProps {
  open: boolean
  projectId: number
  folderId?: number | null
  onClose: () => void
  onSaved: (file: ProjectFile) => void | Promise<void>
}

/** Create a new empty Markdown (.md) file in the project space. The backend
 * (POST /projects/:id/documents) appends the .md suffix and writes the file;
 * it can then be edited inline with the existing Markdown editor. */
export function CxMarkdownCreateDialog(props: MarkdownCreateDialogProps) {
  if (!props.open) return null
  return <MarkdownCreateDialogContent key={`${props.projectId}:${props.folderId ?? 'root'}`} {...props} />
}

function MarkdownCreateDialogContent({
  open,
  projectId,
  folderId,
  onClose,
  onSaved,
}: MarkdownCreateDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) {
      toast.warning({ title: '文件名不能为空' })
      return
    }
    setBusy(true)
    try {
      const file = await api.post<ProjectFile>(`/projects/${projectId}/documents`, {
        name: name.trim(),
        content: '',
        folder_id: folderId != null && folderId >= 0 ? folderId : null,
      })
      toast.success({ title: 'Markdown 已创建' })
      onClose()
      await onSaved(file)
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
      title="新建 Markdown"
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
            form="cx-markdown-form"
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
      <form id="cx-markdown-form" onSubmit={submit}>
        <label style={LABEL_STYLE}>文件名</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          placeholder="例:项目方案、会议纪要(.md 可省略)"
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

interface FileDeleteDialogProps {
  open: boolean
  projectId: number
  file: ProjectFile | null
  onClose: () => void
  onDeleted: () => void | Promise<void>
}

export function CxFileDeleteDialog({
  open,
  projectId,
  file,
  onClose,
  onDeleted,
}: FileDeleteDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!file) return null
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.delete(`/projects/${projectId}/files/${file.id}`)
      toast.success({ title: '文件已移入回收站' })
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
      title={`删除「${file.name}」`}
      description="文件会移入回收站,30 天内可在回收站恢复。"
      confirmLabel="删除"
      tone="danger"
      busy={busy}
    />
  )
}

interface FileMoveDialogProps {
  open: boolean
  projectId: number
  file: ProjectFile | null
  folders: ProjectFolder[]
  onClose: () => void
  onMoved: () => void | Promise<void>
}

export function CxFileMoveDialog(props: FileMoveDialogProps) {
  if (!props.open || !props.file) return null
  return <FileMoveDialogContent key={props.file.id} {...props} />
}

function FileMoveDialogContent({
  open,
  projectId,
  file,
  folders,
  onClose,
  onMoved,
}: FileMoveDialogProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [folderId, setFolderId] = useState(
    file?.folder_id == null ? 'unfiled' : String(file.folder_id),
  )

  if (!file) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api.patch<ProjectFile>(`/projects/${projectId}/files/${file.id}/folder`, {
        folder_id: folderId === 'unfiled' ? null : Number(folderId),
      })
      toast.success({ title: '文件已移动' })
      onClose()
      await onMoved()
    } catch (err) {
      toast.error({
        title: '移动失败',
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
      title="移动文件"
      description={`选择「${file.name}」的新位置。`}
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
            form="cx-file-move-form"
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
            {busy ? '移动中…' : '移动'}
          </button>
        </>
      }
    >
      <form id="cx-file-move-form" onSubmit={submit}>
        <label style={LABEL_STYLE}>目标文件夹</label>
        <select
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="codex-input"
          style={INPUT_STYLE}
        >
          <option value="unfiled">未分类</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </form>
    </CxDialog>
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
    let lastError: unknown = null
    for (const f of Array.from(files)) {
      try {
        await uploadOne(f)
        ok += 1
      } catch (err) {
        failed += 1
        lastError = err
      }
    }
    setBusy(false)
    if (ok > 0) {
      toast.success({
        title: `已上传 ${ok} 份`,
        description: failed > 0 ? `${failed} 份失败` : undefined,
      })
    } else {
      const isTimeout =
        (lastError as { code?: string } | null)?.code === 'ECONNABORTED' ||
        ((lastError as { message?: string } | null)?.message ?? '').includes('timeout')
      toast.error({
        title: '上传失败',
        description: isTimeout
          ? '上传超时,文件可能较大或网络较慢。请刷新确认是否已上传,或重试。'
          : undefined,
      })
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
