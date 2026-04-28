import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Brain,
  Building2,
  ChevronRight,
  FolderKanban,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
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
  const navigate = useNavigate()
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
      [client.name, client.industry, client.contact, client.notes, ...(client.project_names || [])]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(keyword)),
    )
  }, [clients, search])

  const activeClients = useMemo(
    () => clients.filter((client) => client.project_names.length > 0).length,
    [clients],
  )
  const readyMemoryClients = useMemo(
    () => clients.filter((client) => (client.client_memory_version || 0) > 0 && !client.client_memory_stale).length,
    [clients],
  )
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

  if (loadingClients) {
    return (
      <>
        <PageTitle title={isZh ? '联系人' : 'Contacts'} />
        <div className="flex min-h-full items-center justify-center bg-slate-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={isZh ? '联系人' : 'Contacts'} />
      <div className="min-h-full bg-[linear-gradient(180deg,#f6f9fc_0%,#eef4fb_36%,#ffffff_100%)]">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <section className="relative overflow-hidden rounded-[2rem] border border-sky-100 bg-[radial-gradient(circle_at_top_right,#dff3ff_0%,#f0f8ff_42%,#ffffff_100%)] p-8 shadow-[0_30px_70px_rgba(15,23,42,0.08)]">
            <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-sky-200/35 blur-3xl" />
            <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-sky-700 shadow-sm backdrop-blur">
                  <Users className="h-3.5 w-3.5" />
                  <span>{isZh ? '联系人工作台' : 'Contact Workspace'}</span>
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
                  {isZh ? '集中维护客户联系人，沉淀沟通策略和关系洞察' : 'Manage client contacts, relationship signals, and communication insight'}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                  {isZh
                    ? '按客户查看关键联系人、角色、关系状态和沟通偏好，让项目推进时能快速找到合适的人和合适的沟通方式。'
                    : 'Review contacts by client, keep roles and relationship status clean, and preserve the context needed for better follow-up.'}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <SignalPill label={isZh ? '客户' : 'Clients'} value={clients.length} />
                  <SignalPill label={isZh ? '活跃客户' : 'Active clients'} value={activeClients} />
                  <SignalPill label={isZh ? '记忆就绪' : 'Memory ready'} value={readyMemoryClients} tone="emerald" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => selectedClient && navigate(`/clients/${selectedClient.id}`)}
                disabled={!selectedClient}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Building2 className="h-4 w-4" />
                {isZh ? '查看客户详情' : 'Open Client'}
              </button>
            </div>
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label={isZh ? '客户总数' : 'Total Clients'} tone="sky" value={clients.length} sub={isZh ? '可维护联系人的客户池' : 'Clients available for contact work'} />
            <SummaryCard label={isZh ? '当前联系人' : 'Current Contacts'} tone="emerald" value={stakeholders.length} sub={selectedClient?.name || (isZh ? '未选择客户' : 'No client selected')} />
            <SummaryCard label={isZh ? '已有洞察' : 'With Insights'} tone="amber" value={insightCount} sub={isZh ? '当前客户的沟通画像' : 'Profiles for the selected client'} />
            <SummaryCard label={isZh ? '搜索结果' : 'Search Results'} tone="slate" value={filteredClients.length} sub={isZh ? '匹配当前关键词的客户' : 'Clients matching the current query'} />
          </section>

          {error ? (
            <div className="mt-6 rounded-[1.25rem] border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-6">
              <section className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{isZh ? '选择客户' : 'Select Client'}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {isZh ? '联系人按客户归档管理。' : 'Contacts are organized by client.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadClients()}
                    disabled={loadingClients}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-white hover:text-slate-900 disabled:opacity-50"
                    title={isZh ? '刷新客户' : 'Refresh clients'}
                  >
                    {loadingClients ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </button>
                </div>

                <div className="relative mt-4">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={isZh ? '搜索客户、行业、项目或备注' : 'Search client, industry, project, or notes'}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-11 text-sm text-slate-700 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                  />
                  {search ? (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 max-h-[calc(100vh-330px)] space-y-3 overflow-auto pr-1">
                  {filteredClients.length ? (
                    filteredClients.map((client) => {
                      const active = client.id === selectedClientId
                      return (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => setSelectedClientId(client.id)}
                          className={`w-full rounded-[1.35rem] border p-4 text-left transition ${
                            active
                              ? 'border-sky-200 bg-sky-50/80 shadow-sm'
                              : 'border-slate-200 bg-slate-50/70 hover:-translate-y-0.5 hover:border-sky-200 hover:bg-white hover:shadow-sm'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-base font-bold text-sky-700">
                                {client.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">{client.name}</p>
                                <p className="mt-1 truncate text-xs text-slate-500">
                                  {client.industry || client.contact || (isZh ? '暂无客户信息' : 'No client detail')}
                                </p>
                              </div>
                            </div>
                            <ChevronRight className={`h-4 w-4 flex-shrink-0 ${active ? 'text-sky-500' : 'text-slate-300'}`} />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <MiniBadge icon={<FolderKanban className="h-3 w-3" />} label={isZh ? `${client.project_names.length} 个项目` : `${client.project_names.length} projects`} />
                            {(client.client_memory_version || 0) > 0 && !client.client_memory_stale ? (
                              <MiniBadge icon={<Brain className="h-3 w-3" />} label={isZh ? '记忆就绪' : 'Memory ready'} tone="emerald" />
                            ) : (
                              <MiniBadge icon={<Brain className="h-3 w-3" />} label={isZh ? '记忆待整理' : 'Memory work'} tone="amber" />
                            )}
                          </div>
                        </button>
                      )
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                      {isZh ? '没有匹配的客户' : 'No matching clients'}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-sky-600" />
                  <h2 className="text-lg font-semibold text-slate-900">{isZh ? '维护建议' : 'Capture Checklist'}</h2>
                </div>
                <div className="mt-4 space-y-3">
                  <ChecklistItem
                    title={isZh ? '先确认角色和影响力' : 'Start with role and influence'}
                    description={isZh ? '联系人最好记录角色、组织层级和影响类型，方便后续判断推进路径。' : 'Keep role, org level, and influence type clear so follow-up paths stay obvious.'}
                  />
                  <ChecklistItem
                    title={isZh ? '再沉淀沟通偏好' : 'Capture communication style'}
                    description={isZh ? '记录偏好的沟通方式、敏感点和最近动作，减少下一次沟通前的回忆成本。' : 'Record preferences, sensitivities, and last action to reduce context switching.'}
                  />
                  <ChecklistItem
                    title={isZh ? '项目内继续 AI 分析' : 'Analyze from projects'}
                    description={isZh ? '需要结合项目上下文做性格和策略分析时，进入对应项目的干系人页面执行。' : 'Use the project stakeholder page when analysis should include project context.'}
                  />
                </div>
              </section>
            </aside>

            <main className="min-w-0">
              <section className="mb-6 rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-500">{isZh ? '当前客户' : 'Current Client'}</p>
                    <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                      {selectedClient?.name || (isZh ? '请选择客户' : 'Select a client')}
                    </h2>
                  </div>
                  {selectedClient?.project_names?.length ? (
                    <div className="flex max-w-xl flex-wrap justify-start gap-2 sm:justify-end">
                      {selectedClient.project_names.slice(0, 4).map((name) => (
                        <span key={name} className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>

              {selectedClient ? (
                loadingStakeholders ? (
                  <div className="flex min-h-[260px] items-center justify-center rounded-[1.75rem] border border-slate-200 bg-white/92 text-slate-500 shadow-sm">
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
                )
              ) : (
                <div className="flex min-h-[360px] items-center justify-center rounded-[1.75rem] border border-dashed border-slate-200 bg-white/80 text-sm text-slate-500">
                  {isZh ? '请先选择一个客户' : 'Select a client to manage contacts'}
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </>
  )
}

function SignalPill({
  label,
  tone = 'sky',
  value,
}: {
  label: string
  tone?: 'sky' | 'emerald'
  value: number
}) {
  const toneClass = tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-white/80 bg-white/75 text-slate-600'
  return (
    <div className={`rounded-full border px-3 py-1.5 text-xs shadow-sm ${toneClass}`}>
      {label}: <span className="font-semibold text-slate-900">{value}</span>
    </div>
  )
}

function SummaryCard({
  label,
  tone,
  value,
  sub,
}: {
  label: string
  tone: 'sky' | 'emerald' | 'amber' | 'slate'
  value: number | string
  sub: string
}) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-100 bg-emerald-50/80 text-emerald-700'
      : tone === 'amber'
        ? 'border-amber-100 bg-amber-50/80 text-amber-700'
        : tone === 'slate'
          ? 'border-slate-200 bg-slate-50/80 text-slate-700'
          : 'border-sky-100 bg-sky-50/80 text-sky-700'

  return (
    <div className={`rounded-[1.5rem] border p-5 shadow-sm ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 truncate text-sm text-slate-500">{sub}</p>
    </div>
  )
}

function MiniBadge({
  icon,
  label,
  tone = 'sky',
}: {
  icon: ReactNode
  label: string
  tone?: 'sky' | 'amber' | 'emerald'
}) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-100 bg-amber-50 text-amber-700'
      : tone === 'emerald'
        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
        : 'border-sky-100 bg-sky-50 text-sky-700'

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClass}`}>
      {icon}
      {label}
    </span>
  )
}

function ChecklistItem({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50/70 p-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  )
}
