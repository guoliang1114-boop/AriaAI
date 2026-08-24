import { useCallback, useEffect, useRef, useState } from 'react'
import { requestChatRunCancellation, requestChatRunSteering } from '../../../api/chatRuns'
import { getApiBaseUrl } from '../../../config/api'
import i18n from '../../../i18n'
import type {
  GeneratedArtifact,
  KnowledgeEvidenceManifest,
  Message,
  Reference,
} from '../../../types/api'
import { normalizeKnowledgeReferences } from '../../../utils/knowledgeEvidence'
import type { TurnReceiptEvent } from '../../../types/productRunEvent'

/** Project-chat-tab SSE streaming hook.
 *
 * A trimmed-down version of /chat/Chat.tsx's sendMessage flow:
 *   - POST /chat/send with { conversation_id, content, project_id }
 *   - Parse SSE events (text / chunk / status / tool_executing /
 *     tool_result / done / error)
 *   - Surface a single growing `streamingContent` string plus a
 *     transient `statusMessage` so the caller can render a live
 *     "正在生成…" bubble. Tool calls / skill picker / file attach
 *     still live on /chat. This is the minimum surface that
 *     turns the project chat tab from read-only into a usable
 *     two-way chat.
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
  activeRunId: string | null
  /** Stable id assigned to THIS turn's assistant reply at send time.
   * The caller renders the in-flight reply as a draft message with
   * this id, and the final `onAssistantMessage` reuses it — so the
   * same React node updates in place at `done` instead of remounting
   * (no end-of-stream reformat flash). */
  streamingMessageId: number
  send: (content: string) => Promise<void>
  steer: (content: string) => Promise<boolean>
  stop: () => void
}

interface StreamEvent {
  type: string
  run_id?: string
  content?: string
  message?: string
  references?: Reference[]
  knowledge_evidence?: KnowledgeEvidenceManifest
  artifacts?: GeneratedArtifact[]
  tool_calls?: unknown[]
  skill_progress?: unknown[]
  stage_timings?: Record<string, number>
  duration_ms?: number
  key?: string
  tool_name?: string
  error?: string
  action_policy?: string
  tool_access_policy?: string
  intent_reason?: string
  intent_method?: string
  tools_granted?: string[]
  tools_granted_count?: number
  chat_mode?: string
  turn_contract?: Record<string, unknown>
  // conversation_title event payload
  conversation_id?: number
  title?: string
  summary?: string
  mode?: TurnReceiptEvent['mode']
  target_scope?: TurnReceiptEvent['target_scope']
  execution_scope?: TurnReceiptEvent['execution_scope']
  expected_response?: string
  write_allowed?: boolean
  requires_confirmation?: boolean
  steering_supported?: boolean
  content_preview?: string
}

function readApiError(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'AI 生成出错，请稍后重试。'
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
  const stopRequestedRef = useRef(false)

  const reset = () => {
    accumulatedRef.current = ''
    artifactsRef.current = []
    setStreamingContent('')
    setStatusMessage(null)
    setTurnReceipt(null)
    turnReceiptRef.current = null
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

  const finishStoppedStream = useCallback(() => {
    const partial = accumulatedRef.current
    if (conversationId != null) {
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
        }),
        created_at: new Date().toISOString(),
      }
      onAssistantMessage(assistantMsg)
    }
    abortControllerRef.current = null
    activeRunIdRef.current = null
    setActiveRunId(null)
    stopRequestedRef.current = false
    setStatus('idle')
    reset()
  }, [conversationId, onAssistantMessage])

  const send = useCallback(
    async (content: string) => {
      const text = content.trim()
      if (!text) return
      if (conversationId == null) {
        onError?.('未选择对话')
        return
      }
      if (status === 'sending' || status === 'streaming') return

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
        metadata_json: '{}',
        created_at: new Date().toISOString(),
      }
      onUserMessage(userMsg)

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
            skill_id: null,
            force_skill: false,
            rag_doc_ids: [],
            file_ids: [],
            language: i18n.language || 'zh-CN',
          }),
          signal: controller.signal,
        })
      } catch (err) {
        if (stopRequestedRef.current || controller.signal.aborted) {
          finishStoppedStream()
          return
        }
        setStatus('error')
        onError?.(readApiError(err))
        abortControllerRef.current = null
        return
      }

      if (!response.ok || !response.body) {
        setStatus('error')
        onError?.(`服务异常 (${response.status})`)
        abortControllerRef.current = null
        return
      }

      setStatus('streaming')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalReferences: Reference[] = []
      let finalKnowledgeEvidence: KnowledgeEvidenceManifest | undefined
      let finalArtifacts: GeneratedArtifact[] = []
      let finalToolCalls: unknown[] = []
      let finalSkillProgress: unknown[] = []
      let finalStageTimings: Record<string, number> | undefined
      let done = false
      let streamErr: string | null = null

      const handleEvent = (ev: StreamEvent) => {
        if (ev.type === 'run_started' && typeof ev.run_id === 'string') {
          activeRunIdRef.current = ev.run_id
          setActiveRunId(ev.run_id)
        } else if (
          ev.type === 'turn_receipt'
          && typeof ev.run_id === 'string'
          && typeof ev.summary === 'string'
          && ev.mode
          && ev.target_scope
          && ev.execution_scope
          && typeof ev.expected_response === 'string'
        ) {
          const receipt: TurnReceiptEvent = {
            type: 'turn_receipt',
            run_id: ev.run_id,
            summary: ev.summary,
            mode: ev.mode,
            target_scope: ev.target_scope,
            execution_scope: ev.execution_scope,
            expected_response: ev.expected_response,
            write_allowed: Boolean(ev.write_allowed),
            requires_confirmation: Boolean(ev.requires_confirmation),
            steering_supported: Boolean(ev.steering_supported),
          }
          turnReceiptRef.current = receipt
          setTurnReceipt(receipt)
          setStatusMessage(`本轮理解：${receipt.summary}`)
        } else if (ev.type === 'steering_applied' && ev.content_preview) {
          setStatusMessage(`已应用追加要求：${ev.content_preview}`)
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
          finalArtifacts = ev.artifacts && ev.artifacts.length > 0 ? ev.artifacts : artifactsRef.current
          finalToolCalls = ev.tool_calls || []
          finalSkillProgress = ev.skill_progress || []
          finalStageTimings = ev.stage_timings
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
            handleEvent(JSON.parse(line.replace(/^data:\s*/, '')))
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
          finishStoppedStream()
          return
        }
        streamErr = readApiError(err)
      }

      if (stopRequestedRef.current || controller.signal.aborted) {
        finishStoppedStream()
        return
      }

      if (streamErr) {
        setStatus('error')
        onError?.(streamErr)
        abortControllerRef.current = null
        activeRunIdRef.current = null
        setActiveRunId(null)
        reset()
        return
      }

      // Some backends end the stream without a 'done' event but still
      // have content — promote it to the final message rather than
      // dropping it.
      if (!done && !accumulatedRef.current.trim()) {
        setStatus('error')
        onError?.('AI 没有返回任何内容')
        abortControllerRef.current = null
        activeRunIdRef.current = null
        setActiveRunId(null)
        reset()
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
          artifacts: finalArtifacts,
          tool_calls: finalToolCalls,
          skill_progress: finalSkillProgress,
          stage_timings: finalStageTimings,
          turn_receipt: turnReceiptRef.current || undefined,
        }),
        created_at: new Date().toISOString(),
      }
      onAssistantMessage(assistantMsg)
      abortControllerRef.current = null
      activeRunIdRef.current = null
      setActiveRunId(null)
      stopRequestedRef.current = false
      setStatus('idle')
      reset()
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
    activeRunId,
    streamingMessageId,
    send,
    steer,
    stop,
  }
}
