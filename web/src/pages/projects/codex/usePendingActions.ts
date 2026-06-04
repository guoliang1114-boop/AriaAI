import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import type { PendingActionsResponse, PendingToolAction } from '../../../types/api'

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

export function usePendingActions(
  conversationId: number | null,
  onResolved: () => void | Promise<void>,
): UsePendingActionsReturn {
  const [batches, setBatches] = useState<PendingActionBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [actingKey, setActingKey] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (conversationId == null) {
      setBatches([])
      return
    }
    setLoading(true)
    try {
      const res = await api.get<PendingActionsResponse>(
        `/chat/conversations/${conversationId}/pending-actions`,
      )
      setBatches(groupByBatch(res.items || []))
    } catch {
      // Non-fatal: leave the last known state. A failed poll shouldn't
      // wipe a card the user is mid-decision on.
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  // Reset + fetch when the selected conversation changes.
  useEffect(() => {
    setBatches([])
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
        await api.post(path, body)
        await Promise.all([refetch(), onResolved()])
      } catch {
        await refetch()
      } finally {
        setActingKey(null)
      }
    },
    [actingKey, onResolved, refetch],
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
