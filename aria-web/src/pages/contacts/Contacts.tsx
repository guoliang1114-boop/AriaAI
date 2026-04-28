import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Loader2, RefreshCw, Search, Users } from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { ClientStakeholder } from '../../types/api'
import { ClientStakeholdersStructuredCard } from '../projects/ClientStakeholdersStructuredCard'

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

export function Contacts() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [clients, setClients] = useState<ClientListItem[]>([])
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)
  const [stakeholders, setStakeholders] = useState<ClientStakeholder[]>([])
  const [search, setSearch] = useState('')
  const [loadingClients, setLoadingClients] = useState(true)
  const [loadingStakeholders, setLoadingStakeholders] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedClient = clients.find((client) => client.id === selectedClientId)

  const filteredClients = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return clients
    return clients.filter((client) =>
      [client.name, client.industry, client.contact, ...(client.project_names || [])]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(keyword)),
    )
  }, [clients, search])

  const insightCount = useMemo(
    () =>
      stakeholders.filter(
        (item) =>
          item.personality_profile ||
          item.decision_style ||
          item.communication_strategy ||
          item.trust_signals,
      ).length,
    [stakeholders],
  )

  const loadClients = async () => {
    setLoadingClients(true)
    setError(null)
    try {
      const data = await api.get<ClientListItem[]>('/clients')
      setClients(data)
      setSelectedClientId((current) => current ?? data[0]?.id ?? null)
    } catch {
      setError(isZh ? '客户列表加载失败' : 'Failed to load clients')
    } finally {
      setLoadingClients(false)
    }
  }

  useEffect(() => {
    void loadClients()
  }, [])

  useEffect(() => {
    if (!selectedClientId) {
      setStakeholders([])
      return
    }

    setLoadingStakeholders(true)
    setError(null)
    api
      .get<ClientStakeholder[]>(`/clients/${selectedClientId}/stakeholders`)
      .then(setStakeholders)
      .catch(() => setError(isZh ? '联系人加载失败' : 'Failed to load contacts'))
      .finally(() => setLoadingStakeholders(false))
  }, [isZh, selectedClientId])

  return (
    <div className="min-h-full bg-surface">
      <PageTitle title={isZh ? '联系人' : 'Contacts'} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="flex flex-col gap-4 border-b border-outline/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Users className="h-4 w-4" />
              {isZh ? '客户关系' : 'Client relationships'}
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-on-surface">{isZh ? '联系人' : 'Contacts'}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant">
              {isZh
                ? '按客户集中维护联系人、角色、关系状态和沟通洞察，便于后续在项目里继续分析和调用。'
                : 'Manage contacts, roles, relationship status, and communication insights by client.'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Metric label={isZh ? '客户' : 'Clients'} value={clients.length} />
            <Metric label={isZh ? '当前联系人' : 'Current contacts'} value={stakeholders.length} />
            <Metric label={isZh ? '已有洞察' : 'With insights'} value={insightCount} />
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>
        ) : null}

        <div className="mt-6 grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="h-fit rounded-xl border border-outline/10 bg-surface-container-lowest p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-on-surface">{isZh ? '选择客户' : 'Select client'}</div>
              <button
                type="button"
                onClick={() => void loadClients()}
                disabled={loadingClients}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-surface-container-low hover:text-on-surface disabled:opacity-50"
                title={isZh ? '刷新客户' : 'Refresh clients'}
              >
                {loadingClients ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
            </div>
            <label className="mt-4 flex items-center gap-2 rounded-lg border border-outline/10 bg-surface px-3 py-2">
              <Search className="h-4 w-4 text-on-surface-muted" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={isZh ? '搜索客户、行业或项目' : 'Search clients, industry, or projects'}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-on-surface-muted"
              />
            </label>

            <div className="mt-4 max-h-[calc(100vh-280px)] space-y-2 overflow-auto pr-1">
              {loadingClients ? (
                <div className="flex items-center gap-2 py-8 text-sm text-on-surface-variant">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isZh ? '正在加载客户...' : 'Loading clients...'}
                </div>
              ) : filteredClients.length ? (
                filteredClients.map((client) => {
                  const active = client.id === selectedClientId
                  return (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => setSelectedClientId(client.id)}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                        active
                          ? 'border-primary/25 bg-secondary-container/50 text-on-surface'
                          : 'border-transparent text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate text-sm font-medium">{client.name}</span>
                      </div>
                      <div className="mt-1 truncate pl-6 text-xs text-on-surface-muted">
                        {client.industry || client.contact || (isZh ? '暂无客户信息' : 'No client detail')}
                      </div>
                    </button>
                  )
                })
              ) : (
                <div className="py-8 text-sm text-on-surface-variant">
                  {isZh ? '没有匹配的客户' : 'No matching clients'}
                </div>
              )}
            </div>
          </aside>

          <main className="min-w-0">
            {selectedClient ? (
              <>
                <div className="mb-4 flex flex-col gap-2 rounded-xl border border-outline/10 bg-surface-container-lowest px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm text-on-surface-muted">{isZh ? '当前客户' : 'Current client'}</div>
                    <div className="font-semibold text-on-surface">{selectedClient.name}</div>
                  </div>
                  {selectedClient.project_names?.length ? (
                    <div className="truncate text-sm text-on-surface-variant">
                      {selectedClient.project_names.slice(0, 3).join(' / ')}
                    </div>
                  ) : null}
                </div>
                {loadingStakeholders ? (
                  <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-outline/10 bg-surface-container-lowest text-on-surface-variant">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {isZh ? '正在加载联系人...' : 'Loading contacts...'}
                  </div>
                ) : (
                  <ClientStakeholdersStructuredCard
                    clientId={selectedClient.id}
                    isZh={isZh}
                    onChanged={setStakeholders}
                    stakeholders={stakeholders}
                  />
                )}
              </>
            ) : (
              <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-outline/20 bg-surface-container-lowest text-sm text-on-surface-variant">
                {isZh ? '请先选择一个客户' : 'Select a client to manage contacts'}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[92px] rounded-lg border border-outline/10 bg-surface-container-lowest px-3 py-2 text-right">
      <div className="text-lg font-semibold text-on-surface">{value}</div>
      <div className="text-xs text-on-surface-muted">{label}</div>
    </div>
  )
}
