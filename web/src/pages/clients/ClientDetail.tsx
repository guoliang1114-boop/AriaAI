import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Brain,
  Building2,
  Edit2,
  ExternalLink,
  FileText,
  FolderKanban,
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react'

import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { ClientMemoryResponse, ClientMemoryStatusResponse, ClientStakeholder } from '../../types/api'
import { ClientStakeholdersStructuredCard } from '../projects/ClientStakeholdersStructuredCard'
import { formatDateOnly, formatDateTime, getResolvedAppTimeZone } from '../../utils/timezone'

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

interface Project {
  id: number
  name: string
  status: string
  contract_amount: number | null
}

export function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState<Client | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [stakeholders, setStakeholders] = useState<ClientStakeholder[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Client>>({})
  const [memoryStatus, setMemoryStatus] = useState<ClientMemoryStatusResponse | null>(null)
  const [rebuildingMemory, setRebuildingMemory] = useState(false)

  useEffect(() => {
    if (id) {
      void fetchClient()
    }
  }, [id])

  const fetchClient = async () => {
    try {
      setLoading(true)
      const [clientData, memoryData, projectsData, stakeholderData] = await Promise.all([
        api.get<Client>(`/clients/${id}`),
        api.get<ClientMemoryStatusResponse>(`/clients/${id}/memory/status`),
        api.get<Project[]>(`/clients/${id}/projects`),
        api.get<ClientStakeholder[]>(`/clients/${id}/stakeholders`),
      ])
      setClient(clientData)
      setEditForm(clientData)
      setMemoryStatus(memoryData)
      setProjects(projectsData)
      setStakeholders(stakeholderData)
    } catch (error) {
      console.error('Failed to fetch client:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async () => {
    if (!client) return
    try {
      const updated = await api.put<Client>(`/clients/${client.id}`, editForm)
      setClient(updated)
      setEditForm(updated)
      setIsEditing(false)
      setMemoryStatus((current) =>
        current
          ? {
              ...current,
              memory_stale: true,
            }
          : current,
      )
    } catch (error) {
      console.error('Failed to update client:', error)
    }
  }

  const handleDelete = async () => {
    if (!client) return
    if (!confirm(isZh ? '确定要删除这个客户吗？' : 'Are you sure you want to delete this client?')) return

    try {
      await api.delete(`/clients/${client.id}`)
      navigate('/clients')
    } catch (error) {
      console.error('Failed to delete client:', error)
    }
  }

  const handleRebuildMemory = async () => {
    if (!client) return
    try {
      setRebuildingMemory(true)
      const response = await api.post<ClientMemoryResponse>(`/clients/${client.id}/memory/rebuild`, {}, { timeout: 120000 })
      setMemoryStatus({
        client_id: client.id,
        has_memory: true,
        memory_version: response.memory_version,
        memory_stale: response.memory_stale,
        memory_updated_at: response.memory_updated_at,
      })
    } catch (error) {
      console.error('Failed to rebuild client memory:', error)
    } finally {
      setRebuildingMemory(false)
    }
  }

  const handleStakeholdersChanged = (nextStakeholders: ClientStakeholder[]) => {
    setStakeholders(nextStakeholders)
    setMemoryStatus((current) =>
      current
        ? {
            ...current,
            memory_stale: true,
          }
        : current,
    )
  }

  const handleStartClientSkill = (intent: 'strategy' | 'opportunity' | 'retrospective') => {
    if (!client) return
    const prompt = buildClientSkillPromptV2({
      client,
      intent,
      isZh,
      memoryStatus,
      projects,
    })
    const params = new URLSearchParams({
      client: String(client.id),
      clientName: client.name,
      q: prompt,
    })
    if (projects[0]?.id) {
      params.set('clientProject', String(projects[0].id))
    }
    navigate(`/skills?${params.toString()}`)
  }

  const memorySummary = useMemo(() => {
    if (!memoryStatus?.has_memory) {
      return isZh ? '当前还没有客户记忆，建议先生成一次用于后续跨项目复用。' : 'No client memory yet. Generate one to reuse client context across projects.'
    }
    if (memoryStatus.memory_stale) {
      return isZh ? '客户记忆已存在，但建议刷新后再继续分析或沉淀。' : 'Client memory exists, but it should be refreshed before further analysis or reuse.'
    }
    return isZh ? '客户记忆已同步，可直接用于跨项目洞察与复用。' : 'Client memory is up to date and ready for cross-project insights and reuse.'
  }, [isZh, memoryStatus])

  const memoryStateLabel = useMemo(() => {
    if (!memoryStatus?.has_memory) return isZh ? '尚未生成' : 'Not prepared'
    if (memoryStatus.memory_stale) return isZh ? '建议刷新' : 'Needs refresh'
    return isZh ? '可直接使用' : 'Ready'
  }, [isZh, memoryStatus])

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? '客户详情' : 'Client Detail'} />
        <div className="flex min-h-full items-center justify-center bg-slate-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    )
  }

  if (!client) {
    return (
      <>
        <PageTitle title={isZh ? '客户详情' : 'Client Detail'} />
        <div className="flex min-h-full items-center justify-center bg-slate-50">
          <div className="text-center">
            <p className="text-slate-500">{isZh ? '未找到该客户' : 'Client not found'}</p>
            <button onClick={() => navigate('/clients')} className="mt-4 text-primary hover:underline">
              {isZh ? '返回客户列表' : 'Back to clients'}
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={client.name} />
      <div className="min-h-full bg-[linear-gradient(180deg,#f6f9fc_0%,#eef4fb_36%,#ffffff_100%)]">
        <div className="w-full px-6 py-8 xl:px-8 2xl:px-10">
          <section className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_right,#dfefff_0%,#f8fbff_42%,#ffffff_100%)] p-8 shadow-[0_30px_70px_rgba(15,23,42,0.08)]">
            <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-sky-200/35 blur-3xl" />
            <div className="relative">
              <button
                onClick={() => navigate('/clients')}
                className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 py-1.5 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" />
                {isZh ? '返回客户列表' : 'Back to clients'}
              </button>

              <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-sky-100 to-sky-50 text-2xl font-bold text-sky-700">
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-sky-700 shadow-sm backdrop-blur">
                      <Building2 className="h-3.5 w-3.5" />
                      <span>{isZh ? '客户档案' : 'Client Record'}</span>
                    </div>
                    <h1 className="truncate text-2xl font-semibold text-slate-900">{client.name}</h1>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-sm text-slate-600">
                        {client.industry || (isZh ? '未填写行业' : 'No industry yet')}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-sm text-slate-600">
                        {isZh ? `${projects.length} 个项目` : `${projects.length} projects`}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-sm text-slate-600">
                        {isZh ? `${client.document_count} 份文档` : `${client.document_count} docs`}
                      </span>
                    </div>
                    <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                      {client.notes || (isZh ? '这位客户的背景、合作方向和关键联系人信息还可以继续补充。' : 'This client record can be enriched with more background, collaboration context, and stakeholder notes.')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setIsEditing((current) => !current)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white"
                  >
                    {isEditing ? <X className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
                    {isEditing ? (isZh ? '取消编辑' : 'Cancel') : (isZh ? '编辑资料' : 'Edit')}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white/90 px-4 py-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {isZh ? '删除客户' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label={isZh ? '关联项目' : 'Projects'} value={projects.length} tone="sky" />
            <SummaryCard label={isZh ? '客户文档' : 'Documents'} value={client.document_count} tone="amber" />
            <SummaryCard label={isZh ? '记忆状态' : 'Memory'} value={memoryStateLabel} tone="emerald" />
            <SummaryCard
              label={isZh ? '创建日期' : 'Created'}
              value={formatDateOnly(client.created_at, undefined, getResolvedAppTimeZone())}
              tone="slate"
            />
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.8fr)]">
            <div className="space-y-6">
              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{isZh ? '客户资料' : 'Client Information'}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {isZh ? '维护客户背景、联系人和合作上下文。' : 'Maintain company background, contacts, and collaboration context.'}
                    </p>
                  </div>
                  {isEditing ? (
                    <button
                      onClick={handleUpdate}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary"
                    >
                      <Save className="h-4 w-4" />
                      {isZh ? '保存修改' : 'Save'}
                    </button>
                  ) : null}
                </div>

                {isEditing ? (
                  <div className="mt-5 grid gap-4">
                    <FormField label={isZh ? '客户名称' : 'Client Name'}>
                      <input
                        type="text"
                        value={editForm.name || ''}
                        onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                      />
                    </FormField>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField label={isZh ? '行业' : 'Industry'}>
                        <input
                          type="text"
                          value={editForm.industry || ''}
                          onChange={(event) => setEditForm({ ...editForm, industry: event.target.value })}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                        />
                      </FormField>
                      <FormField label={isZh ? '联系人' : 'Contact'}>
                        <input
                          type="text"
                          value={editForm.contact || ''}
                          onChange={(event) => setEditForm({ ...editForm, contact: event.target.value })}
                          placeholder={isZh ? '姓名、电话、邮箱等' : 'Name, phone, email, etc.'}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                        />
                      </FormField>
                    </div>
                    <FormField label={isZh ? '备注' : 'Notes'}>
                      <textarea
                        value={editForm.notes || ''}
                        onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                        rows={6}
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                      />
                    </FormField>
                  </div>
                ) : (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <InfoPanel
                      icon={<Building2 className="h-4 w-4" />}
                      label={isZh ? '行业' : 'Industry'}
                      value={client.industry || (isZh ? '未填写' : 'Not provided')}
                    />
                    <InfoPanel
                      icon={<User className="h-4 w-4" />}
                      label={isZh ? '联系人' : 'Contact'}
                      value={client.contact || (isZh ? '未填写' : 'Not provided')}
                    />
                    <div className="md:col-span-2">
                      <InfoPanel
                        icon={<Phone className="h-4 w-4" />}
                        label={isZh ? '备注与上下文' : 'Notes & Context'}
                        value={client.notes || (isZh ? '暂无备注，可继续补充客户背景、合作目标和关键风险。' : 'No notes yet. Add company background, collaboration goals, and key risks here.')}
                        multiline
                      />
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{isZh ? '关联项目' : 'Related Projects'}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {isZh ? '查看当前客户下的项目与执行进展。' : 'Review projects and execution status linked to this client.'}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-500">
                    {projects.length}
                  </span>
                </div>

                {projects.length === 0 ? (
                  <div className="py-14 text-center text-slate-500">
                    <FolderKanban className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                    <h3 className="text-lg font-semibold text-slate-700">{isZh ? '暂无关联项目' : 'No projects yet'}</h3>
                    <p className="mt-2 text-sm">
                      {isZh ? '等项目与这个客户关联后，这里会自动展示。' : 'Projects linked to this client will appear here automatically.'}
                    </p>
                  </div>
                ) : (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => navigate(`/projects/${project.id}`)}
                        className="group flex h-full flex-col rounded-[1.35rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] p-5 text-left transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                              <FolderKanban className="h-3.5 w-3.5" />
                              {isZh ? '项目' : 'Project'}
                            </div>
                            <h3 className="mt-3 truncate text-base font-semibold text-slate-900">{project.name}</h3>
                          </div>
                          <ExternalLink className="h-4 w-4 flex-shrink-0 text-slate-300 transition group-hover:text-slate-500" />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className={`rounded-full px-3 py-1 text-xs font-medium ${getProjectStatusTone(project.status)}`}>
                            {project.status || (isZh ? '未标记状态' : 'No status')}
                          </span>
                          {project.contract_amount != null ? (
                            <span className="rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                              {formatCurrency(project.contract_amount)}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="space-y-6">
              <ClientStakeholdersStructuredCard
                clientId={client.id}
                isZh={isZh}
                onChanged={handleStakeholdersChanged}
                stakeholders={stakeholders}
              />

              <section className="overflow-hidden rounded-[1.75rem] border border-emerald-100 bg-[linear-gradient(160deg,#ecfdf5_0%,#f8fafc_48%,#ffffff_100%)] p-6 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{isZh ? '客户 Skill 工作流' : 'Client Skill Workflows'}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {isZh
                        ? '从客户空间直接启动 Skill，自动带入客户档案、客户记忆状态和关联项目线索。'
                        : 'Launch a Skill from the client workspace with client profile, memory status, and related project context prefilled.'}
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <ClientSkillLaunchCard
                    title={isZh ? '关系策略' : 'Relationship strategy'}
                    description={isZh ? '整理关键干系人、沟通节奏和下一次拜访重点。' : 'Map stakeholders, communication cadence, and the next meeting focus.'}
                    onClick={() => handleStartClientSkill('strategy')}
                  />
                  <ClientSkillLaunchCard
                    title={isZh ? '机会分析' : 'Opportunity analysis'}
                    description={isZh ? '基于客户背景和历史项目找潜在增购与交叉销售机会。' : 'Use client context and project history to surface expansion opportunities.'}
                    onClick={() => handleStartClientSkill('opportunity')}
                  />
                  <ClientSkillLaunchCard
                    title={isZh ? '项目复盘' : 'Project retrospective'}
                    description={isZh ? '把关联项目经验整理成可复用的客户洞察。' : 'Turn related project experience into reusable client insight.'}
                    onClick={() => handleStartClientSkill('retrospective')}
                  />
                </div>
              </section>

              <section className="rounded-[1.75rem] border border-slate-200 bg-white/92 p-6 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-primary" />
                      <h2 className="text-lg font-semibold text-slate-900">{isZh ? '客户记忆' : 'Client Memory'}</h2>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{memorySummary}</p>
                  </div>
                  <button
                    onClick={handleRebuildMemory}
                    disabled={rebuildingMemory}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {rebuildingMemory ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {isZh ? '刷新记忆' : 'Refresh'}
                  </button>
                </div>

                <div className="mt-5 space-y-3">
                  <InfoPanel
                    icon={<Brain className="h-4 w-4" />}
                    label={isZh ? '状态' : 'Status'}
                    value={memoryStateLabel}
                  />
                  <InfoPanel
                    icon={<RefreshCw className="h-4 w-4" />}
                    label={isZh ? '最近同步' : 'Last sync'}
                    value={
                      memoryStatus?.memory_updated_at
                        ? formatDateTime(memoryStatus.memory_updated_at, isZh ? 'zh-CN' : 'en-US', undefined, getResolvedAppTimeZone())
                        : isZh
                          ? '暂无记录'
                          : 'Not yet'
                    }
                  />
                  <InfoPanel
                    icon={<FileText className="h-4 w-4" />}
                    label={isZh ? '记忆版本' : 'Memory version'}
                    value={memoryStatus?.memory_version != null ? String(memoryStatus.memory_version) : (isZh ? '暂无' : 'N/A')}
                  />
                </div>

                <button
                  onClick={() => navigate(`/clients/${client.id}/memory`)}
                  className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary"
                >
                  <Brain className="h-4 w-4" />
                  {isZh ? '打开客户记忆' : 'Open Client Memory'}
                </button>
              </section>
            </div>
          </div>
        </div>
      </div>
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
  value: string | number
}) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-100 bg-emerald-50/80'
      : tone === 'amber'
        ? 'border-amber-100 bg-amber-50/80'
        : tone === 'slate'
          ? 'border-slate-200 bg-slate-50/80'
          : 'border-sky-100 bg-sky-50/80'

  return (
    <div className={`rounded-[1.5rem] border p-5 shadow-sm ${toneClass}`}>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function InfoPanel({
  icon,
  label,
  multiline = false,
  value,
}: {
  icon: ReactNode
  label: string
  multiline?: boolean
  value: string
}) {
  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="text-slate-400">{icon}</span>
        <span>{label}</span>
      </div>
      <p className={`mt-2 text-sm text-slate-900 ${multiline ? 'whitespace-pre-wrap leading-6' : ''}`}>{value}</p>
    </div>
  )
}

function FormField({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium text-slate-700">{label}</div>
      {children}
    </label>
  )
}

function ClientSkillLaunchCard({
  description,
  onClick,
  title,
}: {
  description: string
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-[1.15rem] border border-white/80 bg-white/85 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white hover:shadow-md"
    >
      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition group-hover:bg-emerald-700">
        <MessageSquare className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <ExternalLink className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300 transition group-hover:text-emerald-600" />
    </button>
  )
}

function buildClientSkillPromptV2({
  client,
  intent,
  isZh,
  memoryStatus,
  projects,
}: {
  client: Client
  intent: 'strategy' | 'opportunity' | 'retrospective'
  isZh: boolean
  memoryStatus: ClientMemoryStatusResponse | null
  projects: Project[]
}) {
  const projectLines = projects.length
    ? projects.slice(0, 8).map((project) => `- ${project.name} (${project.status || 'unknown'})`).join('\n')
    : isZh
      ? '- 暂无关联项目'
      : '- No related projects yet'
  const memoryState = !memoryStatus?.has_memory
    ? isZh
      ? '尚未生成客户记忆'
      : 'Client memory has not been generated'
    : memoryStatus.memory_stale
      ? isZh
        ? `客户记忆需要刷新，当前版本 ${memoryStatus.memory_version ?? 'N/A'}`
        : `Client memory needs refresh, current version ${memoryStatus.memory_version ?? 'N/A'}`
      : isZh
        ? `客户记忆可用，当前版本 ${memoryStatus.memory_version ?? 'N/A'}`
        : `Client memory is ready, current version ${memoryStatus.memory_version ?? 'N/A'}`

  const intentInstruction = {
    strategy: isZh
      ? '请基于该客户档案，为我生成一份客户关系策略，包含关键关系判断、下一次沟通目标、风险提醒和 3 条可执行跟进动作。'
      : 'Please generate a client relationship strategy with relationship judgment, next communication goals, risks, and 3 concrete follow-up actions.',
    opportunity: isZh
      ? '请基于该客户档案和关联项目，分析潜在增购、交叉销售或新项目机会，并按优先级给出推进建议。'
      : 'Please analyze expansion, cross-sell, or new-project opportunities from this client profile and project history, then prioritize next moves.',
    retrospective: isZh
      ? '请基于该客户的关联项目，提炼可复用经验、客户偏好、交付注意事项，以及后续项目的启动建议。'
      : 'Please extract reusable lessons, client preferences, delivery caveats, and start recommendations for future projects from this client history.',
  }[intent]

  if (!isZh) {
    return `${intentInstruction}

Client context:
- Name: ${client.name}
- Industry: ${client.industry || 'Not provided'}
- Contact: ${client.contact || 'Not provided'}
- Notes: ${client.notes || 'Not provided'}
- Memory status: ${memoryState}

Related projects:
${projectLines}

Please use the client context first. If information is missing, state assumptions clearly and suggest what to capture next.`
  }

  return `${intentInstruction}

客户上下文：
- 客户名称：${client.name}
- 行业：${client.industry || '未填写'}
- 联系人：${client.contact || '未填写'}
- 备注：${client.notes || '未填写'}
- 记忆状态：${memoryState}

关联项目：
${projectLines}

请优先使用客户上下文。如果信息不足，请明确你的假设，并指出下一步应该补充哪些客户信息。`
}

function getProjectStatusTone(status: string) {
  if (status === 'active') return 'bg-emerald-50 text-emerald-700'
  if (status === 'lead') return 'bg-amber-50 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(value)
}
