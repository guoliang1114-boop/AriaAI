import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  CalendarClock,
  FolderKanban,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react'
import type { AxiosError } from 'axios'
import { api } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import type { Conversation, SkillSummary } from '../types/api'
import { resolveProjectStage } from '../types/enums'
import { formatDateOnly, getResolvedAppTimeZone } from '../utils/timezone'

interface DashboardProjectSummary {
  id: number
  name: string
  client: string
  status: string
  contract_amount?: number
  updated_at: string
  memory_stale?: boolean
  memory_version?: number
}

const panelClass = 'rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_18px_48px_-38px_rgba(15,23,42,0.28)] backdrop-blur'

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

function StatusBadge({ status, isZh }: { status: string; isZh: boolean }) {
  const toneMap: Record<string, string> = {
    lead: 'bg-slate-50 text-slate-600 border-slate-200',
    opportunity: 'bg-amber-50 text-amber-700 border-amber-200',
    won: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    delivering: 'bg-sky-50 text-sky-700 border-sky-200',
    archived: 'bg-slate-100 text-slate-500 border-slate-200',
  }
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneMap[status] || toneMap.lead}`}>
      {getStageLabel(status, isZh)}
    </span>
  )
}

function MemoryIndicator({ stale, version }: { stale?: boolean; version?: number }) {
  const isFresh = !stale && (version ?? 0) > 0
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${isFresh ? 'text-emerald-600' : 'text-amber-600'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isFresh ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {isFresh ? 'v' + version : 'stale'}
    </span>
  )
}

export function Workspace() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<DashboardProjectSummary[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])

  useEffect(() => {
    void loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      const [allProjects, allConversations, allSkills] = await Promise.all([
        api.get<DashboardProjectSummary[]>('/projects/meta/dashboard-summary'),
        api.get<Conversation[]>('/chat/conversations'),
        api.get<SkillSummary[]>('/skills/meta/summary'),
      ])
      setProjects(allProjects)
      setConversations(allConversations)
      setSkills(allSkills)
    } catch (err) {
      const apiError = err as AxiosError
      setError(
        !apiError.response
          ? isZh ? '无法连接到服务器' : 'Unable to reach the server'
          : isZh ? '加载工作台失败' : 'Failed to load workspace',
      )
    } finally {
      setLoading(false)
    }
  }

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status !== 'archived'),
    [projects],
  )

  const recentConversations = useMemo(
    () => [...conversations].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 5),
    [conversations],
  )

  const digitalStrategySkill = useMemo(
    () => skills.find((s) => s.name?.toLowerCase().includes('digital-strategy') || s.name?.includes('数字化战略')),
    [skills],
  )

  const handleSummarizeAll = () => {
    const q = isZh ? '帮我总结所有进行中的项目' : 'Summarize all active projects for me'
    navigate(`/chat?q=${encodeURIComponent(q)}`)
  }

  const handleDigitalStrategy = () => {
    if (digitalStrategySkill) {
      navigate(`/chat?skill=${digitalStrategySkill.id}`)
    } else {
      navigate('/chat?q=' + encodeURIComponent(isZh ? '进行一次数字化战略分析' : 'Run a digital strategy analysis'))
    }
  }

  const handlePreMeetingBrief = () => {
    const q = isZh ? '帮我准备会前简报' : 'Help me prepare a pre-meeting brief'
    navigate(`/chat?q=${encodeURIComponent(q)}`)
  }

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? '今日工作台' : 'Workspace'} />
        <div className="flex h-full items-center justify-center bg-slate-50">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <PageTitle title={isZh ? '今日工作台' : 'Workspace'} />
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-slate-50">
          <p className="text-sm text-slate-600">{error}</p>
          <button
            onClick={() => void loadData()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" />
            {isZh ? '重试' : 'Retry'}
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={isZh ? '今日工作台' : 'Workspace'} />
      <div className="h-full overflow-auto bg-[linear-gradient(180deg,#f5f9ff_0%,#f8fafc_46%,#f3fbf7_100%)]">
        <div className="flex w-full flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-5 lg:px-8 lg:py-6 2xl:px-10">

          {/* Header */}
          <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-4 shadow-[0_18px_48px_-42px_rgba(37,99,235,0.35)] backdrop-blur sm:px-5 lg:flex lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-[20px] font-semibold tracking-normal text-slate-950 sm:text-[22px]">
                {isZh ? '今日工作台' : "Today's Workspace"}
              </h1>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {isZh ? '快速访问你的项目、对话和常用技能。' : 'Quick access to your projects, conversations, and skills.'}
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2 sm:mt-0">
              <button
                onClick={() => void loadData()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {isZh ? '刷新' : 'Refresh'}
              </button>
              <button
                onClick={() => navigate('/chat')}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition hover:bg-primary/90"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {isZh ? '新建对话' : 'New chat'}
              </button>
            </div>
          </div>

          <main className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">

            {/* Left column */}
            <div className="flex flex-col gap-4">

              {/* Quick Actions */}
              <section className={panelClass}>
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3.5 sm:px-5">
                  <Zap className="h-4 w-4 text-slate-700" />
                  <h2 className="font-semibold text-slate-950">{isZh ? '快速操作' : 'Quick Actions'}</h2>
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
                  <button
                    onClick={handleDigitalStrategy}
                    className="group flex flex-col items-start gap-2 rounded-xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/60 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 transition group-hover:bg-indigo-200">
                      <Target className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{isZh ? '数字化战略分析' : 'Digital Strategy'}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{isZh ? '最常用技能 · 27 次' : 'Top skill · 27 uses'}</div>
                    </div>
                  </button>

                  <button
                    onClick={handleSummarizeAll}
                    className="group flex flex-col items-start gap-2 rounded-xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50/60 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 transition group-hover:bg-emerald-200">
                      <FolderKanban className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{isZh ? '总结所有项目' : 'Summarize Projects'}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{isZh ? '最高频问题 · 15 次' : 'Top question · 15 asks'}</div>
                    </div>
                  </button>

                  <button
                    onClick={handlePreMeetingBrief}
                    className="group flex flex-col items-start gap-2 rounded-xl border border-amber-100 bg-gradient-to-br from-white to-amber-50/60 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600 transition group-hover:bg-amber-200">
                      <CalendarClock className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{isZh ? '会前简报' : 'Pre-meeting Brief'}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{isZh ? '北极星功能' : 'North star feature'}</div>
                    </div>
                  </button>
                </div>
              </section>

              {/* Active Projects Summary */}
              <section className={panelClass}>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="h-4 w-4 text-slate-700" />
                    <h2 className="font-semibold text-slate-950">{isZh ? '进行中项目' : 'Active Projects'}</h2>
                    <span className="text-xs text-slate-400">({activeProjects.length})</span>
                  </div>
                  <button onClick={() => navigate('/projects')} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {isZh ? '查看全部' : 'View all'}
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {activeProjects.length ? activeProjects.slice(0, 6).map((project) => (
                    <button
                      key={project.id}
                      onClick={() => navigate(`/projects/${project.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 sm:items-center sm:gap-4 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="line-clamp-1 text-sm font-semibold text-slate-900">{project.name}</span>
                          <StatusBadge status={project.status} isZh={isZh} />
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                          <span>{project.client || (isZh ? '未填写客户' : 'No client')}</span>
                          <span className="text-slate-300">·</span>
                          <span>{formatRelativeTime(project.updated_at, isZh)}</span>
                          <span className="text-slate-300">·</span>
                          <MemoryIndicator stale={project.memory_stale} version={project.memory_version} />
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                    </button>
                  )) : (
                    <div className="px-4 py-6 text-center text-sm text-slate-500">
                      {isZh ? '暂无进行中的项目。' : 'No active projects.'}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Right column */}
            <aside className="flex min-w-0 flex-col gap-4">

              {/* Recent Conversations */}
              <section className={panelClass}>
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <h2 className="font-semibold text-slate-950">{isZh ? '最近对话' : 'Recent Chats'}</h2>
                  <button onClick={() => navigate('/chat')} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {isZh ? '全部' : 'All'}
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                <div className="space-y-1 p-3">
                  {recentConversations.length ? recentConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      onClick={() => navigate(conversation.project_id ? `/projects/${conversation.project_id}/chat` : '/chat')}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {conversation.title || (isZh ? '未命名对话' : 'Untitled chat')}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {formatRelativeTime(conversation.updated_at, isZh)}
                        </span>
                      </span>
                    </button>
                  )) : (
                    <div className="px-3 py-4 text-center text-sm text-slate-500">
                      {isZh ? '暂无最近对话。' : 'No recent chats.'}
                    </div>
                  )}
                </div>
              </section>

              {/* Upcoming Milestones (placeholder — data comes from project detail) */}
              <section className={panelClass}>
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                  <Sparkles className="h-4 w-4 text-slate-700" />
                  <h2 className="font-semibold text-slate-950">{isZh ? '即将到期' : 'Upcoming'}</h2>
                </div>
                <div className="px-4 py-5 text-center text-sm text-slate-500">
                  {isZh
                    ? '进入项目查看里程碑和待办事项。'
                    : 'Open a project to view milestones and todos.'}
                  <div className="mt-3">
                    <button
                      onClick={() => navigate('/projects')}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      {isZh ? '查看项目' : 'View projects'}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </section>
            </aside>
          </main>
        </div>
      </div>
    </>
  )
}
