import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Building2, Clock3, ExternalLink, Loader2, Play, RefreshCw, Search, Sparkles, Users, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import type {
  ClientMemoryJob,
  ClientMemoryJobsResponse,
  ClientMemoryBatchWarmSummariesResponse,
  ClientMemoryResponse,
  ClientMemoryBatchRebuildResponse,
  ClientMemoryStatusResponse,
} from '../../types/api'
import { formatProjectMemoryUpdatedAt } from '../projects/projectMemoryTime'

interface ClientListItem {
  id: number
  name: string
  industry: string
  contact: string
  notes: string
  created_at: string
  document_count: number
  project_names: string[]
  client_memory_version?: number
  client_memory_stale?: boolean
  client_memory_updated_at?: string | null
  client_memory_rebuild_status?: string
  client_memory_rebuild_failed_at?: string | null
}

type MemoryFilter = 'all' | 'ready' | 'stale' | 'missing'

function getMemoryStatus(client: ClientListItem): MemoryFilter {
  if ((client.client_memory_version || 0) === 0) return 'missing'
  if (client.client_memory_stale) return 'stale'
  return 'ready'
}

function getAsyncStatusLabel(status: string | undefined, isZh: boolean) {
  switch (status) {
    case 'queued':
      return isZh ? '排队中' : 'Queued'
    case 'rebuilding':
      return isZh ? '重建中' : 'Rebuilding'
    case 'failed':
      return isZh ? '重建失败' : 'Failed'
    default:
      return isZh ? '空闲' : 'Idle'
  }
}

function getJobTypeLabel(jobType: string | undefined, isZh: boolean) {
  if (jobType === 'summary_warm') {
    return isZh ? '摘要预热' : 'Summary warm'
  }
  return isZh ? '记忆重建' : 'Memory rebuild'
}

export function ClientMemorySettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const toast = useToast()
  const autoGenerateMissingTriggeredRef = useRef(false)
  const autoWarmSummariesTriggeredRef = useRef(false)

  const [clients, setClients] = useState<ClientListItem[]>([])
  const [jobs, setJobs] = useState<ClientMemoryJob[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<MemoryFilter>('all')
  const [isRefreshingStale, setIsRefreshingStale] = useState(false)
  const [isGeneratingMissing, setIsGeneratingMissing] = useState(false)
  const [isWarmingSummaries, setIsWarmingSummaries] = useState(false)
  const [refreshingClientId, setRefreshingClientId] = useState<number | null>(null)
  const [jobActionClientId, setJobActionClientId] = useState<number | null>(null)

  const fetchClients = async () => {
    try {
      setLoading(true)
      const data = await api.get<ClientListItem[]>('/clients')
      setClients(data)
    } catch (error) {
      console.error('Failed to load clients for memory settings:', error)
      toast.error(isZh ? '加载客户记忆列表失败' : 'Failed to load client memories')
    } finally {
      setLoading(false)
    }
  }

  const fetchJobs = async (silent = false) => {
    try {
      if (!silent) setLoadingJobs(true)
      const data = await api.get<ClientMemoryJobsResponse>('/clients/memory/jobs')
      setJobs(data.jobs || [])
    } catch (error) {
      console.error('Failed to load client memory jobs:', error)
      if (!silent) {
        toast.error(isZh ? '加载客户记忆任务失败' : 'Failed to load client memory jobs')
      }
    } finally {
      if (!silent) setLoadingJobs(false)
    }
  }

  useEffect(() => {
    void Promise.all([fetchClients(), fetchJobs()])
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchJobs(true)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [])

  const counts = useMemo(
    () => ({
      all: clients.length,
      ready: clients.filter((client) => getMemoryStatus(client) === 'ready').length,
      stale: clients.filter((client) => getMemoryStatus(client) === 'stale').length,
      missing: clients.filter((client) => getMemoryStatus(client) === 'missing').length,
    }),
    [clients],
  )

  const readyClientIds = useMemo(
    () =>
      clients
        .filter((client) => getMemoryStatus(client) === 'ready')
        .map((client) => client.id),
    [clients],
  )

  const filteredClients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return clients.filter((client) => {
      const matchesFilter = filter === 'all' || getMemoryStatus(client) === filter
      const matchesQuery =
        !query ||
        client.name.toLowerCase().includes(query) ||
        client.industry.toLowerCase().includes(query) ||
        client.contact.toLowerCase().includes(query) ||
        client.project_names.some((projectName) => projectName.toLowerCase().includes(query))
      return matchesFilter && matchesQuery
    })
  }, [clients, filter, searchQuery])

  const applyClientMemoryUpdate = (
    clientId: number,
    update: Pick<
      ClientMemoryStatusResponse,
      'memory_stale' | 'memory_version' | 'memory_updated_at' | 'memory_rebuild_status' | 'memory_rebuild_failed_at'
    >,
  ) => {
    setClients((current) =>
      current.map((client) =>
        client.id === clientId
          ? {
              ...client,
              client_memory_stale: update.memory_stale,
              client_memory_version: update.memory_version,
              client_memory_updated_at: update.memory_updated_at ?? client.client_memory_updated_at,
              client_memory_rebuild_status: update.memory_rebuild_status ?? client.client_memory_rebuild_status,
              client_memory_rebuild_failed_at:
                update.memory_rebuild_failed_at ?? client.client_memory_rebuild_failed_at,
            }
          : client,
      ),
    )
  }

  const warmSummaries = async (
    clientIds: number[],
    options?: {
      silent?: boolean
      forceRefresh?: boolean
      profile?: 'core' | 'all'
    },
  ) => {
    if (clientIds.length === 0) return

    try {
      setIsWarmingSummaries(true)
      const result = await api.post<ClientMemoryBatchWarmSummariesResponse>(
        '/clients/memory/warm-summaries-batch',
        {
          client_ids: clientIds,
          summary_types:
            options?.profile === 'all'
              ? ['overview', 'stakeholder', 'lessons', 'risk', 'opportunity', 'relationship', 'delivery', 'client-facing']
              : ['overview', 'stakeholder', 'lessons'],
          language: i18n.language,
          force_refresh: options?.forceRefresh ?? false,
        },
        { timeout: 120000 },
      )

      void fetchJobs(true)

      if (!options?.silent) {
        if ((result.queued_count || 0) > 0) {
          toast.success(
            isZh
              ? `已将 ${result.queued_count} 个客户的常用 AI 摘要加入后台队列`
              : `Queued common AI summaries for ${result.queued_count} clients`,
          )
        } else {
          toast.success(
            isZh
              ? `已为 ${result.processed_count} 个客户预生成常用 AI 摘要`
              : `Warmed common AI summaries for ${result.processed_count} clients`,
          )
        }
      }
    } catch (error) {
      console.error('Failed to warm client memory summaries:', error)
      toast.error(isZh ? '批量预生成客户 AI 摘要失败' : 'Failed to warm client AI summaries')
    } finally {
      setIsWarmingSummaries(false)
    }
  }

  const refreshSingleClient = async (client: ClientListItem) => {
    try {
      setRefreshingClientId(client.id)
      const data = await api.post<ClientMemoryResponse>(`/clients/${client.id}/memory/rebuild`, {}, { timeout: 120000 })
      applyClientMemoryUpdate(client.id, {
        memory_stale: data.memory_stale,
        memory_version: data.memory_version,
        memory_updated_at: data.memory_updated_at,
        memory_rebuild_status: data.memory_rebuild_status,
        memory_rebuild_failed_at: data.memory_rebuild_failed_at,
      })
      await warmSummaries([client.id], { silent: true })
      toast.success(isZh ? `已更新 ${client.name} 的客户记忆` : `Refreshed memory for ${client.name}`)
    } catch (error) {
      console.error('Failed to refresh client memory:', error)
      toast.error(isZh ? `更新 ${client.name} 的客户记忆失败` : `Failed to refresh memory for ${client.name}`)
    } finally {
      setRefreshingClientId(null)
    }
  }

  const runBatch = async (mode: 'stale' | 'missing') => {
    const targetClients = clients.filter((client) =>
      mode === 'stale' ? getMemoryStatus(client) === 'stale' : getMemoryStatus(client) === 'missing',
    )
    if (targetClients.length === 0) return

    if (mode === 'stale') setIsRefreshingStale(true)
    else setIsGeneratingMissing(true)

    try {
      const result = await api.post<ClientMemoryBatchRebuildResponse>(
        '/clients/memory/rebuild-batch',
        {
          client_ids: targetClients.map((client) => client.id),
          stale_only: mode === 'stale',
        },
        { timeout: 120000 },
      )

      result.rebuilt.forEach((item) => {
        applyClientMemoryUpdate(item.client_id, {
          memory_stale: item.memory_stale,
          memory_version: item.memory_version,
          memory_updated_at: item.memory_updated_at,
          memory_rebuild_status: item.memory_rebuild_status,
          memory_rebuild_failed_at: item.memory_rebuild_failed_at,
        })
      })
      if (result.rebuilt.length > 0) {
        await warmSummaries(
          result.rebuilt.map((item) => item.client_id),
          { silent: true },
        )
      }
      void fetchJobs(true)

      toast.success(
        isZh
          ? mode === 'stale'
            ? `已更新 ${result.rebuilt_count} 个建议刷新的客户记忆`
            : `已补齐 ${result.rebuilt_count} 个尚未整理的客户记忆`
          : mode === 'stale'
            ? `Refreshed ${result.rebuilt_count} stale client memories`
            : `Generated ${result.rebuilt_count} missing client memories`,
      )
    } catch (error) {
      console.error('Failed to batch rebuild client memories:', error)
      toast.error(
        isZh
          ? mode === 'stale'
            ? '批量更新客户记忆失败'
            : '批量补齐客户记忆失败'
          : mode === 'stale'
            ? 'Failed to refresh client memories'
            : 'Failed to generate missing client memories',
      )
    } finally {
      if (mode === 'stale') setIsRefreshingStale(false)
      else setIsGeneratingMissing(false)
    }
  }

  const cancelJob = async (clientId: number) => {
    try {
      setJobActionClientId(clientId)
      await api.post(`/clients/memory/jobs/${clientId}/cancel`, {})
      setJobs((current) => current.filter((job) => job.client_id !== clientId))
      toast.success(isZh ? '已取消该客户的排队任务' : 'Cancelled queued jobs for this client')
    } catch (error) {
      console.error('Failed to cancel client memory jobs:', error)
      toast.error(isZh ? '取消客户记忆任务失败' : 'Failed to cancel client memory jobs')
    } finally {
      setJobActionClientId(null)
    }
  }

  const runJobNow = async (clientId: number) => {
    try {
      setJobActionClientId(clientId)
      const result = await api.post<{
        ok: boolean
        action: string
        memory_stale: boolean
        memory_version: number
        memory_updated_at?: string | null
        memory_rebuild_status?: string
        memory_rebuild_failed_at?: string | null
      }>(`/clients/memory/jobs/${clientId}/run-now`, {})
      applyClientMemoryUpdate(clientId, {
        memory_stale: result.memory_stale,
        memory_version: result.memory_version,
        memory_updated_at: result.memory_updated_at,
        memory_rebuild_status: result.memory_rebuild_status,
        memory_rebuild_failed_at: result.memory_rebuild_failed_at,
      })
      await fetchJobs(true)
      toast.success(isZh ? '已立即执行客户记忆重建' : 'Started client memory rebuild now')
    } catch (error) {
      console.error('Failed to run client memory job now:', error)
      toast.error(isZh ? '立即执行客户记忆任务失败' : 'Failed to run client memory job now')
    } finally {
      setJobActionClientId(null)
    }
  }

  useEffect(() => {
    if (loading || isGeneratingMissing || autoGenerateMissingTriggeredRef.current || counts.missing === 0) {
      return
    }

    autoGenerateMissingTriggeredRef.current = true
    toast.info(
      isZh
        ? `系统正在自动补齐 ${counts.missing} 个尚未整理的客户记忆`
        : `Automatically preparing ${counts.missing} missing client memories`,
    )
    void runBatch('missing')
  }, [counts.missing, isGeneratingMissing, isZh, loading])

  useEffect(() => {
    if (
      loading ||
      isGeneratingMissing ||
      isWarmingSummaries ||
      autoWarmSummariesTriggeredRef.current ||
      readyClientIds.length === 0
    ) {
      return
    }

    autoWarmSummariesTriggeredRef.current = true
    void warmSummaries(readyClientIds, { silent: true, profile: 'core' })
  }, [isGeneratingMissing, isWarmingSummaries, loading, readyClientIds])

  const filterOptions: Array<{ key: MemoryFilter; label: string; count: number }> = [
    { key: 'all', label: isZh ? '全部客户' : 'All', count: counts.all },
    { key: 'ready', label: isZh ? '可直接使用' : 'Ready', count: counts.ready },
    { key: 'stale', label: isZh ? '建议更新' : 'Needs refresh', count: counts.stale },
    { key: 'missing', label: isZh ? '尚未整理' : 'Not prepared', count: counts.missing },
  ]

  const ghostButtonStyle: React.CSSProperties = {
    padding: '7px 12px',
    fontSize: 12.5,
    background: 'var(--color-codex-bg)',
    color: 'var(--color-codex-ink-soft)',
    border: '1px solid var(--color-codex-line)',
    borderRadius: 'var(--codex-r-sm, 3px)',
  }

  const smallGhostStyle: React.CSSProperties = {
    padding: '5px 9px',
    fontSize: 11,
    background: 'var(--color-codex-bg)',
    color: 'var(--color-codex-ink-soft)',
    border: '1px solid var(--color-codex-line)',
    borderRadius: 'var(--codex-r-sm, 3px)',
  }

  if (loading) {
    return (
      <div
        className="theme-codex flex min-h-[320px] items-center justify-center"
        style={{ background: 'var(--color-codex-bg)' }}
      >
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--color-codex-accent)' }} />
      </div>
    )
  }

  const statusToneBg = (status: MemoryFilter) =>
    status === 'missing'
      ? 'color-mix(in oklch, var(--color-codex-warn) 14%, transparent)'
      : status === 'stale'
        ? 'color-mix(in oklch, var(--color-codex-warn) 10%, transparent)'
        : 'var(--color-codex-accent-bg)'
  const statusToneInk = (status: MemoryFilter) =>
    status === 'missing'
      ? 'var(--color-codex-warn)'
      : status === 'stale'
        ? 'var(--color-codex-warn)'
        : 'var(--color-codex-accent-ink)'

  return (
    <div
      className="theme-codex"
      style={{
        background: 'var(--color-codex-bg)',
        color: 'var(--color-codex-ink)',
        padding: '8px 4px 32px',
      }}
    >
      <header
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
        style={{ marginBottom: 20 }}
      >
        <div className="min-w-0 flex items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center"
            style={{
              background: 'var(--color-codex-accent-bg)',
              color: 'var(--color-codex-accent)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 500,
                color: 'var(--color-codex-ink)',
                letterSpacing: '-0.015em',
              }}
            >
              {isZh ? '客户记忆管理' : 'Client Memory Manager'}
            </h1>
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 13,
                color: 'var(--color-codex-ink-mute)',
                lineHeight: 1.6,
                maxWidth: 640,
              }}
            >
              {isZh
                ? '集中查看客户级长期记忆状态，统一补齐缺失内容并刷新建议更新的客户记忆。'
                : 'Track long-term client memory health, generate missing memories, and refresh stale ones in one place.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void runBatch('missing')}
            disabled={counts.missing === 0 || isGeneratingMissing}
            className="inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              background: 'var(--color-codex-accent)',
              color: 'var(--color-codex-bg-elev)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            {isGeneratingMissing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            {isZh ? '补齐缺失记忆' : 'Generate Missing'}
          </button>
          <button
            onClick={() => void runBatch('stale')}
            disabled={counts.stale === 0 || isRefreshingStale}
            className="inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={ghostButtonStyle}
          >
            {isRefreshingStale ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {isZh ? '刷新待更新' : 'Refresh Stale'}
          </button>
          <button
            onClick={() => void warmSummaries(readyClientIds, { forceRefresh: false, profile: 'all' })}
            disabled={readyClientIds.length === 0 || isWarmingSummaries}
            className="inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={ghostButtonStyle}
          >
            {isWarmingSummaries ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {isZh ? '预热 AI 摘要' : 'Warm Summaries'}
          </button>
        </div>
      </header>

      {isGeneratingMissing && autoGenerateMissingTriggeredRef.current ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: 'var(--color-codex-bg-tint)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-ink-soft)',
            fontSize: 12.5,
          }}
        >
          {isZh
            ? '系统正在自动补齐尚未整理的客户记忆，结果会在列表中自动更新。'
            : 'Missing client memories are being prepared automatically. The list will update as results come back.'}
        </div>
      ) : null}

      {isWarmingSummaries ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            background: 'var(--color-codex-bg-tint)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-ink-soft)',
            fontSize: 12.5,
          }}
        >
          {isZh
            ? '系统正在后台预热常用 AI 摘要，并按队列、预算和间隔节奏控制，避免集中触发限流。'
            : 'Common AI summaries are being warmed in the background with queue, budget, and pacing controls to avoid rate-limit spikes.'}
        </div>
      ) : null}

      {/* Filter cards */}
      <div className="grid gap-3 md:grid-cols-4" style={{ marginBottom: 16 }}>
        {filterOptions.map((option) => {
          const isActive = filter === option.key
          return (
            <button
              key={option.key}
              onClick={() => setFilter(option.key)}
              className="p-4 text-left transition-colors"
              style={{
                background: isActive
                  ? 'var(--color-codex-accent-bg)'
                  : 'var(--color-codex-bg-elev)',
                border: isActive
                  ? '1px solid color-mix(in oklch, var(--color-codex-accent) 35%, transparent)'
                  : '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-md, 6px)',
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 10.5,
                  color: isActive ? 'var(--color-codex-accent-ink)' : 'var(--color-codex-ink-mute)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {option.label}
              </div>
              <div
                className="font-mono"
                style={{
                  marginTop: 6,
                  fontSize: 22,
                  fontWeight: 500,
                  color: isActive ? 'var(--color-codex-accent-ink)' : 'var(--color-codex-ink)',
                }}
              >
                {option.count}
              </div>
            </button>
          )
        })}
      </div>

      {/* Background queue */}
      <div
        style={{
          padding: 16,
          marginBottom: 16,
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--color-codex-ink)',
              }}
            >
              {isZh ? '后台任务队列' : 'Background queue'}
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 12,
                color: 'var(--color-codex-ink-mute)',
              }}
            >
              {isZh ? '查看正在排队的客户记忆重建任务，并可直接取消或立即执行。' : 'See queued client memory rebuilds and control them directly.'}
            </p>
          </div>
          <button
            onClick={() => void fetchJobs()}
            className="inline-flex items-center gap-2"
            style={ghostButtonStyle}
          >
            {loadingJobs ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {isZh ? '刷新队列' : 'Refresh queue'}
          </button>
        </div>

        {jobs.length === 0 ? (
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--color-codex-bg-tint)',
              border: '1px dashed var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
              fontSize: 13,
              color: 'var(--color-codex-ink-mute)',
            }}
          >
            {isZh ? '当前没有排队中的客户记忆任务。' : 'No queued client memory jobs right now.'}
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.job_id}
                className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
                style={{
                  padding: '12px 14px',
                  background: 'var(--color-codex-bg)',
                  border: '1px solid var(--color-codex-line-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: 'var(--color-codex-accent)' }} />
                    <span
                      className="truncate"
                      style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--color-codex-ink)' }}
                    >
                      {job.client_name}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 11.5,
                      color: 'var(--color-codex-ink-mute)',
                    }}
                  >
                    {job.industry || (isZh ? '未填写行业' : 'Industry not set')}
                  </div>
                  <div
                    className="mt-2 flex flex-wrap items-center gap-2"
                    style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
                  >
                    <span
                      className="font-mono"
                      style={{
                        padding: '1px 6px',
                        background: 'var(--color-codex-bg-tint)',
                        color: 'var(--color-codex-ink-soft)',
                        borderRadius: 'var(--codex-r-pill, 999px)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {getJobTypeLabel(job.job_type, isZh)}
                    </span>
                    <span className="font-mono">
                      v{job.memory_version} · {job.memory_stale ? (isZh ? '待刷新' : 'Stale') : (isZh ? '已同步' : 'Ready')}
                    </span>
                    <span className="font-mono">
                      {isZh ? '计划' : 'Scheduled'} {formatProjectMemoryUpdatedAt(job.next_run_at, isZh)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => void runJobNow(job.client_id)}
                    disabled={jobActionClientId === job.client_id}
                    className="inline-flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
                    style={smallGhostStyle}
                  >
                    {jobActionClientId === job.client_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {isZh ? '立即' : 'Run'}
                  </button>
                  <button
                    onClick={() => void cancelJob(job.client_id)}
                    disabled={jobActionClientId === job.client_id}
                    className="inline-flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
                    style={smallGhostStyle}
                  >
                    <XCircle className="h-3 w-3" />
                    {isZh ? '取消' : 'Cancel'}
                  </button>
                  <button
                    onClick={() => navigate(`/clients/${job.client_id}/memory`)}
                    className="inline-flex items-center gap-1"
                    style={smallGhostStyle}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {isZh ? '查看' : 'Open'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <div
        className="flex flex-col gap-3 lg:flex-row lg:items-center"
        style={{
          padding: 14,
          marginBottom: 16,
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
        }}
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: 'var(--color-codex-ink-faint)' }}
          />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={isZh ? '搜索客户、行业、联系人或关联项目…' : 'Search clients, industry, contact, or project…'}
            className="w-full outline-none"
            style={{
              padding: '8px 12px 8px 34px',
              fontSize: 13.5,
              background: 'var(--color-codex-bg)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
              color: 'var(--color-codex-ink)',
            }}
          />
        </div>
        <div
          className="font-mono"
          style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
        >
          {isZh ? `${filteredClients.length} / ${clients.length}` : `${filteredClients.length} / ${clients.length}`}
        </div>
      </div>

      {/* Table */}
      <div
        className="overflow-hidden"
        style={{
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
        }}
      >
        <div
          className="grid gap-4 px-5 py-3 font-mono"
          style={{
            gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.2fr) 150px 150px 160px 150px',
            background: 'var(--color-codex-bg-tint)',
            borderBottom: '1px solid var(--color-codex-line)',
            fontSize: 10.5,
            color: 'var(--color-codex-ink-mute)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          <div>{isZh ? '客户' : 'Client'}</div>
          <div>{isZh ? '关联项目' : 'Project Coverage'}</div>
          <div>{isZh ? '记忆状态' : 'Memory Status'}</div>
          <div>{isZh ? '异步状态' : 'Async Status'}</div>
          <div>{isZh ? '最近同步' : 'Last Updated'}</div>
          <div>{isZh ? '操作' : 'Actions'}</div>
        </div>

        {filteredClients.length === 0 ? (
          <div className="text-center" style={{ padding: '48px 24px', color: 'var(--color-codex-ink-mute)' }}>
            <Building2
              className="mx-auto mb-3 h-9 w-9"
              style={{ color: 'var(--color-codex-ink-faint)' }}
            />
            <p style={{ margin: 0, fontSize: 13 }}>
              {isZh ? '当前筛选条件下没有客户' : 'No clients match the current filter'}
            </p>
          </div>
        ) : (
          <div>
            {filteredClients.map((client, index) => {
              const status = getMemoryStatus(client)
              const statusText =
                status === 'missing'
                  ? isZh
                    ? '尚未整理'
                    : 'Not prepared'
                  : status === 'stale'
                    ? isZh
                      ? '建议更新'
                      : 'Needs refresh'
                    : isZh
                      ? '可直接使用'
                      : 'Ready'

              return (
                <div
                  key={client.id}
                  className="grid gap-4 px-5 py-4"
                  style={{
                    gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.2fr) 150px 150px 160px 150px',
                    borderTop:
                      index === 0 ? 'none' : '1px solid var(--color-codex-line-soft)',
                  }}
                >
                  <div className="min-w-0">
                    <div
                      className="truncate"
                      style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-codex-ink)' }}
                    >
                      {client.name}
                    </div>
                    <div
                      className="mt-1 truncate"
                      style={{ fontSize: 12, color: 'var(--color-codex-ink-soft)' }}
                    >
                      {client.industry || (isZh ? '未填写行业' : 'Industry not set')}
                    </div>
                    <div
                      className="mt-1 truncate font-mono"
                      style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
                    >
                      {client.contact || (isZh ? '未填写联系人' : 'No primary contact')}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div
                      className="font-mono"
                      style={{ fontSize: 12.5, color: 'var(--color-codex-ink)' }}
                    >
                      {isZh ? `${client.project_names.length} 个项目` : `${client.project_names.length} projects`}
                    </div>
                    <div
                      className="mt-1 truncate"
                      style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
                    >
                      {client.project_names.length > 0
                        ? client.project_names.slice(0, 2).join(' / ')
                        : isZh
                          ? '暂无关联项目'
                          : 'No linked projects'}
                    </div>
                  </div>

                  <div className="flex items-center">
                    <span
                      className="font-mono"
                      style={{
                        padding: '2px 8px',
                        fontSize: 10.5,
                        background: statusToneBg(status),
                        color: statusToneInk(status),
                        borderRadius: 'var(--codex-r-pill, 999px)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {statusText}
                    </span>
                  </div>

                  <div
                    style={{ fontSize: 12, color: 'var(--color-codex-ink-soft)' }}
                  >
                    <div className="font-mono">{getAsyncStatusLabel(client.client_memory_rebuild_status, isZh)}</div>
                    {client.client_memory_rebuild_failed_at ? (
                      <div
                        className="mt-1 font-mono"
                        style={{ fontSize: 10.5, color: 'var(--color-codex-bad)' }}
                      >
                        {formatProjectMemoryUpdatedAt(client.client_memory_rebuild_failed_at, isZh)}
                      </div>
                    ) : null}
                  </div>

                  <div
                    className="font-mono"
                    style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
                  >
                    {formatProjectMemoryUpdatedAt(client.client_memory_updated_at, isZh)}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void refreshSingleClient(client)}
                      disabled={refreshingClientId === client.id}
                      className="inline-flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
                      style={smallGhostStyle}
                    >
                      {refreshingClientId === client.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      {isZh ? '更新' : 'Refresh'}
                    </button>
                    <button
                      onClick={() => navigate(`/clients/${client.id}/memory`)}
                      className="inline-flex items-center gap-1"
                      style={smallGhostStyle}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {isZh ? '查看' : 'Open'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
