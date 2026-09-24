import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./client', () => ({ api: { get } }))

import { awaitMemoryRebuild, isOutcomeUnknownError } from './memoryRebuild'

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const response = { status, data: 'error code', statusText: '', headers: {}, config } as AxiosResponse
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, {}, response)
}

const status = (version: number, extra: Record<string, unknown> = {}) => ({
  memory_version: version,
  memory_stale: version < 3,
  ...extra,
})

function route(responses: { status: unknown[]; jobs?: unknown[] }) {
  get.mockImplementation((path: string) => {
    if (path.endsWith('/memory/status')) return Promise.resolve(responses.status.shift())
    if (path.endsWith('/memory/jobs')) {
      if (!responses.jobs) return Promise.reject(httpError(403))
      return Promise.resolve(responses.jobs.shift())
    }
    return Promise.reject(new Error(`unexpected ${path}`))
  })
}

const fast = { pollIntervalMs: 1, pollWindowMs: 200 }

describe('awaitMemoryRebuild', () => {
  beforeEach(() => {
    get.mockReset()
  })

  it('classifies only gateway and client timeouts as outcome-unknown', () => {
    expect(isOutcomeUnknownError(httpError(504))).toBe(true)
    expect(isOutcomeUnknownError(httpError(524))).toBe(true)
    expect(isOutcomeUnknownError(new AxiosError('timeout of 120000ms exceeded', 'ECONNABORTED'))).toBe(true)
    expect(isOutcomeUnknownError(httpError(502))).toBe(false)
    expect(isOutcomeUnknownError(httpError(500))).toBe(false)
    expect(isOutcomeUnknownError(new Error('plain'))).toBe(false)
  })

  it('returns the direct response when the request completes', async () => {
    route({ status: [status(2)], jobs: [{ recent_failures: [] }] })
    const outcome = await awaitMemoryRebuild('project', 37, async () => ({ memory_version: 3 }), fast)
    expect(outcome).toEqual({ kind: 'completed', data: { memory_version: 3 } })
  })

  it('confirms success from a newer version after a gateway timeout', async () => {
    route({ status: [status(2), status(2), status(3)], jobs: [{ recent_failures: [] }, { recent_failures: [] }] })
    const outcome = await awaitMemoryRebuild('project', 37, () => Promise.reject(httpError(504)), fast)
    expect(outcome).toMatchObject({ kind: 'confirmed', status: { memory_version: 3 } })
  })

  it('reports a failure receipt that appeared after the request', async () => {
    const old = { project_id: 37, stage: 'rebuild', failed_at: '2026-06-01T00:00:00' }
    const fresh = { project_id: 37, stage: 'memory_rebuild:manual', failed_at: '2026-09-24T13:25:38', message: 'model_completion_truncated' }
    const other = { project_id: 2, stage: 'rebuild', failed_at: '2026-09-24T13:25:39' }
    route({
      status: [status(2), status(2)],
      jobs: [{ recent_failures: [old] }, { recent_failures: [fresh, other, old] }],
    })
    const outcome = await awaitMemoryRebuild('project', 37, () => Promise.reject(httpError(504)), fast)
    expect(outcome).toEqual({ kind: 'failed', message: 'model_completion_truncated' })
  })

  it('settles by version alone when failure receipts are not readable', async () => {
    route({ status: [status(6), status(7)] })
    const outcome = await awaitMemoryRebuild('client', 4, () => Promise.reject(httpError(504)), fast)
    expect(outcome).toMatchObject({ kind: 'confirmed', status: { memory_version: 7 } })
  })

  it('stays pending instead of failing when nothing changes in the window', async () => {
    get.mockImplementation((path: string) =>
      path.endsWith('/memory/status') ? Promise.resolve(status(2)) : Promise.resolve({ recent_failures: [] }),
    )
    const outcome = await awaitMemoryRebuild('project', 37, () => Promise.reject(httpError(504)), { pollIntervalMs: 1, pollWindowMs: 20 })
    expect(outcome).toEqual({ kind: 'pending' })
  })

  it('rethrows real errors', async () => {
    route({ status: [status(2)], jobs: [{ recent_failures: [] }] })
    await expect(awaitMemoryRebuild('project', 37, () => Promise.reject(httpError(502)), fast)).rejects.toBeInstanceOf(AxiosError)
  })
})
