import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Building2, ExternalLink, Loader2, RefreshCw, Search, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import type {
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
}

type MemoryFilter = 'all' | 'ready' | 'stale' | 'missing'

function getMemoryStatus(client: ClientListItem): MemoryFilter {
  if ((client.client_memory_version || 0) === 0) return 'missing'
  if (client.client_memory_stale) return 'stale'
  return 'ready'
}

export function ClientMemorySettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const toast = useToast()

  const [clients, setClients] = useState<ClientListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<MemoryFilter>('all')
  const [isRefreshingStale, setIsRefreshingStale] = useState(false)
  const [isGeneratingMissing, setIsGeneratingMissing] = useState(false)
  const [refreshingClientId, setRefreshingClientId] = useState<number | null>(null)

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

  useEffect(() => {
    void fetchClients()
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
    update: Pick<ClientMemoryStatusResponse, 'memory_stale' | 'memory_version' | 'memory_updated_at'>,
  ) => {
    setClients((current) =>
      current.map((client) =>
        client.id === clientId
          ? {
              ...client,
              client_memory_stale: update.memory_stale,
              client_memory_version: update.memory_version,
              client_memory_updated_at: update.memory_updated_at ?? client.client_memory_updated_at,
            }
          : client,
      ),
    )
  }

  const refreshSingleClient = async (client: ClientListItem) => {
    try {
      setRefreshingClientId(client.id)
      const data = await api.post<ClientMemoryResponse>(`/clients/${client.id}/memory/rebuild`, {}, { timeout: 120000 })
      applyClientMemoryUpdate(client.id, {
        memory_stale: data.memory_stale,
        memory_version: data.memory_version,
        memory_updated_at: data.memory_updated_at,
      })
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
        })
      })

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
        </div>
      </div>

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
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_180px_160px_150px] gap-4 border-b border-outline bg-surface-container-low px-5 py-3 text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
          <div>{isZh ? '客户' : 'Client'}</div>
          <div>{isZh ? '关联项目与覆盖' : 'Project Coverage'}</div>
          <div>{isZh ? '记忆状态' : 'Memory Status'}</div>
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
                  className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_180px_160px_150px] gap-4 px-5 py-4"
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
