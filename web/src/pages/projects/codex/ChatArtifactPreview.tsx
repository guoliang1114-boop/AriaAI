import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import { getApiBaseUrl } from '../../../config/api'
import { MarkdownRenderer } from '../../../components/MarkdownRenderer'
import type { GeneratedArtifact } from '../../../types/api'
import { downloadArtifact } from '../downloadArtifact'
import { CxIcon } from './CxIcons'

/** Right-side artifact preview panel — slides in when the user
 * clicks an artifact in a message or a file row in the 空间 tree.
 *
 * Rendering branches by file kind (see `getFileKind`):
 *
 *  - md      : `/projects/:id/documents/:fid` → MarkdownRenderer.
 *  - pdf     : `/files/:fid/download` as a blob → object URL → iframe.
 *  - image   : same blob path, rendered as `<img>`.
 *  - other   : metadata-only card. The 下载 button in the header
 *              is the primary action.
 *
 * A 下载 button sits in the header for ALL file kinds so the
 * affordance is consistent. Files with no `project_file_id` cannot
 * be previewed in place, but a persisted GeneratedFile `id` / `path`
 * remains downloadable through the authenticated artifact endpoint.
 */

type FileKind = 'md' | 'pdf' | 'image' | 'other'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

function getFileKind(ext: string): FileKind {
  const e = ext.toLowerCase()
  if (e === 'md' || e === 'markdown') return 'md'
  if (e === 'pdf') return 'pdf'
  if (IMAGE_EXTS.has(e)) return 'image'
  return 'other'
}

interface PreviewProps {
  projectId: number
  artifact: GeneratedArtifact
  onClose: () => void
  /** Current pane width in px. Parent owns the value so it persists
   * across re-opens within the same session. */
  width: number
  onResize: (next: number) => void
}

const MIN_PREVIEW_WIDTH = 280
const MAX_PREVIEW_WIDTH_RATIO = 0.7

interface DocumentPayload {
  id: number
  name: string
  content: string
  summary: string | null
  uploaded_at: string | null
}

function fileDownloadUrl(projectId: number, fileId: number): string {
  const base = getApiBaseUrl().replace(/\/$/, '')
  return `${base}/projects/${projectId}/files/${fileId}/download`
}

async function fetchFileBlob(
  projectId: number,
  fileId: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(fileDownloadUrl(projectId, fileId), {
    signal,
    headers: { 'X-Auth-Token': localStorage.getItem('authToken') || '' },
  })
  if (!response.ok) throw new Error(`无法获取文件 (${response.status})`)
  return response.blob()
}

async function triggerDownload(
  projectId: number,
  fileId: number,
  filename: string,
): Promise<void> {
  const blob = await fetchFileBlob(projectId, fileId)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function ChatArtifactPreview({
  artifact,
  projectId,
  ...props
}: PreviewProps) {
  const previewKey = `${projectId}:${artifact.project_file_id ?? artifact.name}:${artifact.file_type}`
  return (
    <ChatArtifactPreviewContent
      key={previewKey}
      artifact={artifact}
      projectId={projectId}
      {...props}
    />
  )
}

function ChatArtifactPreviewContent({
  projectId,
  artifact,
  onClose,
  width,
  onResize,
}: PreviewProps) {
  const ext = (artifact.file_type || artifact.name.split('.').pop() || '')
    .replace('.', '')
    .toUpperCase()
  const kind = getFileKind(ext)
  const fileId = artifact.project_file_id ?? null
  const artifactId = Number.isInteger(artifact.id) && Number(artifact.id) > 0
    ? Number(artifact.id)
    : null
  const hasArtifactPath = typeof artifact.path === 'string' && artifact.path.trim() !== ''
  const canDownload = fileId != null || artifactId != null || hasArtifactPath

  const [doc, setDoc] = useState<DocumentPayload | null>(null)
  const [docLoading, setDocLoading] = useState(kind === 'md' && fileId != null)
  const [docError, setDocError] = useState<string | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [blobLoading, setBlobLoading] = useState(
    (kind === 'pdf' || kind === 'image') && fileId != null,
  )
  const [blobError, setBlobError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [hoverHandle, setHoverHandle] = useState(false)

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    setResizing(true)
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      const max = Math.floor(window.innerWidth * MAX_PREVIEW_WIDTH_RATIO)
      const next = Math.max(MIN_PREVIEW_WIDTH, Math.min(max, startWidth + delta))
      onResize(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      setResizing(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Markdown source fetch — only fires for md files via the
  // document endpoint that returns parsed JSON {content, ...}.
  useEffect(() => {
    let cancelled = false
    if (kind !== 'md' || fileId == null) return
    api
      .get<DocumentPayload>(`/projects/${projectId}/documents/${fileId}`)
      .then((data) => {
        if (cancelled) return
        setDoc(data)
      })
      .catch((err) => {
        if (cancelled) return
        setDocError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        if (!cancelled) setDocLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, fileId, kind])

  // Binary blob fetch — for pdf/image in-pane preview. We can't
  // point an <iframe>/<img> at the download URL directly because
  // browsers don't send our X-Auth-Token header on that request,
  // so we pull as a blob and hand the iframe an object URL.
  useEffect(() => {
    let cancelled = false
    if ((kind !== 'pdf' && kind !== 'image') || fileId == null) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    void (async () => {
      try {
        const raw = await fetchFileBlob(projectId, fileId, controller.signal)
        const mime =
          kind === 'pdf'
            ? 'application/pdf'
            : raw.type || `image/${ext.toLowerCase()}`
        const typed = new Blob([raw], { type: mime })
        const url = URL.createObjectURL(typed)
        objectUrl = url
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        setBlobUrl(url)
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        setBlobError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setBlobLoading(false)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [projectId, fileId, kind, ext])

  const handleDownload = async () => {
    if (downloading || !canDownload) return
    setDownloading(true)
    try {
      if (fileId != null) {
        await triggerDownload(projectId, fileId, artifact.name)
      } else if (artifactId != null) {
        await downloadArtifact({ artifactId, fileName: artifact.name })
      } else {
        await downloadArtifact({ artifact })
      }
    } catch (err) {
      setBlobError(err instanceof Error ? err.message : '下载失败')
    } finally {
      setDownloading(false)
    }
  }

  const content = doc?.content ?? ''
  const sizeKb = artifact.size_bytes ? Math.round(artifact.size_bytes / 1024) : null
  const headerHint =
    kind === 'md'
      ? 'Markdown 预览'
      : kind === 'pdf'
        ? 'PDF 预览'
        : kind === 'image'
          ? '图片预览'
          : `${ext || '文件'} · 不支持预览`
  const downloadDisabled = downloading || !canDownload

  return (
    <aside
      style={{
        position: 'relative',
        borderLeft: '1px solid var(--line)',
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={handleResizeStart}
        onMouseEnter={() => setHoverHandle(true)}
        onMouseLeave={() => setHoverHandle(false)}
        style={{
          position: 'absolute',
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: 'col-resize',
          zIndex: 5,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 3,
            top: 0,
            bottom: 0,
            width: 2,
            background:
              resizing || hoverHandle ? 'var(--accent)' : 'transparent',
            transition: resizing ? 'none' : 'background 120ms',
          }}
        />
      </div>

      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span
          style={{
            width: 28,
            height: 32,
            borderRadius: 'var(--r-sm)',
            background: kind === 'md' ? 'var(--accent-bg)' : 'var(--bg-tint)',
            color: kind === 'md' ? 'var(--accent)' : 'var(--ink-mute)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          {ext || 'FILE'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="ui"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {artifact.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
            {headerHint}
            {sizeKb != null && (
              <>
                {' · '}
                <span className="num">{sizeKb} KB</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloadDisabled}
          title={canDownload ? '下载' : '暂无可用的下载来源'}
          aria-label="下载"
          style={{
            width: 28,
            height: 28,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--ink-mute)',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--r-sm)',
            cursor: downloadDisabled ? 'not-allowed' : 'pointer',
            opacity: downloadDisabled ? 0.4 : 1,
          }}
        >
          <CxIcon
            name="download"
            size={14}
            stroke={1.6}
            style={{ opacity: downloading ? 0.5 : 1 }}
          />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="关闭"
          style={{
            color: 'var(--ink-faint)',
            fontSize: 16,
            padding: 4,
            lineHeight: 1,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>

      {/* Body — dispatch on kind. Every kind is single-pane now;
       * the multi-tab strip was removed to keep the preview pure. */}
      <div
        style={{
          flex: 1,
          overflow: kind === 'md' || kind === 'other' ? 'auto' : 'hidden',
          padding:
            kind === 'pdf'
              ? 0
              : kind === 'image'
                ? '20px'
                : '16px 20px',
          display:
            kind === 'image' || kind === 'pdf' ? 'flex' : 'block',
          alignItems: 'center',
          justifyContent: 'center',
          background: kind === 'pdf' ? 'var(--bg-tint)' : 'transparent',
        }}
      >
        {fileId == null ? (
          <GeneratedArtifactState canDownload={canDownload} />
        ) : kind === 'md' ? (
          <MdBody loading={docLoading} error={docError} content={content} />
        ) : kind === 'pdf' ? (
          <BlobBody
            loading={blobLoading}
            error={blobError}
            url={blobUrl}
            renderUrl={(url) => (
              <iframe
                title={artifact.name}
                src={url}
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            )}
          />
        ) : kind === 'image' ? (
          <BlobBody
            loading={blobLoading}
            error={blobError}
            url={blobUrl}
            renderUrl={(url) => (
              <img
                src={url}
                alt={artifact.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            )}
          />
        ) : (
          <OtherFormatState ext={ext} artifact={artifact} />
        )}
      </div>
    </aside>
  )
}

function MdBody({
  loading,
  error,
  content,
}: {
  loading: boolean
  error: string | null
  content: string
}) {
  if (loading) return <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>加载中…</div>
  if (error) {
    return <div style={{ fontSize: 12, color: 'var(--bad)', lineHeight: 1.6 }}>{error}</div>
  }
  return (
    <div className="md-root" style={{ fontSize: 13.5, color: 'var(--ink)' }}>
      <MarkdownRenderer content={content} />
    </div>
  )
}

function BlobBody({
  loading,
  error,
  url,
  renderUrl,
}: {
  loading: boolean
  error: string | null
  url: string | null
  renderUrl: (url: string) => React.ReactNode
}) {
  if (loading) {
    return (
      <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>加载中…</div>
    )
  }
  if (error) {
    return (
      <div
        style={{
          fontSize: 12.5,
          color: 'var(--bad)',
          lineHeight: 1.7,
          padding: '12px 20px',
          textAlign: 'center',
        }}
      >
        {error}
      </div>
    )
  }
  if (!url) return null
  return <>{renderUrl(url)}</>
}

function OtherFormatState({
  ext,
  artifact,
}: {
  ext: string
  artifact: GeneratedArtifact
}) {
  return (
    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.75 }}>
      <p style={{ margin: 0 }}>
        {ext || '此格式'} 文件不支持在线预览,可点右上「下载」获取。
      </p>
      {artifact.description && (
        <p
          style={{
            margin: '12px 0 0',
            padding: '10px 12px',
            background: 'var(--bg-tint)',
            borderRadius: 'var(--r-sm)',
            color: 'var(--ink)',
          }}
        >
          {artifact.description}
        </p>
      )}
    </div>
  )
}

function GeneratedArtifactState({ canDownload }: { canDownload: boolean }) {
  return (
    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.75 }}>
      这份产出尚未保存为项目文档，暂不支持在线预览。
      {canDownload ? (
        <>
          <br />
          可点击右上角「下载」获取原始产出。
        </>
      ) : (
        <>
          <br />
          当前记录没有可用的下载来源。
        </>
      )}
    </div>
  )
}
