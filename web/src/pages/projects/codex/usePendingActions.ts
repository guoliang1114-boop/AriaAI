import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../api/client'
import type {
  ConfirmActionResponse,
  PendingActionsResponse,
  PendingToolAction,
} from '../../../types/api'

/** HITAS (Human-in-the-Loop tool approval) client hook for the project
 * chat tab.
 *
 * The backend pauses high-risk tool actions (modify/delete file,
 * destructive tools) and persists them as ``PendingToolAction`` rows
 * instead of executing. This hook surfaces them so the user can confirm
 * or reject, then deterministically executes on the backend.
 *
 * Fetch triggers: conversation change + an explicit ``refetch()`` the
 * caller fires when a stream completes (a turn may have produced new
 * pending actions). Confirm/reject operate per approval batch — the
 * backend executes a batch's frozen tools in sequence and writes a
 * result message, so the caller refetches messages on resolve. */

export interface PendingActionBatch {
  /** Approval batch id, or "" for legacy single actions. */
  batchId: string
  actions: PendingToolAction[]
}

interface UsePendingActionsReturn {
  batches: PendingActionBatch[]
  hasPending: boolean
  loading: boolean
  /** Id of the action/batch currently being confirmed or rejected. */
  actingKey: string | null
  refetch: () => Promise<void>
  confirm: (batch: PendingActionBatch) => Promise<void>
  reject: (batch: PendingActionBatch, reason?: string) => Promise<void>
}

const TERMINAL_ACTION_STATUSES = new Set(['completed', 'failed', 'rejected', 'skipped', 'superseded'])
const ACTION_POLL_INTERVAL_MS = 2000
const ACTION_POLL_ATTEMPTS = 90

class ActionStillExecutingError extends Error {
  constructor() {
    super('Action is still executing')
    this.name = 'ActionStillExecutingError'
  }
}

function groupByBatch(actions: PendingToolAction[]): PendingActionBatch[] {
  const order: string[] = []
  const map = new Map<string, PendingToolAction[]>()
  for (const action of actions) {
    // Legacy actions without a batch id each form their own group.
    const key = action.approval_batch_id || `single:${action.id}`
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(action)
  }
  return order.map((key) => {
    const items = map.get(key)!
    items.sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0))
    return { batchId: items[0].approval_batch_id || '', actions: items }
  })
}

function batchKey(batch: PendingActionBatch): string {
  return batch.batchId || `single:${batch.actions[0]?.id}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'Action request failed'
}

async function waitForActionsToSettle(actionIds: number[]): Promise<PendingToolAction[]> {
  let latest: PendingToolAction[] = []
  for (let attempt = 0; attempt < ACTION_POLL_ATTEMPTS; attempt += 1) {
    latest = await Promise.all(
      actionIds.map((id) => api.get<PendingToolAction>(`/chat/actions/${id}`)),
    )
    if (latest.every((action) => TERMINAL_ACTION_STATUSES.has(String(action.status || '').toLowerCase()))) {
      return latest
    }
    await sleep(ACTION_POLL_INTERVAL_MS)
  }
  throw new ActionStillExecutingError()
}

export function usePendingActions(
  conversationId: number | null,
  onResolved: () => void | Promise<void>,
  onError?: (message: string) => void,
): UsePendingActionsReturn {
  const requestIdRef = useRef(0)
  const [batchState, setBatchState] = useState<{
    conversationId: number | null
    batches: PendingActionBatch[]
  }>({ conversationId: null, batches: [] })
  const [loadedConversationId, setLoadedConversationId] = useState<number | null>(null)
  const [actingKey, setActingKey] = useState<string | null>(null)
  const batches = batchState.conversationId === conversationId ? batchState.batches : []
  const loading = conversationId != null && loadedConversationId !== conversationId

  const refetch = useCallback(() => {
    const requestId = ++requestIdRef.current
    if (conversationId == null) return Promise.resolve()
    return api
      .get<PendingActionsResponse>(
        `/chat/conversations/${conversationId}/pending-actions`,
      )
      .then((res) => {
        if (requestId !== requestIdRef.current) return
        setBatchState({ conversationId, batches: groupByBatch(res.items || []) })
      })
      .catch(() => {
        // Non-fatal: leave the last known state. A failed poll shouldn't
        // wipe a card the user is mid-decision on.
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoadedConversationId(conversationId)
      })
  }, [conversationId])

  // The visible state is keyed by conversation, so an old conversation's
  // approvals disappear immediately without a synchronous reset effect.
  useEffect(() => {
    void refetch()
  }, [refetch])

  const resolve = useCallback(
    async (batch: PendingActionBatch, path: string, body: Record<string, unknown>) => {
      const key = batchKey(batch)
      if (actingKey) return
      // Keep the card in place (buttons disable + show progress) until the
      // backend resolves; then refetch pending (drops the resolved card) and
      // the thread (shows the backend's result message).
      setActingKey(key)
      try {
        const response = await api.post<ConfirmActionResponse>(path, body)
        if (response.status === 'executing' && response.action_ids?.length) {
          await waitForActionsToSettle(response.action_ids)
        }
        await Promise.all([refetch(), onResolved()])
      } catch (err) {
        onError?.(errorMessage(err))
        if (!(err instanceof ActionStillExecutingError)) {
          await refetch()
        }
      } finally {
        setActingKey(null)
      }
    },
    [actingKey, onError, onResolved, refetch],
  )

  const confirm = useCallback(
    async (batch: PendingActionBatch) => {
      const path = batch.batchId
        ? `/chat/actions/batches/${batch.batchId}/confirm`
        : `/chat/actions/${batch.actions[0].id}/confirm`
      await resolve(batch, path, { approved: true })
    },
    [resolve],
  )

  const reject = useCallback(
    async (batch: PendingActionBatch, reason?: string) => {
      const path = batch.batchId
        ? `/chat/actions/batches/${batch.batchId}/reject`
        : `/chat/actions/${batch.actions[0].id}/reject`
      await resolve(batch, path, reason ? { reason } : {})
    },
    [resolve],
  )

  return {
    batches,
    hasPending: batches.length > 0,
    loading,
    actingKey,
    refetch,
    confirm,
    reject,
  }
}
