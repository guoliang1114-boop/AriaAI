import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BellRing,
  Brain,
  Building2,
  CheckCircle2,
  Activity,
  FolderKanban,
  ListTodo,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from 'lucide-react'
import type { AxiosError } from 'axios'
import { api } from '../api/client'
import { buildDailyBrief, DailyBriefHero } from '../components/DailyBriefHero'
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

const panelClass = 'rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_18px_48px_-38px_rgba(15,23,42,0.28)] backdrop-blur'

function readCachedUser() {
  try {
    const raw = localStorage.getItem('user')
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
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
  const homeAnnouncement = useMemo(
    () => messages.find((message) => !message.is_read && message.is_published) || null,
    [messages],
  )
  const dailyBrief = useMemo(
    () =>
      buildDailyBrief({
        projects,
        todos: myTodos,
        clients,
        isZh,
      }),
    [projects, myTodos, clients, isZh],
  )
  const activeClients = useMemo(() => clients.filter((client) => client.project_names.length > 0), [clients])
  const clientPulse = useMemo(() => {
    const tones = [
      {
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        card: 'border-emerald-100 bg-gradient-to-br from-white to-emerald-50/65',
      },
      {
        badge: 'bg-amber-50 text-amber-700 border-amber-100',
        card: 'border-amber-100 bg-gradient-to-br from-white to-amber-50/65',
      },
      {
        badge: 'bg-indigo-50 text-indigo-700 border-indigo-100',
        card: 'border-indigo-100 bg-gradient-to-br from-white to-indigo-50/65',
      },
      {
        badge: 'bg-sky-50 text-sky-700 border-sky-100',
        card: 'border-sky-100 bg-gradient-to-br from-white to-sky-50/65',
      },
    ]

    return [...activeClients]
      .sort((a, b) => {
        const aStale = a.client_memory_stale || (a.client_memory_version ?? 0) === 0 ? 1 : 0
        const bStale = b.client_memory_stale || (b.client_memory_version ?? 0) === 0 ? 1 : 0
        return bStale - aStale || b.project_names.length - a.project_names.length
      })
      .slice(0, 4)
      .map((client, index) => ({
        client,
        tone: tones[index] || tones[0],
        status: client.client_memory_stale || (client.client_memory_version ?? 0) === 0
          ? isZh ? '待更新' : 'Needs refresh'
          : isZh ? '稳定' : 'Healthy',
      }))
  }, [activeClients, isZh])
  const judgementQueue = useMemo(() => {
    const todoItems = [...overdueTodos, ...dueSoonTodos].slice(0, 2).map((todo) => ({
      key: `todo-${todo.id}`,
      label: todo.due_date && new Date(todo.due_date) < new Date() ? (isZh ? '逾期' : 'Overdue') : (isZh ? '临期' : 'Due soon'),
      title: todo.content,
      meta: todo.project_name,
      path: `/projects/${todo.project_id}/todos`,
      tone: 'rose',
    }))
    const projectItems = projectQueue.slice(0, 4 - todoItems.length).map((project) => ({
      key: `project-${project.id}`,
      label: project.memory_stale || (project.memory_version ?? 0) === 0 ? (isZh ? '补记忆' : 'Memory') : getStageLabel(project.status, isZh),
      title: project.name,
      meta: `${project.client || (isZh ? '未填写客户' : 'No client')} · ${formatRelativeTime(project.updated_at, isZh)}`,
      path: `/projects/${project.id}`,
      tone: project.memory_stale || (project.memory_version ?? 0) === 0 ? 'amber' : 'blue',
    }))
    return [...todoItems, ...projectItems]
  }, [dueSoonTodos, isZh, overdueTodos, projectQueue])
  const stakeholderWatch = useMemo(() => {
    return [...activeClients]
      .sort((a, b) => {
        const aStale = a.client_memory_stale || (a.client_memory_version ?? 0) === 0 ? 1 : 0
        const bStale = b.client_memory_stale || (b.client_memory_version ?? 0) === 0 ? 1 : 0
        return bStale - aStale || a.name.localeCompare(b.name)
      })
      .slice(0, 3)
  }, [activeClients])

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
      <div className="h-full overflow-auto bg-[linear-gradient(180deg,#f5f9ff_0%,#f8fafc_46%,#f3fbf7_100%)]">
        <div className="flex w-full flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-5 lg:px-8 lg:py-6 2xl:px-10">
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

          <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-4 shadow-[0_18px_48px_-42px_rgba(37,99,235,0.35)] backdrop-blur sm:px-5 lg:flex lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-slate-950 sm:text-xl">
                {greeting}，{user?.display_name || (isZh ? '欢迎回来' : 'Welcome back')}
              </h1>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {isZh ? '今天的客户关系，AriaAI 已经为你整理好。' : 'AriaAI has organized today’s client relationship work.'}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:mt-0">
              <button
                type="button"
                onClick={() => navigate('/chat')}
                className="hidden h-9 min-w-[280px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-400 transition hover:border-slate-300 hover:bg-slate-50 lg:inline-flex"
              >
                <Search className="h-3.5 w-3.5" />
                {isZh ? '回忆一下 …' : 'Recall something …'}
              </button>
              <button
                onClick={() => void loadData()}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:h-9"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${secondaryLoading ? 'animate-spin' : ''}`} />
                {isZh ? '刷新' : 'Refresh'}
              </button>
              <button
                onClick={() => navigate('/chat')}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition hover:bg-primary/90 sm:h-9"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {isZh ? '新建对话' : 'New chat'}
              </button>
            </div>
          </div>

          <DailyBriefHero
            brief={dailyBrief}
            totalAvailable={dailyBrief.totalSignals}
            isZh={isZh}
            loading={secondaryLoading}
            onRefresh={() => void loadData()}
          />

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Activity className="h-4 w-4 text-slate-700" />
                <h2 className="text-base font-semibold text-slate-950">{isZh ? '客户脉搏' : 'Client pulse'}</h2>
                <span className="text-xs leading-5 text-slate-500">
                  {isZh ? `· 你正在跟进的 ${activeClients.length} 位客户的关系状态` : `· ${activeClients.length} active client relationships`}
                </span>
              </div>
              <button onClick={() => navigate('/clients')} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {isZh ? '查看全部客户' : 'View all clients'}
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {clientPulse.length ? clientPulse.map(({ client, tone, status }) => (
                <button
                  key={client.id}
                  onClick={() => navigate(`/clients/${client.id}`)}
                  className={`rounded-2xl border p-3.5 text-left shadow-sm shadow-slate-200/40 transition hover:-translate-y-0.5 hover:shadow-md hover:shadow-slate-200/70 sm:p-4 ${tone.card}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950">{client.name}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {client.industry || (isZh ? '行业未填' : 'No industry')} · {client.project_names.length} {isZh ? '个项目' : 'projects'}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${tone.badge}`}>
                      {status}
                    </span>
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
                    {client.client_memory_stale || (client.client_memory_version ?? 0) === 0
                      ? isZh ? '客户记忆需要刷新，建议先补齐近期输入。' : 'Client memory needs a refresh before reuse.'
                      : isZh ? '关系信号稳定，可直接进入项目推进。' : 'Relationship signals look stable.'}
                  </div>
                </button>
              )) : (
                <div className="md:col-span-2 xl:col-span-4">
                  <EmptyBlock>{isZh ? '暂无活跃客户。可以先从项目或客户档案开始补充。' : 'No active clients yet. Start from projects or client profiles.'}</EmptyBlock>
                </div>
              )}
            </div>
          </section>

          <main className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
            <section className={panelClass}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5 sm:py-4">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-slate-700" />
                  <h2 className="font-semibold text-slate-950">{isZh ? '判断队列' : 'Judgement queue'}</h2>
                </div>
                <button onClick={() => navigate('/projects')} className="text-xs font-medium text-primary hover:underline">
                  {isZh ? '项目总览' : 'Projects'}
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {judgementQueue.length ? judgementQueue.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => navigate(item.path)}
                    className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 sm:items-center sm:gap-4 sm:px-5"
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full sm:mt-0 ${item.tone === 'rose' ? 'bg-rose-500' : item.tone === 'amber' ? 'bg-amber-500' : 'bg-primary'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="line-clamp-2 text-sm font-semibold text-slate-900 sm:line-clamp-1">{item.title}</span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{item.label}</span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500">{item.meta}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                )) : (
                  <div className="p-4">
                    <EmptyBlock>{isZh ? '今天没有明显阻塞项，可以从最近对话继续推进。' : 'No obvious blockers today. Continue from recent chats.'}</EmptyBlock>
                  </div>
                )}
              </div>
            </section>

            <aside className="flex min-w-0 flex-col gap-4">
              <section className={panelClass}>
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <h2 className="font-semibold text-slate-950">{isZh ? '干系人观察' : 'Stakeholder watch'}</h2>
                  <span className="text-xs text-slate-400">{stakeholderWatch.length}</span>
                </div>
                <div className="space-y-1 p-3">
                  {stakeholderWatch.length ? stakeholderWatch.map((client) => (
                    <button key={client.id} onClick={() => navigate(`/clients/${client.id}`)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50">
                      <Users className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{client.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {client.project_names.length} {isZh ? '个项目' : 'projects'} · {client.client_memory_stale || (client.client_memory_version ?? 0) === 0 ? (isZh ? '待对齐' : 'Needs alignment') : (isZh ? '稳定' : 'Stable')}
                        </span>
                      </span>
                    </button>
                  )) : (
                    <EmptyBlock>{isZh ? '暂无客户关系记录。' : 'No client relationship records.'}</EmptyBlock>
                  )}
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
                    <button key={conversation.id} onClick={() => navigate(conversation.project_id ? `/projects/${conversation.project_id}/chat` : '/chat')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50">
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
                    { icon: ListTodo, label: isZh ? '待办' : 'Todos', path: '/projects' },
                    { icon: Sparkles, label: isZh ? '技能' : 'Skills', path: '/skills' },
                  ].map((item) => (
                    <button key={item.label} onClick={() => navigate(item.path)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:justify-start">
                      <item.icon className="h-4 w-4 text-primary" />
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                  {isZh ? `${skills.length} 个技能可用 · ${memoryHealth.projectNeedWork + memoryHealth.clientNeedWork} 项记忆待处理` : `${skills.length} skills · ${memoryHealth.projectNeedWork + memoryHealth.clientNeedWork} memory items`}
                </div>
              </section>
            </aside>
          </main>
        </div>
      </div>
    </>
  )
}
