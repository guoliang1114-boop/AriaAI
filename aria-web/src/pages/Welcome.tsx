import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  Brain,
  Building2,
  ChevronRight,
  CheckCircle2,
  FolderKanban,
  Home,
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
import { ServiceErrorState } from '../components/ServiceErrorState'
import type { Conversation, MyProjectTodo, Project, SkillSummary, SystemMessage, User } from '../types/api'
import { formatDateOnly, getResolvedAppTimeZone } from '../utils/timezone'

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
  'rounded-[28px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_18px_50px_-34px_rgba(59,130,246,0.18)] backdrop-blur transition duration-200 hover:-translate-y-1 hover:shadow-[0_24px_60px_-30px_rgba(59,130,246,0.2)]'

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
  return formatDateOnly(value, {
    month: 'short',
    day: 'numeric',
  }, getResolvedAppTimeZone())
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

function HomeAnnouncementCard({
  isZh,
  message,
  onOpen,
  onRead,
}: {
  isZh: boolean
  message: SystemMessage
  onOpen: () => void
  onRead: () => void
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-emerald-200/80 bg-[linear-gradient(135deg,_rgba(236,253,245,0.96),_rgba(240,253,250,0.95)_45%,_rgba(255,251,235,0.9)_100%)] p-5 text-slate-900 shadow-[0_22px_60px_-36px_rgba(16,185,129,0.45)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.2),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.14),_transparent_28%)]" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-[0_14px_30px_-18px_rgba(5,150,105,0.9)]">
            <BellRing className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-200 bg-white/80 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {isZh ? '系统升级' : 'Product update'}
              </span>
              <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-xs font-medium text-slate-600">
                Kimi K2.6
              </span>
            </div>
            <h2 className="text-base font-semibold text-slate-950 md:text-lg">{message.title}</h2>
            <p className="mt-1 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.content}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {message.link ? (
            <button
              onClick={onOpen}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              {isZh ? '查看 AI 设置' : 'View AI settings'}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}
          <button
            onClick={onRead}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-white/85 px-4 py-2.5 text-sm font-medium text-emerald-800 transition hover:bg-white"
          >
            <CheckCircle2 className="h-4 w-4" />
            {isZh ? '知道了' : 'Got it'}
          </button>
        </div>
      </div>
    </section>
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
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [user] = useState<User | null>(() => readCachedUser())
  const [projects, setProjects] = useState<DashboardProjectSummary[]>([])
  const [clients, setClients] = useState<ClientSummary[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [myTodos, setMyTodos] = useState<MyProjectTodo[]>([])
  const [messages, setMessages] = useState<SystemMessage[]>([])

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
      setErrorStatus(null)

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

      void api.get<{ items: SystemMessage[]; unread_count: number }>('/messages')
        .then((systemMessages) => setMessages(systemMessages.items))
        .catch(() => {})
    } catch (err) {
      const apiError = err as AxiosError<ErrorResponsePayload>
      if (apiError.response?.status === 401) throw apiError
      setSecondaryLoading(false)
      setLoading(false)
      setErrorStatus(apiError.response?.status ?? null)
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
  const homeAnnouncement = useMemo(
    () => messages.find((message) => !message.is_read && message.is_published) || null,
    [messages],
  )
  const todayActions = useMemo(() => {
    const actions: Array<{
      key: string
      title: string
      description: string
      badge: string
      icon: typeof AlertCircle
      path: string
      tone: string
    }> = []

    overdueTodos.slice(0, 2).forEach((todo) => {
      actions.push({
        key: `overdue-${todo.id}`,
        title: isZh ? `处理逾期待办：${todo.content}` : `Clear overdue todo: ${todo.content}`,
        description: `${todo.project_name}${todo.due_date ? ` · ${todo.due_date}` : ''}`,
        badge: isZh ? '逾期' : 'Overdue',
        icon: AlertCircle,
        path: `/projects/${todo.project_id}/todos`,
        tone: 'border-red-200 bg-red-50 text-red-900',
      })
    })

    dueSoonTodos.slice(0, 2).forEach((todo) => {
      actions.push({
        key: `due-${todo.id}`,
        title: isZh ? `推进临期待办：${todo.content}` : `Move due-soon todo: ${todo.content}`,
        description: `${todo.project_name}${todo.due_date ? ` · ${todo.due_date}` : ''}`,
        badge: isZh ? '三天内' : 'Due soon',
        icon: ListTodo,
        path: `/projects/${todo.project_id}/todos`,
        tone: 'border-amber-200 bg-amber-50 text-amber-900',
      })
    })

    projects
      .filter((project) => project.status !== 'archived' && (project.memory_stale || (project.memory_version || 0) === 0))
      .slice(0, 2)
      .forEach((project) => {
        actions.push({
          key: `project-memory-${project.id}`,
          title: isZh ? `刷新项目记忆：${project.name}` : `Refresh project memory: ${project.name}`,
          description: project.client || (isZh ? '未填写客户' : 'No client'),
          badge: isZh ? '项目记忆' : 'Project memory',
          icon: Brain,
          path: `/projects/${project.id}/memory`,
          tone: 'border-indigo-200 bg-indigo-50 text-indigo-900',
        })
      })

    clients
      .filter((client) => client.client_memory_stale || (client.client_memory_version || 0) === 0)
      .slice(0, 2)
      .forEach((client) => {
        actions.push({
          key: `client-memory-${client.id}`,
          title: isZh ? `刷新客户记忆：${client.name}` : `Refresh client memory: ${client.name}`,
          description: client.industry || (isZh ? '未填写行业' : 'No industry'),
          badge: isZh ? '客户记忆' : 'Client memory',
          icon: Users,
          path: `/clients/${client.id}/memory`,
          tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        })
      })

    return actions.slice(0, 6)
  }, [clients, dueSoonTodos, isZh, overdueTodos, projects])

  const markAnnouncementRead = async (messageId: number) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, is_read: true, read_at: new Date().toISOString() }
          : message,
      ),
    )
    window.dispatchEvent(new Event('messages:updated'))
    try {
      await api.post(`/messages/${messageId}/read`)
    } catch {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { ...message, is_read: false, read_at: null }
            : message,
        ),
      )
    }
  }

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
    const isServiceUnavailable = errorStatus === 502 || errorStatus === 503 || errorStatus === 504
    const errorCopy = isServiceUnavailable
      ? {
          badge: String(errorStatus),
          title: isZh ? '工作台正在恢复中' : 'Workspace is recovering',
          description: isZh
            ? '部署或后端重启期间，工作台接口可能会短暂返回 502/503/504。数据通常没有丢，稍等片刻后重试即可。'
            : 'During deployment or backend restart, workspace APIs may briefly return 502/503/504. Your data is usually safe. Try again shortly.',
          hintTitle: isZh ? '现在可以这样做' : 'What you can do now',
          hintOne: isZh ? '点击“重新加载工作台”，等后端恢复后会自动回到首页。' : 'Click Reload workspace and return once the backend is healthy.',
          hintTwo: isZh ? '也可以先进入项目列表或对话页，继续其他工作。' : 'You can also open Projects or Chat and continue other work.',
          primary: isZh ? '重新加载工作台' : 'Reload workspace',
        }
      : {
          badge: errorStatus ? String(errorStatus) : (isZh ? '网络' : 'Network'),
          title: isZh ? '工作台暂时无法加载' : 'Workspace could not load',
          description: isZh
            ? '工作台请求遇到问题。你可以重试，或者先进入项目列表继续工作。'
            : 'The workspace request failed. You can retry or continue from the project list.',
          hintTitle: isZh ? '下一步建议' : 'Next step',
          hintOne: isZh ? '如果刚刚部署过，建议稍等几十秒再重试。' : 'If deployment just ran, wait a few seconds and retry.',
          hintTwo: isZh ? '如果持续失败，可以从错误详情判断具体接口问题。' : 'If it continues, use the error detail to identify the failing API.',
          primary: isZh ? '重试' : 'Retry',
        }

    return (
      <>
        <PageTitle title={t('dashboard.title')} />
        <ServiceErrorState
          actions={[
            {
              icon: <RefreshCw className="h-4 w-4" />,
              label: errorCopy.primary,
              onClick: () => void loadData(),
            },
            {
              icon: <FolderKanban className="h-4 w-4" />,
              label: isZh ? '返回项目列表' : 'Projects',
              onClick: () => navigate('/projects'),
              variant: 'secondary',
            },
            {
              icon: <MessageSquare className="h-4 w-4" />,
              label: isZh ? '进入对话' : 'Chat',
              onClick: () => navigate('/chat'),
              variant: 'secondary',
            },
          ]}
          badge={errorCopy.badge}
          description={errorCopy.description}
          detail={error}
          detailLabel={isZh ? '错误详情' : 'Error detail'}
          hints={[errorCopy.hintOne, errorCopy.hintTwo]}
          hintTitle={errorCopy.hintTitle}
          linksTitle={isZh ? '快捷入口' : 'Quick links'}
          serviceUnavailable={isServiceUnavailable}
          title={errorCopy.title}
          links={[
            {
              icon: <Home className="h-4 w-4" />,
              label: isZh ? '刷新首页' : 'Dashboard',
              description: isZh ? '等服务恢复后重新进入今日工作台。' : 'Return here once the service recovers.',
              onClick: () => navigate('/'),
            },
            {
              label: isZh ? '任务中心' : 'Operations',
              description: isZh ? '管理员可以查看记忆任务和失败记录。' : 'Admins can inspect memory jobs and failures.',
              onClick: () => navigate('/settings/memory-ops'),
            },
          ]}
        />
      </>
    )
  }

  return (
    <>
      <PageTitle title={t('dashboard.title')} />
      <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.14),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.1),_transparent_24%),radial-gradient(circle_at_center,_rgba(251,191,36,0.08),_transparent_26%),linear-gradient(to_bottom,_rgba(248,250,252,1),_rgba(255,255,255,1))]">
        <div className="space-y-6 px-8 py-8">
          {homeAnnouncement ? (
            <HomeAnnouncementCard
              isZh={isZh}
              message={homeAnnouncement}
              onOpen={() => {
                void markAnnouncementRead(homeAnnouncement.id)
                navigate(homeAnnouncement.link || '/messages')
              }}
              onRead={() => void markAnnouncementRead(homeAnnouncement.id)}
            />
          ) : null}

          <section className="relative overflow-hidden rounded-[32px] border border-sky-100 bg-[linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(239,246,255,0.96)_38%,_rgba(236,253,245,0.94)_100%)] p-8 text-slate-900 shadow-[0_24px_80px_-36px_rgba(59,130,246,0.28)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(251,191,36,0.14),_transparent_22%)]" />
            <div className="relative grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/80 px-3 py-1 text-xs font-medium text-sky-700 shadow-sm">
                  <Sparkles className="h-3.5 w-3.5" />
                  {isZh ? '今日工作台' : 'Today workspace'}
                </div>
                <div>
                  <p className="mb-2 text-sm text-slate-500">{greeting}</p>
                  <h1 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
                    {user?.display_name || (isZh ? '欢迎回来' : 'Welcome back')}
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
                    {isZh
                      ? '先看待办优先级、项目节奏和记忆健康度，再决定今天最值得推进的动作。'
                      : 'Start from priorities, project rhythm, and memory health before choosing what to move today.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => navigate('/chat')} className="inline-flex items-center gap-2 rounded-2xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-600">
                    {isZh ? '开始新对话' : 'Start a chat'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button onClick={() => navigate('/projects/new')} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-white">
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
                    <div key={item.label} className="rounded-full border border-white/80 bg-white/75 px-3 py-1.5 text-xs text-slate-600 shadow-sm">
                      {item.label}: <span className="font-semibold text-slate-900">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    title: isZh ? '项目记忆' : 'Project memory',
                    sub: isZh ? '统一刷新项目记忆与摘要缓存' : 'Refresh project memory and cached summaries',
                    icon: Brain,
                    path: '/settings/memory',
                    cardClass: 'border-indigo-200/70 bg-gradient-to-br from-indigo-500/24 via-sky-500/12 to-white/72 text-slate-950',
                    subClass: 'text-slate-700',
                    iconClass: 'text-indigo-700',
                  },
                  {
                    title: isZh ? '客户记忆' : 'Client memory',
                    sub: isZh ? '查看客户级长期经验沉淀' : 'Review client-level knowledge',
                    icon: Users,
                    path: '/settings/client-memory',
                    cardClass: 'border-emerald-200/80 bg-gradient-to-br from-emerald-400/24 via-teal-300/12 to-white/74 text-slate-950',
                    subClass: 'text-slate-700',
                    iconClass: 'text-emerald-700',
                  },
                  {
                    title: isZh ? '客户列表' : 'Clients',
                    sub: isZh ? '维护客户档案与合作关系' : 'Maintain client records and relationships',
                    icon: Building2,
                    path: '/clients',
                    cardClass: 'border-sky-200/85 bg-gradient-to-br from-sky-200/88 via-cyan-100/82 to-white/92 text-slate-900',
                    subClass: 'text-slate-600',
                    iconClass: 'text-sky-700',
                  },
                  {
                    title: isZh ? '项目列表' : 'Projects',
                    sub: isZh ? '回到核心业务看板' : 'Return to the delivery board',
                    icon: FolderKanban,
                    path: '/projects',
                    cardClass: 'border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-slate-50/96 text-slate-900',
                    subClass: 'text-slate-600',
                    iconClass: 'text-amber-700',
                  },
                ].map((item) => (
                  <button
                    key={item.title}
                    onClick={() => navigate(item.path)}
                    className={`group rounded-3xl border ${item.cardClass} p-4 text-left shadow-[0_16px_36px_-28px_rgba(59,130,246,0.18)] backdrop-blur-sm transition duration-200 hover:-translate-y-1 hover:shadow-[0_18px_40px_-24px_rgba(59,130,246,0.22)]`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="text-sm font-semibold">{item.title}</div>
                        <div className={`text-xs leading-5 ${item.subClass}`}>{item.sub}</div>
                      </div>
                      <item.icon className={`h-4 w-4 ${item.iconClass} opacity-85 transition duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5`} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className={cardBase}>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-on-surface">{isZh ? '今天建议先做' : 'Recommended next actions'}</h2>
                <p className="mt-1 text-sm text-on-surface-muted">
                  {isZh
                    ? '自动从待办、项目记忆和客户记忆里挑出最值得先处理的动作。'
                    : 'Automatically pulled from todos, project memory, and client memory signals.'}
                </p>
              </div>
              <button
                onClick={() => navigate('/settings/memory-ops')}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {isZh ? '打开任务中心' : 'Open operations'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {todayActions.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {todayActions.map((action) => (
                  <button
                    key={action.key}
                    onClick={() => navigate(action.path)}
                    className={`group rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${action.tone}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-semibold">{action.badge}</span>
                        <div className="mt-3 line-clamp-2 text-sm font-semibold">{action.title}</div>
                        <div className="mt-1 truncate text-xs opacity-75">{action.description}</div>
                      </div>
                      <action.icon className="h-4 w-4 shrink-0 transition group-hover:scale-110" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-on-surface-muted">
                {isZh ? '今天没有明显阻塞项，可以从新对话或最近项目继续推进。' : 'No obvious blockers today. Continue from a new chat or recent projects.'}
              </div>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: isZh ? '活跃项目' : 'Active projects', value: activeProjects.length, sub: isZh ? `总计 ${projects.length} 个项目` : `${projects.length} total projects`, icon: FolderKanban, tone: 'to-indigo-50/80' },
              { label: isZh ? '活跃客户' : 'Active clients', value: secondaryLoading ? '...' : activeClients.length, sub: isZh ? `总计 ${clients.length} 个客户` : `${clients.length} total clients`, icon: Building2, tone: 'to-sky-50/80' },
              { label: isZh ? '合同总额' : 'Contract value', value: formatCurrency(contractValue, isZh), sub: isZh ? '按未归档项目统计' : 'Across non-archived projects', icon: Wallet, tone: 'to-emerald-50/80' },
              { label: isZh ? '技能数量' : 'Available skills', value: secondaryLoading ? '...' : skills.length, sub: isZh ? '可复用的工作流和技能' : 'Reusable skills and workflows', icon: Sparkles, tone: 'to-amber-50/80' },
            ].map((card) => (
              <div key={card.label} className={`rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white ${card.tone} p-5 shadow-[0_18px_40px_-30px_rgba(59,130,246,0.16)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_24px_48px_-28px_rgba(59,130,246,0.2)]`}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm text-on-surface-muted">{card.label}</div>
                  <div className="rounded-xl bg-white p-2 text-sky-600 shadow-sm"><card.icon className="h-4 w-4" /></div>
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

