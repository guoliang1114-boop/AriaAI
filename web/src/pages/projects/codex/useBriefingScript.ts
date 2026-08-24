import { useCallback, useState } from 'react'
import { getApiBaseUrl } from '../../../config/api'

/** Frontend SSE consumer for POST /projects/:id/briefing/refine/stream.
 *
 * We use fetch + ReadableStream instead of EventSource because
 * EventSource is GET-only and can't carry the X-Auth-Token header the
 * API expects. The stream emits four event types:
 *   - meta:  initial frame with memory_version + cached flag
 *   - delta: a token chunk to append
 *   - done:  full content + persisted timestamp; arrives in lieu of
 *            deltas when the response was cached
 *   - error: stage / reason; stream ends after this
 */

export interface BriefingScriptMeta {
  memoryVersion: number | null
  cached: boolean
  generatedAt: string | null
}

export interface BriefingScriptState {
  /** Whatever the LLM has emitted so far (or the full cached content
   * once a "done" event lands). Empty string until anything arrives. */
  content: string
  /** True while the connection is open. */
  streaming: boolean
  /** True once we've seen a "done" or "error" event. */
  finished: boolean
  /** Error message from a backend "error" frame OR a network error. */
  error: string | null
  meta: BriefingScriptMeta | null
}

interface StartArgs {
  projectId: number
  meetingType?: string
  language?: string
  forceRefresh?: boolean
  /** Existing cached content to seed `content` with — lets the UI
   * display the persisted script the instant the user clicks, while
   * we kick a fresh stream in the background. */
  seed?: string | null
}

interface BriefingScriptHookValue extends BriefingScriptState {
  start: (args: StartArgs) => Promise<void>
  reset: () => void
}

const INITIAL: BriefingScriptState = {
  content: '',
  streaming: false,
  finished: false,
  error: null,
  meta: null,
}

export function useBriefingScript(): BriefingScriptHookValue {
  const [state, setState] = useState<BriefingScriptState>(INITIAL)

  const reset = useCallback(() => setState(INITIAL), [])

  const start = useCallback(async ({ projectId, meetingType, language, forceRefresh, seed }: StartArgs) => {
    const token = localStorage.getItem('authToken')
    setState({
      content: seed ?? '',
      streaming: true,
      finished: false,
      error: null,
      meta: null,
    })

    let url: string
    try {
      const base = getApiBaseUrl().replace(/\/+$/, '')
      url = `${base}/projects/${projectId}/briefing/refine/stream`
    } catch {
      setState((s) => ({ ...s, streaming: false, finished: true, error: 'API base URL unavailable' }))
      return
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Auth-Token': token } : {}),
        },
        body: JSON.stringify({
          meeting_type: meetingType ?? 'status',
          language: language ?? undefined,
          force_refresh: !!forceRefresh,
        }),
      })
    } catch (err) {
      setState((s) => ({
        ...s,
        streaming: false,
        finished: true,
        error: err instanceof Error ? err.message : '网络错误',
      }))
      return
    }

    if (!response.ok || !response.body) {
      let message = `HTTP ${response.status}`
      try {
        const detail = await response.text()
        if (detail) message = `${message} · ${detail.slice(0, 240)}`
      } catch {
        // ignore
      }
      setState((s) => ({ ...s, streaming: false, finished: true, error: message }))
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE frames are separated by blank lines. Pull complete frames
        // out of the buffer and leave any partial frame for the next
        // read. Each frame has one or more `data:` lines we concatenate.
        let separatorIdx = buffer.indexOf('\n\n')
        while (separatorIdx !== -1) {
          const rawFrame = buffer.slice(0, separatorIdx)
          buffer = buffer.slice(separatorIdx + 2)
          separatorIdx = buffer.indexOf('\n\n')
          const dataLines: string[] = []
          for (const line of rawFrame.split('\n')) {
            if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart())
            }
          }
          if (dataLines.length === 0) continue
          const payload = dataLines.join('\n')
          handleFrame(payload, setState)
        }
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        streaming: false,
        finished: true,
        error: err instanceof Error ? err.message : '读取流失败',
      }))
      return
    }

    setState((s) =>
      s.finished ? s : { ...s, streaming: false, finished: true },
    )
  }, [])

  return { ...state, start, reset }
}

function handleFrame(
  payload: string,
  setState: (updater: (s: BriefingScriptState) => BriefingScriptState) => void,
) {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(payload) as Record<string, unknown>
  } catch {
    return
  }
  const type = typeof event.type === 'string' ? event.type : ''
  if (type === 'meta') {
    setState((s) => ({
      ...s,
      meta: {
        memoryVersion:
          typeof event.memory_version === 'number' ? event.memory_version : null,
        cached: !!event.cached,
        generatedAt: null,
      },
      // Cached responses skip deltas — clear seed so the upcoming
      // "done" frame fully replaces it.
      content: event.cached ? '' : s.content,
    }))
    return
  }
  if (type === 'delta') {
    const text = typeof event.text === 'string' ? event.text : ''
    if (!text) return
    setState((s) => ({ ...s, content: s.content + text }))
    return
  }
  if (type === 'done') {
    const content = typeof event.content === 'string' ? event.content : ''
    const generatedAt =
      typeof event.generated_at === 'string' ? event.generated_at : null
    setState((s) => ({
      ...s,
      content: content || s.content,
      meta: s.meta ? { ...s.meta, generatedAt } : { memoryVersion: null, cached: false, generatedAt },
      streaming: false,
      finished: true,
    }))
    return
  }
  if (type === 'error') {
    const message =
      typeof event.message === 'string' ? event.message : '生成失败'
    setState((s) => ({ ...s, error: message, streaming: false, finished: true }))
  }
}
