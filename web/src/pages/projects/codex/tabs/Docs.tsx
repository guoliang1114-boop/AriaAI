import { useMemo, useState, type CSSProperties } from 'react'
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

function dateText(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
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
                      setSel({ folder: g.id, file: 0 })
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

        {/* RIGHT — folder contents */}
        <div style={{ overflow: 'auto', padding: '20px 32px 32px', minWidth: 0 }}>
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
                  <span className="num" style={{ color: 'var(--ink-faint)', marginLeft: 4 }}>
                    {cur.files.length}
                  </span>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
              {cur && cur.id !== UNFILED_ID && (
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
              )}
            </div>
          </div>

          {!cur || cur.files.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 0',
                fontSize: 13,
                color: 'var(--ink-faint)',
              }}
            >
              {cur ? `${cur.name} 中暂无文件` : '还没有上传任何文件。'}
            </div>
          ) : (
            <div>
              {cur.files.map((d, i) => (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSel({ folder: cur.id, file: i })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSel({ folder: cur.id, file: i })
                  }}
                  className="row-hov"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '50px 1fr 100px 90px 22px',
                    padding: '14px 8px',
                    gap: 14,
                    alignItems: 'flex-start',
                    borderBottom: '1px solid var(--line-soft)',
                    borderRadius: 'var(--r-sm)',
                    cursor: 'pointer',
                    background:
                      sel.folder === cur.id && sel.file === i ? 'var(--bg-tint)' : 'transparent',
                    textAlign: 'left',
                    width: '100%',
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
                    {extOf(d)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>
                      {d.name}
                    </div>
                    {d.summary && (
                      <p
                        style={{
                          margin: '3px 0 6px',
                          fontSize: 12.5,
                          color: 'var(--ink-soft)',
                          lineHeight: 1.55,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical' as CSSProperties['WebkitBoxOrient'],
                        }}
                      >
                        {d.summary}
                      </p>
                    )}
                    {d.origin && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 11,
                          color: 'var(--ink-mute)',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span>{d.origin}</span>
                      </div>
                    )}
                  </div>
                  <span className="num" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                    {sizeText(d.size)}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                    {dateText(d.uploaded_at)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeletingFile(d)
                    }}
                    title="删除"
                    style={{
                      padding: 4,
                      color: 'var(--ink-faint)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      alignSelf: 'flex-start',
                    }}
                  >
                    <CxIcon name="trash" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
      className="row-hov"
      onClick={onClick}
      role="button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 6px',
        paddingLeft: 6 + depth * 14,
        margin: '0 -6px',
        borderRadius: 'var(--r-sm)',
        cursor: 'pointer',
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
