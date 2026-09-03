import { useCallback, useEffect, useRef, useState } from 'react'
import { requestChatRunCancellation, requestChatRunSteering } from '../../../api/chatRuns'
import { getApiBaseUrl } from '../../../config/api'
import i18n from '../../../i18n'
import type {
  GeneratedArtifact,
  KnowledgeEvidenceManifest,
  Message,
  MentionContext,
  ProjectQuestionReanswerEvidenceManifest,
  ProjectQuestionReanswerInput,
  Reference,
  SkillDeliverableSelectionInput,
  TurnBriefInput,
  TurnRecoveryInput,
  TurnRevisionInput,
  TurnSetupTraceInput,
} from '../../../types/api'
import { normalizeKnowledgeReferences } from '../../../utils/knowledgeEvidence'
import {
  isProductRunEvent,
  type ContextReceiptEvent,
  type TurnReceiptEvent,
} from '../../../types/productRunEvent'
import {
  reduceRunActivity,
  type RunActivityTimeline,
} from '../../../stores/runActivityReducer'
import {
  parseChatStreamEvent,
  toContextReceiptEvent,
  toTurnReceiptEvent,
  type ChatStreamEvent,
} from '../../../types/chatStreamEvent'

/** Project-chat-tab SSE streaming hook.
 *
 * A trimmed-down version of /chat/Chat.tsx's sendMessage flow:
 *   - POST /chat/send with { conversation_id, content, project_id }
 *   - Parse SSE events (text / chunk / status / tool_executing /
 *     tool_result / done / error)
 *   - Surface a single growing `streamingContent` string plus a
 *     transient `statusMessage` so the caller can render a live
 *     "正在生成…" bubble. File attachment still lives on /chat;
 *     this hook also carries the project tab's per-turn Skill choice.
 *
 * The caller owns the message list. We just hand back the final
 * assistant Message on `done` via `onAssistantMessage` and the user
 * message via `onUserMessage` (so the caller can immediately render
 * the user bubble without waiting for the round-trip).
 */

export type ChatStreamStatus = 'idle' | 'sending' | 'streaming' | 'error'

/** Snapshot of the capability the backend gave THIS turn — emitted
 * via the SSE ``capability`` event at run start. Used by the dev
 * pill so researchers can answer "why didn't Aria use a tool?" by
 * looking at the page instead of trawling logs. */
export interface ChatCapabilityFrame {
  action_policy: string
  tool_access_policy: string
  intent_reason: string
  intent_method: string
  tools_granted: string[]
  tools_granted_count: number
  chat_mode: string
  turn_contract?: Record<string, unknown>
}

export interface ProjectChatTurnControl {
  skillId?: number
  disableSkill?: boolean
  mentionContext?: MentionContext
  turnBrief?: TurnBriefInput
  turnRevision?: TurnRevisionInput
  turnSetupTrace?: TurnSetupTraceInput
  turnRecovery?: TurnRecoveryInput
  projectQuestionReanswer?: ProjectQuestionReanswerInput
  skillDeliverable?: SkillDeliverableSelectionInput
}

interface UseChatStreamArgs {
  projectId: number
  conversationId: number | null
  onUserMessage: (msg: Message) => void
  onAssistantMessage: (msg: Message) => void
  /** Fires when the backend's in-band auto-titler pushes a fresh
   * title for this conversation. Parent should update the rail
   * immediately — no refetch needed. */
  onConversationTitle?: (conversationId: number, title: string) => void
  onError?: (message: string) => void
}

interface UseChatStreamReturn {
  status: ChatStreamStatus
  /** Live-growing assistant content while a message is streaming.
   * Empty string when idle. */
  streamingContent: string
  /** Short status line ("已收到，正在连接模型…", etc) surfaced from
   * backend `status` events. Useful for the placeholder bubble's
   * header. */
  statusMessage: string | null
  /** Latest capability snapshot the backend reported for this
   * conversation. Null until the first turn's capability event
   * lands. */
  capability: ChatCapabilityFrame | null
  turnReceipt: TurnReceiptEvent | null
  contextReceipt: ContextReceiptEvent | null
  activityTimeline: RunActivityTimeline | null
  activeRunId: string | null
  /** Stable id assigned to THIS turn's assistant reply at send time.
   * The caller renders the in-flight reply as a draft message with
   * this id, and the final `onAssistantMessage` reuses it — so the
   * same React node updates in place at `done` instead of remounting
   * (no end-of-stream reformat flash). */
  streamingMessageId: number
  send: (content: string, turnControl?: ProjectChatTurnControl) => Promise<Message | void>
  steer: (content: string) => Promise<boolean>
  stop: () => void
}

function readApiError(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'AI 生成出错，请稍后重试。'
}

function createTurnRecoveryConflictError(): Error & { response: { status: 409 } } {
  const error = new Error('状态已变化，请重新核对') as Error & { response: { status: 409 } }
  error.name = 'TurnRecoveryPreviewConflictError'
  error.response = { status: 409 }
  return error
}

function createQuestionReanswerConflictError(): Error & { response: { status: 409 } } {
  const error = new Error('问题或证据已经变化，请重新分析后再回答') as Error & {
    response: { status: 409 }
  }
  error.name = 'ProjectQuestionReanswerConflictError'
  error.response = { status: 409 }
  return error
}

export function useChatStream(args: UseChatStreamArgs): UseChatStreamReturn {
  const {
    projectId,
    conversationId,
    onUserMessage,
    onAssistantMessage,
    onConversationTitle,
    onError,
  } = args
  const [status, setStatus] = useState<ChatStreamStatus>('idle')
  const [streamingContent, setStreamingContent] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [capability, setCapability] = useState<ChatCapabilityFrame | null>(null)
  const [turnReceipt, setTurnReceipt] = useState<TurnReceiptEvent | null>(null)
  const [contextReceipt, setContextReceipt] = useState<ContextReceiptEvent | null>(null)
  const [activityTimeline, setActivityTimeline] = useState<RunActivityTimeline | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  // Stable id for the current turn's assistant reply. State so the
  // caller re-renders the draft under the right key; ref mirror so the
  // done/stop handlers (in callbacks) read it without stale closures.
  const [streamingMessageId, setStreamingMessageId] = useState(0)
  const assistantDraftIdRef = useRef(0)
  // Refs for the long-lived stream parser to avoid stale closures.
  const accumulatedRef = useRef('')
  const artifactsRef = useRef<GeneratedArtifact[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const turnReceiptRef = useRef<TurnReceiptEvent | null>(null)
  const contextReceiptRef = useRef<ContextReceiptEvent | null>(null)
  const activityTimelineRef = useRef<RunActivityTimeline | null>(null)
  const stopRequestedRef = useRef(false)
  const sendInFlightRef = useRef(false)

  const reset = () => {
    accumulatedRef.current = ''
    artifactsRef.current = []
    setStreamingContent('')
    setStatusMessage(null)
    setTurnReceipt(null)
    turnReceiptRef.current = null
    setContextReceipt(null)
    contextReceiptRef.current = null
    setActivityTimeline(null)
    activityTimelineRef.current = null
  }

  const stop = useCallback(() => {
    stopRequestedRef.current = true
    setStatusMessage('正在停止并保存当前进度…')
    const controller = abortControllerRef.current
    if (!controller) return
    const runId = activeRunIdRef.current
    if (!runId) {
      controller.abort()
      return
    }
    void requestChatRunCancellation(runId)
      .then((accepted) => {
        if (!accepted) controller.abort()
      })
      .catch(() => controller.abort())
    window.setTimeout(() => {
      if (stopRequestedRef.current && abortControllerRef.current === controller) {
        controller.abort()
      }
    }, 1500)
  }, [])

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true
      const runId = activeRunIdRef.current
      if (runId) void requestChatRunCancellation(runId).catch(() => false)
      abortControllerRef.current?.abort()
    }
  }, [])

  const finishStoppedStream = useCallback((publishLocalAssistant = true) => {
    const partial = accumulatedRef.current
    const interruptedRunId = activeRunIdRef.current
    if (publishLocalAssistant && conversationId != null) {
      const stoppedTimeline = activityTimelineRef.current
        ? {
          ...activityTimelineRef.current,
          final_status: 'cancelled' as const,
          status: undefined,
        }
        : undefined
      const assistantMsg: Message = {
        id: assistantDraftIdRef.current,
        conversation_id: conversationId,
        role: 'assistant',
        content: partial.trim()
          ? `${partial}\n\n（本轮已停止，正在保存中断状态。）`
          : '（本轮已停止，正在保存中断状态。）',
        metadata_json: JSON.stringify({
          stopped: true,
          turn_interrupted: { reason: 'user_interrupted' },
          ...(interruptedRunId
            ? { run_rollout: { run_id: interruptedRunId, status: 'cancelled' } }
            : {}),
          activity_timeline: stoppedTimeline,
        }),
        created_at: new Date().toISOString(),
      }
      onAssistantMessage(assistantMsg)
    }
    if (!publishLocalAssistant) {
      assistantDraftIdRef.current = 0
      setStreamingMessageId(0)
    }
    abortControllerRef.current = null
    activeRunIdRef.current = null
    setActiveRunId(null)
    stopRequestedRef.current = false
    sendInFlightRef.current = false
    setStatus('idle')
    reset()
  }, [conversationId, onAssistantMessage])

  const send = useCallback(
    async (content: string, turnControl: ProjectChatTurnControl = {}) => {
      const text = content.trim()
      if (!text) return
      const guardedTurn = Boolean(
        turnControl.turnRecovery || turnControl.projectQuestionReanswer,
      )
      if (conversationId == null) {
        if (guardedTurn) throw new Error('未选择对话')
        onError?.('未选择对话')
        return
      }
      if (sendInFlightRef.current || status === 'sending' || status === 'streaming') {
        if (turnControl.turnRecovery) {
          throw new Error('当前已有轮次正在运行，本次恢复未发送')
        }
        if (turnControl.projectQuestionReanswer) {
          throw new Error('当前已有轮次正在运行，本次证据回答未发送')
        }
        return
      }

      sendInFlightRef.current = true
      reset()
      stopRequestedRef.current = false
      activeRunIdRef.current = null
      setActiveRunId(null)
      setStatus('sending')
      setStatusMessage('已收到，正在连接模型…')

      const userMsgId = Date.now()
      // Reserve this turn's assistant id up front so the draft bubble
      // and the final message share a React key (in-place reconcile).
      assistantDraftIdRef.current = userMsgId + 1
      setStreamingMessageId(assistantDraftIdRef.current)
      const userMsg: Message = {
        id: userMsgId,
        conversation_id: conversationId,
        role: 'user',
        content: text,
        metadata_json: JSON.stringify({
          ...(turnControl.skillId != null ? { skill_id: turnControl.skillId } : {}),
          ...(turnControl.mentionContext ? { mention_context: turnControl.mentionContext } : {}),
          ...(turnControl.turnBrief ? { turn_brief: turnControl.turnBrief } : {}),
          ...(turnControl.turnRevision ? { turn_revision: turnControl.turnRevision } : {}),
          ...(turnControl.turnSetupTrace ? { turn_setup_trace: turnControl.turnSetupTrace } : {}),
          ...(turnControl.turnRecovery ? { turn_recovery: turnControl.turnRecovery } : {}),
          ...(turnControl.projectQuestionReanswer
            ? { project_question_reanswer: turnControl.projectQuestionReanswer }
            : {}),
          ...(turnControl.skillDeliverable
            ? { skill_deliverable: turnControl.skillDeliverable }
            : {}),
        }),
        created_at: new Date().toISOString(),
      }
      const finishRequestedStop = () => {
        if (guardedTurn) {
          // Recovery success is defined only by a matching Product run_done
          // with completed/waiting_confirmation. A local abort or cancelled
          // terminal must reject the caller so the UI cannot announce a false
          // recovery success. Before activation this also avoids a ghost
          // assistant bubble for a child run that may not exist.
          finishStoppedStream(false)
          throw new Error(
            turnControl.turnRecovery
              ? '恢复运行已取消，未确认成功终态；请刷新后重新核对'
              : '证据回答运行已取消，未确认成功终态；请刷新后重新核对',
          )
        }
        finishStoppedStream()
      }
      // A recovery turn is guarded by the server-issued preview hash. Do not
      // render its optimistic user message until the server accepts that hash;
      // a 409 must leave no local instruction that was never persisted.
      if (!guardedTurn) onUserMessage(userMsg)

      const token = localStorage.getItem('authToken') || ''
      const controller = new AbortController()
      abortControllerRef.current = controller
      let response: Response
      try {
        response = await fetch(`${getApiBaseUrl()}/chat/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
          body: JSON.stringify({
            conversation_id: conversationId,
            content: text,
            project_id: projectId,
            skill_id: turnControl.skillId ?? null,
            force_skill: turnControl.skillId != null,
            disable_skill: turnControl.disableSkill === true,
            rag_doc_ids: [],
            file_ids: [],
            language: i18n.language || 'zh-CN',
            mention_context: turnControl.mentionContext,
            turn_brief: turnControl.turnBrief,
            turn_revision: turnControl.turnRevision,
            turn_setup_trace: turnControl.turnSetupTrace,
            turn_recovery: turnControl.turnRecovery,
            project_question_reanswer: turnControl.projectQuestionReanswer,
            skill_deliverable: turnControl.skillDeliverable,
          }),
          signal: controller.signal,
        })
      } catch (err) {
        if (stopRequestedRef.current || controller.signal.aborted) {
          finishRequestedStop()
          return
        }
        const message = readApiError(err)
        setStatus('error')
        abortControllerRef.current = null
        sendInFlightRef.current = false
        if (guardedTurn) {
          assistantDraftIdRef.current = 0
          setStreamingMessageId(0)
          reset()
          throw err instanceof Error ? err : new Error(message)
        }
        onError?.(message)
        return
      }

      if (!response.ok || !response.body) {
        abortControllerRef.current = null
        activeRunIdRef.current = null
        setActiveRunId(null)
        stopRequestedRef.current = false
        sendInFlightRef.current = false
        if (guardedTurn && response.status === 409) {
          assistantDraftIdRef.current = 0
          setStreamingMessageId(0)
          setStatus('idle')
          reset()
          throw turnControl.turnRecovery
            ? createTurnRecoveryConflictError()
            : createQuestionReanswerConflictError()
        }
        const message = `服务异常 (${response.status})`
        setStatus('error')
        if (guardedTurn) {
          assistantDraftIdRef.current = 0
          setStreamingMessageId(0)
          reset()
          throw new Error(message)
        }
        onError?.(message)
        return
      }

      setStatus('streaming')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalReferences: Reference[] = []
      let finalKnowledgeEvidence: KnowledgeEvidenceManifest | undefined
      let finalQuestionReanswerEvidence: ProjectQuestionReanswerEvidenceManifest | undefined
      let finalArtifacts: GeneratedArtifact[] = []
      let finalToolCalls: unknown[] = []
      let finalSkillProgress: unknown[] = []
      let finalStageTimings: Record<string, number> | undefined
      let finalMessageId = assistantDraftIdRef.current
      let finalRunRollout: Record<string, unknown> | undefined
      let finalTurnInterrupted: Record<string, unknown> | undefined
      let finalPhaseError: Record<string, unknown> | undefined
      let finalDeliveryFailed = false
      let done = false
      let streamErr: string | null = null
      let productTerminalStatus: 'completed' | 'waiting_confirmation' | 'failed' | 'cancelled' | null = null
      let productTerminalError: string | null = null
      let productStartedRunId: string | null = null
      let guardedUserMessagePublished = false

      const handleEvent = (ev: ChatStreamEvent) => {
        // A recovery Message and child Run are only usable after the reserved
        // rollout is activated at first iteration. HTTP 200 merely opens the
        // StreamingResponse; activation failure can still be the first frame.
        // Publish the local user bubble only after a frame that the backend
        // emits strictly after successful activation.
        if (
          guardedTurn
          && !guardedUserMessagePublished
          && (ev.type === 'conversation_id' || ev.type === 'run_started')
        ) {
          guardedUserMessagePublished = true
          onUserMessage(userMsg)
        }
        if (isProductRunEvent(ev)) {
          const nextTimeline = reduceRunActivity(activityTimelineRef.current, ev)
          activityTimelineRef.current = nextTimeline
          setActivityTimeline(nextTimeline)
        }
        if (ev.type === 'run_started' && typeof ev.run_id === 'string') {
          if (productStartedRunId && productStartedRunId !== ev.run_id) {
            productTerminalError = '运行事件身份不一致，请重新发起本轮请求'
          } else {
            productStartedRunId = ev.run_id
          }
          activeRunIdRef.current = ev.run_id
          setActiveRunId(ev.run_id)
        } else if (ev.type === 'run_failed') {
          productTerminalStatus = 'failed'
          productTerminalError = (
            productStartedRunId && ev.run_id !== productStartedRunId
              ? '运行失败事件身份不一致，请重新发起本轮请求'
              : ev.error_message || ev.message || 'AI 运行未完成，请稍后重试。'
          )
          activeRunIdRef.current = null
          setActiveRunId(null)
        } else if (ev.type === 'run_done') {
          const terminalIdentityMatches = Boolean(
            productStartedRunId && ev.run_id === productStartedRunId,
          )
          if (!terminalIdentityMatches) {
            productTerminalStatus = null
            productTerminalError = '运行完成事件缺少匹配的启动身份，请重新发起本轮请求'
          } else {
            productTerminalStatus = ev.final_status || null
          }
          if (!productTerminalError && (productTerminalStatus === 'failed' || productTerminalStatus === 'cancelled')) {
            productTerminalError = productTerminalStatus === 'cancelled'
              ? 'AI 运行已取消'
              : 'AI 运行未完成，请稍后重试。'
          }
          activeRunIdRef.current = null
          setActiveRunId(null)
        } else if (ev.type === 'turn_receipt') {
          const receipt = toTurnReceiptEvent(ev)
          if (!receipt) return
          turnReceiptRef.current = receipt
          setTurnReceipt(receipt)
          setStatusMessage(`本轮理解：${receipt.summary}`)
        } else if (ev.type === 'context_receipt') {
          const receipt = toContextReceiptEvent(ev)
          if (!receipt) return
          contextReceiptRef.current = receipt
          setContextReceipt(receipt)
        } else if (ev.type === 'steering_applied' && ev.content_preview) {
          setStatusMessage(`已应用追加要求：${ev.content_preview}`)
        } else if (ev.type === 'message_persisted' && ev.message_id != null) {
          const persistedId = Number(ev.message_id)
          if (Number.isInteger(persistedId) && persistedId > 0) finalMessageId = persistedId
        } else if ((ev.type === 'text' || ev.type === 'chunk') && ev.content) {
          accumulatedRef.current += ev.content
          setStreamingContent(accumulatedRef.current)
          setStatusMessage(null)
        } else if (ev.type === 'conversation_title') {
          if (
            typeof ev.conversation_id === 'number' &&
            typeof ev.title === 'string' &&
            ev.title.trim() !== ''
          ) {
            onConversationTitle?.(ev.conversation_id, ev.title)
          }
        } else if (ev.type === 'capability') {
          setCapability({
            action_policy: ev.action_policy ?? '',
            tool_access_policy: ev.tool_access_policy ?? '',
            intent_reason: ev.intent_reason ?? '',
            intent_method: ev.intent_method ?? '',
            tools_granted: Array.isArray(ev.tools_granted) ? ev.tools_granted : [],
            tools_granted_count: ev.tools_granted_count ?? 0,
            chat_mode: ev.chat_mode ?? '',
            turn_contract: ev.turn_contract,
          })
        } else if (ev.type === 'status') {
          if (ev.message) setStatusMessage(ev.message)
        } else if (ev.type === 'tool_executing') {
          if (ev.tool_name) setStatusMessage(`正在执行 ${ev.tool_name}…`)
        } else if (ev.type === 'tool_result') {
          // Some tool calls produce artifacts. The 'done' event also
          // includes them, but stash anything we see along the way as
          // a safety net.
          const result = (ev as unknown as { result?: GeneratedArtifact }).result
          if (result && (result.name || result.path)) {
            artifactsRef.current = [...artifactsRef.current, result]
          }
        } else if (ev.type === 'done') {
          done = true
          activeRunIdRef.current = null
          setActiveRunId(null)
          finalReferences = normalizeKnowledgeReferences(ev.references)
          finalKnowledgeEvidence = ev.knowledge_evidence
          finalQuestionReanswerEvidence = ev.project_question_reanswer_evidence
          finalArtifacts = ev.artifacts && ev.artifacts.length > 0 ? ev.artifacts : artifactsRef.current
          finalToolCalls = ev.tool_calls || []
          finalSkillProgress = ev.skill_progress || []
          finalStageTimings = ev.stage_timings
          finalRunRollout = ev.run_rollout
          finalTurnInterrupted = ev.turn_interrupted
          finalPhaseError = ev.phase_error
          finalDeliveryFailed = Boolean(ev.delivery_failed)
          const doneMessageId = ev.message_id ?? ev.assistant_message_id
          if (doneMessageId != null) {
            const persistedId = Number(doneMessageId)
            if (Number.isInteger(persistedId) && persistedId > 0) finalMessageId = persistedId
          }
        } else if (ev.type === 'error') {
          streamErr = ev.message || ev.error || 'AI 生成过程中断，请稍后重试。'
        }
      }

      const drainBuffer = (flush = false) => {
        const events = buffer.split('\n\n')
        buffer = flush ? '' : events.pop() || ''
        for (const ev of events.filter(Boolean)) {
          const line = ev
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.startsWith('data: '))
          if (!line) continue
          try {
            const parsed = parseChatStreamEvent(JSON.parse(line.replace(/^data:\s*/, '')))
            if (parsed) handleEvent(parsed)
          } catch (parseErr) {
            console.error('Failed to parse stream event:', parseErr)
          }
        }
      }

      try {
        while (true) {
          const { done: rdone, value } = await reader.read()
          if (rdone) break
          buffer += decoder.decode(value, { stream: true })
          drainBuffer()
        }
        buffer += decoder.decode()
        drainBuffer(true)
      } catch (err) {
        if (stopRequestedRef.current || controller.signal.aborted) {
          finishRequestedStop()
          return
        }
        streamErr = readApiError(err)
      }

      if (stopRequestedRef.current || controller.signal.aborted) {
        finishRequestedStop()
        return
      }

      if (productTerminalError) {
        setStatus('error')
        abortControllerRef.current = null
        activeRunIdRef.current = null
        setActiveRunId(null)
        reset()
        sendInFlightRef.current = false
        if (guardedTurn) throw new Error(productTerminalError)
        onError?.(productTerminalError)
        return
      }

      if (streamErr) {
        setStatus('error')
        abortControllerRef.current = null
        activeRunIdRef.current = null
        setActiveRunId(null)
        reset()
        sendInFlightRef.current = false
        if (guardedTurn) throw new Error(streamErr)
        onError?.(streamErr)
        return
      }

      if (
        guardedTurn
        && productTerminalStatus !== 'completed'
        && productTerminalStatus !== 'waiting_confirmation'
      ) {
        const message = '受保护运行缺少可验证的成功终态，请重新核对后再继续'
        setStatus('error')
        abortControllerRef.current = null
        activeRunIdRef.current = null
        setActiveRunId(null)
        reset()
        sendInFlightRef.current = false
        throw new Error(message)
      }

      // Some backends end the stream without a 'done' event but still
      // have content — promote it to the final message rather than
      // dropping it.
      if (!done && !accumulatedRef.current.trim()) {
        const message = 'AI 没有返回任何内容'
        setStatus('error')
        abortControllerRef.current = null
        activeRunIdRef.current = null
        setActiveRunId(null)
        reset()
        sendInFlightRef.current = false
        if (guardedTurn) throw new Error(message)
        onError?.(message)
        return
      }

      const assistantMsg: Message = {
        id: assistantDraftIdRef.current,
        conversation_id: conversationId,
        role: 'assistant',
        content: accumulatedRef.current,
        metadata_json: JSON.stringify({
          references: finalReferences,
          knowledge_evidence: finalKnowledgeEvidence,
          project_question_reanswer_evidence: finalQuestionReanswerEvidence,
          artifacts: finalArtifacts,
          tool_calls: finalToolCalls,
          skill_progress: finalSkillProgress,
          stage_timings: finalStageTimings,
          run_rollout: finalRunRollout,
          turn_interrupted: finalTurnInterrupted,
          phase_error: finalPhaseError,
          delivery_failed: finalDeliveryFailed || undefined,
          persisted_message_id: finalMessageId !== assistantDraftIdRef.current
            ? finalMessageId
            : undefined,
          turn_receipt: turnReceiptRef.current || undefined,
          context_receipt: contextReceiptRef.current || undefined,
          turn_revision: turnControl.turnRevision,
          turn_recovery: turnControl.turnRecovery,
          project_question_reanswer: turnControl.projectQuestionReanswer,
          activity_timeline: activityTimelineRef.current || undefined,
        }),
        created_at: new Date().toISOString(),
      }
      onAssistantMessage(assistantMsg)
      abortControllerRef.current = null
      activeRunIdRef.current = null
      setActiveRunId(null)
      stopRequestedRef.current = false
      sendInFlightRef.current = false
      setStatus('idle')
      reset()
      return assistantMsg
    },
    [
      conversationId,
      projectId,
      onAssistantMessage,
      onUserMessage,
      onConversationTitle,
      onError,
      finishStoppedStream,
      status,
    ],
  )

  const steer = useCallback(
    async (content: string): Promise<boolean> => {
      const runId = activeRunIdRef.current
      const text = content.trim()
      if (!runId || !text || !turnReceiptRef.current?.steering_supported) return false
      try {
        const accepted = await requestChatRunSteering(runId, text)
        if (!accepted || accepted.run_id !== runId) return false
        onUserMessage({
          id: accepted.message_id,
          conversation_id: accepted.conversation_id,
          role: 'user',
          content: text,
          metadata_json: JSON.stringify({
            run_steering: {
              schema_version: 'aria.run_steering.v1',
              status: 'accepted',
              run_id: accepted.run_id,
              steering_id: accepted.steering_id,
              sequence: accepted.sequence,
            },
          }),
          created_at: new Date().toISOString(),
        })
        setStatusMessage('追加要求已接收，将在当前运行的安全边界生效…')
        return true
      } catch (err) {
        onError?.(readApiError(err))
        return false
      }
    },
    [onError, onUserMessage],
  )

  return {
    status,
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
  }
}
