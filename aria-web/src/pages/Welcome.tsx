import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  Brain,
  Building2,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ListTodo,
  Loader2,
  MessageSquare,
  Plus,
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
import { resolveProjectStage } from '../types/enums'
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
  status: Project['status'] | string
  contract_amount?: number
  updated_at: string
  memory_stale?: boolean
  memory_version?: number
}

type PriorityAction = {
  key: string
  title: string
  description: string
  label: string
  path: string
  tone: 'red' | 'amber' | 'indigo' | 'emerald'
  icon: typeof AlertCircle
}

const panelClass = 'rounded-2xl border border-white/70 bg-white/90 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.35)] backdrop-blur'

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
    currency: 'USD',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(value)
}

function formatRelativeTime(value?: string | null, isZh = true) {
  if (!value) return isZh ? '暂无记录' : 'No recent activity'
  const diffMinutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  if (diffMinutes < 1) return isZh ? '刚刚' : 'Just now'
  if (diffMinutes < 60) return isZh ? `${diffMinutes} 分钟前` : `${diffMinutes} min ago`
  if (diffMinutes < 1440) return isZh ? `${Math.floor(diffMinutes / 60)} 小时前` : `${Math.floor(diffMinutes / 60)} h ago`
  if (diffMinutes < 2880) return isZh ? '昨天' : 'Yesterday'
  return formatDateOnly(value, { day: 'numeric', month: 'short' }, getResolvedAppTimeZone())
}

function getStageLabel(status: string, isZh: boolean) {
  const stage = resolveProjectStage(status)
  return isZh ? stage.labelZh : stage.label
}

function getActionTone(tone: PriorityAction['tone']) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-950',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-950',
    red: 'border-red-200 bg-red-50 text-red-950',
  }
  return tones[tone]
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
    <section className="rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50 via-white to-sky-50 p-4 text-slate-900 shadow-[0_16px_44px_-34px_rgba(5,150,105,0.45)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
            <BellRing className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-emerald-700">{isZh ? '系统通知' : 'System notice'}</div>
            <h2 className="mt-1 text-sm font-semibold text-slate-950">{message.title}</h2>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-700">{message.content}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {message.link ? (
            <button onClick={onOpen} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
              {isZh ? '查看' : 'Open'}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}
          <button onClick={onRead} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
            <CheckCircle2 className="h-4 w-4" />
            {isZh ? '知道了' : 'Got it'}
          </button>
        </div>
      </div>
    </section>
  )
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}

export function Welcome() {
  const navigate = useNavigate()
  const { i18n, t } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [loading, setLoading] = useState(true)
  const [secondaryLoading, setSecondaryLoading] = useState(true)
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
      if (apiError.response?.status === 401) {
        setLoading(false)
        setSecondaryLoading(false)
        return
      }
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
  const recentProjects = useMemo(() => [...projects].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6), [projects])
  const recentConversations = useMemo(() => [...conversations].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 4), [conversations])
  const memoryHealth = useMemo(() => ({
    clientNeedWork: clients.filter((client) => client.client_memory_stale || (client.client_memory_version || 0) === 0).length,
    projectNeedWork: projects.filter((project) => project.memory_stale || (project.memory_version || 0) === 0).length,
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
  const projectQueue = useMemo(() => {
    return [...activeProjects]
      .sort((a, b) => {
        const aScore = (a.memory_stale || (a.memory_version || 0) === 0 ? 100 : 0) + new Date(a.updated_at).getTime() / 1_000_000_000
        const bScore = (b.memory_stale || (b.memory_version || 0) === 0 ? 100 : 0) + new Date(b.updated_at).getTime() / 1_000_000_000
        return bScore - aScore
      })
      .slice(0, 6)
  }, [activeProjects])
  const spotlightProject = projectQueue[0] || null
  const homeAnnouncement = useMemo(
    () => messages.find((message) => !message.is_read && message.is_published) || null,
    [messages],
  )
  const priorityActions = useMemo<PriorityAction[]>(() => {
    const actions: PriorityAction[] = []

    overdueTodos.slice(0, 3).forEach((todo) => {
      actions.push({
        description: `${todo.project_name}${todo.due_date ? ` · ${formatDateOnly(todo.due_date, { month: '2-digit', day: '2-digit' }, getResolvedAppTimeZone())}` : ''}`,
        icon: AlertCircle,
        key: `overdue-${todo.id}`,
        label: isZh ? '逾期' : 'Overdue',
        path: `/projects/${todo.project_id}/todos`,
        title: isZh ? `处理：${todo.content}` : `Clear: ${todo.content}`,
        tone: 'red',
      })
    })

    dueSoonTodos.slice(0, 3).forEach((todo) => {
      actions.push({
        description: `${todo.project_name}${todo.due_date ? ` · ${formatDateOnly(todo.due_date, { month: '2-digit', day: '2-digit' }, getResolvedAppTimeZone())}` : ''}`,
        icon: ListTodo,
        key: `due-${todo.id}`,
        label: isZh ? '三天内' : 'Due soon',
        path: `/projects/${todo.project_id}/todos`,
        title: isZh ? `推进：${todo.content}` : `Move: ${todo.content}`,
        tone: 'amber',
      })
    })

    activeProjects
      .filter((project) => project.memory_stale || (project.memory_version || 0) === 0)
      .slice(0, 3)
      .forEach((project) => {
        actions.push({
          description: project.client || (isZh ? '未填写客户' : 'No client'),
          icon: Brain,
          key: `project-memory-${project.id}`,
          label: isZh ? '项目记忆' : 'Project memory',
          path: `/projects/${project.id}/memory`,
          title: isZh ? `刷新 ${project.name}` : `Refresh ${project.name}`,
          tone: 'indigo',
        })
      })

    clients
      .filter((client) => client.client_memory_stale || (client.client_memory_version || 0) === 0)
      .slice(0, 2)
      .forEach((client) => {
        actions.push({
          description: client.industry || (isZh ? '未填写行业' : 'No industry'),
          icon: Users,
          key: `client-memory-${client.id}`,
          label: isZh ? '客户记忆' : 'Client memory',
          path: `/clients/${client.id}/memory`,
          title: isZh ? `刷新 ${client.name}` : `Refresh ${client.name}`,
          tone: 'emerald',
        })
      })

    return actions.slice(0, 7)
  }, [activeProjects, clients, dueSoonTodos, isZh, overdueTodos])

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
        <div className="flex h-full items-center justify-center bg-slate-50">
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
          description: isZh
            ? '部署或后端重启期间，工作台接口可能会短暂返回 502/503/504。数据通常没有丢，稍等片刻后重试即可。'
            : 'During deployment or backend restart, workspace APIs may briefly return 502/503/504. Your data is usually safe. Try again shortly.',
          hintOne: isZh ? '点击“重新加载工作台”，等后端恢复后会自动回到首页。' : 'Click Reload workspace and return once the backend is healthy.',
          hintTitle: isZh ? '现在可以这样做' : 'What you can do now',
          hintTwo: isZh ? '也可以先进入项目列表或对话页，继续其他工作。' : 'You can also open Projects or Chat and continue other work.',
          primary: isZh ? '重新加载工作台' : 'Reload workspace',
          title: isZh ? '工作台正在恢复中' : 'Workspace is recovering',
        }
      : {
          badge: errorStatus ? String(errorStatus) : (isZh ? '网络' : 'Network'),
          description: isZh
            ? '工作台请求遇到问题。你可以重试，或者先进入项目列表继续工作。'
            : 'The workspace request failed. You can retry or continue from the project list.',
          hintOne: isZh ? '如果刚刚部署过，建议稍等几十秒再重试。' : 'If deployment just ran, wait a few seconds and retry.',
          hintTitle: isZh ? '下一步建议' : 'Next step',
          hintTwo: isZh ? '如果持续失败，可以从错误详情判断具体接口问题。' : 'If it continues, use the error detail to identify the failing API.',
          primary: isZh ? '重试' : 'Retry',
          title: isZh ? '工作台暂时无法加载' : 'Workspace could not load',
        }

    return (
      <>
        <PageTitle title={t('dashboard.title')} />
        <ServiceErrorState
          actions={[
            { icon: <RefreshCw className="h-4 w-4" />, label: errorCopy.primary, onClick: () => void loadData() },
            { icon: <FolderKanban className="h-4 w-4" />, label: isZh ? '返回项目列表' : 'Projects', onClick: () => navigate('/projects'), variant: 'secondary' },
            { icon: <MessageSquare className="h-4 w-4" />, label: isZh ? '进入对话' : 'Chat', onClick: () => navigate('/chat'), variant: 'secondary' },
          ]}
          badge={errorCopy.badge}
          description={errorCopy.description}
          detail={error}
          detailLabel={isZh ? '错误详情' : 'Error detail'}
          hints={[errorCopy.hintOne, errorCopy.hintTwo]}
          hintTitle={errorCopy.hintTitle}
          links={[
            { description: isZh ? '等服务恢复后重新进入今日工作台。' : 'Return here once the service recovers.', icon: <FolderKanban className="h-4 w-4" />, label: isZh ? '项目列表' : 'Projects', onClick: () => navigate('/projects') },
            { description: isZh ? '管理员可以查看记忆任务和失败记录。' : 'Admins can inspect memory jobs and failures.', label: isZh ? '任务中心' : 'Operations', onClick: () => navigate('/settings/memory-ops') },
          ]}
          linksTitle={isZh ? '快捷入口' : 'Quick links'}
          serviceUnavailable={isServiceUnavailable}
          title={errorCopy.title}
        />
      </>
    )
  }

  return (
    <>
      <PageTitle title={t('dashboard.title')} />
      <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_26%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)]">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-5 px-6 py-6">
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

          <header className="relative overflow-hidden rounded-3xl border border-white/70 bg-white/85 px-6 py-6 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)] backdrop-blur xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-stretch xl:gap-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-emerald-400 to-sky-400" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span>{greeting}</span>
                <span>/</span>
                <span>{user?.display_name || (isZh ? '欢迎回来' : 'Welcome back')}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <h1 className="text-3xl font-semibold tracking-normal text-slate-950">{isZh ? '今日工作台' : 'Today workspace'}</h1>
                <span className="pb-1 text-sm text-slate-500">
                  {isZh ? '先处理阻塞，再推进项目，然后补齐记忆。' : 'Clear blockers, move projects, then refresh memory.'}
                </span>
              </div>
              <div className="mt-5 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
                  <div className="text-xs text-slate-400">{isZh ? '今天要盯住' : 'Watch today'}</div>
                  <div className="mt-1 font-semibold text-slate-900">{overdueTodos.length + dueSoonTodos.length} {isZh ? '个待办信号' : 'todo signals'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
                  <div className="text-xs text-slate-400">{isZh ? '可推进项目' : 'Movable projects'}</div>
                  <div className="mt-1 font-semibold text-slate-900">{activeProjects.length} {isZh ? '个活跃项目' : 'active projects'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
                  <div className="text-xs text-slate-400">{isZh ? '知识健康' : 'Knowledge health'}</div>
                  <div className="mt-1 font-semibold text-slate-900">{memoryHealth.projectNeedWork + memoryHealth.clientNeedWork} {isZh ? '项待处理' : 'items to review'}</div>
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-col justify-between gap-3 xl:mt-0">
              <div className="rounded-3xl bg-slate-950 px-5 py-4 text-white shadow-[0_24px_60px_-36px_rgba(15,23,42,0.75)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-slate-400">{isZh ? '今日节奏' : 'Today rhythm'}</div>
                    <div className="mt-1 text-lg font-semibold">{isZh ? '先收口，再推进' : 'Close gaps, then move'}</div>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                    <Sparkles className="h-5 w-5 text-sky-200" />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: isZh ? '阻塞' : 'Blocked', value: overdueTodos.length },
                    { label: isZh ? '推进' : 'Move', value: dueSoonTodos.length + activeProjects.length },
                    { label: isZh ? '补齐' : 'Refresh', value: memoryHealth.projectNeedWork + memoryHealth.clientNeedWork },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl bg-white/10 px-3 py-2">
                      <div className="text-lg font-semibold">{item.value}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{item.label}</div>
                    </div>
                  ))}
                </div>
                {spotlightProject ? (
                  <button
                    onClick={() => navigate(`/projects/${spotlightProject.id}`)}
                    className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl bg-white/10 px-3 py-2 text-left transition hover:bg-white/15"
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] text-slate-400">{isZh ? '建议打开' : 'Suggested'}</span>
                      <span className="mt-0.5 block truncate text-sm font-semibold text-white">{spotlightProject.name}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-sky-200" />
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => void loadData()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-white">
                  <RefreshCw className="h-4 w-4" />
                  {isZh ? '刷新' : 'Refresh'}
                </button>
                <button onClick={() => navigate('/projects/new')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-white">
                  <Plus className="h-4 w-4" />
                  {isZh ? '新建项目' : 'New project'}
                </button>
                <button onClick={() => navigate('/chat')} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-primary/20 hover:bg-primary/90">
                  <MessageSquare className="h-4 w-4" />
                  {isZh ? '开始新对话' : 'Start chat'}
                </button>
              </div>
            </div>
          </header>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { icon: FolderKanban, label: isZh ? '活跃项目' : 'Active projects', sub: isZh ? `总计 ${projects.length} 个项目` : `${projects.length} total`, tint: 'from-blue-50 to-white', value: activeProjects.length },
              { icon: ListTodo, label: isZh ? '待办压力' : 'Todo pressure', sub: isZh ? `${overdueTodos.length} 逾期 / ${dueSoonTodos.length} 临期` : `${overdueTodos.length} overdue / ${dueSoonTodos.length} soon`, tint: 'from-amber-50 to-white', value: myTodos.length },
              { icon: Brain, label: isZh ? '记忆待处理' : 'Memory review', sub: isZh ? `${memoryHealth.projectNeedWork} 项目 / ${secondaryLoading ? '...' : memoryHealth.clientNeedWork} 客户` : `${memoryHealth.projectNeedWork} projects / ${secondaryLoading ? '...' : memoryHealth.clientNeedWork} clients`, tint: 'from-indigo-50 to-white', value: memoryHealth.projectNeedWork + memoryHealth.clientNeedWork },
              { icon: Wallet, label: isZh ? '未归档合同额' : 'Open contract value', sub: isZh ? `${activeClients.length} 个活跃客户` : `${activeClients.length} active clients`, tint: 'from-emerald-50 to-white', value: formatCurrency(contractValue, isZh) },
            ].map((item) => (
              <div key={item.label} className={`rounded-2xl border border-white/70 bg-gradient-to-br ${item.tint} p-5 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_52px_-36px_rgba(15,23,42,0.42)]`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-500">{item.label}</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-950">{item.value}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.sub}</div>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-primary shadow-sm">
                    <item.icon className="h-4 w-4" />
                  </div>
                </div>
              </div>
            ))}
          </section>

          <main className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex min-w-0 flex-col gap-5">
              <section className={panelClass}>
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{isZh ? '今天优先处理' : 'Priority actions'}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {isZh ? '从逾期待办、临期待办和记忆状态里自动挑出最该先做的事。' : 'Pulled from overdue work, near-term todos, and memory health.'}
                    </p>
                  </div>
                  <button onClick={() => navigate('/projects')} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    {isZh ? '项目总览' : 'Projects'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  {priorityActions.length ? priorityActions.map((action) => (
                    <button key={action.key} onClick={() => navigate(action.path)} className={`group rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${getActionTone(action.tone)}`}>
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/75 shadow-sm">
                          <action.icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 inline-flex rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold">{action.label}</div>
                          <div className="line-clamp-2 text-sm font-semibold">{action.title}</div>
                          <div className="mt-1 truncate text-xs opacity-75">{action.description}</div>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 opacity-50 transition group-hover:translate-x-0.5" />
                      </div>
                    </button>
                  )) : (
                    <div className="md:col-span-2">
                      <EmptyBlock>{isZh ? '今天没有明显阻塞项，可以从最近项目或新对话继续推进。' : 'No obvious blockers today. Continue from recent projects or a new chat.'}</EmptyBlock>
                    </div>
                  )}
                </div>
              </section>

              <section className={panelClass}>
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{isZh ? '项目推进队列' : 'Project movement queue'}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {isZh ? '优先显示需要补记忆或最近有变化的活跃项目。' : 'Prioritizes active projects with stale memory or recent movement.'}
                    </p>
                  </div>
                  <button onClick={() => navigate('/projects/new')} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    {isZh ? '新增' : 'New'}
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {projectQueue.length ? projectQueue.map((project) => {
                    const needsMemory = project.memory_stale || (project.memory_version || 0) === 0
                    return (
                      <button key={project.id} onClick={() => navigate(`/projects/${project.id}`)} className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50/80">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <FolderKanban className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-semibold text-slate-950">{project.name}</div>
                            {needsMemory ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{isZh ? '记忆待更新' : 'Memory stale'}</span> : null}
                          </div>
                          <div className="mt-1 truncate text-xs text-slate-500">
                            {project.client || (isZh ? '未填写客户' : 'No client')} · {getStageLabel(project.status, isZh)} · {formatRelativeTime(project.updated_at, isZh)}
                          </div>
                        </div>
                        <div className="hidden text-right sm:block">
                          <div className="text-sm font-semibold text-slate-900">{formatCurrency(project.contract_amount || 0, isZh)}</div>
                          <div className="mt-1 text-xs text-slate-500">{isZh ? '合同额' : 'Contract'}</div>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                      </button>
                    )
                  }) : (
                    <div className="p-4">
                      <EmptyBlock>{isZh ? '暂无活跃项目。可以新建项目或查看项目列表。' : 'No active projects yet. Create one or open the project list.'}</EmptyBlock>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <aside className="flex min-w-0 flex-col gap-5">
              <section className={panelClass}>
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="font-semibold text-slate-950">{isZh ? '我的待办' : 'My todos'}</h2>
                </div>
                <div className="space-y-2 p-3">
                  {myTodos.slice(0, 5).map((todo) => (
                    <button key={todo.id} onClick={() => navigate(`/projects/${todo.project_id}/todos`)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50">
                      <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium text-slate-800">{todo.content}</span>
                        <span className="mt-1 block truncate text-xs text-slate-500">{todo.project_name}{todo.due_date ? ` · ${formatDateOnly(todo.due_date, { month: '2-digit', day: '2-digit' }, getResolvedAppTimeZone())}` : ''}</span>
                      </span>
                    </button>
                  ))}
                  {myTodos.length === 0 ? <EmptyBlock>{isZh ? '目前没有分配给你的项目待办。' : 'No project todos are assigned to you.'}</EmptyBlock> : null}
                </div>
              </section>

              <section className={panelClass}>
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="font-semibold text-slate-950">{isZh ? '运营信号' : 'Operating signals'}</h2>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3">
                  {[
                    { icon: AlertCircle, label: isZh ? '逾期' : 'Overdue', path: '/projects', value: overdueTodos.length },
                    { icon: Clock3, label: isZh ? '临期' : 'Due soon', path: '/projects', value: dueSoonTodos.length },
                    { icon: Brain, label: isZh ? '项目记忆' : 'Project memory', path: '/settings/memory', value: memoryHealth.projectNeedWork },
                    { icon: Users, label: isZh ? '客户记忆' : 'Client memory', path: '/settings/client-memory', value: secondaryLoading ? '...' : memoryHealth.clientNeedWork },
                  ].map((item) => (
                    <button key={item.label} onClick={() => navigate(item.path)} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3 text-left hover:bg-slate-50">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{item.label}</span>
                        <item.icon className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="mt-2 text-xl font-semibold text-slate-950">{item.value}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className={panelClass}>
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="font-semibold text-slate-950">{isZh ? '最近对话' : 'Recent chats'}</h2>
                </div>
                <div className="space-y-1 p-3">
                  {secondaryLoading ? (
                    <EmptyBlock>{isZh ? '正在加载对话' : 'Loading chats'}</EmptyBlock>
                  ) : recentConversations.length ? recentConversations.map((conversation) => (
                    <button key={conversation.id} onClick={() => navigate(conversation.project_id ? `/projects/${conversation.project_id}/chat` : '/chat')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50">
                      <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{conversation.title || (isZh ? '未命名对话' : 'Untitled chat')}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{formatRelativeTime(conversation.updated_at, isZh)}</span>
                      </span>
                    </button>
                  )) : (
                    <EmptyBlock>{isZh ? '暂无最近对话。' : 'No recent chats.'}</EmptyBlock>
                  )}
                </div>
              </section>

              <section className={panelClass}>
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="font-semibold text-slate-950">{isZh ? '常用入口' : 'Shortcuts'}</h2>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3">
                  {[
                    { icon: FolderKanban, label: isZh ? '项目' : 'Projects', path: '/projects' },
                    { icon: Building2, label: isZh ? '客户' : 'Clients', path: '/clients' },
                    { icon: Sparkles, label: isZh ? '技能' : 'Skills', path: '/skills' },
                    { icon: MessageSquare, label: isZh ? '对话' : 'Chat', path: '/chat' },
                  ].map((item) => (
                    <button key={item.label} onClick={() => navigate(item.path)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      <item.icon className="h-4 w-4 text-primary" />
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                  {isZh ? `${skills.length} 个技能可用` : `${skills.length} skills available`}
                </div>
              </section>
            </aside>
          </main>
        </div>
      </div>
    </>
  )
}
