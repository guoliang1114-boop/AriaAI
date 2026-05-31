import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client'
import { MarkdownRenderer } from '../../../components/MarkdownRenderer'
import type { GeneratedArtifact } from '../../../types/api'
import { CxIcon } from './CxIcons'

/** Right-side artifact preview panel — slides in when the user
 * clicks a generated artifact (in a message or in the 空间 tree) or
 * a file row in the 空间 tree.
 *
 * Tabs: 预览 / 源码 / 目录 / 版本.
 *  - 预览: markdown rendered
 *  - 源码: raw text
 *  - 目录: TOC extracted from H1–H4 headings
 *  - 版本: placeholder — backend has a versions endpoint but the
 *    history-restore round-trip isn't worth wiring before someone
 *    actually wants it. Left as "暂无历史版本" so the tab strip
 *    matches the design but doesn't promise capability we don't
 *    have.
 *
 * Only markdown documents (file_type === 'md') are fetchable via
 * `/projects/:id/documents/:file_id`; everything else falls back to
 * metadata + a hint to use the docs tab.
 */

interface PreviewProps {
  projectId: number
  artifact: GeneratedArtifact
  onClose: () => void
}

interface DocumentPayload {
  id: number
  name: string
  content: string
  summary: string | null
  uploaded_at: string | null
}

type TabKey = 'preview' | 'source' | 'toc' | 'versions'

interface TocItem {
  level: number
  text: string
  index: number
}

function extractToc(md: string): TocItem[] {
  const out: TocItem[] = []
  const lines = md.split('\n')
  let i = 0
  for (const line of lines) {
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) out.push({ level: m[1].length, text: m[2].trim(), index: i })
    i++
  }
  return out
}

export function ChatArtifactPreview({ projectId, artifact, onClose }: PreviewProps) {
  const ext = (artifact.file_type || artifact.name.split('.').pop() || '')
    .replace('.', '')
    .toUpperCase()
  const isMd = ext === 'MD'
  const fileId = artifact.project_file_id ?? null

  const [tab, setTab] = useState<TabKey>('preview')
  const [doc, setDoc] = useState<DocumentPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)
    setTab('preview')
    if (!isMd || fileId == null) {
      // Nothing to fetch — non-md or unsaved artifact. The render
      // path handles these states explicitly.
      return
    }
    setLoading(true)
    api
      .get<DocumentPayload>(`/projects/${projectId}/documents/${fileId}`)
      .then((data) => {
        if (cancelled) return
        setDoc(data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, fileId, isMd])

  const content = doc?.content ?? ''
  const toc = useMemo(() => (isMd && content ? extractToc(content) : []), [content, isMd])
  const sizeKb = artifact.size_bytes ? Math.round(artifact.size_bytes / 1024) : null

  return (
    <aside
      style={{
        borderLeft: '1px solid var(--line)',
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
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
            background: isMd ? 'var(--accent-bg)' : 'var(--bg-tint)',
            color: isMd ? 'var(--accent)' : 'var(--ink-mute)',
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
            {isMd ? 'Markdown 预览' : `${ext || '文件'} · 仅元数据`}
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

      {/* Tab strip */}
      <div
        style={{
          padding: '0 16px',
          borderBottom: '1px solid var(--line-soft)',
          display: 'flex',
          gap: 4,
          flexShrink: 0,
        }}
      >
        {(
          [
            { k: 'preview', label: '预览' },
            { k: 'source', label: '源码' },
            { k: 'toc', label: '目录' },
            { k: 'versions', label: '版本' },
          ] as const
        ).map((t) => {
          const active = tab === t.k
          return (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              style={{
                position: 'relative',
                padding: '8px 4px',
                marginRight: 12,
                fontSize: 12.5,
                color: active ? 'var(--ink)' : 'var(--ink-mute)',
                fontWeight: active ? 500 : 400,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {t.label}
              {active && (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: -1,
                    height: 2,
                    background: 'var(--accent)',
                  }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {!isMd ? (
          <NonMarkdownState ext={ext} artifact={artifact} />
        ) : fileId == null ? (
          <UnsavedArtifactState />
        ) : loading ? (
          <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>加载中…</div>
        ) : error ? (
          <div style={{ fontSize: 12, color: 'var(--bad)', lineHeight: 1.6 }}>{error}</div>
        ) : !doc ? null : tab === 'preview' ? (
          <div className="md-root" style={{ fontSize: 13.5, color: 'var(--ink)' }}>
            <MarkdownRenderer content={content} />
          </div>
        ) : tab === 'source' ? (
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.65,
              color: 'var(--ink-soft)',
              fontFamily:
                '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {content}
          </pre>
        ) : tab === 'toc' ? (
          <TocView items={toc} />
        ) : (
          <VersionsPlaceholder />
        )}
      </div>
    </aside>
  )
}

function TocView({ items }: { items: TocItem[] }) {
  if (items.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
        当前文档没有标题
      </div>
    )
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {items.map((it) => (
        <li
          key={`${it.index}-${it.text}`}
          style={{
            padding: '5px 0',
            paddingLeft: (it.level - 1) * 14,
            fontSize: 12.5,
            color: it.level === 1 ? 'var(--ink)' : 'var(--ink-soft)',
            fontWeight: it.level === 1 ? 500 : 400,
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}
        >
          <CxIcon
            name="dot"
            size={6}
            style={{
              color: 'var(--ink-faint)',
              marginRight: 6,
              verticalAlign: 'middle',
            }}
          />
          {it.text}
        </li>
      ))}
    </ul>
  )
}

function VersionsPlaceholder() {
  return (
    <div
      style={{
        fontSize: 12,
        color: 'var(--ink-faint)',
        lineHeight: 1.7,
        padding: '12px 0',
      }}
    >
      暂无历史版本 · 下次保存到项目文档后会出现在这里
    </div>
  )
}

function NonMarkdownState({
  ext,
  artifact,
}: {
  ext: string
  artifact: GeneratedArtifact
}) {
  return (
    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.75 }}>
      <p style={{ margin: 0 }}>
        当前只支持 Markdown 预览。{ext || '此格式'} 文件可前往「文档」Tab 下载查看。
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

function UnsavedArtifactState() {
  return (
    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.75 }}>
      这份产出还没保存为项目文档,无法读取内容。
      <br />
      点击对话里的「保存」按钮把它收入项目文档后即可预览。
    </div>
  )
}
