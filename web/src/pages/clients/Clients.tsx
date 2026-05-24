import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Brain,
  Building2,
  ChevronRight,
  CircleDashed,
  FileText,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react'

import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import { formatDateOnly, getResolvedAppTimeZone } from '../../utils/timezone'

interface Client {
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

type FilterKey = 'all' | 'active' | 'memory' | 'notes' | 'unassigned'

interface ClientSuggestion {
  name: string
  industry: string
  contact: string
  notes: string
}

function formatRelativeDate(value: string, isZh: boolean) {
  const diffHours = Math.floor((Date.now() - new Date(value).getTime()) / (1000 * 60 * 60))
  if (diffHours < 24) return isZh ? '今天创建' : 'Created today'
  if (diffHours < 48) return isZh ? '昨天创建' : 'Created yesterday'
  return formatDateOnly(value, {
    month: 'short',
    day: 'numeric',
  }, getResolvedAppTimeZone())
}

function getClientAttentionScore(client: Client) {
  let score = 0
  if (client.project_names.length > 0) score += 3
  if (!client.notes.trim()) score += 2
  if (!client.contact.trim()) score += 1
  if ((client.client_memory_version || 0) === 0 || client.client_memory_stale) score += 3
  if (client.document_count > 0) score += 1
  return score
}

export function Clients() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', industry: '', contact: '', notes: '' })

  const [aiQuery, setAiQuery] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<ClientSuggestion[]>([])
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    void fetchClients()
  }, [])

  const fetchClients = async () => {
    try {
      setLoading(true)
      const data = await api.get<Client[]>('/clients')
      setClients(data)
    } catch (error) {
      console.error('Failed to fetch clients:', error)
    } finally {
      setLoading(false)
    }
  }

  const closeCreateModal = () => {
    setShowCreateModal(false)
    setAiQuery('')
    setAiSuggestions([])
    setAiError(null)
  }

  const handleAiSuggest = async () => {
    const query = aiQuery.trim()
    if (!query) return
    setAiLoading(true)
    setAiError(null)
    setAiSuggestions([])
    try {
      const results = await api.post<ClientSuggestion[]>('/clients/ai-suggest', { query })
      setAiSuggestions(results)
      if (results.length === 0) {
        setAiError(isZh ? 'AI 没有返回可用建议。' : 'AI returned no suggestions.')
      }
    } catch (err: any) {
      console.error('AI suggest failed:', err)
      setAiError(err?.response?.data?.detail || (isZh ? 'AI 建议生成失败，请稍后重试。' : 'AI suggestion failed. Please try again.'))
    } finally {
      setAiLoading(false)
    }
  }

  const filterCounts = useMemo(
    () => ({
      all: clients.length,
      active: clients.filter((client) => client.project_names.length > 0).length,
      memory: clients.filter((client) => (client.client_memory_version || 0) === 0 || client.client_memory_stale).length,
      notes: clients.filter((client) => !client.notes.trim()).length,
      unassigned: clients.filter((client) => client.project_names.length === 0).length,
    }),
    [clients],
  )

  const filteredClients = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return clients.filter((client) => {
      const matchesQuery =
        !normalizedQuery ||
        client.name.toLowerCase().includes(normalizedQuery) ||
        client.industry.toLowerCase().includes(normalizedQuery) ||
        client.notes.toLowerCase().includes(normalizedQuery) ||
        client.contact.toLowerCase().includes(normalizedQuery) ||
        client.project_names.some((name) => name.toLowerCase().includes(normalizedQuery))

      if (!matchesQuery) return false

      switch (activeFilter) {
        case 'active':
          return client.project_names.length > 0
        case 'memory':
          return (client.client_memory_version || 0) === 0 || client.client_memory_stale === true
        case 'notes':
          return !client.notes.trim()
        case 'unassigned':
          return client.project_names.length === 0
        default:
          return true
      }
    })
  }, [activeFilter, clients, searchQuery])

  const sortedClients = useMemo(
    () =>
      [...filteredClients].sort((left, right) => {
        const attentionDiff = getClientAttentionScore(right) - getClientAttentionScore(left)
        if (attentionDiff !== 0) return attentionDiff
        const projectDiff = right.project_names.length - left.project_names.length
        if (projectDiff !== 0) return projectDiff
        const documentDiff = right.document_count - left.document_count
        if (documentDiff !== 0) return documentDiff
        return left.name.localeCompare(right.name)
      }),
    [filteredClients],
  )

  const totalProjects = useMemo(
    () => clients.reduce((sum, client) => sum + client.project_names.length, 0),
    [clients],
  )
  const totalDocuments = useMemo(
    () => clients.reduce((sum, client) => sum + client.document_count, 0),
    [clients],
  )
  const activeClients = useMemo(
    () => clients.filter((client) => client.project_names.length > 0).length,
    [clients],
  )
  const readyMemoryClients = useMemo(
    () => clients.filter((client) => (client.client_memory_version || 0) > 0 && !client.client_memory_stale).length,
    [clients],
  )
  const clientsMissingNotes = useMemo(
    () => clients.filter((client) => !client.notes.trim()).length,
    [clients],
  )
  const averageDocsPerClient = useMemo(
    () => (clients.length ? (totalDocuments / clients.length).toFixed(1) : '0.0'),
    [clients.length, totalDocuments],
  )
  const spotlightClients = useMemo(
    () => [...clients].sort((left, right) => getClientAttentionScore(right) - getClientAttentionScore(left)).slice(0, 3),
    [clients],
  )

  const filterOptions: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'all', label: isZh ? '全部客户' : 'All clients', count: filterCounts.all },
    { key: 'active', label: isZh ? '有项目推进' : 'Active work', count: filterCounts.active },
    { key: 'memory', label: isZh ? '记忆待整理' : 'Memory needs work', count: filterCounts.memory },
    { key: 'notes', label: isZh ? '待补背景' : 'Missing notes', count: filterCounts.notes },
    { key: 'unassigned', label: isZh ? '未关联项目' : 'No linked project', count: filterCounts.unassigned },
  ]

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? '客户' : 'Clients'} />
        <div className="flex min-h-full items-center justify-center bg-slate-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={isZh ? '客户' : 'Clients'} />
      <div className="min-h-full bg-[linear-gradient(180deg,#f6f9fc_0%,#eef4fb_36%,#ffffff_100%)]">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <section className="relative overflow-hidden rounded-[2rem] border border-emerald-100 bg-[radial-gradient(circle_at_top_right,#d7f7ea_0%,#effcf5_42%,#ffffff_100%)] p-8 shadow-[0_30px_70px_rgba(15,23,42,0.08)]">
            <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-emerald-200/40 blur-3xl" />
            <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-sm backdrop-blur">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>{isZh ? '客户工作台' : 'Client Workspace'}</span>
                </div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  {isZh ? '知客情而知势，掌项进以汇识' : 'See relationships, delivery signals, and reusable context in one client workspace'}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                  {isZh
                    ? '不只是维护客户档案，更快找到哪些客户正在推进、哪些信息还缺失，以及接下来最值得补强的客户上下文。'
                    : 'Go beyond a directory: quickly spot which clients are active, what context is still missing, and where to strengthen next.'}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <SignalPill label={isZh ? '活跃客户' : 'Active clients'} value={activeClients} />
                  <SignalPill label={isZh ? '记忆已就绪' : 'Memory ready'} value={readyMemoryClients} />
                  <SignalPill label={isZh ? '待补背景' : 'Missing notes'} value={clientsMissingNotes} tone="amber" />
                </div>
              </div>

              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:bg-primary"
              >
                <Plus className="h-4 w-4" />
                {isZh ? '新建客户' : 'New Client'}
              </button>
            </div>
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label={isZh ? '客户总数' : 'Total Clients'} tone="sky" value={clients.length} sub={isZh ? '当前客户池规模' : 'Size of your client base'} />
            <SummaryCard label={isZh ? '关联项目' : 'Linked Projects'} tone="emerald" value={totalProjects} sub={isZh ? '所有客户项目总计' : 'Projects attached to clients'} />
            <SummaryCard label={isZh ? '客户资料' : 'Documents'} tone="amber" value={totalDocuments} sub={isZh ? `平均每个客户 ${averageDocsPerClient} 份` : `${averageDocsPerClient} docs per client`} />
            <SummaryCard label={isZh ? '记忆已准备' : 'Memory Ready'} tone="slate" value={readyMemoryClients} sub={isZh ? `${filterCounts.memory} 个仍待刷新` : `${filterCounts.memory} still need refresh`} />
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
            <div className="space-y-6">
              <section className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="relative w-full min-w-0 flex-1 xl:max-w-2xl">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder={isZh ? '按客户名、行业、联系人、项目或备注搜索' : 'Search by client, industry, contact, project, or notes'}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-11 text-sm text-slate-700 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                      />
                      {searchQuery ? (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        {isZh ? `结果 ${sortedClients.length}` : `${sortedClients.length} results`}
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        {isZh ? `活跃 ${activeClients}` : `Active ${activeClients}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {filterOptions.map((filter) => (
                      <button
                        key={filter.key}
                        type="button"
                        onClick={() => setActiveFilter(filter.key)}
                        className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition ${
                          activeFilter === filter.key
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                        }`}
                      >
                        <span>{filter.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${activeFilter === filter.key ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          {filter.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{isZh ? '客户列表' : 'Client Directory'}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {isZh
                        ? '优先展示更值得跟进的客户：项目更活跃、材料更多、但仍有信息需要补齐。'
                        : 'Prioritized toward the clients most worth reviewing: active, material-rich, and still needing context.'}
                    </p>
                  </div>
                </div>

                {sortedClients.length === 0 ? (
                  <div className="py-20 text-center text-slate-500">
                    <Building2 className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                    <h3 className="text-lg font-semibold text-slate-700">{isZh ? '没有匹配的客户' : 'No matching clients'}</h3>
                    <p className="mt-2 text-sm">
                      {isZh ? '试试切换筛选条件、清空搜索，或者直接新建一个客户。' : 'Try another filter, clear the search, or create a new client.'}
                    </p>
                  </div>
                ) : (
                  <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {sortedClients.map((client) => {
                      const missingMemory = (client.client_memory_version || 0) === 0
                      const needsRefresh = client.client_memory_stale && !missingMemory
                      return (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => navigate(`/clients/${client.id}`)}
                          className="group flex h-full flex-col rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_20px_50px_rgba(15,23,42,0.08)]"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-lg font-bold text-sky-700">
                                {client.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <h3 className="truncate text-base font-semibold text-slate-900">{client.name}</h3>
                                <p className="mt-1 truncate text-sm text-slate-500">
                                  {client.industry || (isZh ? '尚未填写行业' : 'No industry yet')}
                                </p>
                              </div>
                            </div>
                            <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-300 transition group-hover:text-slate-500" />
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                              <FolderKanban className="h-3.5 w-3.5" />
                              {client.project_names.length} {isZh ? '项目' : 'projects'}
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                              <FileText className="h-3.5 w-3.5" />
                              {client.document_count} {isZh ? '文档' : 'docs'}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                                missingMemory
                                  ? 'border border-amber-100 bg-amber-50 text-amber-700'
                                  : needsRefresh
                                    ? 'border border-rose-100 bg-rose-50 text-rose-700'
                                    : 'border border-emerald-100 bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              <Brain className="h-3.5 w-3.5" />
                              {missingMemory
                                ? isZh
                                  ? '未生成记忆'
                                  : 'No memory'
                                : needsRefresh
                                  ? isZh
                                    ? '记忆待刷新'
                                    : 'Refresh memory'
                                  : isZh
                                    ? '记忆就绪'
                                    : 'Memory ready'}
                            </span>
                          </div>

                          <div className="mt-4 flex-1">
                            <p className="line-clamp-3 text-sm leading-6 text-slate-600">
                              {client.notes || (isZh ? '还没有背景备注，建议补充合作目标、关键关系人和风险线索。' : 'No notes yet. Add goals, stakeholders, and risk signals here.')}
                            </p>
                          </div>

                          <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                            <div className="inline-flex items-center gap-2 text-sm text-slate-500">
                              <Users className="h-4 w-4" />
                              <span>{client.contact || (isZh ? '未填写联系人' : 'No contact yet')}</span>
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-400">
                              <span>{formatRelativeDate(client.created_at, isZh)}</span>
                              <span>
                                {client.project_names.length > 0
                                  ? isZh
                                    ? `${client.project_names[0]}${client.project_names.length > 1 ? ` +${client.project_names.length - 1}` : ''}`
                                    : `${client.project_names[0]}${client.project_names.length > 1 ? ` +${client.project_names.length - 1}` : ''}`
                                  : isZh
                                    ? '未关联项目'
                                    : 'No linked project'}
                              </span>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>

            <div className="space-y-6">
              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-sky-600" />
                  <h2 className="text-lg font-semibold text-slate-900">{isZh ? '建议先看的客户' : 'Clients to review first'}</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {isZh
                    ? '这里优先提示活跃但上下文还不完整的客户，适合先补记忆、备注或联系人信息。'
                    : 'These are active clients with incomplete context, good candidates for memory, notes, or contact cleanup.'}
                </p>

                <div className="mt-5 space-y-3">
                  {spotlightClients.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      {isZh ? '还没有客户数据。' : 'No clients yet.'}
                    </div>
                  ) : (
                    spotlightClients.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => navigate(`/clients/${client.id}`)}
                        className="w-full rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-sky-200 hover:bg-white hover:shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{client.name}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {client.industry || (isZh ? '未填写行业' : 'No industry yet')}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300" />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {client.project_names.length > 0 ? (
                            <MiniBadge icon={<FolderKanban className="h-3 w-3" />} label={isZh ? `${client.project_names.length} 个项目` : `${client.project_names.length} projects`} />
                          ) : (
                            <MiniBadge icon={<CircleDashed className="h-3 w-3" />} label={isZh ? '未挂项目' : 'Unassigned'} tone="slate" />
                          )}
                          {!client.notes.trim() ? <MiniBadge icon={<AlertCircle className="h-3 w-3" />} label={isZh ? '待补备注' : 'Missing notes'} tone="amber" /> : null}
                          {(client.client_memory_version || 0) === 0 || client.client_memory_stale ? (
                            <MiniBadge icon={<Brain className="h-3 w-3" />} label={isZh ? '记忆待处理' : 'Memory work'} tone="rose" />
                          ) : null}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">{isZh ? '录入建议' : 'Capture checklist'}</h2>
                <div className="mt-4 space-y-3">
                  <ChecklistItem
                    title={isZh ? '先补背景备注' : 'Start with notes'}
                    description={isZh ? '记录合作目标、关键干系人和敏感点，后续检索会更准确。' : 'Capture goals, stakeholders, and sensitive topics for stronger retrieval later.'}
                  />
                  <ChecklistItem
                    title={isZh ? '补联系人信息' : 'Add contact context'}
                    description={isZh ? '至少留一个联系人，方便后续从客户详情进入执行。' : 'Keep at least one usable contact to make follow-up work smoother.'}
                  />
                  <ChecklistItem
                    title={isZh ? '生成客户记忆' : 'Prepare client memory'}
                    description={isZh ? '当客户开始跨项目合作时，尽早沉淀客户级经验。' : 'Once work spans multiple projects, prepare memory early so insights can be reused.'}
                  />
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.25)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{isZh ? '新建客户' : 'New Client'}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {isZh ? '先录入基础档案，再逐步补全项目、备注和客户记忆。' : 'Start with the basics, then enrich projects, notes, and client memory over time.'}
                </p>
              </div>
              <button
                onClick={closeCreateModal}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="mb-2 block text-xs font-semibold text-slate-500">
                  {isZh ? 'AI 智能补全' : 'AI Auto-fill'}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={aiQuery}
                    onChange={(event) => setAiQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), void handleAiSuggest())}
                    placeholder={isZh ? '输入公司名称或一句业务描述...' : 'Enter a company name or short business description...'}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAiSuggest()}
                    disabled={aiLoading || !aiQuery.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isZh ? '生成建议' : 'Generate'}
                  </button>
                </div>

                {aiError && <p className="mt-2 text-xs text-rose-500">{aiError}</p>}

                {aiSuggestions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-slate-400">
                      {isZh ? '点击建议即可一键填入表单。' : 'Click a suggestion to auto-fill the form.'}
                    </p>
                    {aiSuggestions.map((suggestion, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          setForm({
                            name: suggestion.name,
                            industry: suggestion.industry,
                            contact: suggestion.contact,
                            notes: suggestion.notes,
                          })
                          setAiSuggestions([])
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-primary/30 hover:shadow-sm"
                      >
                        <p className="text-sm font-medium text-slate-900">{suggestion.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {[suggestion.industry, suggestion.notes].filter(Boolean).join(' · ')}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <FormField label={isZh ? '客户名称' : 'Client Name'} required>
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder={isZh ? '请输入客户名称' : 'Enter client name'}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={isZh ? '行业' : 'Industry'}>
                  <input
                    type="text"
                    value={form.industry}
                    onChange={(event) => setForm({ ...form, industry: event.target.value })}
                    placeholder={isZh ? '如：互联网、制造业' : 'e.g. SaaS, Manufacturing'}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                  />
                </FormField>

                <FormField label={isZh ? '联系人' : 'Contact'}>
                  <input
                    type="text"
                    value={form.contact}
                    onChange={(event) => setForm({ ...form, contact: event.target.value })}
                    placeholder={isZh ? '如：张三 / 13800000000' : 'e.g. Jane Doe / +1 555...'}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                  />
                </FormField>
              </div>

              <FormField label={isZh ? '备注' : 'Notes'}>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  placeholder={isZh ? '补充背景、合作目标、关键关系人或风险线索...' : 'Add background, goals, stakeholders, or risk signals...'}
                  rows={4}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                />
              </FormField>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                onClick={closeCreateModal}
                disabled={creating}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                {isZh ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={async () => {
                  if (!form.name.trim()) {
                    alert(isZh ? '客户名称不能为空。' : 'Client name is required.')
                    return
                  }
                  setCreating(true)
                  try {
                    await api.post('/clients', {
                      name: form.name.trim(),
                      industry: form.industry.trim(),
                      contact: form.contact.trim(),
                      notes: form.notes.trim(),
                    })
                    setForm({ name: '', industry: '', contact: '', notes: '' })
                    closeCreateModal()
                    await fetchClients()
                  } catch (error) {
                    console.error('Failed to create client:', error)
                    alert(isZh ? '创建失败，请稍后重试。' : 'Failed to create client.')
                  } finally {
                    setCreating(false)
                  }
                }}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-primary disabled:opacity-50"
              >
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                {isZh ? '确认创建' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function SignalPill({
  label,
  tone = 'sky',
  value,
}: {
  label: string
  tone?: 'sky' | 'amber'
  value: number
}) {
  return (
    <div className={`rounded-full border px-3 py-1.5 text-xs shadow-sm ${tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-white/80 bg-white/75 text-slate-600'}`}>
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
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{sub}</p>
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
  tone?: 'sky' | 'amber' | 'rose' | 'slate'
}) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-100 bg-amber-50 text-amber-700'
      : tone === 'rose'
        ? 'border-rose-100 bg-rose-50 text-rose-700'
        : tone === 'slate'
          ? 'border-slate-200 bg-slate-100 text-slate-600'
          : 'border-sky-100 bg-sky-50 text-sky-700'

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
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

function FormField({
  children,
  label,
  required = false,
}: {
  children: ReactNode
  label: string
  required?: boolean
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-1 text-rose-500">*</span> : null}
      </div>
      {children}
    </label>
  )
}
