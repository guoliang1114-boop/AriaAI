import { useCallback, useRef, useState } from 'react'
import { getApiBaseUrl } from '../../../config/api'
import type { GeneratedArtifact, Message } from '../../../types/api'

/** Project-chat-tab SSE streaming hook.
 *
 * A trimmed-down version of /chat/Chat.tsx's sendMessage flow:
 *   - POST /chat/send with { conversation_id, content, project_id }
 *   - Parse SSE events (text / chunk / status / tool_executing /
 *     tool_result / done / error)
 *   - Surface a single growing `streamingContent` string plus a
 *     transient `statusMessage` so the caller can render a live
 *     "正在生成…" bubble. Tool calls / skill picker / file attach /
 *     stream cancellation are intentionally NOT supported here —
 *     those still live on /chat. This is the minimum surface that
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
  send: (content: string) => Promise<void>
}

interface StreamEvent {
  type: string
  content?: string
  message?: string
  references?: Array<{ type: string; id: number; title: string }>
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
  // conversation_title event payload
  conversation_id?: number
  title?: string
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
  // Refs for the long-lived stream parser to avoid stale closures.
  const accumulatedRef = useRef('')
  const artifactsRef = useRef<GeneratedArtifact[]>([])

  const reset = () => {
    accumulatedRef.current = ''
    artifactsRef.current = []
    setStreamingContent('')
    setStatusMessage(null)
  }

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
      setStatus('sending')
      setStatusMessage('已收到，正在连接模型…')

      const userMsg: Message = {
        id: Date.now(),
        conversation_id: conversationId,
        role: 'user',
        content: text,
        metadata_json: '{}',
        created_at: new Date().toISOString(),
      }
      onUserMessage(userMsg)

      const token = localStorage.getItem('authToken') || ''
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
          }),
        })
      } catch (err) {
        setStatus('error')
        onError?.(readApiError(err))
        return
      }

      if (!response.ok || !response.body) {
        setStatus('error')
        onError?.(`服务异常 (${response.status})`)
        return
      }

      setStatus('streaming')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalReferences: Array<{ type: string; id: number; title: string }> = []
      let finalArtifacts: GeneratedArtifact[] = []
      let finalToolCalls: unknown[] = []
      let finalSkillProgress: unknown[] = []
      let finalStageTimings: Record<string, number> | undefined
      let done = false
      let streamErr: string | null = null

      const handleEvent = (ev: StreamEvent) => {
        if ((ev.type === 'text' || ev.type === 'chunk') && ev.content) {
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
          finalReferences = ev.references || []
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
        streamErr = readApiError(err)
      }

      if (streamErr) {
        setStatus('error')
        onError?.(streamErr)
        reset()
        return
      }

      // Some backends end the stream without a 'done' event but still
      // have content — promote it to the final message rather than
      // dropping it.
      if (!done && !accumulatedRef.current.trim()) {
        setStatus('error')
        onError?.('AI 没有返回任何内容')
        reset()
        return
      }

      const assistantMsg: Message = {
        id: Date.now() + 1,
        conversation_id: conversationId,
        role: 'assistant',
        content: accumulatedRef.current,
        metadata_json: JSON.stringify({
          references: finalReferences,
          artifacts: finalArtifacts,
          tool_calls: finalToolCalls,
          skill_progress: finalSkillProgress,
          stage_timings: finalStageTimings,
        }),
        created_at: new Date().toISOString(),
      }
      onAssistantMessage(assistantMsg)
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
      status,
    ],
  )

  return { status, streamingContent, statusMessage, capability, send }
}
