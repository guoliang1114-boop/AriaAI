import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../../api/client'
import { MarkdownRenderer } from '../../../../components/MarkdownRenderer'
import { getApiBaseUrl } from '../../../../config/api'
import type {
  ProjectDetail as ProjectDetailType,
  ProjectFile,
  ProjectFolder,
} from '../../../../types/api'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import {
  CxFileDeleteDialog,
  CxFolderCreateDialog,
  CxFolderDeleteDialog,
  CxUploadDropzone,
} from '../CxDocsActions'

interface DocsProps {
  projectId: number
  detail: ProjectDetailType
  refetch: () => Promise<void>
}

const UNFILED_ID = -1

interface FolderGroup {
  id: number
  name: string
  files: ProjectFile[]
}

function buildGroups(folders: ProjectFolder[], files: ProjectFile[]): FolderGroup[] {
  const folderMap = new Map<number, FolderGroup>()
  const sortedFolders = [...folders].sort((a, b) => a.sort_order - b.sort_order)
  for (const f of sortedFolders) {
    folderMap.set(f.id, { id: f.id, name: f.name, files: [] })
  }
  const visible = files.filter((f) => !f.deleted_at)
  const unfiled: ProjectFile[] = []
  for (const f of visible) {
    if (f.folder_id != null && folderMap.has(f.folder_id)) {
      folderMap.get(f.folder_id)!.files.push(f)
    } else {
      unfiled.push(f)
    }
  }
  const groups = Array.from(folderMap.values())
  if (unfiled.length > 0) {
    groups.push({ id: UNFILED_ID, name: '未分类', files: unfiled })
  }
  return groups
}

function extOf(file: ProjectFile): string {
  if (file.file_type) {
    return file.file_type.replace('.', '').toUpperCase().slice(0, 4)
  }
  const idx = file.name.lastIndexOf('.')
  if (idx === -1) return '—'
  return file.name.slice(idx + 1).toUpperCase().slice(0, 4)
}

function sizeText(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fileSize(file: ProjectFile): number | undefined {
  return file.size ?? (file as ProjectFile & { size_bytes?: number }).size_bytes
}

function dateText(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

function normalizeFileType(file: ProjectFile): string {
  const explicit = (file.file_type || '').replace('.', '').toLowerCase()
  if (explicit) return explicit
  const idx = file.name.lastIndexOf('.')
  return idx === -1 ? '' : file.name.slice(idx + 1).toLowerCase()
}

function getPreviewKind(file: ProjectFile): 'pdf' | 'image' | 'markdown' | 'text' | 'unsupported' {
  const type = normalizeFileType(file)
  if (type === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(type)) return 'image'
  if (['md', 'markdown'].includes(type)) return 'markdown'
  if (['txt', 'csv', 'json', 'log'].includes(type)) return 'text'
  return 'unsupported'
}

function projectFileDownloadUrl(projectId: number, fileId: number): string {
  const base = getApiBaseUrl().replace(/\/$/, '')
  return `${base}/projects/${projectId}/files/${fileId}/download`
}

async function fetchProjectFileBlob(projectId: number, file: ProjectFile, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(projectFileDownloadUrl(projectId, file.id), {
    signal,
    headers: {
      'X-Auth-Token': localStorage.getItem('authToken') || '',
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to load file (${response.status})`)
  }
  return response.blob()
}

async function downloadProjectFile(projectId: number, file: ProjectFile): Promise<void> {
  const blob = await fetchProjectFileBlob(projectId, file)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function CxProjectDocs({ projectId, detail, refetch }: DocsProps) {
  const { project, folders, files } = detail
  const groups = useMemo(() => buildGroups(folders, files), [folders, files])
  const totalFiles = groups.reduce((s, g) => s + g.files.length, 0)

  const initialFolderId = groups[0]?.id ?? UNFILED_ID
  const [expanded, setExpanded] = useState<Record<number, boolean>>(() => {
    const m: Record<number, boolean> = {}
    if (groups[0]) m[groups[0].id] = true
    return m
  })
  const [sel, setSel] = useState<{ folder: number; file: number }>({
    folder: initialFolderId,
    file: 0,
  })
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [deletingFolder, setDeletingFolder] = useState<ProjectFolder | null>(null)
  const [deletingFile, setDeletingFile] = useState<ProjectFile | null>(null)

  const toggle = (id: number) => setExpanded((e) => ({ ...e, [id]: !e[id] }))
  const cur = groups.find((g) => g.id === sel.folder) ?? groups[0]
  const selectedFile = sel.file >= 0 ? cur?.files[sel.file] ?? null : null

  useEffect(() => {
    if (sel.file < 0 || selectedFile || groups.length === 0) return
    const firstGroupWithFile = groups.find((g) => g.files.length > 0)
    if (firstGroupWithFile) {
      setSel({ folder: firstGroupWithFile.id, file: 0 })
    }
  }, [groups, sel.file, selectedFile])

  return (
    <CxProjectShell activeTab="docs" projectId={projectId} project={project}>
      <div
        style={{
          height: '100%',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          minWidth: 0,
        }}
      >
        {/* LEFT — tree */}
        <aside
          style={{
            borderRight: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '18px 16px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
              项目文件
            </h2>
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
              {groups.length} 夹 · {totalFiles} 份
            </span>
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <CxUploadDropzone
              projectId={projectId}
              folderId={sel.folder === UNFILED_ID ? null : sel.folder}
              onUploaded={refetch}
            />
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 14px 14px' }}>
            <TreeRow depth={0} icon="folder" iconColor="var(--ink-soft)" label="全部文件" badge={totalFiles} />
            {groups.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ink-faint)',
                  textAlign: 'center',
                  padding: '24px 0',
                }}
              >
                — 暂无文件夹 —
              </div>
            ) : (
              groups.map((g) => (
                <span key={g.id} style={{ display: 'contents' }}>
                  <TreeRow
                    depth={1}
                    expandable
                    isOpen={!!expanded[g.id]}
                    icon="folder"
                    iconColor="var(--ink-mute)"
                    label={g.name}
                    badge={g.files.length}
                    active={sel.folder === g.id && sel.file === -1}
                    onClick={() => {
                      toggle(g.id)
                      setSel({ folder: g.id, file: -1 })
                    }}
                  />
                  {expanded[g.id] &&
                    g.files.map((d, i) => (
                      <FileRow
                        key={d.id}
                        depth={2}
                        ext={extOf(d)}
                        label={d.name}
                        active={sel.folder === g.id && sel.file === i}
                        onClick={() => setSel({ folder: g.id, file: i })}
                      />
                    ))}
                </span>
              ))
            )}
          </div>
        </aside>

        {/* RIGHT — file preview */}
        <div
          style={{
            overflow: 'hidden',
            padding: '20px 32px 32px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 13,
                color: 'var(--ink-mute)',
              }}
            >
              <CxIcon name="folder" size={13} style={{ color: 'var(--ink-faint)' }} />
              <span>全部文件</span>
              {cur && (
                <>
                  <CxIcon name="chevron-right" size={11} style={{ color: 'var(--ink-faint)' }} />
                  <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{cur.name}</span>
                  {selectedFile && (
                    <>
                      <CxIcon name="chevron-right" size={11} style={{ color: 'var(--ink-faint)' }} />
                      <span
                        style={{
                          color: 'var(--ink)',
                          fontWeight: 500,
                          maxWidth: 360,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {selectedFile.name}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setCreatingFolder(true)}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  color: 'var(--ink-soft)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                新建文件夹
              </button>
              {selectedFile ? (
                <>
                  <button
                    type="button"
                    onClick={() => void downloadProjectFile(projectId, selectedFile)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      color: 'var(--ink-soft)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-sm)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <CxIcon name="download" size={12} />
                    下载
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingFile(selectedFile)}
                    title="删除当前文件"
                    style={{
                      padding: 6,
                      color: 'var(--ink-faint)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-sm)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CxIcon name="trash" size={12} />
                  </button>
                </>
              ) : cur && cur.id !== UNFILED_ID ? (
                <button
                  type="button"
                  onClick={() => {
                    const folder = folders.find((f) => f.id === cur.id)
                    if (folder) setDeletingFolder(folder)
                  }}
                  title="删除当前文件夹"
                  style={{
                    padding: 6,
                    color: 'var(--ink-faint)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CxIcon name="trash" size={12} />
                </button>
              ) : null}
            </div>
          </div>

          <FilePreviewPane projectId={projectId} file={selectedFile} currentFolder={cur} />
        </div>
      </div>

      <CxFolderCreateDialog
        open={creatingFolder}
        projectId={projectId}
        onClose={() => setCreatingFolder(false)}
        onSaved={refetch}
      />
      <CxFolderDeleteDialog
        open={deletingFolder !== null}
        projectId={projectId}
        folder={deletingFolder}
        fileCount={
          deletingFolder
            ? groups.find((g) => g.id === deletingFolder.id)?.files.length ?? 0
            : 0
        }
        onClose={() => setDeletingFolder(null)}
        onDeleted={refetch}
      />
      <CxFileDeleteDialog
        open={deletingFile !== null}
        projectId={projectId}
        file={deletingFile}
        onClose={() => setDeletingFile(null)}
        onDeleted={refetch}
      />
    </CxProjectShell>
  )
}

interface ProjectMarkdownPayload {
  content: string
}

interface PreviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  kind?: ReturnType<typeof getPreviewKind>
  url?: string
  text?: string
  truncated?: boolean
  message?: string
}

function FilePreviewPane({
  projectId,
  file,
  currentFolder,
}: {
  projectId: number
  file: ProjectFile | null
  currentFolder?: FolderGroup
}) {
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })

  useEffect(() => {
    if (!file) {
      setPreview({ status: 'idle' })
      return
    }

    const kind = getPreviewKind(file)
    if (kind === 'unsupported') {
      setPreview({ status: 'ready', kind })
      return
    }

    let objectUrl: string | undefined
    let disposed = false
    const controller = new AbortController()

    const load = async () => {
      setPreview({ status: 'loading', kind })
      try {
        if (kind === 'markdown') {
          const data = await api.get<ProjectMarkdownPayload>(`/projects/${projectId}/documents/${file.id}`)
          if (!disposed) setPreview({ status: 'ready', kind, text: data.content || '' })
          return
        }

        const blob = await fetchProjectFileBlob(projectId, file, controller.signal)
        if (kind === 'text') {
          const limit = 1024 * 1024
          const text = await blob.slice(0, limit).text()
          if (!disposed) {
            setPreview({
              status: 'ready',
              kind,
              text,
              truncated: blob.size > limit,
            })
          }
          return
        }

        const typedBlob =
          kind === 'pdf'
            ? new Blob([blob], { type: 'application/pdf' })
            : new Blob([blob], { type: blob.type || `image/${normalizeFileType(file)}` })
        objectUrl = URL.createObjectURL(typedBlob)
        if (disposed) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setPreview({ status: 'ready', kind, url: objectUrl })
      } catch (err) {
        if (!disposed && !controller.signal.aborted) {
          setPreview({
            status: 'error',
            kind,
            message: err instanceof Error ? err.message : '文件预览失败',
          })
        }
      }
    }

    void load()

    return () => {
      disposed = true
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, projectId])

  if (!file) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)',
          background: 'var(--bg-elev)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-faint)',
          fontSize: 13,
          textAlign: 'center',
          padding: 24,
        }}
      >
        {currentFolder
          ? `「${currentFolder.name}」是文件夹。请在左侧选择一个文件查看内容。`
          : '请选择左侧文件查看内容。'}
      </div>
    )
  }

  return (
    <section
      style={{
        flex: 1,
        minHeight: 0,
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-elev)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '16px 18px',
          borderBottom: '1px solid var(--line-soft)',
          display: 'grid',
          gridTemplateColumns: '50px 1fr',
          gap: 14,
          alignItems: 'start',
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--ink-mute)',
            padding: '3px 8px',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            textAlign: 'center',
            letterSpacing: '0.04em',
            justifySelf: 'start',
          }}
        >
          {extOf(file)}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2
            className="ui"
            style={{
              margin: 0,
              fontSize: 16,
              color: 'var(--ink)',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.name}
          </h2>
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 6,
              fontSize: 11.5,
              color: 'var(--ink-faint)',
              flexWrap: 'wrap',
            }}
          >
            <span className="num">{sizeText(fileSize(file))}</span>
            <span>{dateText(file.uploaded_at)}</span>
            {file.origin && <span>{file.origin}</span>}
          </div>
          {file.summary && (
            <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
              {file.summary}
            </p>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg)' }}>
        {preview.status === 'loading' && (
          <PreviewNotice icon="file" title="正在加载预览…" />
        )}
        {preview.status === 'error' && (
          <PreviewNotice
            icon="file"
            title="暂时无法预览"
            description={preview.message || '可以下载原文件查看。'}
          />
        )}
        {preview.status === 'ready' && preview.kind === 'pdf' && preview.url && (
          <iframe
            title={file.name}
            src={preview.url}
            style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
          />
        )}
        {preview.status === 'ready' && preview.kind === 'image' && preview.url && (
          <div
            style={{
              minHeight: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            <img
              src={preview.url}
              alt={file.name}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </div>
        )}
        {preview.status === 'ready' && preview.kind === 'markdown' && (
          <div className="project-chat-preview-md md-root" style={{ padding: '22px 26px' }}>
            <MarkdownRenderer content={preview.text || ''} />
          </div>
        )}
        {preview.status === 'ready' && preview.kind === 'text' && (
          <div style={{ padding: 20 }}>
            {preview.truncated && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '8px 10px',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                  color: 'var(--ink-mute)',
                  fontSize: 12,
                  background: 'var(--bg-elev)',
                }}
              >
                文件较大，仅展示前 1 MB 内容。
              </div>
            )}
            <pre
              className="mono"
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 12.5,
                lineHeight: 1.7,
                color: 'var(--ink-soft)',
              }}
            >
              {preview.text}
            </pre>
          </div>
        )}
        {preview.status === 'ready' && preview.kind === 'unsupported' && (
          <PreviewNotice
            icon="file"
            title="该类型暂不支持在线预览"
            description="可以下载原文件查看；文件摘要仍会用于项目记忆和对话上下文。"
          />
        )}
      </div>
    </section>
  )
}

function PreviewNotice({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description?: string
}) {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 32,
        color: 'var(--ink-faint)',
      }}
    >
      <CxIcon name={icon} size={28} style={{ marginBottom: 12 }} />
      <div style={{ fontSize: 14, color: 'var(--ink-soft)', fontWeight: 500 }}>{title}</div>
      {description && (
        <p style={{ margin: '8px 0 0', maxWidth: 360, fontSize: 12.5, lineHeight: 1.6 }}>
          {description}
        </p>
      )}
    </div>
  )
}

interface TreeRowProps {
  depth?: number
  icon?: string
  iconColor?: string
  expandable?: boolean
  isOpen?: boolean
  label: string
  badge?: number
  onClick?: () => void
  active?: boolean
}

function TreeRow({ depth = 0, icon, iconColor, expandable, isOpen, label, badge, onClick, active }: TreeRowProps) {
  return (
    <a
      className={onClick ? 'row-hov' : ''}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 6px',
        paddingLeft: 6 + depth * 14,
        margin: '0 -6px',
        borderRadius: 'var(--r-sm)',
        cursor: onClick ? 'pointer' : 'default',
        background: active ? 'var(--bg-tint)' : 'transparent',
        position: 'relative',
      }}
    >
      {active && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 5,
            bottom: 5,
            width: 2,
            background: 'var(--accent)',
          }}
        />
      )}
      <span
        style={{
          width: 12,
          color: 'var(--ink-faint)',
          fontSize: 9,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {expandable ? (isOpen ? '▾' : '▸') : ''}
      </span>
      {icon && (
        <CxIcon
          name={icon}
          size={12}
          style={{ color: iconColor ?? 'var(--ink-mute)', flexShrink: 0 }}
        />
      )}
      <span
        style={{
          fontSize: 12.5,
          color: active ? 'var(--ink)' : 'var(--ink-soft)',
          fontWeight: active ? 500 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {label}
      </span>
      {badge != null && (
        <span
          className="num"
          style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}
        >
          {badge}
        </span>
      )}
    </a>
  )
}

interface FileRowProps {
  depth: number
  ext: string
  label: string
  active?: boolean
  onClick?: () => void
}

function FileRow({ depth, ext, label, active, onClick }: FileRowProps) {
  const highlight = ext === 'MD' || ext === 'MEM'
  return (
    <a
      className="row-hov"
      onClick={onClick}
      role="button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 6px',
        paddingLeft: 6 + depth * 14 + 12,
        margin: '0 -6px',
        borderRadius: 'var(--r-sm)',
        cursor: 'pointer',
        background: active ? 'var(--accent-bg)' : 'transparent',
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: highlight ? 'var(--accent)' : 'var(--ink-mute)',
          padding: '1px 4px',
          border: `1px solid ${highlight ? 'var(--accent-bg)' : 'var(--line)'}`,
          background: highlight ? 'var(--accent-bg)' : 'transparent',
          borderRadius: 2,
          flexShrink: 0,
          letterSpacing: '0.04em',
          minWidth: 26,
          textAlign: 'center',
        }}
      >
        {ext}
      </span>
      <span
        style={{
          fontSize: 12,
          color: active ? 'var(--ink)' : 'var(--ink-soft)',
          fontWeight: active ? 500 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {label}
      </span>
    </a>
  )
}
