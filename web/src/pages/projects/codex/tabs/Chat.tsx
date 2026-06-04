import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  Conversation,
  GeneratedArtifact,
  Message,
  ProjectDetail as ProjectDetailType,
} from '../../../../types/api'
import { api } from '../../../../api/client'
import { useToast } from '../../../../contexts/ToastContext'
import { CxConfirmDialog, CxSkeleton } from '../../../../components/codex'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxConversationRenameDialog } from '../CxConversationActions'
import { ProjectChatMessage } from '../ChatMessage'
import { ChatArtifactPreview } from '../ChatArtifactPreview'
import { ChatEmptyState } from '../ChatEmptyState'
import { ChatSpaceTree } from '../ChatSpaceTree'
import {
  useChatStream,
  type ChatCapabilityFrame,
  type ChatStreamStatus,
} from '../useChatStream'
import {
  formatUpdatedRelative,
  useConversationMessages,
  useProjectConversations,
} from '../useProjectsApi'

interface ChatProps {
  projectId: number
  detail: ProjectDetailType
}

/** Project chat tab — full two-way chat in the project shell.
 *
 * Layout: 260px left rail (segmented 对话 / 空间) + 1fr thread +
 * optional 380px artifact preview pane on the right. Messages,
 * pending sends, and the SSE streaming hook all live here at the
 * parent so the 空间 tree can read the same conversation's
 * artifacts without re-fetching. ThreadView is now a pure renderer
 * + composer that takes everything via props. */
export function CxProjectChat({ projectId, detail }: ChatProps) {
  const { project } = detail
  const toast = useToast()
  const {
    data: conversations,
    loading: convsLoading,
    error: convsError,
    refetch: refetchConvs,
    removeLocal: removeConversationLocal,
  } = useProjectConversations(projectId)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<'chats' | 'space'>('chats')
  const [creating, setCreating] = useState(false)
  const [openArtifact, setOpenArtifact] = useState<GeneratedArtifact | null>(null)
  // Preview pane width is user-resizable via a drag handle on its
  // left edge. Per-session only — we don't bother persisting it.
  const [previewWidth, setPreviewWidth] = useState(380)

  // Conversation messages — lifted out of ThreadView so the 空间
  // tree can list 「本会话产出」 without a duplicate fetch. Pending
  // messages (user + finalized assistant from useChatStream) are
  // layered on top.
  const {
    data: serverMessages,
    loading: msgsLoading,
    error: msgsError,
  } = useConversationMessages(selectedId)
  const [pending, setPending] = useState<Message[]>([])
  useEffect(() => {
    setPending([])
  }, [selectedId])
  const allMessages = useMemo(
    () => (pending.length ? [...serverMessages, ...pending] : serverMessages),
    [serverMessages, pending],
  )

  const {
    status: streamStatus,
    streamingContent,
    statusMessage,
    capability,
    streamingMessageId,
    send,
    stop,
  } = useChatStream({
    projectId,
    conversationId: selectedId,
    onUserMessage: (m) => setPending((prev) => [...prev, m]),
    onAssistantMessage: (m) => setPending((prev) => [...prev, m]),
    onConversationTitle: () => {
      // Backend pushed the in-band auto-title via the SSE
      // ``conversation_title`` event. Refetching the convs list is
      // enough — the rail will pick up the new row state on next
      // render. No polling, no setTimeout.
      void refetchConvs()
    },
    onError: (msg) => toast.error({ title: '发送失败', description: msg }),
  })

  // Auto-select the most recently-updated conversation when the
  // list arrives or refreshes. Don't overwrite the user's pick.
  useEffect(() => {
    if (selectedId != null) return
    if (conversations.length > 0) setSelectedId(conversations[0].id)
  }, [conversations, selectedId])

  // Guard against stale selection — if selectedId points at a
  // conversation that's no longer in the list (deleted in another
  // tab, deleted before this mount finished, etc.), reset to null
  // so the auto-select effect above can pick a fresh row instead
  // of letting useConversationMessages 404 forever.
  useEffect(() => {
    if (selectedId == null) return
    if (convsLoading) return
    if (conversations.length === 0) {
      setSelectedId(null)
      return
    }
    if (!conversations.some((c) => c.id === selectedId)) {
      setSelectedId(null)
    }
  }, [conversations, convsLoading, selectedId])

  // Recovery — if the messages fetch 404s (conversation was
  // deleted on the server but still cached in the list, or some
  // other race), drop the selection and refetch the list so the
  // user lands on a valid conversation.
  useEffect(() => {
    if (!msgsError) return
    if (!msgsError.includes('404')) return
    setSelectedId(null)
    void refetchConvs()
  }, [msgsError, refetchConvs])

  const handleNewConversation = async () => {
    if (creating) return
    setCreating(true)
    try {
      const conv = await api.post<Conversation>('/chat/conversations', {
        project_id: projectId,
      })
      await refetchConvs()
      setSelectedId(conv.id)
    } catch (err) {
      toast.error({
        title: '创建失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setCreating(false)
    }
  }

  const showPreview = openArtifact != null
  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null

  const handleConversationDeleted = async (deletedId: number) => {
    const deletedIndex = conversations.findIndex((item) => item.id === deletedId)
    const remaining = conversations.filter((item) => item.id !== deletedId)
    const nextConversation =
      conversations[deletedIndex + 1] ?? conversations[deletedIndex - 1] ?? remaining[0] ?? null
    removeConversationLocal(deletedId)
    setPending([])
    setOpenArtifact(null)
    setSelectedId((current) => (current === deletedId ? nextConversation?.id ?? null : current))
    void refetchConvs()
  }

  return (
    <CxProjectShell activeTab="chat" projectId={projectId} project={project}>
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: showPreview
            ? `260px minmax(0, 1fr) ${previewWidth}px`
            : '260px minmax(0, 1fr)',
          minHeight: 0,
        }}
      >
        {/* Left rail */}
        <aside
          style={{
            borderRight: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '12px 12px 0', flexShrink: 0 }}>
            <SegmentedSwitcher
              view={view}
              setView={setView}
              chatsCount={conversations.length}
            />
          </div>
          {view === 'chats' ? (
            <ChatsListView
              creating={creating}
              loading={convsLoading}
              error={convsError}
              conversations={conversations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onNew={handleNewConversation}
            />
          ) : (
            <ChatSpaceTree
              projectId={projectId}
              detail={detail}
              conversationMessages={allMessages}
              onOpenArtifact={setOpenArtifact}
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
              conversation={selectedConv}
              detail={detail}
              messages={allMessages}
              messagesLoading={msgsLoading}
              messagesError={msgsError}
              streamStatus={streamStatus}
              streamingContent={streamingContent}
              streamStatusMessage={statusMessage}
              streamingMessageId={streamingMessageId}
              capability={capability}
              onSend={send}
              onStop={stop}
              onOpenArtifact={setOpenArtifact}
              onDeleted={handleConversationDeleted}
              onChanged={refetchConvs}
            />
          ) : (
            <EmptyThread />
          )}
        </div>

        {/* Right preview pane */}
        {showPreview && openArtifact && (
          <ChatArtifactPreview
            projectId={projectId}
            artifact={openArtifact}
            onClose={() => setOpenArtifact(null)}
            width={previewWidth}
            onResize={setPreviewWidth}
          />
        )}
      </div>
    </CxProjectShell>
  )
}

/** Segmented control swapping between the conversation list and the
 * 空间 (project space) tree. Visual style: minimal pill switcher
 * sitting flush at the top of the rail. */
function SegmentedSwitcher({
  view,
  setView,
  chatsCount,
}: {
  view: 'chats' | 'space'
  setView: (v: 'chats' | 'space') => void
  chatsCount: number
}) {
  const items: Array<{ k: 'chats' | 'space'; l: string; n: number | null }> = [
    { k: 'chats', l: '对话', n: chatsCount },
    { k: 'space', l: '空间', n: null },
  ]
  return (
    <div
      style={{
        display: 'flex',
        padding: 2,
        background: 'var(--bg-tint)',
        borderRadius: 'var(--r-sm)',
        border: '1px solid var(--line-soft)',
      }}
    >
      {items.map((t) => {
        const active = view === t.k
        return (
          <button
            key={t.k}
            type="button"
            onClick={() => setView(t.k)}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 'var(--r-sm)',
              background: active ? 'var(--bg-elev)' : 'transparent',
              border: active ? '1px solid var(--line)' : '1px solid transparent',
              fontSize: 12.5,
              color: active ? 'var(--ink)' : 'var(--ink-mute)',
              fontWeight: active ? 500 : 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              cursor: 'pointer',
            }}
          >
            {t.l}
            {t.n != null && (
              <span
                className="num"
                style={{
                  fontSize: 10.5,
                  color: active ? 'var(--accent)' : 'var(--ink-faint)',
                }}
              >
                {t.n}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

interface ChatsListViewProps {
  creating: boolean
  loading: boolean
  error: string | null
  conversations: Conversation[]
  selectedId: number | null
  onSelect: (id: number) => void
  onNew: () => void
}

/** The 对话 (conversations) view inside the left rail. Extracted so
 * the segmented switcher's body can swap to ChatSpaceTree cleanly. */
function ChatsListView({
  creating,
  loading,
  error,
  conversations,
  selectedId,
  onSelect,
  onNew,
}: ChatsListViewProps) {
  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '10px 14px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <button
        type="button"
        onClick={onNew}
        disabled={creating}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--ink)',
          color: 'var(--bg-elev)',
          borderRadius: 'var(--r-sm)',
          fontSize: 12.5,
          fontWeight: 500,
          cursor: creating ? 'wait' : 'pointer',
          opacity: creating ? 0.6 : 1,
          marginBottom: 6,
        }}
      >
        <CxIcon name="plus" size={12} /> {creating ? '创建中…' : '新建对话'}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, opacity: 0.6 }}>⌘N</span>
      </button>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>
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
        <div style={{ fontSize: 12, color: 'var(--bad)', padding: '8px 4px' }}>
          {error}
        </div>
      )}

      {!loading && !error && conversations.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-faint)',
            padding: '24px 4px',
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
          onSelect={onSelect}
        />
      )}
    </div>
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
  detail: ProjectDetailType
  messages: Message[]
  messagesLoading: boolean
  messagesError: string | null
  streamStatus: ChatStreamStatus
  streamingContent: string
  streamStatusMessage: string | null
  streamingMessageId: number
  capability: ChatCapabilityFrame | null
  onSend: (text: string) => Promise<void>
  onStop: () => void
  onOpenArtifact: (artifact: GeneratedArtifact) => void
  onDeleted: (conversationId: number) => Promise<void> | void
  onChanged: () => Promise<void>
}

function ThreadView({
  projectId,
  conversationId,
  conversation,
  detail,
  messages,
  messagesLoading,
  messagesError,
  streamStatus,
  streamingContent,
  streamStatusMessage,
  streamingMessageId,
  capability,
  onSend,
  onStop,
  onOpenArtifact,
  onDeleted,
  onChanged,
}: ThreadViewProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Composer text is lifted here so the empty-state prompts can
  // seed it. Cleared on send.
  const [composerText, setComposerText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll while a reply is streaming. Cheap to do every
  // render — the diff is append-only.
  useEffect(() => {
    if (streamStatus === 'streaming' || streamStatus === 'sending') {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'auto',
      })
    }
  }, [streamStatus, streamingContent])

  // Also snap to bottom whenever the displayed messages count grows
  // (new send, new conversation arrived, etc.). Use 'auto' (not 'smooth'):
  // the count bumps at stream-end, the same frame the final message first
  // mounts its full MarkdownRenderer — a smooth-scroll animation there
  // competes with that render and shows as a stutter.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'auto',
    })
  }, [messages.length])

  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await api.delete(`/chat/conversations/${conversationId}`)
      toast.success({ title: '对话已删除' })
      setConfirmDelete(false)
      await onDeleted(conversationId)
    } catch (err) {
      toast.error({
        title: '删除失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
      setDeleting(false)
    }
  }

  const busy = streamStatus === 'sending' || streamStatus === 'streaming'

  // Throttle the live reply so Markdown re-parses ~12×/s, not per SSE token.
  const throttledStreaming = useThrottledValue(streamingContent, 80)
  // Render the in-flight reply as a draft message appended to the list — same
  // component and React key the final message will use — so `done` updates the
  // node in place (artifact card slides in) instead of remounting it.
  const renderMessages: Message[] = busy
    ? [
        ...messages,
        {
          id: streamingMessageId,
          conversation_id: conversationId,
          role: 'assistant',
          content: throttledStreaming,
          metadata_json: '',
          created_at: new Date().toISOString(),
        },
      ]
    : messages

  return (
    <>
      {/* Compact 48px title bar — mirrors /chat. Title only on the
       * left, ⋯ menu on the right. The old meta line (项目对话 · N 条
       * 消息 · 更新时间) and inline 重命名 / 删除 / 打开 buttons are
       * gone; rename + delete now live in the menu, and the bottom
       * composer already deep-links into /chat. */}
      <div
        style={{
          height: 48,
          padding: '0 28px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          borderBottom: '1px solid var(--line)',
          background: 'color-mix(in oklch, var(--bg-elev) 50%, var(--bg))',
          flexShrink: 0,
        }}
      >
        <h2
          className="ui"
          style={{
            margin: 0,
            flex: 1,
            minWidth: 0,
            fontSize: 14.5,
            fontWeight: 500,
            color: 'var(--ink)',
            letterSpacing: '-0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {conversation?.title || `对话 #${conversationId}`}
        </h2>
        <ConversationMenu
          onRename={() => setRenaming(true)}
          onDelete={() => setConfirmDelete(true)}
          onOpenInChat={() =>
            navigate(`/chat?conversation=${conversationId}&project=${projectId}`)
          }
          deleting={deleting}
        />
      </div>
      <CxConversationRenameDialog
        open={renaming}
        conversation={conversation}
        onClose={() => setRenaming(false)}
        onSaved={onChanged}
      />
      <CxConfirmDialog
        open={confirmDelete}
        onClose={() => {
          if (!deleting) setConfirmDelete(false)
        }}
        onConfirm={handleDelete}
        title="删除这段对话?"
        description="对话和所有消息记录将一并移除,此操作不可撤销。"
        tone="danger"
        confirmLabel={deleting ? '删除中…' : '删除'}
        busy={deleting}
      />

      {/* Messages */}
      <div
        ref={scrollRef}
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
        {capability && <CapabilityPill capability={capability} />}

        {messagesLoading && (
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

        {!messagesLoading && messagesError && (
          <div style={{ fontSize: 13, color: 'var(--bad)' }}>{messagesError}</div>
        )}

        {!messagesLoading && !messagesError && messages.length === 0 && !busy && (
          <ChatEmptyState
            projectId={projectId}
            detail={detail}
            onSelectPrompt={(text) => {
              setComposerText(text)
              // Defer focus until the empty-state-to-composer
              // transition stabilizes.
              setTimeout(() => textareaRef.current?.focus(), 0)
            }}
          />
        )}

        {!messagesLoading &&
          !messagesError &&
          renderMessages.map((m) => (
            <ProjectChatMessage
              key={m.id}
              message={m}
              projectId={projectId}
              onArtifactClick={onOpenArtifact}
              isStreaming={busy && m.id === streamingMessageId}
              streamingStatus={streamStatusMessage}
            />
          ))}
      </div>

      {/* Composer */}
      <div style={{ padding: '0 56px 22px', width: '100%' }}>
        <Composer
          value={composerText}
          onChange={setComposerText}
          onSend={async (text) => {
            setComposerText('')
            await onSend(text)
          }}
          onStop={onStop}
          disabled={busy}
          textareaRef={textareaRef}
        />
      </div>
    </>
  )
}

interface ConversationMenuProps {
  onRename: () => void
  onDelete: () => void
  onOpenInChat: () => void
  deleting: boolean
}

/** ⋯ dropdown for the conversation title bar. Click-outside +
 * Escape close. Items: 在对话页打开 / 重命名 / (separator) / 删除. */
function ConversationMenu({ onRename, onDelete, onOpenInChat, deleting }: ConversationMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const itemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '7px 10px',
    fontSize: 12.5,
    color: 'var(--ink-soft)',
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--r-sm)',
    textAlign: 'left' as const,
    width: '100%',
    cursor: 'pointer',
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="对话菜单"
        title="更多"
        style={{
          width: 30,
          height: 30,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-mute)',
          background: open ? 'var(--bg-tint)' : 'transparent',
          border: 'none',
          borderRadius: 'var(--r-sm)',
          cursor: 'pointer',
        }}
      >
        <CxIcon name="more" size={14} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            minWidth: 160,
            padding: 5,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 14px 34px -14px rgba(0,0,0,0.45)',
            zIndex: 50,
          }}
        >
          <button
            type="button"
            className="row-hov"
            onClick={() => {
              setOpen(false)
              onOpenInChat()
            }}
            style={itemStyle}
          >
            <CxIcon name="arrow-up-right" size={12} stroke={1.5} />
            在对话页打开
          </button>
          <button
            type="button"
            className="row-hov"
            onClick={() => {
              setOpen(false)
              onRename()
            }}
            style={itemStyle}
          >
            <CxIcon name="edit" size={12} stroke={1.5} />
            重命名
          </button>
          <span
            aria-hidden="true"
            style={{
              height: 1,
              margin: '4px 6px',
              background: 'var(--line-soft)',
            }}
          />
          <button
            type="button"
            className="row-hov"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            disabled={deleting}
            style={{
              ...itemStyle,
              color: 'var(--bad)',
              cursor: deleting ? 'wait' : 'pointer',
            }}
          >
            <CxIcon name="trash" size={12} stroke={1.5} />
            {deleting ? '删除中…' : '删除'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
 * Composer — autosizing textarea + send button. Enter sends,
 * Shift+Enter inserts a newline. Disabled while a stream is in
 * flight. Intentionally minimal: no Skill picker, no @-mention, no
 * file attach — those live on /chat and aren't part of the
 * "直接沟通" MVP for the project chat tab.
 * ──────────────────────────────────────────────────────────────── */
function Composer({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  textareaRef,
}: {
  value: string
  onChange: (next: string) => void
  onSend: (text: string) => void | Promise<void>
  onStop: () => void
  disabled: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const autosize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }

  useEffect(() => {
    autosize()
    // textareaRef is stable across renders; autosize reads .current
    // imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text || disabled) return
    void onSend(text)
  }

  return (
    <div
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '12px 14px',
        opacity: disabled ? 0.85 : 1,
        transition: 'opacity 120ms',
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={disabled ? 'Aria 正在回复…' : '继续向 Aria 提问…'}
        rows={1}
        disabled={disabled}
        style={{
          width: '100%',
          minHeight: 24,
          maxHeight: 220,
          padding: 0,
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--ink)',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: 'inherit',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--line-soft)',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
          Enter 发送 · Shift+Enter 换行
        </span>
        <button
          type="button"
          onClick={disabled ? onStop : submit}
          disabled={!disabled && !value.trim()}
          style={{
            padding: '5px 14px',
            background: disabled ? 'var(--ink)' : 'var(--accent)',
            color: 'var(--bg-elev)',
            borderRadius: 'var(--r-sm)',
            fontSize: 12.5,
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            opacity: !disabled && !value.trim() ? 0.5 : 1,
            cursor: !disabled && !value.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {disabled ? (
            <>
              停止 <CxIcon name="stop" size={10} stroke={1.8} />
            </>
          ) : (
            <>
              发送 <CxIcon name="arrow-right" size={11} stroke={1.8} />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
 * CapabilityPill — dev-only observability strip. Renders the
 * action_policy / tool_access / intent_reason / tools_granted_count
 * the backend reported for the current turn so researchers can
 * answer "why didn't Aria use a tool?" without trawling logs.
 * Shown only when import.meta.env.DEV is truthy; prod users never
 * see this.
 * ──────────────────────────────────────────────────────────────── */
function CapabilityPill({ capability }: { capability: ChatCapabilityFrame }) {
  if (!import.meta.env.DEV) return null
  const writeAllowed = capability.tool_access_policy === 'write_allowed'
  const noTools =
    capability.tool_access_policy === 'none' ||
    capability.tool_access_policy === 'injected_context_only'
  const tone = writeAllowed ? 'var(--good)' : noTools ? 'var(--warn)' : 'var(--ink-mute)'
  return (
    <div
      style={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        fontSize: 10.5,
        color: 'var(--ink-mute)',
        background: 'var(--bg-tint)',
        border: '1px solid var(--line-soft)',
        borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--font-mono, monospace)',
      }}
      title="本轮能力 · backend capability frame · dev only"
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: tone,
        }}
      />
      <span style={{ color: 'var(--ink)' }}>{capability.action_policy}</span>
      <span style={{ color: 'var(--ink-faint)' }}>·</span>
      <span style={{ color: 'var(--ink)' }}>{capability.tool_access_policy}</span>
      <span style={{ color: 'var(--ink-faint)' }}>·</span>
      <span>{capability.tools_granted_count} tools</span>
      {capability.intent_reason && (
        <>
          <span style={{ color: 'var(--ink-faint)' }}>·</span>
          <span>{capability.intent_reason}</span>
        </>
      )}
    </div>
  )
}

/**
 * Throttle a fast-changing value to at most one update per `intervalMs`
 * (leading + trailing). SSE deltas arrive token-by-token; re-parsing Markdown
 * on every token is wasteful and flickers, so the in-flight reply renders a
 * throttled snapshot. The trailing edge guarantees the last delta lands.
 */
function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value)
  const lastRef = useRef(0)
  useEffect(() => {
    const delay = Math.max(0, intervalMs - (Date.now() - lastRef.current))
    const id = window.setTimeout(() => {
      lastRef.current = Date.now()
      setThrottled(value)
    }, delay)
    return () => window.clearTimeout(id)
  }, [value, intervalMs])
  return throttled
}
