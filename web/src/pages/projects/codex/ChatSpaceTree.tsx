import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  GeneratedArtifact,
  Message,
  ProjectDetail,
  ProjectFile,
  ProjectFolder,
} from '../../../types/api'
import { CxIcon } from './CxIcons'

/** Project chat tab · 「空间」 view.
 *
 * A read-only tree rolling up everything the user wants to glance at
 * without leaving the chat: memory version + anchors, file tree,
 * artifacts generated in the current conversation. Items are pure
 * navigation — clicking a memory / anchors node jumps to the memory
 * tab, clicking a file or artifact opens the right-side preview
 * pane. Nothing here mutates state on its own.
 */

interface SpaceTreeProps {
  projectId: number
  detail: ProjectDetail
  conversationMessages: Message[]
  onOpenArtifact: (artifact: GeneratedArtifact) => void
}

interface PinnedSummary {
  risks: number
  questions: number
  stakeholders: number
  total: number
}

function readPinnedSummary(rawJson: string | null | undefined): PinnedSummary {
  if (!rawJson) return { risks: 0, questions: 0, stakeholders: 0, total: 0 }
  try {
    const parsed: unknown = JSON.parse(rawJson)
    if (!parsed || typeof parsed !== 'object') {
      return { risks: 0, questions: 0, stakeholders: 0, total: 0 }
    }
    const obj = parsed as Record<string, unknown>
    const countPinned = (key: string): number => {
      const v = obj[key]
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 0
      const inner = v as Record<string, unknown>
      return Array.isArray(inner.pinned) ? inner.pinned.length : 0
    }
    const risks = countPinned('key_risks')
    const questions = countPinned('open_questions')
    const stakeholders = countPinned('stakeholder_notes')
    return {
      risks,
      questions,
      stakeholders,
      total: risks + questions + stakeholders,
    }
  } catch {
    return { risks: 0, questions: 0, stakeholders: 0, total: 0 }
  }
}

function readArtifacts(messages: Message[]): GeneratedArtifact[] {
  const out: GeneratedArtifact[] = []
  const seen = new Set<string>()
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    if (!m.metadata_json) continue
    try {
      const meta = JSON.parse(m.metadata_json) as Record<string, unknown>
      if (!Array.isArray(meta.artifacts)) continue
      for (const raw of meta.artifacts) {
        const a = raw as GeneratedArtifact
        const key = `${a.project_file_id ?? ''}|${a.path}|${a.name}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(a)
      }
    } catch {
      // skip malformed metadata
    }
  }
  return out
}

export function ChatSpaceTree({
  projectId,
  detail,
  conversationMessages,
  onOpenArtifact,
}: SpaceTreeProps) {
  const navigate = useNavigate()
  const { project, files, folders } = detail

  const pinned = useMemo(
    () => readPinnedSummary(project.context_memory_json),
    [project.context_memory_json],
  )
  const artifacts = useMemo(
    () => readArtifacts(conversationMessages),
    [conversationMessages],
  )
  const visibleFiles = useMemo(() => files.filter((f) => !f.deleted_at), [files])
  // Group files by folder. Folders with no files get omitted; files
  // without a (known) folder land in 未分类.
  const groupedFolders = useMemo(() => {
    const folderById = new Map<number, ProjectFolder>(folders.map((f) => [f.id, f]))
    const groups: Array<{ id: number; name: string; files: ProjectFile[] }> = []
    for (const folder of [...folders].sort((a, b) => a.sort_order - b.sort_order)) {
      const items = visibleFiles.filter((f) => f.folder_id === folder.id)
      if (items.length > 0) groups.push({ id: folder.id, name: folder.name, files: items })
    }
    const unfiled = visibleFiles.filter(
      (f) => f.folder_id == null || !folderById.has(f.folder_id),
    )
    if (unfiled.length > 0) groups.push({ id: -1, name: '未分类', files: unfiled })
    return groups
  }, [folders, visibleFiles])

  // Branch expand/collapse — sticky within a single mount of the
  // chat tab. Defaults open so the user sees structure immediately.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    memory: true,
    anchors: true,
    docs: true,
    outputs: true,
  })
  const toggle = (k: string) => setExpanded((e) => ({ ...e, [k]: !e[k] }))

  const memoryFresh = !project.memory_stale
  const memoryVersion = project.memory_version != null ? `v${project.memory_version}` : '—'

  const goToMemoryTab = () => navigate(`/projects/${projectId}/memory`)

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px 14px' }}>
      {/* === Memory branch === */}
      <TreeRow
        depth={0}
        expandable
        isOpen={expanded.memory}
        icon="sparkle"
        iconColor="var(--accent)"
        label="项目记忆"
        badge={memoryVersion}
        badgeColor={memoryFresh ? 'var(--good)' : 'var(--warn)'}
        onClick={() => toggle('memory')}
      />
      {expanded.memory && (
        <>
          <TreeRow
            depth={1}
            icon="file"
            label={`当前版本 · ${memoryVersion}`}
            dim
            onClick={goToMemoryTab}
          />
          <TreeRow
            depth={1}
            icon="target"
            label={memoryFresh ? '已同步' : '需刷新'}
            dim
            badgeColor={memoryFresh ? 'var(--good)' : 'var(--warn)'}
            onClick={goToMemoryTab}
          />
        </>
      )}

      {/* === Anchors branch === */}
      <TreeRow
        depth={0}
        expandable
        isOpen={expanded.anchors}
        icon="target"
        iconColor="var(--warn)"
        label="锚点"
        badge={pinned.total > 0 ? String(pinned.total) : undefined}
        onClick={() => toggle('anchors')}
      />
      {expanded.anchors && (
        <>
          <TreeRow
            depth={1}
            icon="dot"
            iconColor="var(--bad)"
            label="风险锚点"
            badge={pinned.risks > 0 ? String(pinned.risks) : undefined}
            onClick={goToMemoryTab}
          />
          <TreeRow
            depth={1}
            icon="dot"
            iconColor="var(--warn)"
            label="待确认问题"
            badge={pinned.questions > 0 ? String(pinned.questions) : undefined}
            onClick={goToMemoryTab}
          />
          <TreeRow
            depth={1}
            icon="dot"
            iconColor="var(--info)"
            label="干系人提示"
            badge={pinned.stakeholders > 0 ? String(pinned.stakeholders) : undefined}
            onClick={goToMemoryTab}
          />
        </>
      )}

      {/* === Documents branch === */}
      <TreeRow
        depth={0}
        expandable
        isOpen={expanded.docs}
        icon="folder"
        iconColor="var(--accent)"
        label="文档"
        badge={visibleFiles.length > 0 ? String(visibleFiles.length) : undefined}
        onClick={() => toggle('docs')}
      />
      {expanded.docs &&
        (groupedFolders.length === 0 ? (
          <div
            style={{
              padding: '8px 14px',
              fontSize: 11.5,
              color: 'var(--ink-faint)',
              lineHeight: 1.6,
            }}
          >
            还没有项目文档
          </div>
        ) : (
          groupedFolders.map((g) => {
            const fk = `docs/${g.id}`
            const open = expanded[fk] ?? true
            return (
              <div key={g.id}>
                <TreeRow
                  depth={1}
                  expandable
                  isOpen={open}
                  icon="folder"
                  iconColor="var(--ink-mute)"
                  label={g.name}
                  badge={String(g.files.length)}
                  onClick={() => toggle(fk)}
                />
                {open &&
                  g.files.map((f) => (
                    <FileRow
                      key={f.id}
                      depth={2}
                      file={f}
                      onClick={() =>
                        onOpenArtifact({
                          project_file_id: f.id,
                          project_id: projectId,
                          name: f.name,
                          file_type: f.file_type,
                          path: f.path,
                          size_bytes: f.size,
                          description: f.summary,
                        })
                      }
                    />
                  ))}
              </div>
            )
          })
        ))}

      {/* === Current-conversation outputs === */}
      <TreeRow
        depth={0}
        expandable
        isOpen={expanded.outputs}
        icon="sparkle"
        iconColor="var(--accent)"
        label="本会话产出"
        badge={artifacts.length > 0 ? String(artifacts.length) : undefined}
        onClick={() => toggle('outputs')}
      />
      {expanded.outputs &&
        (artifacts.length === 0 ? (
          <div
            style={{
              padding: '8px 14px',
              fontSize: 11.5,
              color: 'var(--ink-faint)',
              lineHeight: 1.6,
            }}
          >
            当前对话还没有生成产出
          </div>
        ) : (
          artifacts.map((a, i) => (
            <ArtifactRow
              key={`${a.project_file_id ?? a.path}-${i}`}
              depth={1}
              artifact={a}
              onClick={() => onOpenArtifact(a)}
            />
          ))
        ))}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
 * Tree row primitives. Kept inline because they're tightly coupled
 * to the visual rhythm of this tree.
 * ──────────────────────────────────────────────────────────────── */

interface TreeRowProps {
  depth: number
  icon?: string
  iconColor?: string
  expandable?: boolean
  isOpen?: boolean
  label: string
  badge?: string
  badgeColor?: string
  onClick?: () => void
  dim?: boolean
  active?: boolean
}

function TreeRow({
  depth,
  icon,
  iconColor,
  expandable,
  isOpen,
  label,
  badge,
  badgeColor,
  onClick,
  dim,
  active,
}: TreeRowProps) {
  return (
    <button
      type="button"
      className="row-hov"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 6px',
        paddingLeft: 6 + depth * 14,
        width: '100%',
        margin: '0 -2px',
        borderRadius: 'var(--r-sm)',
        cursor: onClick ? 'pointer' : 'default',
        background: active ? 'var(--bg-tint)' : 'transparent',
        position: 'relative',
        textAlign: 'left',
        border: 'none',
      }}
    >
      {active && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 4,
            bottom: 4,
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
      {icon &&
        (icon === 'dot' ? (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: iconColor || 'var(--ink-mute)',
              flexShrink: 0,
            }}
          />
        ) : (
          <CxIcon
            name={icon}
            size={11}
            stroke={1.5}
            style={{ color: iconColor || 'var(--ink-mute)', flexShrink: 0 }}
          />
        ))}
      <span
        style={{
          fontSize: 12,
          color: dim ? 'var(--ink-mute)' : 'var(--ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {label}
      </span>
      {badge && (
        <span
          className="num"
          style={{ fontSize: 10, color: badgeColor || 'var(--ink-faint)', flexShrink: 0 }}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

function FileRow({
  depth,
  file,
  onClick,
}: {
  depth: number
  file: ProjectFile
  onClick: () => void
}) {
  const ext = (file.file_type || file.name.split('.').pop() || '')
    .replace('.', '')
    .toUpperCase()
    .slice(0, 4)
  const highlight = ext === 'MD' || ext === 'MEM'
  const sizeStr = file.size > 0 ? formatSize(file.size) : ''
  return (
    <button
      type="button"
      className="row-hov"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px',
        paddingLeft: 6 + depth * 14 + 12,
        width: '100%',
        margin: '0 -2px',
        borderRadius: 'var(--r-sm)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
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
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {ext || '—'}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {file.name}
      </span>
      {sizeStr && (
        <span className="num" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
          {sizeStr}
        </span>
      )}
    </button>
  )
}

function ArtifactRow({
  depth,
  artifact,
  onClick,
}: {
  depth: number
  artifact: GeneratedArtifact
  onClick: () => void
}) {
  const ext = (artifact.file_type || artifact.name.split('.').pop() || '')
    .replace('.', '')
    .toUpperCase()
    .slice(0, 4)
  const isMd = ext === 'MD'
  const sizeStr = artifact.size_bytes ? formatSize(artifact.size_bytes) : ''
  return (
    <button
      type="button"
      className="row-hov"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px',
        paddingLeft: 6 + depth * 14 + 12,
        width: '100%',
        margin: '0 -2px',
        borderRadius: 'var(--r-sm)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: isMd ? 'var(--accent)' : 'var(--ink-mute)',
          padding: '1px 4px',
          border: `1px solid ${isMd ? 'var(--accent-bg)' : 'var(--line)'}`,
          background: isMd ? 'var(--accent-bg)' : 'transparent',
          borderRadius: 2,
          flexShrink: 0,
          letterSpacing: '0.04em',
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {ext || '—'}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {artifact.name}
      </span>
      {sizeStr && (
        <span className="num" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
          {sizeStr}
        </span>
      )}
    </button>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}
