import { useEffect, useState } from 'react'
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
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const cacheKey = buildCacheKey({ clientId, summaryType, language, memoryVersion })

  const refresh = async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = clientMemorySummaryCache.get(cacheKey)
      if (cached) {
        setContent(cached)
        setError('')
        setLoading(false)
        return cached
      }
    }

    setLoading(true)
    setError('')
    setContent('')

    try {
      const response = await api.post<ClientMemorySummaryResponse>(
        `/clients/${clientId}/memory/summarize`,
        {
          language,
          summary_type: summaryType,
          force_refresh: forceRefresh,
        },
        { timeout: 120000 },
      )
      clientMemorySummaryCache.set(cacheKey, response.content)
      setContent(response.content)
      return response.content
    } catch (nextError) {
      console.error('Failed to load client memory summary:', nextError)
      setError(nextError instanceof Error && nextError.message ? nextError.message : errorMessage)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [cacheKey, enabled])

  return {
    content,
    error,
    loading,
    refresh,
  }
}
