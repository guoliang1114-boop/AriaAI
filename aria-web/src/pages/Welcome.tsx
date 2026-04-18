import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowRight,
  Brain,
  Building2,
  ChevronRight,
  FolderKanban,
  ListTodo,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react'
import type { AxiosError } from 'axios'
import { api } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import type { Conversation, MyProjectTodo, Project, SkillSummary, User } from '../types/api'

interface ErrorResponsePayload {
  detail?: string
}

interface ClientSummary {
  id: number
  name: string
  industry: string
  created_at: string
  project_names: string[]
  client_memory_version?: number
  client_memory_stale?: boolean
  client_memory_updated_at?: string | null
}

interface DashboardProjectSummary {
  id: number
  name: string
  client: string
  status: Project['status']
  contract_amount?: number
  updated_at: string
  memory_stale?: boolean
  memory_version?: number
}

const cardBase =
  'rounded-[28px] border border-slate-200/70 bg-white/90 p-6 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.35)] backdrop-blur transition duration-200 hover:-translate-y-1 hover:shadow-[0_22px_60px_-30px_rgba(15,23,42,0.28)]'

function readCachedUser() {
  try {
    const raw = localStorage.getItem('user')
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

function formatCurrency(value: number, isZh: boolean) {
  if (!value) return isZh ? '￥0' : '$0'
  if (isZh) {
    if (value >= 1_000_000) return `￥${(value / 1_000_000).toFixed(1)}M`
    if (value >= 10_000) return `￥${(value / 10_000).toFixed(1)}万`
    return `￥${value.toLocaleString('zh-CN')}`
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatRelativeTime(value?: string | null, isZh = true) {
  if (!value) return isZh ? '暂无记录' : 'No recent activity'
  const diffMinutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  if (diffMinutes < 1) return isZh ? '刚刚' : 'Just now'
  if (diffMinutes < 60) return isZh ? `${diffMinutes} 分钟前` : `${diffMinutes} min ago`
  if (diffMinutes < 1440) return isZh ? `${Math.floor(diffMinutes / 60)} 小时前` : `${Math.floor(diffMinutes / 60)} h ago`
  if (diffMinutes < 2880) return isZh ? '昨天' : 'Yesterday'
  return new Date(value).toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function getStageLabel(status: Project['status'], isZh: boolean) {
  switch (status) {
    case 'lead':
      return isZh ? '线索阶段' : 'Lead'
    case 'opportunity':
      return isZh ? '商机阶段' : 'Opportunity'
    case 'won':
      return isZh ? '已签约' : 'Won'
    case 'delivering':
      return isZh ? '交付中' : 'Delivering'
    case 'archived':
      return isZh ? '已归档' : 'Archived'
    default:
      return status
  }
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-on-surface-muted">
      <div className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </div>
    </div>
  )
}

export function Welcome() {
  const navigate = useNavigate()
  const { i18n, t } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [loading, setLoading] = useState(true)
  const [secondaryLoading, setSecondaryLoading] = useState(true)
  const [showExtendedSections, setShowExtendedSections] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user] = useState<User | null>(() => readCachedUser())
  const [projects, setProjects] = useState<DashboardProjectSummary[]>([])
  const [clients, setClients] = useState<ClientSummary[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [myTodos, setMyTodos] = useState<MyProjectTodo[]>([])

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (loading) {
      setShowExtendedSections(false)
      return
    }

    const timer = window.setTimeout(() => {
      setShowExtendedSections(true)
    }, 180)

    return () => window.clearTimeout(timer)
  }, [loading])

  const loadData = async () => {
    try {
      setLoading(true)
      setSecondaryLoading(true)
      setError(null)

      const [allProjects, todos] = await Promise.all([
        api.get<DashboardProjectSummary[]>('/projects/meta/dashboard-summary'),
        api.get<MyProjectTodo[]>('/projects/todos/my'),
      ])

      setProjects(allProjects)
      setMyTodos(todos)
      setLoading(false)

      void Promise.all([
        api.get<ClientSummary[]>('/clients'),
        api.get<SkillSummary[]>('/skills/meta/summary'),
        api.get<Conversation[]>('/chat/conversations'),
      ])
        .then(([allClients, allSkills, allConversations]) => {
          setClients(allClients)
          setSkills(allSkills)
          setConversations(allConversations)
        })
        .catch(() => {})
        .finally(() => setSecondaryLoading(false))
    } catch (err) {
      const apiError = err as AxiosError<ErrorResponsePayload>
      if (apiError.response?.status === 401) throw apiError
      setSecondaryLoading(false)
      setLoading(false)
      setError(
        !apiError.response
          ? isZh
            ? '无法连接到服务器，请确认后端服务正在运行。'
            : 'Unable to reach the server. Please make sure the backend is running.'
          : isZh
            ? `加载工作台失败：${apiError.response?.data?.detail || apiError.message}`
            : `Failed to load workspace: ${apiError.response?.data?.detail || apiError.message}`,
      )
    }
  }

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return isZh ? '早上好' : t('dashboard.greeting.morning')
    if (hour < 18) return isZh ? '下午好' : t('dashboard.greeting.afternoon')
    return isZh ? '晚上好' : t('dashboard.greeting.evening')
  }, [isZh, t])

  const activeProjects = useMemo(() => projects.filter((project) => project.status !== 'archived'), [projects])
  const activeClients = useMemo(() => clients.filter((client) => client.project_names.length > 0), [clients])
  const contractValue = useMemo(() => activeProjects.reduce((sum, project) => sum + (project.contract_amount || 0), 0), [activeProjects])
  const recentProjects = useMemo(() => [...projects].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 4), [projects])
  const recentConversations = useMemo(() => [...conversations].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 3), [conversations])
  const topProjects = useMemo(() => [...activeProjects].filter((project) => (project.contract_amount || 0) > 0).sort((a, b) => (b.contract_amount || 0) - (a.contract_amount || 0)).slice(0, 4), [activeProjects])
  const maxProjectValue = useMemo(() => Math.max(...topProjects.map((project) => project.contract_amount || 0), 1), [topProjects])
  const memoryHealth = useMemo(() => ({
    projectNeedWork: projects.filter((project) => project.memory_stale || (project.memory_version || 0) === 0).length,
    clientNeedWork: clients.filter((client) => client.client_memory_stale || (client.client_memory_version || 0) === 0).length,
  }), [clients, projects])
  const overdueTodos = useMemo(() => {
    const now = new Date()
    return myTodos.filter((todo) => todo.due_date && new Date(todo.due_date) < now)
  }, [myTodos])
  const dueSoonTodos = useMemo(() => {
    const now = Date.now()
    const inThreeDays = now + 3 * 24 * 60 * 60 * 1000
    return myTodos.filter((todo) => {
      if (!todo.due_date) return false
      const due = new Date(todo.due_date).getTime()
      return due >= now && due <= inThreeDays
    })
  }, [myTodos])
  const stageSummary = useMemo(() => (
    (['lead', 'opportunity', 'won', 'delivering', 'archived'] as Project['status'][]).map((status) => ({
      status,
      count: projects.filter((project) => project.status === status).length,
    }))
  ), [projects])

  if (loading) {
    return (
      <>
        <PageTitle title={t('dashboard.title')} />
        <div className="flex h-full items-center justify-center bg-surface">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <PageTitle title={t('dashboard.title')} />
        <div className="flex h-full items-center justify-center bg-surface">
          <div className="max-w-md rounded-3xl border border-outline bg-surface p-8 text-center shadow-sm">
            <AlertCircle className="mx-auto mb-4 h-10 w-10 text-error" />
            <p className="mb-4 text-sm text-on-surface">{error}</p>
            <button
              onClick={() => void loadData()}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              {isZh ? '重试' : 'Retry'}
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={t('dashboard.title')} />
      <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.08),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.06),_transparent_24%),linear-gradient(to_bottom,_rgba(248,250,252,1),_rgba(255,255,255,1))]">
        <div className="space-y-6 px-8 py-8">
          <section className="relative overflow-hidden rounded-[32px] bg-slate-950 p-8 text-white shadow-[0_24px_80px_-32px_rgba(15,23,42,0.75)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.32),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.22),_transparent_24%)]" />
            <div className="relative grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80">
                  <Sparkles className="h-3.5 w-3.5" />
                  {isZh ? '今日工作台' : 'Today workspace'}
                </div>
                <div>
                  <p className="mb-2 text-sm text-white/70">{greeting}</p>
                  <h1 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
                    {user?.display_name || (isZh ? '欢迎回来' : 'Welcome back')}
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-white/75">
                    {isZh
                      ? '先看待办优先级、项目节奏和记忆健康度，再决定今天最值得推进的动作。'
                      : 'Start from priorities, project rhythm, and memory health before choosing what to move today.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => navigate('/chat')} className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-white/90">
                    {isZh ? '开始新对话' : 'Start a chat'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button onClick={() => navigate('/projects/new')} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10">
                    <FolderKanban className="h-4 w-4" />
                    {isZh ? '新建项目' : 'Create project'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: isZh ? '逾期待办' : 'Overdue', value: overdueTodos.length },
                    { label: isZh ? '记忆待处理' : 'Memory work', value: memoryHealth.projectNeedWork + memoryHealth.clientNeedWork },
                    { label: isZh ? '活跃项目' : 'Active projects', value: activeProjects.length },
                  ].map((item) => (
                    <div key={item.label} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80">
                      {item.label}: <span className="font-semibold text-white">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { title: isZh ? '项目记忆' : 'Project memory', sub: isZh ? '统一刷新项目记忆与摘要缓存' : 'Refresh project memory and cached summaries', icon: Brain, path: '/settings/memory', style: 'from-indigo-500/20 to-indigo-400/5 text-white' },
                  { title: isZh ? '客户记忆' : 'Client memory', sub: isZh ? '查看客户级长期经验沉淀' : 'Review client-level knowledge', icon: Users, path: '/settings/client-memory', style: 'from-emerald-500/20 to-emerald-400/5 text-white' },
                  { title: isZh ? '客户列表' : 'Clients', sub: isZh ? '维护客户档案与合作关系' : 'Maintain client records and relationships', icon: Building2, path: '/clients', style: 'from-sky-500/20 to-sky-400/5 text-white' },
                  { title: isZh ? '项目列表' : 'Projects', sub: isZh ? '回到核心业务看板' : 'Return to the delivery board', icon: FolderKanban, path: '/projects', style: 'from-white/95 to-white/80 text-slate-900' },
                ].map((item) => (
                  <button key={item.title} onClick={() => navigate(item.path)} className={`group rounded-3xl border border-white/10 bg-gradient-to-br ${item.style} p-4 text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:border-white/20 hover:shadow-[0_18px_40px_-24px_rgba(15,23,42,0.45)]`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="text-sm font-semibold">{item.title}</div>
                        <div className={`text-xs leading-5 ${item.style.includes('white/95') ? 'text-slate-600' : 'text-white/70'}`}>{item.sub}</div>
                      </div>
                      <item.icon className="h-4 w-4 opacity-80 transition duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: isZh ? '活跃项目' : 'Active projects', value: activeProjects.length, sub: isZh ? `总计 ${projects.length} 个项目` : `${projects.length} total projects`, icon: FolderKanban, tone: 'to-indigo-50/80' },
              { label: isZh ? '活跃客户' : 'Active clients', value: secondaryLoading ? '...' : activeClients.length, sub: isZh ? `总计 ${clients.length} 个客户` : `${clients.length} total clients`, icon: Building2, tone: 'to-sky-50/80' },
              { label: isZh ? '合同总额' : 'Contract value', value: formatCurrency(contractValue, isZh), sub: isZh ? '按未归档项目统计' : 'Across non-archived projects', icon: Wallet, tone: 'to-emerald-50/80' },
              { label: isZh ? '技能数量' : 'Available skills', value: secondaryLoading ? '...' : skills.length, sub: isZh ? '可复用的工作流和技能' : 'Reusable skills and workflows', icon: Sparkles, tone: 'to-amber-50/80' },
            ].map((card) => (
              <div key={card.label} className={`rounded-3xl border border-slate-200/70 bg-gradient-to-br from-white ${card.tone} p-5 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.4)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_24px_48px_-28px_rgba(15,23,42,0.35)]`}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm text-on-surface-muted">{card.label}</div>
                  <div className="rounded-xl bg-white/70 p-2 text-primary shadow-sm"><card.icon className="h-4 w-4" /></div>
                </div>
                <div className="text-3xl font-semibold text-on-surface">{card.value}</div>
                <div className="mt-2 text-sm text-on-surface-muted">{card.sub}</div>
              </div>
            ))}
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className={cardBase}>
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-on-surface">{isZh ? '今日优先动作' : 'Priority for today'}</h2>
                  <p className="mt-1 text-sm text-on-surface-muted">
                    {isZh ? '先看逾期、临近到期和最近对话，再决定今天先推进什么。' : 'Review overdue work, near-term tasks, and recent chats before deciding what to move first.'}
                  </p>
                </div>
                <button onClick={() => navigate('/projects')} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  {isZh ? '查看项目' : 'Open projects'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: isZh ? '逾期待办' : 'Overdue todos', value: overdueTodos.length, icon: AlertCircle },
                  { label: isZh ? '三天内到期' : 'Due in 3 days', value: dueSoonTodos.length, icon: ListTodo },
                  { label: isZh ? '近期对话' : 'Recent chats', value: secondaryLoading ? '...' : recentConversations.length, icon: MessageSquare },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-slate-50 px-4 py-4">
                    <div className="mb-2 flex items-center justify-between text-sm text-on-surface-muted">
                      <span>{item.label}</span>
                      <item.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="text-2xl font-semibold text-on-surface">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-3">
                {myTodos.slice(0, 4).map((todo) => (
                  <button key={todo.id} onClick={() => navigate(`/projects/${todo.project_id}/todos`)} className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-slate-50">
                    <div className="mt-0.5 rounded-full bg-primary/10 p-1 text-primary"><ListTodo className="h-3.5 w-3.5" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-on-surface">{todo.content}</div>
                      <div className="mt-1 text-xs text-on-surface-muted">{todo.project_name}{todo.due_date ? ` · ${todo.due_date}` : ''}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-on-surface-muted" />
                  </button>
                ))}
                {myTodos.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-on-surface-muted">
                    {isZh ? '目前没有分配给你的项目待办。' : 'No project todos are assigned to you right now.'}
                  </div>
                ) : null}
              </div>
            </div>

            <div className={cardBase}>
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-on-surface">{isZh ? '记忆健康度' : 'Memory health'}</h2>
                <p className="mt-1 text-sm text-on-surface-muted">
                  {isZh ? '首页只做信号提示，详细管理统一进入设置。' : 'Use this as a signal layer and settings for full management.'}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: isZh ? '项目待处理' : 'Projects to review', value: memoryHealth.projectNeedWork, path: '/settings/memory', tone: 'from-amber-50' },
                  { label: isZh ? '客户待处理' : 'Clients to review', value: secondaryLoading ? '...' : memoryHealth.clientNeedWork, path: '/settings/client-memory', tone: 'from-emerald-50' },
                  { label: isZh ? '项目记忆入口' : 'Project memory', value: '→', path: '/settings/memory', tone: 'from-indigo-50' },
                  { label: isZh ? '客户记忆入口' : 'Client memory', value: '→', path: '/settings/client-memory', tone: 'from-sky-50' },
                ].map((item) => (
                  <button key={item.label} onClick={() => navigate(item.path)} className={`rounded-2xl border border-slate-200 bg-gradient-to-br ${item.tone} to-white px-4 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm`}>
                    <div className="text-sm text-on-surface-muted">{item.label}</div>
                    <div className="mt-2 text-2xl font-semibold text-on-surface">{item.value}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {showExtendedSections ? (
            <>
              <section className="grid gap-6 xl:grid-cols-[1fr_1fr_1.05fr]">
                <div className={cardBase}>
              <h2 className="text-lg font-semibold text-on-surface">{isZh ? '项目阶段分布' : 'Pipeline overview'}</h2>
              <div className="mt-4 space-y-3">
                {stageSummary.map((item) => (
                  <div key={item.status} className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-on-surface">{getStageLabel(item.status, isZh)}</span>
                      <span className="text-on-surface-muted">{item.count}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-indigo-400" style={{ width: `${projects.length ? (item.count / projects.length) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={cardBase}>
              <h2 className="text-lg font-semibold text-on-surface">{isZh ? '最近更新的项目' : 'Recently updated projects'}</h2>
              <div className="mt-4 space-y-2">
                {recentProjects.map((project) => (
                  <button key={project.id} onClick={() => navigate(`/projects/${project.id}`)} className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-on-surface">{project.name}</div>
                      <div className="mt-1 text-xs text-on-surface-muted">{project.client || (isZh ? '未填写客户' : 'No client')} · {getStageLabel(project.status, isZh)}</div>
                    </div>
                    <div className="ml-3 text-xs text-on-surface-muted">{formatRelativeTime(project.updated_at, isZh)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className={cardBase}>
              <h2 className="text-lg font-semibold text-on-surface">{isZh ? '最近客户与对话' : 'Recent clients and chats'}</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-muted">{isZh ? '客户' : 'Clients'}</div>
                  <div className="space-y-2">
                    {secondaryLoading ? <LoadingBlock label={isZh ? '正在加载客户' : 'Loading clients'} /> : clients.slice(0, 3).map((client) => (
                      <button key={client.id} onClick={() => navigate(`/clients/${client.id}`)} className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-slate-50">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-on-surface">{client.name}</div>
                          <div className="mt-1 text-xs text-on-surface-muted">{client.industry || (isZh ? '未填写行业' : 'No industry')}</div>
                        </div>
                        <div className="ml-3 text-xs text-on-surface-muted">{formatRelativeTime(client.client_memory_updated_at || client.created_at, isZh)}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-muted">{isZh ? '对话' : 'Chats'}</div>
                  <div className="space-y-2">
                    {secondaryLoading ? <LoadingBlock label={isZh ? '正在加载对话' : 'Loading chats'} /> : recentConversations.map((conversation) => (
                      <button key={conversation.id} onClick={() => navigate('/chat')} className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-slate-50">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-on-surface">{conversation.title || (isZh ? '未命名对话' : 'Untitled conversation')}</div>
                          <div className="mt-1 text-xs text-on-surface-muted">{conversation.project_id ? `${isZh ? '关联项目' : 'Project'} #${conversation.project_id}` : isZh ? '通用工作台' : 'General workspace'}</div>
                        </div>
                        <div className="ml-3 text-xs text-on-surface-muted">{formatRelativeTime(conversation.updated_at, isZh)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
                </div>
              </section>

              <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <div className={cardBase}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-on-surface">{isZh ? '重点项目' : 'Top projects'}</h2>
                  <p className="mt-1 text-sm text-on-surface-muted">
                    {isZh ? '按合同金额快速看到当前最值得关注的项目。' : 'Surface the projects with the largest contract value.'}
                  </p>
                </div>
                <button onClick={() => navigate('/projects')} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  {isZh ? '查看全部' : 'View all'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                {topProjects.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-on-surface-muted">
                    {isZh ? '当前还没有带合同金额的重点项目。' : 'No contract-backed top projects yet.'}
                  </div>
                ) : (
                  topProjects.map((project) => (
                    <button key={project.id} onClick={() => navigate(`/projects/${project.id}`)} className="w-full rounded-2xl border border-slate-200 px-4 py-4 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-on-surface">{project.name}</div>
                          <div className="mt-1 text-xs text-on-surface-muted">{project.client || (isZh ? '未填写客户' : 'No client')} · {getStageLabel(project.status, isZh)}</div>
                        </div>
                        <div className="text-sm font-semibold text-on-surface">{formatCurrency(project.contract_amount || 0, isZh)}</div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400" style={{ width: `${((project.contract_amount || 0) / maxProjectValue) * 100}%` }} />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className={cardBase}>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-on-surface">{isZh ? '常用入口' : 'Workspace shortcuts'}</h2>
                <p className="mt-1 text-sm text-on-surface-muted">
                  {isZh ? '把最常打开的工作台入口放在首页。' : 'Keep the most-used workspaces one click away.'}
                </p>
              </div>

              <div className="space-y-3">
                {[
                  { title: isZh ? '项目列表' : 'Projects', subtitle: isZh ? '查看项目节奏和阶段分布' : 'Review active work and pipeline stages', icon: FolderKanban, path: '/projects' },
                  { title: isZh ? '项目记忆管理' : 'Project memory manager', subtitle: isZh ? '统一刷新项目记忆与摘要缓存' : 'Refresh project memory and cached summaries', icon: Brain, path: '/settings/memory' },
                  { title: isZh ? '客户记忆管理' : 'Client memory manager', subtitle: isZh ? '维护跨项目客户经验沉淀' : 'Maintain cross-project client knowledge', icon: Users, path: '/settings/client-memory' },
                  { title: isZh ? '客户列表' : 'Clients', subtitle: isZh ? '维护客户档案与项目关系' : 'Maintain client records and relationships', icon: Building2, path: '/clients' },
                ].map((item) => (
                  <button key={item.title} onClick={() => navigate(item.path)} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 py-4 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-slate-50">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-primary"><item.icon className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-on-surface">{item.title}</div>
                      <div className="mt-1 text-xs text-on-surface-muted">{item.subtitle}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-on-surface-muted" />
                  </button>
                ))}
              </div>
                </div>
              </section>
            </>
          ) : (
            <section className={cardBase}>
              <LoadingBlock label={isZh ? '正在准备更多工作台内容' : 'Preparing more workspace insights'} />
            </section>
          )}
        </div>
      </div>
    </>
  )
}

