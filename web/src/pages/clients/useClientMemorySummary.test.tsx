import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMemorySummaryResponse, ClientMemorySummaryType } from '../../types/api'
import { useClientMemorySummary } from './useClientMemorySummary'

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function summary(content: string, summaryType: ClientMemorySummaryType): ClientMemorySummaryResponse {
  return {
    client_id: 991,
    language: 'zh',
    summary_type: summaryType,
    content,
    memory_version: 1,
    generated_at: '2026-01-01T00:00:00Z',
  }
}

describe('useClientMemorySummary', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
  })

  it('keeps the newest summary type when cached requests finish out of order', async () => {
    const overview = deferred<ClientMemorySummaryResponse>()
    const risk = deferred<ClientMemorySummaryResponse>()
    mockGet.mockImplementation((url: string) => url.endsWith('/overview') ? overview.promise : risk.promise)

    const { result, rerender } = renderHook(
      ({ summaryType }: { summaryType: ClientMemorySummaryType }) => useClientMemorySummary({
        clientId: 'summary-race-client',
        summaryType,
        language: 'zh',
        memoryVersion: 1,
        enabled: true,
        errorMessage: '加载失败',
      }),
      { initialProps: { summaryType: 'overview' as ClientMemorySummaryType } },
    )
    rerender({ summaryType: 'risk' })

    await act(async () => risk.resolve(summary('最新风险摘要', 'risk')))
    await waitFor(() => expect(result.current.content).toBe('最新风险摘要'))
    await act(async () => overview.resolve(summary('过期概览摘要', 'overview')))
    expect(result.current.content).toBe('最新风险摘要')
  })
})
