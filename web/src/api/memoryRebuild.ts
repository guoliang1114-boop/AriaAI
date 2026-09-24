import { isAxiosError } from 'axios'
import { api } from './client'

// Memory rebuilds are synchronous model calls that can outlast the gateway
// (the production proxy answers 504 after 60s) or the client timeout while the
// backend keeps working and then commits or records a failure receipt. Treat
// only those "outcome unknown" errors as pending and settle them from native
// status and receipts instead of reporting a false failure.

export type MemoryScope = 'project' | 'client'

export interface MemoryStatusSnapshot {
  memory_version: number
  memory_stale: boolean
  memory_updated_at?: string | null
  memory_rebuild_status?: string | null
  memory_rebuild_failed_at?: string | null
}

export type MemoryRebuildOutcome<T> =
  | { kind: 'completed'; data: T }
  | { kind: 'confirmed'; status: MemoryStatusSnapshot }
  | { kind: 'failed'; message: string }
  | { kind: 'pending' }

interface FailureReceipt {
  project_id?: number
  client_id?: number
  failed_at?: string
  stage?: string
  message?: string
}

export const MEMORY_REBUILD_REQUEST_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 5_000
const POLL_WINDOW_MS = 5 * 60 * 1000

const GATEWAY_TIMEOUT_STATUSES = new Set([504, 524])

export function isOutcomeUnknownError(error: unknown): boolean {
  if (!isAxiosError(error)) return false
  if (error.response) return GATEWAY_TIMEOUT_STATUSES.has(error.response.status)
  return error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || /timeout/i.test(error.message)
}

function basePath(scope: MemoryScope, id: number): string {
  return scope === 'project' ? `/projects/${id}/memory` : `/clients/${id}/memory`
}

export function fetchMemoryStatus(scope: MemoryScope, id: number): Promise<MemoryStatusSnapshot> {
  return api.get<MemoryStatusSnapshot>(`${basePath(scope, id)}/status`)
}

function receiptKey(receipt: FailureReceipt): string {
  return `${receipt.stage ?? ''}|${receipt.failed_at ?? ''}`
}

// Failure receipts are admin-only; non-admin callers settle by version alone.
async function fetchFailureKeys(scope: MemoryScope, id: number): Promise<Map<string, FailureReceipt> | null> {
  try {
    const plural = scope === 'project' ? 'projects' : 'clients'
    const jobs = await api.get<{ recent_failures?: FailureReceipt[] }>(`/${plural}/memory/jobs`)
    const owned = (jobs.recent_failures ?? []).filter((receipt) =>
      scope === 'project' ? receipt.project_id === id : receipt.client_id === id,
    )
    return new Map(owned.map((receipt) => [receiptKey(receipt), receipt]))
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function awaitMemoryRebuild<T>(
  scope: MemoryScope,
  id: number,
  request: () => Promise<T>,
  options: { pollIntervalMs?: number; pollWindowMs?: number } = {},
): Promise<MemoryRebuildOutcome<T>> {
  const [baseline, baselineFailures] = await Promise.all([
    fetchMemoryStatus(scope, id).catch(() => null),
    fetchFailureKeys(scope, id),
  ])
  try {
    return { kind: 'completed', data: await request() }
  } catch (error) {
    if (!isOutcomeUnknownError(error) || baseline === null) throw error
  }

  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const deadline = Date.now() + (options.pollWindowMs ?? POLL_WINDOW_MS)
  while (Date.now() < deadline) {
    await sleep(interval)
    const status = await fetchMemoryStatus(scope, id).catch(() => null)
    if (status && (status.memory_version ?? 0) > (baseline.memory_version ?? 0)) {
      return { kind: 'confirmed', status }
    }
    if (status?.memory_rebuild_failed_at && status.memory_rebuild_failed_at !== baseline.memory_rebuild_failed_at) {
      return { kind: 'failed', message: '' }
    }
    if (baselineFailures !== null) {
      const failures = await fetchFailureKeys(scope, id)
      const fresh = [...(failures?.values() ?? [])].find((receipt) => !baselineFailures.has(receiptKey(receipt)))
      if (fresh) return { kind: 'failed', message: fresh.message ?? '' }
    }
  }
  return { kind: 'pending' }
}
