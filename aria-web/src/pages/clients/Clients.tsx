import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Building2,
  ChevronRight,
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

interface Client {
  id: number
  name: string
  industry: string
  contact: string
  notes: string
  created_at: string
  document_count: number
  project_names: string[]
}

export function Clients() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', industry: '', contact: '', notes: '' })

  const [aiQuery, setAiQuery] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<Array<{ name: string; industry: string; contact: string; notes: string }>>([])
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

  const handleAiSuggest = async () => {
    const query = aiQuery.trim()
    if (!query) return
    setAiLoading(true)
    setAiError(null)
    setAiSuggestions([])
    try {
      const results = await api.post<Array<{ name: string; industry: string; contact: string; notes: string }>>('/clients/ai-suggest', { query })
      setAiSuggestions(results)
      if (results.length === 0) {
        setAiError(isZh ? 'AI 没有返回建议结果' : 'AI returned no results')
      }
    } catch (err: any) {
      console.error('AI suggest failed:', err)
      setAiError(err?.response?.data?.detail || (isZh ? 'AI 建议生成失败' : 'AI suggestion failed'))
    } finally {
      setAiLoading(false)
    }
  }

  const filteredClients = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return clients.filter((client) => {
      if (!normalizedQuery) return true
      return (
        client.name.toLowerCase().includes(normalizedQuery) ||
        client.industry.toLowerCase().includes(normalizedQuery) ||
        client.notes.toLowerCase().includes(normalizedQuery) ||
        client.contact.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [clients, searchQuery])

  const sortedClients = useMemo(
    () =>
      [...filteredClients].sort((left, right) => {
        const projectDiff = right.project_names.length - left.project_names.length
        if (projectDiff !== 0) return projectDiff
        return right.document_count - left.document_count
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
          <section className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_right,#dfefff_0%,#f8fbff_42%,#ffffff_100%)] p-8 shadow-[0_30px_70px_rgba(15,23,42,0.08)]">
            <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-sky-200/35 blur-3xl" />
            <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-sky-700 shadow-sm backdrop-blur">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>{isZh ? '客户空间' : 'Client Workspace'}</span>
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
                  {isZh ? '把客户关系、项目线索和资料沉淀放在一个工作台里' : 'Keep client relationships, project signals, and materials in one workspace'}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                  {isZh
                    ? '在这里统一管理客户档案，快速查看关联项目、文档沉淀和关键备注。'
                    : 'Manage client records in one place, with quick access to related projects, documents, and key notes.'}
                </p>
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

          <section className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full min-w-0 flex-1 xl:max-w-2xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={isZh ? '按客户名称、行业、联系人或备注搜索' : 'Search by client name, industry, contact, or notes'}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-primary/30 focus:bg-white focus:ring-2 focus:ring-primary/15"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  {isZh ? `共 ${sortedClients.length} 个客户` : `${sortedClients.length} clients`}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  {isZh ? `活跃客户 ${activeClients}` : `Active ${activeClients}`}
                </div>
              </div>
            </div>
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label={isZh ? '客户总数' : 'Total Clients'}
              tone="sky"
              value={clients.length}
            />
            <SummaryCard
              label={isZh ? '活跃客户' : 'Active Clients'}
              tone="emerald"
              value={activeClients}
            />
            <SummaryCard
              label={isZh ? '关联项目' : 'Linked Projects'}
              tone="amber"
              value={totalProjects}
            />
            <SummaryCard
              label={isZh ? '文档沉淀' : 'Documents'}
              tone="slate"
              value={totalDocuments}
            />
          </section>

          <section className="mt-6 rounded-[1.75rem] border border-slate-200 bg-white/92 p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{isZh ? '客户列表' : 'Client Directory'}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isZh ? '按项目关联和资料沉淀优先展示。' : 'Prioritized by project activity and accumulated materials.'}
                </p>
              </div>
            </div>

            {sortedClients.length === 0 ? (
              <div className="py-20 text-center text-slate-500">
                <Building2 className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                <h3 className="text-lg font-semibold text-slate-700">{isZh ? '暂无客户' : 'No clients found'}</h3>
                <p className="mt-2 text-sm">
                  {isZh ? '试试调整搜索条件，或者新建一个客户。' : 'Try adjusting your search or create a new client.'}
                </p>
              </div>
            ) : (
              <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {sortedClients.map((client) => (
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
                            {client.industry || (isZh ? '未填写行业' : 'No industry yet')}
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
                    </div>

                    <div className="mt-4 flex-1">
                      <p className="line-clamp-3 text-sm leading-6 text-slate-600">
                        {client.notes || (isZh ? '暂无备注，可在客户详情中继续补充背景与合作信息。' : 'No notes yet. Open the client record to add context and collaboration details.')}
                      </p>
                    </div>

                    <div className="mt-5 border-t border-slate-100 pt-4">
                      <div className="inline-flex items-center gap-2 text-sm text-slate-500">
                        <Users className="h-4 w-4" />
                        <span>{client.contact || (isZh ? '未填写联系人' : 'No contact yet')}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.25)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{isZh ? '新建客户' : 'New Client'}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {isZh ? '录入基础档案，后续再逐步补充项目和资料。' : 'Start with the basics and enrich the record over time.'}
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {isZh ? 'AI 智能补全' : 'AI Auto-fill'}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={aiQuery}
                    onChange={(event) => setAiQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), void handleAiSuggest())}
                    placeholder={isZh ? '输入公司名称或一段业务描述...' : 'Enter a company name or short business description...'}
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
                      {isZh ? '点击建议可一键填充表单' : 'Click a suggestion to auto-fill the form'}
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

              <FormField
                label={isZh ? '客户名称' : 'Client Name'}
                required
              >
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
                  placeholder={isZh ? '补充背景、合作方向或重要线索...' : 'Add background, collaboration context, or key notes...'}
                  rows={4}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                />
              </FormField>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                {isZh ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={async () => {
                  if (!form.name.trim()) {
                    alert(isZh ? '客户名称不能为空' : 'Client name is required')
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
                    setShowCreateModal(false)
                    await fetchClients()
                  } catch (error) {
                    console.error('Failed to create client:', error)
                    alert(isZh ? '创建失败，请重试' : 'Failed to create client')
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

function SummaryCard({
  label,
  tone,
  value,
}: {
  label: string
  tone: 'sky' | 'emerald' | 'amber' | 'slate'
  value: number
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
    </div>
  )
}

function FormField({
  children,
  label,
  required = false,
}: {
  children: React.ReactNode
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
