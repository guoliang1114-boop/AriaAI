import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type {
  Conversation,
  GeneratedArtifact,
  Message,
  ProjectDetail as ProjectDetailType,
  ProjectMentionables,
  ProjectQuestionReanswerInput,
  ProjectRecoveryCenter as ProjectRecoveryCenterPayload,
  ProjectRecoveryCenterItem,
  SkillSummary,
  TurnRecoveryPreview,
  TurnRevisionInput,
  TurnSetupSuggestion,
  TurnSetupTraceInput,
} from '../../../../types/api'
import type { ContextReceiptEvent, TurnReceiptEvent } from '../../../../types/productRunEvent'
import type { RunActivityTimeline } from '../../../../stores/runActivityReducer'
import { api } from '../../../../api/client'
import { useToast } from '../../../../contexts/ToastContext'
import { contextMemoryLayerLabel } from '../../../../utils/contextReceipt'
import { CxConfirmDialog, CxSkeleton } from '../../../../components/codex'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxConversationRenameDialog } from '../CxConversationActions'
import { ProjectChatMessage } from '../ChatMessage'
import { ChatActionPreview } from '../ChatActionPreview'
import { usePendingActions, type PendingActionBatch } from '../usePendingActions'
import { ChatArtifactPreview } from '../ChatArtifactPreview'
import { ChatEmptyState } from '../ChatEmptyState'
import { ChatSpaceTree } from '../ChatSpaceTree'
import {
  useChatStream,
  type ChatCapabilityFrame,
  type ProjectChatTurnControl,
  type ChatStreamStatus,
} from '../useChatStream'
import {
  ProjectSkillControl,
  type ProjectSkillSelection,
} from '../ProjectSkillControl'
import { ProjectTurnBriefControl } from '../ProjectTurnBriefControl'
import { ConversationContinuityPanel } from '../ConversationContinuityPanel'
import { ProjectInteractionMetricsPanel } from '../ProjectInteractionMetrics'
import { ProjectRecoveryCenter } from '../ProjectRecoveryCenter'
import {
  ProjectTurnRevisionPreview,
  ProjectTurnSetupControl,
} from '../ProjectTurnSetupControl'
import {
  EMPTY_PROJECT_TURN_BRIEF,
  PROJECT_TURN_BRIEF_TEMPLATES,
  applyProjectTurnBriefTemplate,
  buildProjectTurnRevisionInput,
  normalizeTurnBriefConstraints,
  normalizeTurnBriefGoal,
  collectRecentProjectTurnBriefs,
  findProjectTurnRevisionSource,
  projectTurnBriefToInput,
  type ProjectTurnBriefHistoryItem,
  type ProjectTurnReusePayload,
  type ProjectTurnRevisionSource,
  type ProjectTurnBriefDraft,
} from '../turnBrief'
import { SkillCandidateButtons } from '../SkillCandidateButtons'
import { ProjectMentionMenu } from '../ProjectMentionMenu'
import {
  buildProjectMentionOptions,
  filterProjectMentionOptions,
  findActiveProjectMention,
  PROJECT_MENTION_KIND_LABEL,
  pruneSelectedProjectMentions,
  replaceActiveProjectMention,
  rebaseProjectMentionTokens,
  restoreProjectMentionsFromContext,
  selectedProjectMentionsToContext,
  type ActiveProjectMention,
  type ProjectMentionOption,
  type SelectedProjectMention,
} from '../projectMentions'
import {
  buildTurnRecoveryContent,
  buildTurnRecoveryInput,
  isTurnRecoveryPreviewConflict,
  turnRecoveryToastCopy,
} from '../ProjectChatRecovery'
import {
  clearProjectQuestionReanswerDraft,
  loadProjectQuestionReanswerDraft,
  type ProjectQuestionReanswerDraft,
} from '../questionReanswerDraft'
import {
  formatUpdatedRelative,
  useConversationMessages,
  useProjectConversations,
} from '../useProjectsApi'

interface ChatProps {
  projectId: number
  detail: ProjectDetailType
  /** Refetch the aggregated project detail (files, folders, …). Called
   * after a HITAS confirm so a deleted/modified file drops out of the
   * 空间 tree immediately instead of waiting for a manual refresh. */
  refetch?: () => Promise<void>
}

const EMPTY_MENTIONABLES: ProjectMentionables = {
  files: [],
  stakeholders: [],
  milestones: [],
}

/** Project chat tab — full two-way chat in the project shell.
 *
 * Layout: 260px left rail (segmented 对话 / 空间 / 恢复) + 1fr thread +
 * optional 380px artifact preview pane on the right. Messages,
 * pending sends, and the SSE streaming hook all live here at the
 * parent so the 空间 tree can read the same conversation's
 * artifacts without re-fetching. ThreadView is now a pure renderer
 * + composer that takes everything via props. */
export function CxProjectChat({ projectId, detail, refetch }: ChatProps) {
  const { project } = detail
  const toast = useToast()
  const { t } = useTranslation()
  const {
    data: conversations,
    loading: convsLoading,
    error: convsError,
    refetch: refetchConvs,
    removeLocal: removeConversationLocal,
  } = useProjectConversations(projectId)

  const [requestedSelectedId, setRequestedSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<'chats' | 'space' | 'recovery'>('chats')
  const [creating, setCreating] = useState(false)
  const [questionReanswerDraft, setQuestionReanswerDraft] = (
    useState<ProjectQuestionReanswerDraft | null>(() => (
      loadProjectQuestionReanswerDraft(projectId)
    ))
  )
  const questionReanswerAutoCreateRef = useRef<number | null>(null)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [mentionablesState, setMentionablesState] = useState<{
    projectId: number
    items: ProjectMentionables
  }>({ projectId, items: EMPTY_MENTIONABLES })
  const mentionables = mentionablesState.projectId === projectId
    ? mentionablesState.items
    : EMPTY_MENTIONABLES
  const [openArtifact, setOpenArtifact] = useState<GeneratedArtifact | null>(null)
  // Preview pane width is user-resizable via a drag handle on its
  // left edge. Per-session only — we don't bother persisting it.
  const [previewWidth, setPreviewWidth] = useState(380)
  const [recoveryState, setRecoveryState] = useState<{
    projectId: number | null
    data: ProjectRecoveryCenterPayload | null
  }>({ projectId: null, data: null })
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const recoveryRequestRef = useRef(0)
  const [recoveryFocus, setRecoveryFocus] = useState<{
    conversationId: number
    messageId: number | null
    requestId: number
  } | null>(null)
  const recoveryData = recoveryState.projectId === projectId ? recoveryState.data : null
  const selectedId = conversations.some((conversation) => conversation.id === requestedSelectedId)
    ? requestedSelectedId
    : conversations[0]?.id ?? null

  const loadRecoveryCenter = useCallback(async () => {
    const requestId = recoveryRequestRef.current + 1
    recoveryRequestRef.current = requestId
    setRecoveryLoading(true)
    setRecoveryError(null)
    try {
      const data = await api.get<ProjectRecoveryCenterPayload>(
        `/chat/projects/${projectId}/recovery-center`,
      )
      if (recoveryRequestRef.current === requestId) {
        setRecoveryState({ projectId, data })
      }
    } catch (error) {
      if (recoveryRequestRef.current === requestId) {
        setRecoveryError(error instanceof Error ? error.message : '暂时无法加载恢复记录')
      }
    } finally {
      if (recoveryRequestRef.current === requestId) setRecoveryLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadRecoveryCenter()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [loadRecoveryCenter])

  useEffect(() => {
    let active = true
    api
      .get<SkillSummary[]>('/skills/meta/summary')
      .then((items) => {
        if (active) setSkills(items)
      })
      .catch(() => {
        if (active) setSkills([])
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    api
      .get<ProjectMentionables>('/chat/mentionables', { params: { project_id: projectId } })
      .then((items) => {
        if (active) setMentionablesState({ projectId, items })
      })
      .catch(() => {
        if (active) setMentionablesState({ projectId, items: EMPTY_MENTIONABLES })
      })
    return () => {
      active = false
    }
  }, [projectId])

  // Conversation messages — lifted out of ThreadView so the 空间
  // tree can list 「本会话产出」 without a duplicate fetch. Pending
  // messages (user + finalized assistant from useChatStream) are
  // layered on top.
  const {
    data: serverMessages,
    loading: msgsLoading,
    error: msgsError,
    refetch: refetchMessages,
  } = useConversationMessages(selectedId)
  const [pendingState, setPendingState] = useState<{
    conversationId: number | null
    messages: Message[]
  }>({ conversationId: null, messages: [] })
  const allMessages = useMemo(
    () => {
      const pending = pendingState.conversationId === selectedId ? pendingState.messages : []
      return pending.length ? [...serverMessages, ...pending] : serverMessages
    },
    [pendingState, selectedId, serverMessages],
  )

  const {
    status: streamStatus,
    streamingContent,
    statusMessage,
    capability,
    turnReceipt,
    contextReceipt,
    activityTimeline,
    activeRunId,
    streamingMessageId,
    send,
    steer,
    stop,
  } = useChatStream({
    projectId,
    conversationId: selectedId,
    onUserMessage: (message) => setPendingState((current) => ({
      conversationId: selectedId,
      messages: current.conversationId === selectedId
        ? [...current.messages, message]
        : [message],
    })),
    onAssistantMessage: (message) => setPendingState((current) => ({
      conversationId: selectedId,
      messages: current.conversationId === selectedId
        ? [...current.messages, message]
        : [message],
    })),
    onConversationTitle: () => {
      // Backend pushed the in-band auto-title via the SSE
      // ``conversation_title`` event. Refetching the convs list is
      // enough — the rail will pick up the new row state on next
      // render. No polling, no setTimeout.
      void refetchConvs()
    },
    onError: (msg) => toast.error({ title: '发送失败', description: msg }),
  })

  // HITAS — high-risk tool actions the backend paused for confirmation.
  // On confirm/reject the backend writes a result message, so we refetch
  // the thread and drop the local stream-pending layer (now persisted
  // server-side) to avoid duplicates. We also refetch the project detail so
  // a deleted/modified file drops out of the 空间 tree right away (its
  // ``deleted_at`` is now set and ``ChatSpaceTree`` filters those out).
  const pendingActions = usePendingActions(
    selectedId,
    async () => {
      await Promise.all([refetchMessages(), refetch?.()])
      setPendingState({ conversationId: selectedId, messages: [] })
    },
    (msg) => {
      toast.error({
        title: t('chatActionPreview.requestFailed'),
        description:
          msg === 'Action is still executing'
            ? t('chatActionPreview.stillExecuting')
            : msg,
      })
    },
  )
  const refetchPendingActions = pendingActions.refetch

  // A streamed turn may have created pending actions; refetch once the
  // stream settles so the confirm card surfaces.
  const prevStreamStatusRef = useRef<ChatStreamStatus>(streamStatus)
  useEffect(() => {
    const prev = prevStreamStatusRef.current
    prevStreamStatusRef.current = streamStatus
    if (streamStatus === 'idle' && (prev === 'streaming' || prev === 'sending')) {
      void refetchPendingActions()
      void loadRecoveryCenter()
    }
  }, [streamStatus, refetchPendingActions, loadRecoveryCenter])

  // Recovery — if the messages fetch 404s (conversation was
  // deleted on the server but still cached in the list, or some
  // other race), drop the selection and refetch the list so the
  // user lands on a valid conversation.
  useEffect(() => {
    if (!msgsError) return
    if (!msgsError.includes('404')) return
    void refetchConvs()
  }, [msgsError, refetchConvs])

  const handleNewConversation = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const conv = await api.post<Conversation>('/chat/conversations', {
        project_id: projectId,
      })
      await refetchConvs()
      setRequestedSelectedId(conv.id)
    } catch (err) {
      toast.error({
        title: '创建失败',
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    } finally {
      setCreating(false)
    }
  }, [creating, projectId, refetchConvs, toast])

  useEffect(() => {
    if (
      questionReanswerDraft
      && !convsLoading
      && conversations.length === 0
      && !creating
      && questionReanswerAutoCreateRef.current !== projectId
    ) {
      questionReanswerAutoCreateRef.current = projectId
      void handleNewConversation()
    }
  }, [
    conversations.length,
    convsLoading,
    creating,
    handleNewConversation,
    projectId,
    questionReanswerDraft,
  ])

  const showPreview = openArtifact != null
  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null

  const handleConversationDeleted = async (deletedId: number) => {
    const deletedIndex = conversations.findIndex((item) => item.id === deletedId)
    const remaining = conversations.filter((item) => item.id !== deletedId)
    const nextConversation =
      conversations[deletedIndex + 1] ?? conversations[deletedIndex - 1] ?? remaining[0] ?? null
    removeConversationLocal(deletedId)
    setPendingState({ conversationId: selectedId, messages: [] })
    setOpenArtifact(null)
    setRequestedSelectedId((current) => (current === deletedId ? nextConversation?.id ?? null : current))
    void refetchConvs()
  }

  const openRecoveryItem = (item: ProjectRecoveryCenterItem) => {
    const targetMessageId = item.recovery_state === 'continued'
      ? item.child_run?.assistant_message_id ?? item.assistant_message_id ?? null
      : item.assistant_message_id ?? null
    setRecoveryFocus((current) => ({
      conversationId: item.conversation_id,
      messageId: targetMessageId,
      requestId: (current?.requestId ?? 0) + 1,
    }))
    setRequestedSelectedId(item.conversation_id)
    setView('chats')
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
              recoveryCount={recoveryData?.summary.attention_count ?? 0}
            />
          </div>
          {view === 'chats' ? (
            <ChatsListView
              creating={creating}
              loading={convsLoading}
              error={convsError}
              conversations={conversations}
              selectedId={selectedId}
              onSelect={setRequestedSelectedId}
              onNew={handleNewConversation}
            />
          ) : view === 'space' ? (
            <ChatSpaceTree
              projectId={projectId}
              detail={detail}
              conversationMessages={allMessages}
              onOpenArtifact={setOpenArtifact}
            />
          ) : (
            <ProjectRecoveryCenter
              data={recoveryData}
              loading={recoveryLoading}
              error={recoveryError}
              onRefresh={() => { void loadRecoveryCenter() }}
              onOpen={openRecoveryItem}
            />
          )}
        </aside>

        {/* Thread column */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedId != null ? (
            <ThreadView
              key={`${selectedId}:${questionReanswerDraft?.input.contract_sha256 ?? ''}`}
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
              turnReceipt={turnReceipt}
              contextReceipt={contextReceipt}
              activityTimeline={activityTimeline}
              skills={skills}
              mentionables={mentionables}
              canSteer={Boolean(activeRunId && turnReceipt?.steering_supported)}
              pendingActionBatches={pendingActions.batches}
              pendingActionKey={pendingActions.actingKey}
              onConfirmAction={pendingActions.confirm}
              onRejectAction={pendingActions.reject}
              onSend={send}
              onSteer={steer}
              onStop={stop}
              onOpenArtifact={setOpenArtifact}
              onDeleted={handleConversationDeleted}
              onChanged={refetchConvs}
              recoveryFocus={recoveryFocus?.conversationId === selectedId ? recoveryFocus : null}
              questionReanswerDraft={questionReanswerDraft}
              onQuestionReanswerConsumed={() => {
                clearProjectQuestionReanswerDraft(projectId)
                setQuestionReanswerDraft(null)
              }}
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
  recoveryCount,
}: {
  view: 'chats' | 'space' | 'recovery'
  setView: (v: 'chats' | 'space' | 'recovery') => void
  chatsCount: number
  recoveryCount: number
}) {
  const items: Array<{ k: 'chats' | 'space' | 'recovery'; l: string; n: number | null }> = [
    { k: 'chats', l: '对话', n: chatsCount },
    { k: 'space', l: '空间', n: null },
    { k: 'recovery', l: '恢复', n: recoveryCount },
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
  const { t } = useTranslation()
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
        <CxIcon name="plus" size={12} /> {creating ? t('chat.creatingConversation', 'Creating...') : t('chat.newChat', 'New Chat')}
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
          {t('chat.noProjectConversations', 'No project conversations yet.')}
          <br />
          {t('chat.startProjectConversation', 'Click "New Chat" to start.')}
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
  const { t } = useTranslation()
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
        <ConversationBucket label={t('chat.today', 'Today')} items={today} selectedId={selectedId} onSelect={onSelect} />
      )}
      {yesterday.length > 0 && (
        <ConversationBucket
          label={t('chat.yesterday', 'Yesterday')}
          items={yesterday}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
      {older.length > 0 && (
        <ConversationBucket label={t('chat.earlier', 'Earlier')} items={older} selectedId={selectedId} onSelect={onSelect} />
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
  const { t } = useTranslation()
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
              {c.title || t('chat.newConversation', 'New Conversation')}
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
  turnReceipt: TurnReceiptEvent | null
  contextReceipt: ContextReceiptEvent | null
  activityTimeline: RunActivityTimeline | null
  skills: SkillSummary[]
  mentionables: ProjectMentionables
  canSteer: boolean
  pendingActionBatches: PendingActionBatch[]
  pendingActionKey: string | null
  onConfirmAction: (batch: PendingActionBatch) => void
  onRejectAction: (batch: PendingActionBatch) => void
  onSend: (text: string, turnControl?: ProjectChatTurnControl) => Promise<void>
  onSteer: (text: string) => Promise<boolean>
  onStop: () => void
  onOpenArtifact: (artifact: GeneratedArtifact) => void
  onDeleted: (conversationId: number) => Promise<void> | void
  onChanged: () => Promise<void>
  recoveryFocus: { messageId: number | null; requestId: number } | null
  questionReanswerDraft: ProjectQuestionReanswerDraft | null
  onQuestionReanswerConsumed: () => void
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
  turnReceipt,
  contextReceipt,
  activityTimeline,
  skills,
  mentionables,
  canSteer,
  pendingActionBatches,
  pendingActionKey,
  onConfirmAction,
  onRejectAction,
  onSend,
  onSteer,
  onStop,
  onOpenArtifact,
  onDeleted,
  onChanged,
  recoveryFocus,
  questionReanswerDraft,
  onQuestionReanswerConsumed,
}: ThreadViewProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Composer text is lifted here so the empty-state prompts can
  // seed it. Cleared on send.
  const [composerText, setComposerText] = useState(
    questionReanswerDraft?.content ?? '',
  )
  const [skillSelection, setSkillSelection] = useState<ProjectSkillSelection>(
    questionReanswerDraft ? { mode: 'off' } : { mode: 'auto' },
  )
  const [selectedMentions, setSelectedMentions] = useState<SelectedProjectMention[]>([])
  const [turnBriefDraft, setTurnBriefDraft] = useState<ProjectTurnBriefDraft>(EMPTY_PROJECT_TURN_BRIEF)
  const [turnRevisionSource, setTurnRevisionSource] = useState<ProjectTurnRevisionSource | null>(null)
  const [turnSetupSuggestion, setTurnSetupSuggestion] = useState<TurnSetupSuggestion | null>(null)
  const [turnSetupTrace, setTurnSetupTrace] = useState<TurnSetupTraceInput | null>(null)
  const [turnSetupLoading, setTurnSetupLoading] = useState(false)
  const [projectQuestionReanswer, setProjectQuestionReanswer] = (
    useState<ProjectQuestionReanswerInput | null>(
      questionReanswerDraft?.input ?? null,
    )
  )
  const turnSetupRequestRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mentionOptions = useMemo(
    () => buildProjectMentionOptions(skills, mentionables),
    [mentionables, skills],
  )
  const recentTurnBriefs = useMemo(
    () => collectRecentProjectTurnBriefs(messages),
    [messages],
  )
  const currentMentionContext = useMemo(
    () => selectedProjectMentionsToContext(selectedMentions),
    [selectedMentions],
  )
  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant') ?? null,
    [messages],
  )
  const turnRevision = useMemo<TurnRevisionInput | null>(() => (
    turnRevisionSource
      ? buildProjectTurnRevisionInput(turnRevisionSource, {
        content: composerText,
        draft: turnBriefDraft,
        skillMode: skillSelection.mode,
        skillId: skillSelection.mode === 'explicit' ? skillSelection.skillId : undefined,
        mentionContext: currentMentionContext,
      })
      : null
  ), [composerText, currentMentionContext, skillSelection, turnBriefDraft, turnRevisionSource])

  const changeComposerText = (next: string) => {
    turnSetupRequestRef.current += 1
    setTurnSetupSuggestion(null)
    setTurnSetupLoading(false)
    setComposerText(next)
  }

  const changeSkillSelection = (selection: ProjectSkillSelection) => {
    turnSetupRequestRef.current += 1
    setTurnSetupSuggestion(null)
    setTurnSetupLoading(false)
    setSkillSelection(selection)
  }

  const selectSkillForNextTurn = (skillId: number, name: string) => {
    changeSkillSelection({ mode: 'explicit', skillId, name })
    textareaRef.current?.focus()
  }

  const requestTurnSetupSuggestion = async () => {
    const content = composerText.trim()
    if (!content || turnSetupLoading) return
    const requestId = turnSetupRequestRef.current + 1
    turnSetupRequestRef.current = requestId
    setTurnSetupLoading(true)
    setTurnSetupSuggestion(null)
    try {
      const suggestion = await api.post<TurnSetupSuggestion>('/skills/recommendations/turn', {
        project_id: projectId,
        content,
        skill_mode: skillSelection.mode,
        skill_id: skillSelection.mode === 'explicit' ? skillSelection.skillId : undefined,
      })
      if (turnSetupRequestRef.current === requestId) {
        setTurnSetupSuggestion(suggestion)
        setTurnSetupTrace({
          outcome: 'dismissed',
          ...(suggestion.template?.id ? { template_id: suggestion.template.id } : {}),
          ...(suggestion.skill.skill_id ? { skill_id: suggestion.skill.skill_id } : {}),
        })
      }
    } catch (err) {
      if (turnSetupRequestRef.current === requestId) {
        toast.error({
          title: '暂时无法生成配置建议',
          description: err instanceof Error ? err.message : '请稍后重试',
        })
      }
    } finally {
      if (turnSetupRequestRef.current === requestId) setTurnSetupLoading(false)
    }
  }

  const applyTurnSetupSuggestion = () => {
    const template = PROJECT_TURN_BRIEF_TEMPLATES.find(
      (item) => item.id === turnSetupSuggestion?.template?.id,
    )
    if (template) setTurnBriefDraft((current) => applyProjectTurnBriefTemplate(current, template))
    const recommendedSkillId = turnSetupSuggestion?.skill.state === 'recommended'
      ? turnSetupSuggestion.skill.skill_id
      : null
    const recommendedSkill = recommendedSkillId
      ? skills.find((skill) => skill.id === recommendedSkillId)
      : undefined
    if (recommendedSkill) {
      setSkillSelection({ mode: 'explicit', skillId: recommendedSkill.id, name: recommendedSkill.name })
    }
    setTurnSetupTrace((current) => current ? { ...current, outcome: 'applied' } : null)
    setTurnSetupSuggestion(null)
    if (recommendedSkillId && !recommendedSkill) {
      toast.warning({
        title: template ? 'Brief 已应用，建议 Skill 当前不可用' : '建议 Skill 当前不可用',
        description: 'Skill 列表可能已更新，请重新获取配置建议。',
      })
    } else {
      toast.success({ title: '配置建议已应用，发送前仍可修改' })
    }
  }

  const selectSuggestedSkill = (skillId: number, name: string) => {
    setSkillSelection({ mode: 'explicit', skillId, name })
    setTurnSetupTrace((current) => current
      ? { ...current, outcome: 'applied', skill_id: skillId }
      : { outcome: 'applied', skill_id: skillId })
    setTurnSetupSuggestion(null)
  }

  const reuseHistoricalTurn = (payload: ProjectTurnReusePayload) => {
    const restored = restoreProjectMentionsFromContext(mentionOptions, payload.mentionContext)
    const selectedSkill = payload.skillId != null
      ? skills.find((skill) => skill.id === payload.skillId)
      : undefined
    setTurnBriefDraft(payload.draft)
    setTurnRevisionSource(payload)
    turnSetupRequestRef.current += 1
    setTurnSetupSuggestion(null)
    setTurnSetupTrace(null)
    setTurnSetupLoading(false)
    setSelectedMentions(restored.selected)
    setSkillSelection(selectedSkill
      ? { mode: 'explicit', skillId: selectedSkill.id, name: selectedSkill.name }
      : { mode: 'auto' })
    setComposerText(rebaseProjectMentionTokens(
      payload.content,
      restored.selected,
      restored.requestedCount > 0,
    ))
    if (restored.missingCount > 0 || (payload.skillId != null && !selectedSkill)) {
      toast.warning({
        title: '已恢复 Brief，部分引用已失效',
        description: '失效对象不会按名称降级匹配，请在发送前重新选择。',
      })
    } else {
      toast.success({ title: '已恢复到输入框，可修订后发送' })
    }
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const openTurnRevisionSource = (sourceMessageId: number, sourceFingerprint: string) => {
    let target = document.getElementById(`project-chat-message-${sourceMessageId}`)
    if (!target) {
      const source = findProjectTurnRevisionSource(messages, sourceFingerprint)
      if (source) {
        target = document.getElementById(`project-chat-message-${source.id}`)
      }
    }
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      toast.warning({ title: '原始消息已不在当前加载范围内' })
    }
  }

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
  }, [messages.length, pendingActionBatches.length])

  useEffect(() => {
    if (messagesLoading || recoveryFocus?.messageId == null) return
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`project-chat-message-${recoveryFocus.messageId}`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        toast.warning({ title: '恢复消息已不在当前加载范围内' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messagesLoading, recoveryFocus?.messageId, recoveryFocus?.requestId, toast])

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

  const prepareContinuityDraft = (content: string) => {
    const current = composerText.trim()
    changeComposerText(current ? `${current}\n${content}` : content)
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const locateContinuityMessage = (messageId: number) => {
    const target = document.getElementById(`project-chat-message-${messageId}`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      toast.warning({ title: '来源消息已不在当前加载范围内' })
    }
  }

  const continueInterruptedTurn = async (preview: TurnRecoveryPreview) => {
    if (busy) {
      toast.warning({
        title: '请等待当前轮次结束',
        description: '恢复预览不会自动执行；当前轮次结束后可再次核对并确认。',
      })
      return
    }
    try {
      await onSend(buildTurnRecoveryContent(preview), {
        turnRecovery: buildTurnRecoveryInput(preview),
      })
      toast.success(turnRecoveryToastCopy(preview))
    } catch (err) {
      if (isTurnRecoveryPreviewConflict(err)) {
        toast.warning({
          title: '状态已变化，请重新核对',
          description: '恢复预览已经过期，Aria 将重新读取当前项目状态；不会自动重试或执行历史动作。',
        })
        throw err
      }
      toast.error({
        title: '恢复轮次未完成',
        description: err instanceof Error ? err.message : '中断状态仍在保存，请稍后再试。',
      })
    }
  }

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
          {conversation?.title || t('chat.newConversation', 'New Conversation')}
        </h2>
        <ConversationContinuityPanel
          key={conversationId}
          conversationId={conversationId}
          refreshKey={messages.length}
          disabled={busy}
          latestAssistantMessage={latestAssistantMessage}
          onPrepare={prepareContinuityDraft}
          onLocateMessage={locateContinuityMessage}
        />
        <ProjectInteractionMetricsPanel projectId={projectId} />
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
              changeComposerText(text)
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
              activityTimeline={busy && m.id === streamingMessageId ? activityTimeline : null}
              onSkillSelect={selectSkillForNextTurn}
              onTurnBriefReuse={reuseHistoricalTurn}
              onTurnRevisionSourceOpen={openTurnRevisionSource}
              onTurnRecovery={continueInterruptedTurn}
            />
          ))}

        {!busy && pendingActionBatches.length > 0 && (
          // Indent past the avatar (30) + gap (14) so the card aligns under
          // the assistant message body, matching the reference layout.
          <div style={{ paddingLeft: 44 }}>
            <ChatActionPreview
              batches={pendingActionBatches}
              actingKey={pendingActionKey}
              onConfirm={onConfirmAction}
              onReject={onRejectAction}
            />
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ padding: '0 56px 22px', width: '100%' }}>
        {busy && turnReceipt && (
          <TurnReceiptCard
            receipt={turnReceipt}
            contextReceipt={contextReceipt}
            onSkillSelect={selectSkillForNextTurn}
          />
        )}
        {projectQuestionReanswer && (
          <div
            role="status"
            style={{
              marginBottom: 8,
              padding: '9px 11px',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--bg-tint)',
              color: 'var(--ink-soft)',
              fontSize: 11.5,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <span>
              已绑定{' '}
              {questionReanswerDraft?.evidenceCount
                ?? projectQuestionReanswer.attachment_ids.length}{' '}
              条当前核验证据。发送时会再次校验；只生成新回答，不自动关闭问题。
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setProjectQuestionReanswer(null)
                onQuestionReanswerConsumed()
              }}
              style={{
                border: 0,
                padding: 0,
                background: 'transparent',
                color: 'var(--ink-mute)',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              取消证据绑定
            </button>
          </div>
        )}
        <ProjectChatComposer
          value={composerText}
          onChange={changeComposerText}
          onSend={async (text) => {
            const selectionForTurn = skillSelection
            const mentionContext = currentMentionContext
            const turnBrief = projectTurnBriefToInput(turnBriefDraft)
            const setupTraceForTurn = turnSetupTrace
            const questionReanswerForTurn = projectQuestionReanswer
            setComposerText('')
            setSkillSelection({ mode: 'auto' })
            setSelectedMentions([])
            setTurnBriefDraft(EMPTY_PROJECT_TURN_BRIEF)
            setTurnRevisionSource(null)
            turnSetupRequestRef.current += 1
            setTurnSetupSuggestion(null)
            setTurnSetupTrace(null)
            setTurnSetupLoading(false)
            try {
              await onSend(
                text,
                {
                  ...(selectionForTurn.mode === 'explicit'
                    ? { skillId: selectionForTurn.skillId }
                    : selectionForTurn.mode === 'off'
                      ? { disableSkill: true }
                      : {}),
                  ...(mentionContext ? { mentionContext } : {}),
                  ...(turnBrief ? { turnBrief } : {}),
                  ...(turnRevision ? { turnRevision } : {}),
                  ...(setupTraceForTurn ? { turnSetupTrace: setupTraceForTurn } : {}),
                  ...(questionReanswerForTurn
                    ? {
                      disableSkill: true,
                      projectQuestionReanswer: questionReanswerForTurn,
                    }
                    : {}),
                },
              )
              if (questionReanswerForTurn) {
                setProjectQuestionReanswer(null)
                onQuestionReanswerConsumed()
                toast.success({
                  title: '已生成新的证据绑定回答',
                  description: '请回到问题工作台重新分析，并由人工决定是否采用。',
                })
              }
            } catch (error) {
              if (questionReanswerForTurn) {
                setComposerText(text)
                setProjectQuestionReanswer(questionReanswerForTurn)
                toast.warning({
                  title: '证据回答未发送',
                  description: error instanceof Error
                    ? error.message
                    : '请重新分析当前问题证据。',
                })
              }
            }
          }}
          onSteer={async (text) => {
            const accepted = await onSteer(text)
            if (accepted) setComposerText('')
            return accepted
          }}
          onStop={onStop}
          busy={busy}
          canSteer={canSteer}
          skills={skills}
          skillSelection={skillSelection}
          onSkillSelectionChange={changeSkillSelection}
          mentionOptions={mentionOptions}
          selectedMentions={selectedMentions}
          onSelectedMentionsChange={setSelectedMentions}
          turnBriefDraft={turnBriefDraft}
          onTurnBriefDraftChange={setTurnBriefDraft}
          recentTurnBriefs={recentTurnBriefs}
          turnRevision={turnRevision}
          onTurnRevisionCancel={() => setTurnRevisionSource(null)}
          turnSetupSuggestion={turnSetupSuggestion}
          turnSetupLoading={turnSetupLoading}
          onTurnSetupRequest={() => { void requestTurnSetupSuggestion() }}
          onTurnSetupApply={applyTurnSetupSuggestion}
          onTurnSetupDismiss={() => setTurnSetupSuggestion(null)}
          onTurnSetupCandidateSelect={selectSuggestedSkill}
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
 * flight. The project-scoped Skill control is intentionally one-shot:
 * each explicit choice applies to the next turn, then returns to auto.
 * ──────────────────────────────────────────────────────────────── */
export function ProjectChatComposer({
  value,
  onChange,
  onSend,
  onSteer,
  onStop,
  busy,
  canSteer,
  skills,
  skillSelection,
  onSkillSelectionChange,
  mentionOptions,
  selectedMentions,
  onSelectedMentionsChange,
  turnBriefDraft,
  onTurnBriefDraftChange,
  recentTurnBriefs,
  turnRevision,
  onTurnRevisionCancel,
  turnSetupSuggestion,
  turnSetupLoading,
  onTurnSetupRequest,
  onTurnSetupApply,
  onTurnSetupDismiss,
  onTurnSetupCandidateSelect,
  textareaRef,
}: {
  value: string
  onChange: (next: string) => void
  onSend: (text: string) => void | Promise<void>
  onSteer: (text: string) => boolean | Promise<boolean>
  onStop: () => void
  busy: boolean
  canSteer: boolean
  skills: SkillSummary[]
  skillSelection: ProjectSkillSelection
  onSkillSelectionChange: (selection: ProjectSkillSelection) => void
  mentionOptions: ProjectMentionOption[]
  selectedMentions: SelectedProjectMention[]
  onSelectedMentionsChange: (mentions: SelectedProjectMention[]) => void
  turnBriefDraft: ProjectTurnBriefDraft
  onTurnBriefDraftChange: (draft: ProjectTurnBriefDraft) => void
  recentTurnBriefs: ProjectTurnBriefHistoryItem[]
  turnRevision: TurnRevisionInput | null
  onTurnRevisionCancel: () => void
  turnSetupSuggestion: TurnSetupSuggestion | null
  turnSetupLoading: boolean
  onTurnSetupRequest: () => void
  onTurnSetupApply: () => void
  onTurnSetupDismiss: () => void
  onTurnSetupCandidateSelect?: (skillId: number, name: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [activeMention, setActiveMention] = useState<ActiveProjectMention | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const filteredMentionOptions = useMemo(
    () => filterProjectMentionOptions(mentionOptions, activeMention?.query || ''),
    [activeMention?.query, mentionOptions],
  )
  const briefGoal = normalizeTurnBriefGoal(turnBriefDraft.goal)
  const briefConstraints = normalizeTurnBriefConstraints(turnBriefDraft.constraintsText)

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
    if (!text) return
    if (busy) {
      if (canSteer) void onSteer(text)
      return
    }
    void onSend(text)
  }

  const syncActiveMention = (next: string, caret: number) => {
    if (busy) {
      setActiveMention(null)
      return
    }
    const active = findActiveProjectMention(next, caret)
    setActiveMention(active)
    setMentionActiveIndex(0)
    const retained = pruneSelectedProjectMentions(next, selectedMentions)
    if (retained.length !== selectedMentions.length) onSelectedMentionsChange(retained)
  }

  const selectMention = (option: ProjectMentionOption) => {
    if (!activeMention) return
    if (option.kind === 'skill') {
      const next = `${value.slice(0, activeMention.start)}${value.slice(activeMention.end)}`
      onChange(next)
      onSkillSelectionChange({ mode: 'explicit', skillId: option.id, name: option.label })
      setActiveMention(null)
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(activeMention.start, activeMention.start)
      })
      return
    }
    const existing = selectedMentions.find(
      (mention) => mention.kind === option.kind && mention.id === option.id,
    )
    if (existing && value.includes(existing.token)) {
      const next = `${value.slice(0, activeMention.start)}${value.slice(activeMention.end)}`
      onChange(next)
      setActiveMention(null)
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(activeMention.start, activeMention.start)
      })
      return
    }
    const replacement = replaceActiveProjectMention(value, activeMention, option)
    onChange(replacement.value)
    onSelectedMentionsChange([
      ...selectedMentions.filter(
        (mention) => mention.kind !== replacement.selected.kind || mention.id !== replacement.selected.id,
      ),
      replacement.selected,
    ])
    setActiveMention(null)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(replacement.caret, replacement.caret)
    })
  }

  const removeSelectedMention = (mention: SelectedProjectMention) => {
    const next = value
      .replace(mention.token, '')
      .replace(/ {2,}/gu, ' ')
      .trimStart()
    onChange(next)
    onSelectedMentionsChange(
      selectedMentions.filter(
        (selected) => selected.kind !== mention.kind || selected.id !== mention.id,
      ),
    )
    textareaRef.current?.focus()
  }

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '12px 14px',
        opacity: busy && !canSteer ? 0.85 : 1,
        transition: 'opacity 120ms',
      }}
    >
      {activeMention && (
        <ProjectMentionMenu
          id="project-chat-mention-menu"
          options={filteredMentionOptions}
          activeIndex={mentionActiveIndex}
          onActiveIndexChange={setMentionActiveIndex}
          onSelect={selectMention}
        />
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          syncActiveMention(event.target.value, event.target.selectionStart)
        }}
        onClick={(event) => syncActiveMention(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setActiveMention(null)}
        aria-autocomplete="list"
        aria-controls={activeMention ? 'project-chat-mention-menu' : undefined}
        aria-expanded={Boolean(activeMention)}
        aria-activedescendant={
          activeMention && filteredMentionOptions.length > 0
            ? `project-chat-mention-menu-option-${mentionActiveIndex}`
            : undefined
        }
        onKeyDown={(e) => {
          if (activeMention && e.key === 'Escape') {
            e.preventDefault()
            setActiveMention(null)
            return
          }
          if (activeMention && filteredMentionOptions.length > 0) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const direction = e.key === 'ArrowDown' ? 1 : -1
              setMentionActiveIndex((current) => (
                current + direction + filteredMentionOptions.length
              ) % filteredMentionOptions.length)
              return
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              selectMention(filteredMentionOptions[mentionActiveIndex] || filteredMentionOptions[0])
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={
          busy
            ? canSteer
              ? '追加对当前任务的要求，例如：控制在十页、改成董事会口径…'
              : '当前执行阶段暂不接受追加要求…'
            : '继续向 Aria 提问…'
        }
        rows={1}
        disabled={busy && !canSteer}
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
      {selectedMentions.length > 0 && (
        <div
          aria-label="本轮结构化引用"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}
        >
          {selectedMentions.map((mention) => (
            <button
              key={`${mention.kind}:${mention.id}`}
              type="button"
              aria-label={`移除${PROJECT_MENTION_KIND_LABEL[mention.kind]}引用 ${mention.label}`}
              onClick={() => removeSelectedMention(mention)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 7px',
                color: 'var(--accent-ink)',
                background: 'var(--accent-bg)',
                border: '1px solid color-mix(in oklch, var(--accent) 22%, var(--line))',
                borderRadius: 'var(--r-sm)',
                fontSize: 10.5,
              }}
            >
              {PROJECT_MENTION_KIND_LABEL[mention.kind]} · {mention.label}
              <span aria-hidden="true" style={{ color: 'var(--ink-faint)' }}>×</span>
            </button>
          ))}
        </div>
      )}
      {(briefGoal || briefConstraints.length > 0) && (
        <div
          aria-label="本轮 Brief 预览"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 5,
            marginTop: 7,
            padding: '6px 8px',
            color: 'var(--ink-soft)',
            background: 'var(--bg-tint)',
            borderLeft: '2px solid var(--accent)',
            borderRadius: '0 var(--r-sm) var(--r-sm) 0',
            fontSize: 10.5,
          }}
        >
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Brief</span>
          {briefGoal && <span>目标 · {briefGoal}</span>}
          {briefConstraints.map((constraint) => (
            <span
              key={constraint}
              style={{ padding: '2px 6px', background: 'var(--bg-elev)', borderRadius: 'var(--r-sm)' }}
            >
              {constraint}
            </span>
          ))}
        </div>
      )}
      {turnRevision && (
        <ProjectTurnRevisionPreview revision={turnRevision} onCancel={onTurnRevisionCancel} />
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--line-soft)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 9,
            minWidth: 0,
          }}
        >
          <ProjectSkillControl
            skills={skills}
            selection={skillSelection}
            onChange={onSkillSelectionChange}
            disabled={busy}
          />
          <ProjectTurnBriefControl
            draft={turnBriefDraft}
            onChange={onTurnBriefDraftChange}
            referenceCount={selectedMentions.length}
            recentBriefs={recentTurnBriefs}
            disabled={busy}
          />
          <ProjectTurnSetupControl
            suggestion={turnSetupSuggestion}
            loading={turnSetupLoading}
            canRequest={Boolean(value.trim())}
            disabled={busy}
            onRequest={onTurnSetupRequest}
            onApply={onTurnSetupApply}
            onDismiss={onTurnSetupDismiss}
            onSkillSelect={(skillId, name) => {
              if (onTurnSetupCandidateSelect) onTurnSetupCandidateSelect(skillId, name)
              else onSkillSelectionChange({ mode: 'explicit', skillId, name })
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>
            {busy ? 'Enter 追加 · Shift+Enter 换行' : '输入 @ 引用 · Enter 发送'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {busy && (
            <button
              type="button"
              onClick={onStop}
              style={{
                padding: '5px 12px',
                color: 'var(--ink-soft)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                fontSize: 12.5,
              }}
            >
              停止 <CxIcon name="stop" size={10} stroke={1.8} />
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || (busy && !canSteer)}
            style={{
              padding: '5px 14px',
              background: 'var(--accent)',
              color: 'var(--bg-elev)',
              borderRadius: 'var(--r-sm)',
              fontSize: 12.5,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              opacity: !value.trim() || (busy && !canSteer) ? 0.5 : 1,
              cursor: !value.trim() || (busy && !canSteer) ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? '追加到当前任务' : '发送'} <CxIcon name="arrow-right" size={11} stroke={1.8} />
          </button>
        </div>
      </div>
    </div>
  )
}

function TurnReceiptCard({
  receipt,
  contextReceipt,
  onSkillSelect,
}: {
  receipt: TurnReceiptEvent
  contextReceipt: ContextReceiptEvent | null
  onSkillSelect: (skillId: number, name: string) => void
}) {
  const modeLabel = {
    answer_only: '直接回答',
    plan_only: '只做规划',
    execute_now: '立即执行',
    plan_then_execute: '规划后执行',
  }[receipt.mode]
  const scopeLabel = {
    chat: '当前对话',
    project: '当前项目',
    workspace: '工作区',
  }[receipt.target_scope]
  return (
    <div
      style={{
        marginBottom: 8,
        padding: '8px 11px',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-tint)',
        fontSize: 12,
        color: 'var(--ink-soft)',
        lineHeight: 1.55,
      }}
    >
      <span style={{ color: 'var(--ink)', fontWeight: 600 }}>本轮理解</span>
      <span> · {modeLabel} · {scopeLabel}</span>
      <div style={{ marginTop: 3 }}>{receipt.summary}</div>
      {receipt.user_constraints.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
          {receipt.user_constraints.map((constraint) => (
            <span
              key={constraint}
              style={{ padding: '2px 6px', color: 'var(--accent-ink)', background: 'var(--accent-bg)', borderRadius: 'var(--r-sm)', fontSize: 10.5 }}
            >
              {constraint}
            </span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 2, color: 'var(--ink-mute)', fontSize: 11 }}>
        {receipt.write_allowed ? '允许在约定范围内写入' : '不会修改项目内容'}
        {receipt.requires_confirmation ? ' · 高风险动作会先征求确认' : ''}
        {receipt.steering_supported ? ' · 可在下方追加要求' : ''}
      </div>
      {contextReceipt && (
        <ProjectContextReceiptSummary
          receipt={contextReceipt}
          onSkillSelect={onSkillSelect}
        />
      )}
    </div>
  )
}

function ProjectContextReceiptSummary({
  receipt,
  onSkillSelect,
}: {
  receipt: ContextReceiptEvent
  onSkillSelect: (skillId: number, name: string) => void
}) {
  const memoryLabel = {
    not_applicable: '本轮不依赖单项目记忆',
    missing: '项目记忆尚未生成，已使用当前项目原始信息',
    stale: `项目记忆 v${receipt.memory.version} 待刷新，已优先使用较新的项目信号`,
    ready: `项目记忆 v${receipt.memory.version} 已同步`,
  }[receipt.memory.status]
  const skillLabel = receipt.skill.status === 'applied' && receipt.skill.name
    ? `${receipt.skill.usage_mode === 'advisory' ? '专业问答' : '工作流'}：${receipt.skill.name}`
    : receipt.skill.status === 'ambiguous'
      ? `Skill 候选有歧义：${(receipt.skill.candidates || []).map((item) => item.name).join(' / ')}`
      : '未额外启用 Skill'
  const memoryRetrievalLabel = receipt.memory.selected_item_count > 0
    ? `${receipt.memory.retrieval_mode === 'full' ? '全量' : '按问题'}召回 ${receipt.memory.selected_item_count} 条记忆 / ${receipt.memory.selected_slot_count} 个槽位`
    : ''
  const memoryLayerLabels = (receipt.memory.layers || []).map(contextMemoryLayerLabel)
  const evidenceBits = [
    receipt.evidence.knowledge_reference_count > 0
      ? `${receipt.evidence.knowledge_reference_count} 条知识证据`
      : '',
    receipt.evidence.attached_file_count > 0
      ? `${receipt.evidence.attached_file_count} 个指定文件`
      : '',
    receipt.evidence.history_message_count > 0
      ? `${receipt.evidence.history_message_count} 条近期对话`
      : '',
  ].filter(Boolean)
  const hasWarning = receipt.warnings.some((warning) =>
    [
      'project_memory_missing',
      'project_memory_stale',
      'client_memory_stale',
      'user_preference_overridden',
      'skill_match_ambiguous',
      'project_world_state_changed',
    ].includes(warning),
  )
  return (
    <div
      style={{
        marginTop: 6,
        paddingTop: 6,
        borderTop: '1px solid var(--line)',
        color: hasWarning ? 'var(--warning, #a16207)' : 'var(--ink-mute)',
        fontSize: 11,
      }}
    >
      <div>
        <strong>本轮依据</strong> · {memoryLabel}
        {memoryRetrievalLabel ? ` · ${memoryRetrievalLabel}` : ''} · {skillLabel}
      </div>
      {evidenceBits.length > 0 && <div style={{ marginTop: 2 }}>{evidenceBits.join(' · ')}</div>}
      {memoryLayerLabels.length > 0 && (
        <div style={{ marginTop: 2 }}>
          {memoryLayerLabels.map((label) => <div key={label}>{label}</div>)}
        </div>
      )}
      {receipt.world_state && (
        <div style={{ marginTop: 2 }}>
          项目状态版本 · {receipt.world_state.current_version}
          {receipt.world_state.changed
            ? ` · 已检测到 ${receipt.world_state.changed_categories.length} 类变化，已改用当前状态`
            : receipt.world_state.baseline
              ? ' · 已建立本对话基线'
              : ' · 与上一轮一致'}
        </div>
      )}
      {receipt.skill.status === 'ambiguous' && (
        <SkillCandidateButtons
          candidates={receipt.skill.candidates || []}
          onSelect={onSkillSelect}
        />
      )}
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
