import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowRight,
  Brain,
  Building2,
  FolderKanban,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Users,
  Wallet,
  ListTodo,
  Clock3,
  ChevronRight,
  Circle,
} from 'lucide-react'
import type { AxiosError } from 'axios'
import { api } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import type { Conversation, MyProjectTodo, Project, Skill, User } from '../types/api'

interface ErrorResponsePayload {
  detail?: string
}

function formatCurrency(value: number) {
  if (!value) return '¥0'
  if (value >= 1_000_000) return `¥${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `¥${(value / 10_000).toFixed(1)}万`
  return `¥${value.toLocaleString()}`
}

function formatRelativeTime(value?: string | null, isZh = true) {
  if (!value) return isZh ? '暂无记录' : 'No activity yet'
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

      const [currentUser, allProjects, allSkills, allConversations, todos] = await Promise.all([
        api.get<User>('/auth/me'),
        api.get<Project[]>('/projects'),
        api.get<Skill[]>('/skills'),
        api.get<Conversation[]>('/chat/conversations'),
        api.get<MyProjectTodo[]>('/projects/todos/my'),
      ])

      setUser(currentUser)
      setProjects(allProjects)
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
            : `Failed to load dashboard: ${apiError.response?.data?.detail || apiError.message}`,
      )
    } finally {
      setLoading(false)
    }
  }

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status !== 'archived'),
    [projects],
  )

  const contractValue = useMemo(
    () => activeProjects.reduce((sum, project) => sum + (project.contract_amount || 0), 0),
    [activeProjects],
  )

  const stageSummary = useMemo(() => {
    const groups = [
      { key: 'lead', label: isZh ? '线索阶段' : 'Lead', statuses: ['lead'] },
      { key: 'opportunity', label: isZh ? '商机阶段' : 'Opportunity', statuses: ['opportunity'] },
      { key: 'won', label: isZh ? '已签约' : 'Won', statuses: ['won'] },
      { key: 'delivering', label: isZh ? '交付中' : 'Delivering', statuses: ['delivering'] },
      { key: 'archived', label: isZh ? '已归档' : 'Archived', statuses: ['archived'] },
    ]
    return groups.map((group) => ({
      ...group,
      count: projects.filter((project) => group.statuses.includes(project.status)).length,
    }))
  }, [projects, isZh])

  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 6),
    [projects],
  )

  const recentConversations = useMemo(
    () =>
      [...conversations]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 5),
    [conversations],
  )

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
          <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-indigo-600 to-indigo-700 p-8 text-white shadow-sm">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <p className="mb-2 text-sm text-white/80">{greeting}</p>
                <h1 className="mb-3 text-3xl font-bold tracking-tight">
                  {user?.display_name || (isZh ? '欢迎回来' : 'Welcome back')}
                </h1>
                <p className="max-w-xl text-sm leading-6 text-white/85">
                  {isZh
                    ? '这里是你今天的项目工作台：先看待办、项目节奏和最近对话，再决定要推进哪个项目、更新哪份记忆。'
                    : 'This is your workspace for today: review todos, project momentum, and recent conversations before deciding what to move next.'}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => navigate('/chat')}
                  className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-left text-primary transition hover:bg-white/95"
                >
                  <div>
                    <div className="text-sm font-semibold">{isZh ? '开始新对话' : 'Start a chat'}</div>
                    <div className="mt-1 text-xs text-primary/70">{isZh ? '进入 AI 工作台' : 'Open the AI workspace'}</div>
                  </div>
                  <Sparkles className="h-4 w-4" />
                </button>
                <button
                  onClick={() => navigate('/projects/new')}
                  className="flex items-center justify-between rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-left transition hover:bg-white/15"
                >
                  <div>
                    <div className="text-sm font-semibold">{isZh ? '新建项目' : 'Create project'}</div>
                    <div className="mt-1 text-xs text-white/70">{isZh ? '建立新的交付空间' : 'Open a new delivery workspace'}</div>
                  </div>
                  <FolderKanban className="h-4 w-4" />
                </button>
                <button
                  onClick={() => navigate('/settings/memory')}
                  className="flex items-center justify-between rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-left transition hover:bg-white/15"
                >
                  <div>
                    <div className="text-sm font-semibold">{isZh ? '项目记忆管理' : 'Project memory'}</div>
                    <div className="mt-1 text-xs text-white/70">{isZh ? '检查项目记忆和摘要缓存' : 'Review project memory and summary cache'}</div>
                  </div>
                  <Brain className="h-4 w-4" />
                </button>
                <button
                  onClick={() => navigate('/settings/client-memory')}
                  className="flex items-center justify-between rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-left transition hover:bg-white/15"
                >
                  <div>
                    <div className="text-sm font-semibold">{isZh ? '客户记忆管理' : 'Client memory'}</div>
                    <div className="mt-1 text-xs text-white/70">{isZh ? '集中查看跨项目客户经验' : 'Review cross-project client memory'}</div>
                  </div>
                  <Users className="h-4 w-4" />
                </button>
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
                label: isZh ? '合同总额' : 'Contract value',
                value: formatCurrency(contractValue),
                sub: isZh ? '按未归档项目统计' : 'Across non-archived projects',
                icon: Wallet,
              },
              {
                label: isZh ? '我的待办' : 'My todos',
                value: myTodos.length,
                sub: isZh ? '优先看今天要推进的事情' : 'Focus on what to move today',
                icon: ListTodo,
              },
              {
                label: isZh ? '近期对话' : 'Recent chats',
                value: conversations.length,
                sub: recentConversations[0]
                  ? isZh
                    ? `最近更新 ${formatRelativeTime(recentConversations[0].updated_at, true)}`
                    : `Last updated ${formatRelativeTime(recentConversations[0].updated_at, false)}`
                  : isZh
                    ? '还没有历史对话'
                    : 'No recent chats',
                icon: MessageSquare,
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

          <section className="grid gap-6 xl:grid-cols-[1.1fr_1fr_1fr]">
            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-on-surface">{isZh ? '我的待办' : 'My todos'}</h2>
                  <p className="mt-1 text-sm text-on-surface-muted">
                    {isZh ? '先把今天真正要推进的动作拉出来。' : 'Pull forward the actions that matter today.'}
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

              <div className="space-y-3">
                {myTodos.length === 0 ? (
                  <div className="rounded-2xl bg-surface-container-low px-4 py-6 text-center text-sm text-on-surface-muted">
                    {isZh ? '目前没有分配给你的项目待办。' : 'No project todos are assigned to you right now.'}
                  </div>
                ) : (
                  myTodos.slice(0, 6).map((todo) => (
                    <button
                      key={todo.id}
                      onClick={() => navigate(`/projects/${todo.project_id}/todos`)}
                      className="flex w-full items-start gap-3 rounded-2xl border border-outline px-4 py-3 text-left transition hover:bg-surface-container-low"
                    >
                      <Circle className="mt-1 h-3 w-3 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-on-surface">{todo.content}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-on-surface-muted">
                          <span>{todo.project_name}</span>
                          {todo.due_date ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3 w-3" />
                              {todo.due_date}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-on-surface-muted" />
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-on-surface">{isZh ? '项目阶段分布' : 'Pipeline overview'}</h2>
                <p className="mt-1 text-sm text-on-surface-muted">
                  {isZh ? '快速判断当前团队的项目节奏。' : 'A quick look at the current project mix.'}
                </p>
              </div>

              <div className="space-y-3">
                {stageSummary.map((item) => (
                  <div key={item.key} className="rounded-2xl bg-surface-container-low px-4 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-on-surface">{item.label}</span>
                      <span className="text-on-surface-muted">{item.count}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-container-high">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${projects.length > 0 ? (item.count / projects.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-dashed border-outline px-4 py-4 text-sm text-on-surface-muted">
                {isZh
                  ? `当前共有 ${projects.length} 个项目，活跃项目 ${activeProjects.length} 个。`
                  : `${projects.length} total projects, ${activeProjects.length} active.`}
              </div>
            </div>

            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-on-surface">{isZh ? '最近更新' : 'Recently active'}</h2>
                <p className="mt-1 text-sm text-on-surface-muted">
                  {isZh ? '从最近的项目和对话里恢复上下文。' : 'Recover context from the latest project activity.'}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                    {isZh ? '项目' : 'Projects'}
                  </div>
                  <div className="space-y-2">
                    {recentProjects.length === 0 ? (
                      <div className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-muted">
                        {isZh ? '还没有项目。' : 'No projects yet.'}
                      </div>
                    ) : (
                      recentProjects.slice(0, 4).map((project) => (
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
                          <div className="ml-3 text-xs text-on-surface-muted">
                            {formatRelativeTime(project.updated_at, isZh)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                    {isZh ? '对话' : 'Chats'}
                  </div>
                  <div className="space-y-2">
                    {recentConversations.length === 0 ? (
                      <div className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-muted">
                        {isZh ? '还没有对话。' : 'No conversations yet.'}
                      </div>
                    ) : (
                      recentConversations.map((conversation) => (
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
                                ? isZh
                                  ? `关联项目 #${conversation.project_id}`
                                  : `Project #${conversation.project_id}`
                                : isZh
                                  ? '通用工作台'
                                  : 'General workspace'}
                            </div>
                          </div>
                          <div className="ml-3 text-xs text-on-surface-muted">
                            {formatRelativeTime(conversation.updated_at, isZh)}
                          </div>
                        </button>
                      ))
                    )}
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
                {activeProjects
                  .filter((project) => (project.contract_amount || 0) > 0)
                  .sort((a, b) => (b.contract_amount || 0) - (a.contract_amount || 0))
                  .slice(0, 5)
                  .map((project) => {
                    const maxValue = activeProjects.reduce((max, item) => Math.max(max, item.contract_amount || 0), 1)
                    return (
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
                            {formatCurrency(project.contract_amount || 0)}
                          </div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-high">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${((project.contract_amount || 0) / maxValue) * 100}%` }}
                          />
                        </div>
                      </button>
                    )
                  })}
              </div>
            </div>

            <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-on-surface">{isZh ? '工作台入口' : 'Workspace shortcuts'}</h2>
                <p className="mt-1 text-sm text-on-surface-muted">
                  {isZh ? '把最常打开的管理页放到首页。' : 'Keep the most-used management views close at hand.'}
                </p>
              </div>

              <div className="space-y-3">
                {[
                  {
                    title: isZh ? '项目列表' : 'Projects',
                    subtitle: isZh ? '查看项目节奏、阶段和合同分布' : 'Review active work and pipeline stages',
                    icon: FolderKanban,
                    onClick: () => navigate('/projects'),
                  },
                  {
                    title: isZh ? '项目记忆管理' : 'Project Memory Manager',
                    subtitle: isZh ? '统一刷新项目记忆、摘要缓存和后台任务' : 'Refresh project memory, caches, and queued jobs',
                    icon: Brain,
                    onClick: () => navigate('/settings/memory'),
                  },
                  {
                    title: isZh ? '客户记忆管理' : 'Client Memory Manager',
                    subtitle: isZh ? '查看客户长期经验和跨项目沉淀' : 'Manage long-term client knowledge across projects',
                    icon: Users,
                    onClick: () => navigate('/settings/client-memory'),
                  },
                  {
                    title: isZh ? '技能库' : 'Skills',
                    subtitle: isZh ? '查看可用技能和工作流模板' : 'Browse reusable skills and workflows',
                    icon: Sparkles,
                    onClick: () => navigate('/skills'),
                  },
                  {
                    title: isZh ? '客户列表' : 'Clients',
                    subtitle: isZh ? '维护客户档案与项目关系' : 'Maintain client records and relationships',
                    icon: Building2,
                    onClick: () => navigate('/clients'),
                  },
                ].map((item) => (
                  <button
                    key={item.title}
                    onClick={item.onClick}
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

              <div className="mt-5 rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-muted">
                {isZh
                  ? `当前共有 ${skills.length} 个技能可用，最近 ${conversations.length} 条对话可以继续。`
                  : `${skills.length} skills are available and ${conversations.length} chats can be continued.`}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
