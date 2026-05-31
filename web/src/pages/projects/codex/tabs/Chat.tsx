import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Conversation, ProjectDetail as ProjectDetailType } from '../../../../types/api'
import { api } from '../../../../api/client'
import { useToast } from '../../../../contexts/ToastContext'
import { CxSkeleton } from '../../../../components/codex'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxStatus } from '../CxPrimitives'
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
  const { project } = detail
  const toast = useToast()
  const navigate = useNavigate()
  const { data: conversations, loading, error, refetch } = useProjectConversations(projectId)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

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
          gridTemplateColumns: '260px 1fr',
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
              marginBottom: 8,
              cursor: creating ? 'wait' : 'pointer',
              opacity: creating ? 0.6 : 1,
            }}
          >
            <CxIcon name="plus" size={13} /> {creating ? '创建中…' : '新建对话'}
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
            />
          ) : (
            <EmptyThread />
          )}
        </div>
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
}

function ThreadView({ projectId, conversationId, conversation, onDeleted }: ThreadViewProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: messages, loading, error } = useConversationMessages(conversationId)
  const [deleting, setDeleting] = useState(false)

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

        {!loading && !error && messages.map((m) => <MessageBubble key={m.id} m={m} />)}
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

function MessageBubble({ m }: { m: { role: string; content: string; created_at: string } }) {
  const isUser = m.role === 'user'
  const time = formatUpdatedRelative(m.created_at)
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 99,
          background: isUser ? 'var(--bg-tint)' : 'var(--accent-bg)',
          color: isUser ? 'var(--ink-soft)' : 'var(--accent)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {isUser ? '你' : <CxIcon name="sparkle" size={14} />}
      </span>
      <div style={{ flex: 1, paddingTop: 4, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-mute)',
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: isUser ? 'var(--ink-soft)' : 'var(--accent-ink)', fontWeight: 500 }}>
            {isUser ? '我' : 'Aria'}
          </span>
          <span>{time}</span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.75,
            color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {m.content}
        </p>
      </div>
    </div>
  )
}
