import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowRight,
  Brain,
  Building2,
  ChevronRight,
  Clock3,
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
import type { Conversation, MyProjectTodo, Project, Skill, User } from '../types/api'

interface ErrorResponsePayload {
  detail?: string
}

interface ClientSummary {
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

function formatCurrency(value: number, isZh: boolean) {
  if (!value) return isZh ? '¥0' : '$0'
  if (isZh) {
    if (value >= 1_000_000) return `¥${(value / 1_000_000).toFixed(1)}M`
    if (value >= 10_000) return `¥${(value / 10_000).toFixed(1)}万`
    return `¥${value.toLocaleString('zh-CN')}`
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
  return new Date(value).toLocaleDateString(isZh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
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

export function Welcome() {
  const navigate = useNavigate()
  const { i18n, t } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<ClientSummary[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [myTodos, setMyTodos] = useState<MyProjectTodo[]>([])

  useEffect(() => {
    void loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)

      const [currentUser, allProjects, allClients, allSkills, allConversations, todos] = await Promise.all([
        api.get<User>('/auth/me'),
        api.get<Project[]>('/projects'),
        api.get<ClientSummary[]>('/clients'),
        api.get<Skill[]>('/skills'),
        api.get<Conversation[]>('/chat/conversations'),
        api.get<MyProjectTodo[]>('/projects/todos/my'),
      ])

      setUser(currentUser)
      setProjects(allProjects)
      setClients(allClients)
      setSkills(allSkills)
      setConversations(allConversations)
      setMyTodos(todos)
    } catch (err) {
      const apiError = err as AxiosError<ErrorResponsePayload>
      if (apiError.response?.status === 401) throw apiError
      setError(
        !apiError.response
          ? isZh
            ? '无法连接到服务器，请确认后端服务正在运行。'
            : 'Unable to reach the server. Please make sure the backend is running.'
          : isZh
            ? `加载失败：${apiError.response?.data?.detail || apiError.message}`
            : `Failed to load workspace: ${apiError.response?.data?.detail || apiError.message}`,
      )
    } finally {
      setLoading(false)
    }
  }

  const activeProjects = useMemo(() => projects.filter((project) => project.status !== 'archived'), [projects])
  const activeClients = useMemo(() => clients.filter((client) => client.project_names.length > 0), [clients])
  const contractValue = useMemo(
    () => activeProjects.reduce((sum, project) => sum + (project.contract_amount || 0), 0),
    [activeProjects],
  )
  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 5),
    [projects],
  )
  const recentConversations = useMemo(
    () => [...conversations].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 4),
    [conversations],
  )
  const recentClients = useMemo(
    () =>
      [...clients]
        .sort(
          (a, b) =>
            new Date(b.client_memory_updated_at || b.created_at).getTime() -
            new Date(a.client_memory_updated_at || a.created_at).getTime(),
        )
        .slice(0, 4),
    [clients],
  )
  const topProjects = useMemo(
    () =>
      [...activeProjects]
        .filter((project) => (project.contract_amount || 0) > 0)
        .sort((a, b) => (b.contract_amount || 0) - (a.contract_amount || 0))
        .slice(0, 5),
    [activeProjects],
  )
  const maxProjectValue = useMemo(
    () => Math.max(...topProjects.map((project) => project.contract_amount || 0), 1),
    [topProjects],
  )
  const stageSummary = useMemo(
    () =>
      ['lead', 'opportunity', 'won', 'delivering', 'archived'].map((status) => ({
        status: status as Project['status'],
        count: projects.filter((project) => project.status === status).length,
      })),
    [projects],
  )
  const memoryHealth = useMemo(
    () => ({
      projectMissing: projects.filter((project) => (project.memory_version || 0) === 0).length,
      projectStale: projects.filter((project) => (project.memory_version || 0) > 0 && project.memory_stale).length,
      clientMissing: clients.filter((client) => (client.client_memory_version || 0) === 0).length,
      clientStale: clients.filter((client) => (client.client_memory_version || 0) > 0 && client.client_memory_stale).length,
    }),
    [clients, projects],
  )
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
  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return isZh ? '早上好' : t('dashboard.greeting.morning')
    if (hour < 18) return isZh ? '下午好' : t('dashboard.greeting.afternoon')
    return isZh ? '晚上好' : t('dashboard.greeting.evening')
  }, [isZh, t])

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
          <div className="max-w-md rounded-2xl border border-outline bg-surface p-8 text-center shadow-sm">
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
      <div className="h-full overflow-auto bg-surface">
        <div className="space-y-6 px-8 py-8">
          <section className="rounded-3xl bg-gradient-to-br from-primary via-indigo-600 to-indigo-700 p-8 text-white shadow-sm">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <p className="mb-2 text-sm text-white/80">{greeting}</p>
                <h1 className="mb-3 text-3xl font-bold tracking-tight">
                  {user?.display_name || (isZh ? '欢迎回来' : 'Welcome back')}
                </h1>
                <p className="text-sm leading-6 text-white/85">
                  {isZh
                    ? '这里是今天的工作台。先看待办、项目节奏和记忆健康度，再决定优先推进哪件事。'
                    : 'Use this workspace to review today’s priorities, project momentum, and memory health before you move work forward.'}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    title: isZh ? '开始新对话' : 'Start a chat',
                    sub: isZh ? '进入 AI 工作台' : 'Open the AI workspace',
                    icon: Sparkles,
                    path: '/chat',
                    primary: true,
                  },
                  {
                    title: isZh ? '新建项目' : 'Create project',
                    sub: isZh ? '建立新的交付空间' : 'Open a new delivery workspace',
                    icon: FolderKanban,
                    path: '/projects/new',
                  },
                  {
                    title: isZh ? '项目记忆' : 'Project memory',
                    sub: isZh ? '检查项目记忆和摘要缓存' : 'Review project memory and cached summaries',
                    icon: Brain,
                    path: '/settings/memory',
                  },
                  {
                    title: isZh ? '客户记忆' : 'Client memory',
                    sub: isZh ? '查看客户长期经验沉淀' : 'Review client-level knowledge',
                    icon: Users,
                    path: '/settings/client-memory',
                  },
                ].map((item) => (
                  <button
                    key={item.title}
                    onClick={() => navigate(item.path)}
                    className={`flex items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
                      item.primary
                        ? 'bg-white text-primary hover:bg-white/95'
                        : 'border border-white/20 bg-white/10 hover:bg-white/15'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-semibold">{item.title}</div>
                      <div className={`mt-1 text-xs ${item.primary ? 'text-primary/70' : 'text-white/70'}`}>
                        {item.sub}
                      </div>
                    </div>
                    <item.icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: isZh ? '活跃项目' : 'Active projects',
                value: activeProjects.length,
                sub: isZh ? `总计 ${projects.length} 个项目` : `${projects.length} total projects`,
                icon: FolderKanban,
              },
              {
                label: isZh ? '活跃客户' : 'Active clients',
                value: activeClients.length,
                sub: isZh ? `总计 ${clients.length} 个客户` : `${clients.length} total clients`,
                icon: Building2,
              },
              {
                label: isZh ? '合同总额' : 'Contract value',
                value: formatCurrency(contractValue, isZh),
                sub: isZh ? '按未归档项目统计' : 'Across non-archived projects',
                icon: Wallet,
              },
              {
                label: isZh ? '技能数量' : 'Available skills',
                value: skills.length,
                sub: isZh ? '可复用的工作流和技能' : 'Reusable skills and workflows',
                icon: Sparkles,
              },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-outline bg-surface p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm text-on-surface-muted">{card.label}</div>
                  <card.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="text-3xl font-semibold text-on-surface">{card.value}</div>
                <div className="mt-2 text-sm text-on-surface-muted">{card.sub}</div>
              </div>
            ))}
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-on-surface">{isZh ? '今日优先动作' : 'Priority for today'}</h2>
                  <p className="mt-1 text-sm text-on-surface-muted">
                    {isZh ? '把真正需要你推进的动作拉到最前面。' : 'Pull the actions that need your attention to the top.'}
                  </p>
                </div>
                <button
                  onClick={() => navigate('/projects')}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {isZh ? '查看项目' : 'Open projects'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <button
                  onClick={() => navigate('/projects')}
                  className="rounded-2xl border border-outline px-4 py-4 text-left transition hover:bg-surface-container-low"
                >
                  <div className="text-sm text-on-surface-muted">{isZh ? '逾期待办' : 'Overdue todos'}</div>
                  <div className="mt-2 text-2xl font-semibold text-on-surface">{overdueTodos.length}</div>
                </button>
                <button
                  onClick={() => navigate('/projects')}
                  className="rounded-2xl border border-outline px-4 py-4 text-left transition hover:bg-surface-container-low"
                >
                  <div className="text-sm text-on-surface-muted">{isZh ? '三天内到期' : 'Due in 3 days'}</div>
                  <div className="mt-2 text-2xl font-semibold text-on-surface">{dueSoonTodos.length}</div>
                </button>
                <button
                  onClick={() => navigate('/chat')}
                  className="rounded-2xl border border-outline px-4 py-4 text-left transition hover:bg-surface-container-low"
                >
                  <div className="text-sm text-on-surface-muted">{isZh ? '近期对话' : 'Recent chats'}</div>
                  <div className="mt-2 text-2xl font-semibold text-on-surface">{recentConversations.length}</div>
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {myTodos.slice(0, 4).map((todo) => (
                  <button
                    key={todo.id}
                    onClick={() => navigate(`/projects/${todo.project_id}/todos`)}
                    className="flex w-full items-start gap-3 rounded-2xl border border-outline px-4 py-3 text-left transition hover:bg-surface-container-low"
                  >
                    <ListTodo className="mt-0.5 h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-on-surface">{todo.content}</div>
                      <div className="mt-1 text-xs text-on-surface-muted">
                        {todo.project_name}
                        {todo.due_date ? ` · ${todo.due_date}` : ''}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-on-surface-muted" />
                  </button>
                ))}
                {myTodos.length === 0 ? (
                  <div className="rounded-2xl bg-surface-container-low px-4 py-6 text-center text-sm text-on-surface-muted">
                    {isZh ? '目前没有分配给你的项目待办。' : 'No project todos are assigned to you right now.'}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-on-surface">{isZh ? '记忆健康度' : 'Memory health'}</h2>
                <p className="mt-1 text-sm text-on-surface-muted">
                  {isZh
                    ? '首页只展示健康概览，具体管理统一进设置。'
                    : 'Use the dashboard for health signals and settings for full management.'}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: isZh ? '项目待刷新' : 'Project stale', value: memoryHealth.projectStale, path: '/settings/memory' },
                  { label: isZh ? '项目未整理' : 'Project missing', value: memoryHealth.projectMissing, path: '/settings/memory' },
                  { label: isZh ? '客户待刷新' : 'Client stale', value: memoryHealth.clientStale, path: '/settings/client-memory' },
                  { label: isZh ? '客户未整理' : 'Client missing', value: memoryHealth.clientMissing, path: '/settings/client-memory' },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => navigate(item.path)}
                    className="rounded-2xl border border-outline px-4 py-4 text-left transition hover:bg-surface-container-low"
                  >
                    <div className="text-sm text-on-surface-muted">{item.label}</div>
                    <div className="mt-2 text-2xl font-semibold text-on-surface">{item.value}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1fr_1fr_1.1fr]">
            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-on-surface">{isZh ? '项目阶段分布' : 'Pipeline overview'}</h2>
              <div className="mt-4 space-y-3">
                {stageSummary.map((item) => (
                  <div key={item.status} className="rounded-2xl bg-surface-container-low px-4 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-on-surface">{getStageLabel(item.status, isZh)}</span>
                      <span className="text-on-surface-muted">{item.count}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-container-high">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${projects.length ? (item.count / projects.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-on-surface">
                {isZh ? '最近更新的项目' : 'Recently updated projects'}
              </h2>
              <div className="mt-4 space-y-2">
                {recentProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => navigate(`/projects/${project.id}`)}
                    className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-surface-container-low"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-on-surface">{project.name}</div>
                      <div className="mt-1 text-xs text-on-surface-muted">
                        {project.client || (isZh ? '未填写客户' : 'No client')} · {getStageLabel(project.status, isZh)}
                      </div>
                    </div>
                    <div className="ml-3 text-xs text-on-surface-muted">{formatRelativeTime(project.updated_at, isZh)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-on-surface">{isZh ? '最近客户与对话' : 'Recent clients and chats'}</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                    {isZh ? '客户' : 'Clients'}
                  </div>
                  <div className="space-y-2">
                    {recentClients.map((client) => (
                      <button
                        key={client.id}
                        onClick={() => navigate(`/clients/${client.id}`)}
                        className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-surface-container-low"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-on-surface">{client.name}</div>
                          <div className="mt-1 text-xs text-on-surface-muted">
                            {client.industry || (isZh ? '未填写行业' : 'No industry')} · {client.project_names.length}{' '}
                            {isZh ? '个项目' : 'projects'}
                          </div>
                        </div>
                        <div className="ml-3 text-xs text-on-surface-muted">
                          {formatRelativeTime(client.client_memory_updated_at || client.created_at, isZh)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                    {isZh ? '对话' : 'Chats'}
                  </div>
                  <div className="space-y-2">
                    {recentConversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        onClick={() => navigate('/chat')}
                        className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-surface-container-low"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-on-surface">
                            {conversation.title || (isZh ? '未命名对话' : 'Untitled conversation')}
                          </div>
                          <div className="mt-1 text-xs text-on-surface-muted">
                            {conversation.project_id
                              ? `${isZh ? '关联项目' : 'Project'} #${conversation.project_id}`
                              : isZh
                                ? '通用工作台'
                                : 'General workspace'}
                          </div>
                        </div>
                        <div className="ml-3 text-xs text-on-surface-muted">
                          {formatRelativeTime(conversation.updated_at, isZh)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-on-surface">{isZh ? '重点项目' : 'Top projects'}</h2>
                  <p className="mt-1 text-sm text-on-surface-muted">
                    {isZh ? '按合同金额快速看到当前最值得关注的项目。' : 'Surface the projects with the largest contract value.'}
                  </p>
                </div>
                <button
                  onClick={() => navigate('/projects')}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {isZh ? '查看全部' : 'View all'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                {topProjects.length === 0 ? (
                  <div className="rounded-2xl bg-surface-container-low px-4 py-6 text-center text-sm text-on-surface-muted">
                    {isZh ? '当前还没有带合同金额的重点项目。' : 'No contract-backed top projects yet.'}
                  </div>
                ) : (
                  topProjects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => navigate(`/projects/${project.id}`)}
                      className="w-full rounded-2xl border border-outline px-4 py-4 text-left transition hover:bg-surface-container-low"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-on-surface">{project.name}</div>
                          <div className="mt-1 text-xs text-on-surface-muted">
                            {project.client || (isZh ? '未填写客户' : 'No client')} · {getStageLabel(project.status, isZh)}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-on-surface">
                          {formatCurrency(project.contract_amount || 0, isZh)}
                        </div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-high">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${((project.contract_amount || 0) / maxProjectValue) * 100}%` }}
                        />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-on-surface">{isZh ? '常用入口' : 'Workspace shortcuts'}</h2>
                <p className="mt-1 text-sm text-on-surface-muted">
                  {isZh ? '把最常打开的工作台入口放在首页。' : 'Keep the most-used workspaces one click away.'}
                </p>
              </div>
              <div className="space-y-3">
                {[
                  {
                    title: isZh ? '项目列表' : 'Projects',
                    subtitle: isZh ? '查看项目节奏、阶段和合同分布' : 'Review active work and pipeline stages',
                    icon: FolderKanban,
                    path: '/projects',
                  },
                  {
                    title: isZh ? '项目记忆管理' : 'Project memory manager',
                    subtitle: isZh ? '统一刷新项目记忆与摘要缓存' : 'Refresh project memory and cached summaries',
                    icon: Brain,
                    path: '/settings/memory',
                  },
                  {
                    title: isZh ? '客户记忆管理' : 'Client memory manager',
                    subtitle: isZh ? '维护跨项目客户经验沉淀' : 'Maintain cross-project client knowledge',
                    icon: Users,
                    path: '/settings/client-memory',
                  },
                  {
                    title: isZh ? '客户列表' : 'Clients',
                    subtitle: isZh ? '维护客户档案与项目关系' : 'Maintain client records and relationships',
                    icon: Building2,
                    path: '/clients',
                  },
                ].map((item) => (
                  <button
                    key={item.title}
                    onClick={() => navigate(item.path)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-outline px-4 py-4 text-left transition hover:bg-surface-container-low"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <item.icon className="h-5 w-5" />
                    </div>
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
        </div>
      </div>
    </>
  )
}
