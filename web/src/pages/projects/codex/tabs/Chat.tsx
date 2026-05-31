import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  Conversation,
  ProjectDetail as ProjectDetailType,
  ProjectFile,
} from '../../../../types/api'
import { api } from '../../../../api/client'
import { useToast } from '../../../../contexts/ToastContext'
import { CxSkeleton } from '../../../../components/codex'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxStatus } from '../CxPrimitives'
import { CxConversationRenameDialog } from '../CxConversationActions'
import { ProjectChatMessage } from '../ChatMessage'
import {
  formatUpdatedRelative,
  useConversationMessages,
  useProjectConversations,
} from '../useProjectsApi'

interface ChatProps {
  projectId: number
  detail: ProjectDetailType
}

/** Project chat tab — read-only conversation list + thread view.
 *
 * Sending new messages still goes through the global /chat page
 * because that's where the streaming pipeline + tool-call UI lives.
 * The composer here just deep-links you in with the conversation
 * preselected. New-conversation creates an empty conversation and
 * jumps you to the global chat page so the first message flows
 * through the proper stream. */
export function CxProjectChat({ projectId, detail }: ChatProps) {
  const { project, files, folders } = detail
  const toast = useToast()
  const navigate = useNavigate()
  const { data: conversations, loading, error, refetch } = useProjectConversations(projectId)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [expandedFileId, setExpandedFileId] = useState<number | null>(null)

  // Auto-select the most recently-updated conversation when the list
  // arrives or refreshes. Don't overwrite the user's explicit pick.
  useEffect(() => {
    if (selectedId != null) return
    if (conversations.length > 0) setSelectedId(conversations[0].id)
  }, [conversations, selectedId])

  const handleNewConversation = async () => {
    if (creating) return
    setCreating(true)
    try {
      const conv = await api.post<Conversation>('/chat/conversations', {
        project_id: projectId,
      })
      navigate(`/chat?conversation=${conv.id}&project=${projectId}`)
    } catch (err) {
      toast.error({
        title: '创建失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
      setCreating(false)
    }
  }

  return (
    <CxProjectShell activeTab="chat" projectId={projectId} project={project}>
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: showFiles ? '260px 1fr 340px' : '260px 1fr',
          minHeight: 0,
        }}
      >
        {/* Conversation list */}
        <aside
          style={{
            borderRight: '1px solid var(--line)',
            padding: '20px 14px',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <button
            type="button"
            onClick={handleNewConversation}
            disabled={creating}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 12px',
              background: 'var(--ink)',
              color: 'var(--bg-elev)',
              borderRadius: 'var(--r-sm)',
              fontSize: 13,
              fontWeight: 500,
              cursor: creating ? 'wait' : 'pointer',
              opacity: creating ? 0.6 : 1,
            }}
          >
            <CxIcon name="plus" size={13} /> {creating ? '创建中…' : '新建对话'}
          </button>
          <button
            type="button"
            onClick={() => setShowFiles((v) => !v)}
            className="row-hov"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              fontSize: 12.5,
              color: showFiles ? 'var(--accent)' : 'var(--ink-mute)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              marginTop: 6,
              marginBottom: 8,
              background: showFiles ? 'var(--accent-bg)' : 'transparent',
            }}
          >
            <CxIcon name="file" size={12} />
            {showFiles ? '隐藏项目文件' : '查看项目文件'}
          </button>

          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 10px' }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0' }}
                >
                  <CxSkeleton w="80%" h={11} />
                  <CxSkeleton w={60} h={9} />
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <div style={{ fontSize: 12, color: 'var(--bad)', padding: '8px 10px' }}>
              {error}
            </div>
          )}

          {!loading && !error && conversations.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--ink-faint)',
                padding: '24px 10px',
                textAlign: 'center',
                lineHeight: 1.6,
              }}
            >
              还没有项目对话。
              <br />
              点击「新建对话」开始第一段。
            </div>
          )}

          {!loading && !error && conversations.length > 0 && (
            <ConversationGroups
              conversations={conversations}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </aside>

        {/* Thread column */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedId != null ? (
            <ThreadView
              key={selectedId}
              projectId={projectId}
              conversationId={selectedId}
              conversation={conversations.find((c) => c.id === selectedId) ?? null}
              onDeleted={async () => {
                setSelectedId(null)
                await refetch()
              }}
              onChanged={refetch}
            />
          ) : (
            <EmptyThread />
          )}
        </div>

        {/* Optional files preview pane */}
        {showFiles && (
          <FilesPane
            files={files}
            folders={folders}
            expandedFileId={expandedFileId}
            onToggleFile={(id) => setExpandedFileId(expandedFileId === id ? null : id)}
            onClose={() => setShowFiles(false)}
          />
        )}
      </div>
    </CxProjectShell>
  )
}

/** Group conversations into "今天 / 昨天 / 更早" buckets. */
function ConversationGroups({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const today: Conversation[] = []
  const yesterday: Conversation[] = []
  const older: Conversation[] = []
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  for (const c of conversations) {
    const ts = new Date(c.updated_at.endsWith('Z') ? c.updated_at : `${c.updated_at}Z`).getTime()
    if (ts >= startOfToday) today.push(c)
    else if (ts >= startOfYesterday) yesterday.push(c)
    else older.push(c)
  }
  return (
    <>
      {today.length > 0 && (
        <ConversationBucket label="今天" items={today} selectedId={selectedId} onSelect={onSelect} />
      )}
      {yesterday.length > 0 && (
        <ConversationBucket
          label="昨天"
          items={yesterday}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
      {older.length > 0 && (
        <ConversationBucket label="更早" items={older} selectedId={selectedId} onSelect={onSelect} />
      )}
    </>
  )
}

function ConversationBucket({
  label,
  items,
  selectedId,
  onSelect,
}: {
  label: string
  items: Conversation[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  return (
    <>
      <div style={{ color: 'var(--ink-faint)', fontSize: 11, padding: '8px 10px 4px' }}>
        {label}
      </div>
      {items.map((c) => {
        const active = c.id === selectedId
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className="row-hov"
            style={{
              display: 'block',
              padding: '8px 10px',
              borderRadius: 'var(--r-sm)',
              background: active ? 'var(--bg-tint)' : 'transparent',
              position: 'relative',
              textAlign: 'left',
              width: '100%',
            }}
          >
            {active && (
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 8,
                  bottom: 8,
                  width: 2,
                  background: 'var(--accent)',
                  borderRadius: 99,
                }}
              />
            )}
            <div
              style={{
                fontSize: 13,
                color: active ? 'var(--ink)' : 'var(--ink-soft)',
                fontWeight: active ? 500 : 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {c.title || `对话 #${c.id}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
              {formatUpdatedRelative(c.updated_at)}
            </div>
          </button>
        )
      })}
    </>
  )
}

function EmptyThread() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 40px',
      }}
    >
      <div
        style={{
          maxWidth: 360,
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--ink-faint)',
          lineHeight: 1.7,
        }}
      >
        在左侧选择一段对话查看消息,或点「新建对话」开始一段新的。
      </div>
    </div>
  )
}

interface ThreadViewProps {
  projectId: number
  conversationId: number
  conversation: Conversation | null
  onDeleted: () => Promise<void>
  onChanged: () => Promise<void>
}

function ThreadView({ projectId, conversationId, conversation, onDeleted, onChanged }: ThreadViewProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: messages, loading, error } = useConversationMessages(conversationId)
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const handleDelete = async () => {
    if (deleting) return
    if (!confirm('删除这段对话?消息记录将一并移除。')) return
    setDeleting(true)
    try {
      await api.delete(`/chat/conversations/${conversationId}`)
      toast.success({ title: '对话已删除' })
      await onDeleted()
    } catch (err) {
      toast.error({
        title: '删除失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
      setDeleting(false)
    }
  }

  return (
    <>
      {/* Title strip */}
      <div
        style={{
          padding: '18px 40px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            className="ui"
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 500,
              color: 'var(--ink)',
              letterSpacing: '-0.015em',
            }}
          >
            {conversation?.title || `对话 #${conversationId}`}
          </h2>
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-mute)',
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span>项目对话</span>
            <span style={{ color: 'var(--ink-faint)' }}>·</span>
            <span>{messages.length} 条消息</span>
            {conversation?.updated_at && (
              <>
                <span style={{ color: 'var(--ink-faint)' }}>·</span>
                <span>{formatUpdatedRelative(conversation.updated_at)}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => setRenaming(true)}
            title="重命名"
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              color: 'var(--ink-soft)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <CxIcon name="edit" size={11} /> 重命名
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              color: 'var(--bad)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              cursor: deleting ? 'wait' : 'pointer',
            }}
          >
            {deleting ? '删除中…' : '删除'}
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(`/chat?conversation=${conversationId}&project=${projectId}`)
            }
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              color: 'var(--bg-elev)',
              background: 'var(--ink)',
              borderRadius: 'var(--r-sm)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            打开 <CxIcon name="arrow-right" size={11} />
          </button>
        </div>
      </div>
      <CxConversationRenameDialog
        open={renaming}
        conversation={conversation}
        onClose={() => setRenaming(false)}
        onSaved={onChanged}
      />

      {/* Messages */}
      <div
        style={{
          flex: 1,
          padding: '28px 56px',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          width: '100%',
        }}
      >
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 14 }}>
                <CxSkeleton w={30} h={30} radius={99} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <CxSkeleton w={80} h={9} />
                  <CxSkeleton w="92%" h={11} />
                  <CxSkeleton w="84%" h={11} />
                  <CxSkeleton w="70%" h={11} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div style={{ fontSize: 13, color: 'var(--bad)' }}>{error}</div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--ink-faint)',
              padding: '48px 0',
              lineHeight: 1.7,
            }}
          >
            这段对话还没有消息。
            <br />
            点右上「打开」前往对话页发送第一条。
          </div>
        )}

        {!loading &&
          !error &&
          messages.map((m) => (
            <ProjectChatMessage key={m.id} message={m} projectId={projectId} />
          ))}
      </div>

      {/* Composer placeholder */}
      <div style={{ padding: '0 56px 22px', width: '100%' }}>
        <button
          type="button"
          onClick={() => navigate(`/chat?conversation=${conversationId}&project=${projectId}`)}
          style={{
            width: '100%',
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: '14px 16px',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <div
            className="ui"
            style={{ fontSize: 14, color: 'var(--ink-faint)', minHeight: 24 }}
          >
            继续向 Aria 提问…
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--line-soft)',
              fontSize: 12,
              color: 'var(--ink-mute)',
            }}
          >
            <CxStatus tone="mute">在对话页继续</CxStatus>
            <span
              style={{
                padding: '4px 12px',
                background: 'var(--accent)',
                color: 'var(--bg-elev)',
                borderRadius: 'var(--r-sm)',
                fontSize: 12.5,
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              打开 <CxIcon name="arrow-right" size={11} stroke={1.8} />
            </span>
          </div>
        </button>
      </div>
    </>
  )
}

interface FilesPaneProps {
  files: ProjectFile[]
  folders: ProjectDetailType['folders']
  expandedFileId: number | null
  onToggleFile: (id: number) => void
  onClose: () => void
}

/** Right-side files panel — variant of the chat-preview design. Shows
 * project files grouped by folder; clicking a row expands its summary
 * + metadata inline. */
function FilesPane({ files, folders, expandedFileId, onToggleFile, onClose }: FilesPaneProps) {
  const visible = files.filter((f) => !f.deleted_at)
  const folderById = new Map(folders.map((f) => [f.id, f.name]))
  const grouped: Array<{ id: number; name: string; files: ProjectFile[] }> = []
  const seen = new Set<number>()
  for (const f of [...folders].sort((a, b) => a.sort_order - b.sort_order)) {
    const items = visible.filter((v) => v.folder_id === f.id)
    if (items.length > 0) {
      grouped.push({ id: f.id, name: f.name, files: items })
      seen.add(f.id)
    }
  }
  const unfiled = visible.filter((v) => v.folder_id == null || !folderById.has(v.folder_id))
  if (unfiled.length > 0) {
    grouped.push({ id: -1, name: '未分类', files: unfiled })
  }

  return (
    <aside
      style={{
        borderLeft: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-elev)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div>
          <h3 className="ui" style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
            项目文件
          </h3>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
            {visible.length} 份 · 点击展开摘要
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
          }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
        {grouped.length === 0 ? (
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--ink-faint)',
              textAlign: 'center',
              padding: '32px 12px',
              lineHeight: 1.7,
            }}
          >
            还没有上传任何文件。
            <br />
            前往「文档」Tab 上传。
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.id} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 10.5,
                  color: 'var(--ink-faint)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '4px 4px 6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <CxIcon name="folder" size={11} style={{ color: 'var(--ink-faint)' }} />
                {g.name} · {g.files.length}
              </div>
              {g.files.map((f) => (
                <FileEntry
                  key={f.id}
                  file={f}
                  expanded={f.id === expandedFileId}
                  onToggle={() => onToggleFile(f.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

function FileEntry({
  file,
  expanded,
  onToggle,
}: {
  file: ProjectFile
  expanded: boolean
  onToggle: () => void
}) {
  const ext = (file.file_type || file.name.split('.').pop() || '').replace('.', '').toUpperCase().slice(0, 4) || '—'
  const highlight = ext === 'MD' || ext === 'MEM'
  const sizeKb = file.size ? Math.round(file.size / 1024) : 0
  return (
    <div
      style={{
        marginBottom: 6,
        border: expanded ? '1px solid var(--accent)' : '1px solid var(--line-soft)',
        borderRadius: 'var(--r-sm)',
        background: expanded ? 'var(--bg)' : 'transparent',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="row-hov"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
        }}
      >
        <span
          style={{
            fontSize: 9,
            color: highlight ? 'var(--accent)' : 'var(--ink-mute)',
            padding: '2px 5px',
            border: `1px solid ${highlight ? 'var(--accent-bg)' : 'var(--line)'}`,
            background: highlight ? 'var(--accent-bg)' : 'transparent',
            borderRadius: 2,
            flexShrink: 0,
            letterSpacing: '0.04em',
            minWidth: 28,
            textAlign: 'center',
          }}
        >
          {ext}
        </span>
        <span
          className="ui"
          style={{
            flex: 1,
            fontSize: 12.5,
            color: 'var(--ink)',
            fontWeight: expanded ? 500 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.name}
        </span>
        <CxIcon
          name="chevron-down"
          size={10}
          style={{
            color: 'var(--ink-faint)',
            transform: expanded ? 'rotate(180deg)' : undefined,
            transition: 'transform 120ms ease',
          }}
        />
      </button>
      {expanded && (
        <div
          style={{
            padding: '0 12px 12px',
            borderTop: '1px solid var(--line-soft)',
          }}
        >
          {file.summary && (
            <p
              style={{
                margin: '10px 0 8px',
                fontSize: 12,
                color: 'var(--ink-soft)',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {file.summary}
            </p>
          )}
          <div
            style={{
              fontSize: 11,
              color: 'var(--ink-mute)',
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              paddingTop: file.summary ? 0 : 10,
            }}
          >
            {sizeKb > 0 && <span className="num">{sizeKb} KB</span>}
            {file.uploaded_at && <span>{file.uploaded_at.slice(0, 10)}</span>}
            {file.origin && <span>{file.origin}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

