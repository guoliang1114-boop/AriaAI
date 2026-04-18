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
    },
  ) => {
    if (clientIds.length === 0) return

    try {
      setIsWarmingSummaries(true)
      const result = await api.post<ClientMemoryBatchWarmSummariesResponse>(
        '/clients/memory/warm-summaries-batch',
        {
          client_ids: clientIds,
          summary_types: ['overview', 'stakeholder', 'lessons'],
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
    void warmSummaries(readyClientIds, { silent: true })
  }, [isGeneratingMissing, isWarmingSummaries, loading, readyClientIds])

  const filterOptions: Array<{ key: MemoryFilter; label: string; count: number }> = [
    { key: 'all', label: isZh ? '全部客户' : 'All', count: counts.all },
    { key: 'ready', label: isZh ? '可直接使用' : 'Ready', count: counts.ready },
    { key: 'stale', label: isZh ? '建议更新' : 'Needs refresh', count: counts.stale },
    { key: 'missing', label: isZh ? '尚未整理' : 'Not prepared', count: counts.missing },
  ]

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-on-surface">
                {isZh ? '客户记忆管理' : 'Client Memory Manager'}
              </h2>
              <p className="mt-1 text-sm text-on-surface-muted">
                {isZh
                  ? '集中查看客户级长期记忆状态，统一补齐缺失内容并刷新建议更新的客户记忆。'
                  : 'Track long-term client memory health, generate missing memories, and refresh stale ones in one place.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void runBatch('missing')}
            disabled={counts.missing === 0 || isGeneratingMissing}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGeneratingMissing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            {isZh ? '补齐缺失记忆' : 'Generate Missing Memory'}
          </button>
          <button
            onClick={() => void runBatch('stale')}
            disabled={counts.stale === 0 || isRefreshingStale}
            className="inline-flex items-center gap-2 rounded-xl border border-outline px-4 py-2 text-sm font-medium text-on-surface transition hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRefreshingStale ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isZh ? '刷新待更新记忆' : 'Refresh Stale Memory'}
          </button>
          <button
            onClick={() => void warmSummaries(readyClientIds, { forceRefresh: false })}
            disabled={readyClientIds.length === 0 || isWarmingSummaries}
            className="inline-flex items-center gap-2 rounded-xl border border-outline px-4 py-2 text-sm font-medium text-on-surface transition hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isWarmingSummaries ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isZh ? '预生成常用 AI 摘要' : 'Warm Common AI Summaries'}
          </button>
        </div>
      </div>

      {isGeneratingMissing && autoGenerateMissingTriggeredRef.current ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {isZh
            ? '系统正在自动补齐尚未整理的客户记忆，结果会在列表中自动更新。'
            : 'Missing client memories are being prepared automatically. The list will update as results come back.'}
        </div>
      ) : null}

      {isWarmingSummaries ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          {isZh
            ? '系统正在后台预热常用 AI 摘要，并按队列、预算和间隔节奏控制，避免集中触发限流。'
            : 'Common AI summaries are being warmed in the background with queue, budget, and pacing controls to avoid rate-limit spikes.'}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        {filterOptions.map((option) => (
          <button
            key={option.key}
            onClick={() => setFilter(option.key)}
            className={`rounded-2xl border p-4 text-left transition ${
              filter === option.key
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-outline bg-surface hover:bg-surface-container-low'
            }`}
          >
            <div className="text-sm text-on-surface-muted">{option.label}</div>
            <div className="mt-2 text-2xl font-semibold text-on-surface">{option.count}</div>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-outline bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">
              {isZh ? '后台任务队列' : 'Background queue'}
            </h3>
            <p className="mt-1 text-xs text-on-surface-muted">
              {isZh ? '查看正在排队的客户记忆重建任务，并可直接取消或立即执行。' : 'See queued client memory rebuilds and control them directly.'}
            </p>
          </div>
          <button
            onClick={() => void fetchJobs()}
            className="inline-flex items-center gap-2 rounded-xl border border-outline px-3 py-2 text-xs font-medium text-on-surface hover:bg-surface-container-high"
          >
            {loadingJobs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {isZh ? '刷新队列' : 'Refresh queue'}
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="rounded-xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-muted">
            {isZh ? '当前没有排队中的客户记忆任务。' : 'No queued client memory jobs right now.'}
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.job_id}
                className="flex flex-col gap-3 rounded-xl border border-outline px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
                    <Clock3 className="h-4 w-4 text-primary" />
                    <span className="truncate">{job.client_name}</span>
                  </div>
                  <div className="mt-1 text-xs text-on-surface-muted">
                    {(job.industry || (isZh ? '未填写行业' : 'Industry not set'))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-on-surface-muted">
                    <span className="rounded-full bg-surface-container-low px-2.5 py-1">
                      {getJobTypeLabel(job.job_type, isZh)}
                    </span>
                    <span>{isZh ? '版本' : 'Version'} {job.memory_version}</span>
                    <span>{isZh ? '状态' : 'Status'}: {job.memory_stale ? (isZh ? '待刷新' : 'Stale') : (isZh ? '已同步' : 'Ready')}</span>
                    <span>{isZh ? '计划执行' : 'Scheduled'}: {formatProjectMemoryUpdatedAt(job.next_run_at, isZh)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void runJobNow(job.client_id)}
                    disabled={jobActionClientId === job.client_id}
                    className="inline-flex items-center gap-1 rounded-lg border border-outline px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {jobActionClientId === job.client_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    {isZh ? '立即执行' : 'Run now'}
                  </button>
                  <button
                    onClick={() => void cancelJob(job.client_id)}
                    disabled={jobActionClientId === job.client_id}
                    className="inline-flex items-center gap-1 rounded-lg border border-outline px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {isZh ? '取消' : 'Cancel'}
                  </button>
                  <button
                    onClick={() => navigate(`/clients/${job.client_id}/memory`)}
                    className="inline-flex items-center gap-1 rounded-lg border border-outline px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-high"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {isZh ? '查看' : 'Open'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-outline bg-surface p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-muted" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={isZh ? '搜索客户、行业、联系人或关联项目…' : 'Search clients, industry, contact, or project…'}
            className="w-full rounded-xl border border-outline bg-surface px-10 py-2.5 text-sm text-on-surface outline-none transition focus:border-primary"
          />
        </div>
        <div className="text-sm text-on-surface-muted">
          {isZh ? `当前显示 ${filteredClients.length} / ${clients.length} 个客户` : `Showing ${filteredClients.length} of ${clients.length} clients`}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-outline bg-surface">
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_180px_150px_160px_150px] gap-4 border-b border-outline bg-surface-container-low px-5 py-3 text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
          <div>{isZh ? '客户' : 'Client'}</div>
          <div>{isZh ? '关联项目与覆盖' : 'Project Coverage'}</div>
          <div>{isZh ? '记忆状态' : 'Memory Status'}</div>
          <div>{isZh ? '异步状态' : 'Async Status'}</div>
          <div>{isZh ? '最近同步' : 'Last Updated'}</div>
          <div>{isZh ? '操作' : 'Actions'}</div>
        </div>

        {filteredClients.length === 0 ? (
          <div className="py-14 text-center text-on-surface-muted">
            <Building2 className="mx-auto mb-3 h-10 w-10 opacity-40" />
            <p>{isZh ? '当前筛选条件下没有客户' : 'No clients match the current filter'}</p>
          </div>
        ) : (
          <div className="divide-y divide-outline">
            {filteredClients.map((client) => {
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
                  className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_180px_150px_160px_150px] gap-4 px-5 py-4"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-on-surface">{client.name}</div>
                    <div className="mt-1 truncate text-sm text-on-surface-muted">
                      {client.industry || (isZh ? '未填写行业' : 'Industry not set')}
                    </div>
                    <div className="mt-1 truncate text-xs text-on-surface-muted">
                      {client.contact || (isZh ? '未填写联系人' : 'No primary contact')}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm text-on-surface">
                      {isZh ? `${client.project_names.length} 个关联项目` : `${client.project_names.length} related projects`}
                    </div>
                    <div className="mt-1 truncate text-xs text-on-surface-muted">
                      {client.project_names.length > 0
                        ? client.project_names.slice(0, 2).join(' / ')
                        : isZh
                          ? '暂无关联项目'
                          : 'No linked projects'}
                    </div>
                  </div>

                  <div className="flex items-center">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        status === 'missing'
                          ? 'bg-amber-100 text-amber-800'
                          : status === 'stale'
                            ? 'bg-orange-100 text-orange-800'
                            : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {statusText}
                    </span>
                  </div>

                  <div className="text-sm text-on-surface-muted">
                    <div>{getAsyncStatusLabel(client.client_memory_rebuild_status, isZh)}</div>
                    {client.client_memory_rebuild_failed_at ? (
                      <div className="mt-1 text-xs text-error">
                        {formatProjectMemoryUpdatedAt(client.client_memory_rebuild_failed_at, isZh)}
                      </div>
                    ) : null}
                  </div>

                  <div className="text-sm text-on-surface-muted">
                    {formatProjectMemoryUpdatedAt(client.client_memory_updated_at, isZh)}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void refreshSingleClient(client)}
                      disabled={refreshingClientId === client.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-outline px-3 py-1.5 text-xs font-medium text-on-surface transition hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {refreshingClientId === client.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      {isZh ? '更新' : 'Refresh'}
                    </button>
                    <button
                      onClick={() => navigate(`/clients/${client.id}/memory`)}
                      className="inline-flex items-center gap-1 rounded-lg border border-outline px-3 py-1.5 text-xs font-medium text-on-surface transition hover:bg-surface-container-high"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
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
