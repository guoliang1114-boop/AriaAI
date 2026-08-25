import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { ClientMemorySummaryResponse, ClientMemorySummaryType } from '../../types/api'

interface UseClientMemorySummaryOptions {
  clientId: string
  summaryType: ClientMemorySummaryType
  language: string
  memoryVersion?: number
  enabled?: boolean
  errorMessage: string
}

const clientMemorySummaryCache = new Map<string, string>()

interface ClientMemorySummaryResult {
  cacheKey: string
  content: string
  error: string
}

function normalizeLanguage(language: string) {
  const normalized = language.trim().toLowerCase()
  if (normalized.startsWith('zh')) return 'zh'
  if (normalized.startsWith('en')) return 'en'
  return normalized || 'default'
}

function buildCacheKey(options: {
  clientId: string
  summaryType: ClientMemorySummaryType
  language: string
  memoryVersion?: number
}) {
  return [
    options.clientId,
    options.summaryType,
    normalizeLanguage(options.language),
    options.memoryVersion ?? 0,
  ].join(':')
}

export function useClientMemorySummary({
  clientId,
  summaryType,
  language,
  memoryVersion,
  enabled = true,
  errorMessage,
}: UseClientMemorySummaryOptions) {
  const cacheKey = buildCacheKey({ clientId, summaryType, language, memoryVersion })
  const [result, setResult] = useState<ClientMemorySummaryResult | null>(null)
  const [loadingCacheKey, setLoadingCacheKey] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const loadCachedSummary = useCallback(() => {
    const requestId = ++requestIdRef.current
    return api.get<ClientMemorySummaryResponse>(
        `/clients/${clientId}/memory/summaries/${summaryType}`,
        { params: { language } },
      )
      .then((response) => {
        if (requestId !== requestIdRef.current) return ''
        const content = response.content?.trim() || ''
        if (content) clientMemorySummaryCache.set(cacheKey, content)
        setResult({ cacheKey, content, error: '' })
        return content
      })
      .catch((nextError: unknown) => {
        if (requestId !== requestIdRef.current) return ''
        const status = (nextError as { response?: { status?: number } })?.response?.status
        if (status !== 404) {
          console.error('Failed to load cached client memory summary:', nextError)
        }
        setResult({ cacheKey, content: '', error: '' })
        return ''
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoadingCacheKey(null)
      })
  }, [cacheKey, clientId, language, summaryType])

  const refresh = useCallback((forceRefresh = false) => {
    const requestId = ++requestIdRef.current
    if (!forceRefresh) {
      const cached = clientMemorySummaryCache.get(cacheKey)
      if (cached) {
        setLoadingCacheKey(null)
        setResult({ cacheKey, content: cached, error: '' })
        return Promise.resolve(cached)
      }
    }

    setLoadingCacheKey(cacheKey)
    setResult({ cacheKey, content: '', error: '' })
    return api.post<ClientMemorySummaryResponse>(
        `/clients/${clientId}/memory/summarize`,
        {
          language,
          summary_type: summaryType,
          force_refresh: forceRefresh,
        },
        { timeout: 120000 },
      )
      .then((response) => {
        if (requestId !== requestIdRef.current) return response.content
        clientMemorySummaryCache.set(cacheKey, response.content)
        setResult({ cacheKey, content: response.content, error: '' })
        return response.content
      })
      .catch((nextError: unknown) => {
        if (requestId !== requestIdRef.current) return ''
        console.error('Failed to load client memory summary:', nextError)
        const error = nextError instanceof Error && nextError.message ? nextError.message : errorMessage
        setResult({ cacheKey, content: '', error })
        return ''
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoadingCacheKey(null)
      })
  }, [cacheKey, clientId, errorMessage, language, summaryType])

  useEffect(() => {
    if (!enabled) return
    const cached = clientMemorySummaryCache.get(cacheKey)
    if (cached) return
    if (!memoryVersion) return
    void loadCachedSummary()
  }, [cacheKey, enabled, loadCachedSummary, memoryVersion])

  const current = result?.cacheKey === cacheKey ? result : null

  return {
    content: clientMemorySummaryCache.get(cacheKey) ?? current?.content ?? '',
    error: current?.error ?? '',
    loading: loadingCacheKey === cacheKey,
    refresh,
  }
}
