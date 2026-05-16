import { useNavigate } from 'react-router-dom'
import { ChevronDown, ListFilter, RefreshCw, Sparkles } from 'lucide-react'

import type { MyProjectTodo } from '../types/api'
import { formatDateOnly, getResolvedAppTimeZone } from '../utils/timezone'

export type BriefTone = 'red' | 'amber' | 'green'

export interface BriefItem {
  key: string
  tone: BriefTone
  pinLabel?: string
  title: string
  source: string
  linkPath: string
  actionLabel: string
  actionStrong?: boolean
}

export interface DailyBrief {
  actionRequired: BriefItem[]
  clientActivity: BriefItem[]
  quietWatch: BriefItem[]
  totalSignals: number
}

export interface BriefProjectInput {
  id: number
  name: string
  client: string
  status: string
  updated_at: string
  memory_stale?: boolean
  memory_version?: number
}

export interface BriefClientInput {
  id: number
  name: string
  industry: string
  project_names: string[]
  client_memory_stale?: boolean
  client_memory_version?: number
  client_memory_updated_at?: string | null
}

const ONE_DAY = 24 * 60 * 60 * 1000

function formatRelative(updatedAt: string, isZh: boolean): string {
  const hoursAgo = Math.max(1, Math.floor((Date.now() - new Date(updatedAt).getTime()) / (60 * 60 * 1000)))
  if (hoursAgo < 24) {
    return isZh ? `${hoursAgo} 小时前` : `${hoursAgo}h ago`
  }
  const days = Math.floor(hoursAgo / 24)
  return isZh ? `${days} 天前` : `${days}d ago`
}

export function buildDailyBrief({
  projects,
  todos,
  clients,
  isZh,
}: {
  projects: BriefProjectInput[]
  todos: MyProjectTodo[]
  clients: BriefClientInput[]
  isZh: boolean
}): DailyBrief {
  const now = Date.now()

  const overdueTodos = todos.filter((t) => t.due_date && new Date(t.due_date).getTime() < now)
  const todayTodos = todos.filter((t) => {
    if (!t.due_date) return false
    const due = new Date(t.due_date).getTime()
    return due >= now && due <= now + ONE_DAY
  })

  const recentlyMovedProjects = [...projects]
    .filter((p) => p.status !== 'archived')
    .filter((p) => now - new Date(p.updated_at).getTime() <= 3 * ONE_DAY)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  const staleMemoryClients = clients.filter(
    (c) => c.project_names.length > 0 && (c.client_memory_stale || (c.client_memory_version ?? 0) === 0),
  )

  const longSilentClients = clients
    .filter((c) => c.project_names.length > 0 && c.client_memory_updated_at)
    .filter((c) => now - new Date(c.client_memory_updated_at!).getTime() >= 14 * ONE_DAY)
    .sort((a, b) => new Date(a.client_memory_updated_at!).getTime() - new Date(b.client_memory_updated_at!).getTime())

  const actionRequired: BriefItem[] = []

  overdueTodos.slice(0, 3).forEach((todo) => {
    const dueLabel = todo.due_date
      ? ` ${formatDateOnly(todo.due_date, { month: '2-digit', day: '2-digit' }, getResolvedAppTimeZone())}`
      : ''
    actionRequired.push({
      key: `overdue-${todo.id}`,
      tone: 'red',
      title: todo.content,
      source: isZh ? `${todo.project_name} · 逾期${dueLabel}` : `${todo.project_name} · Overdue${dueLabel}`,
      linkPath: `/projects/${todo.project_id}/todos`,
      actionLabel: isZh ? '处理 →' : 'Handle →',
      actionStrong: true,
    })
  })

  todayTodos.slice(0, Math.max(0, 4 - actionRequired.length)).forEach((todo) => {
    actionRequired.push({
      key: `today-${todo.id}`,
      tone: 'red',
      title: todo.content,
      source: isZh ? `${todo.project_name} · 今天到期` : `${todo.project_name} · Due today`,
      linkPath: `/projects/${todo.project_id}/todos`,
      actionLabel: isZh ? '处理 →' : 'Handle →',
      actionStrong: true,
    })
  })

  const clientActivity: BriefItem[] = []

  recentlyMovedProjects.slice(0, 3).forEach((project) => {
    const isMemoryStale = project.memory_stale || (project.memory_version ?? 0) === 0
    const relative = formatRelative(project.updated_at, isZh)
    clientActivity.push({
      key: `recent-${project.id}`,
      tone: 'amber',
      title: isMemoryStale
        ? isZh
          ? `${project.name} 最近有动作但项目记忆未更新 — 建议刷新`
          : `${project.name} has recent activity but memory is stale — refresh`
        : isZh
          ? `${project.name} ${relative}有更新`
          : `${project.name} updated ${relative}`,
      source: isZh
        ? `${project.client || '未填写客户'}${isMemoryStale ? ' · 记忆滞后' : ''}`
        : `${project.client || 'No client'}${isMemoryStale ? ' · Memory stale' : ''}`,
      linkPath: isMemoryStale ? `/projects/${project.id}/memory` : `/projects/${project.id}`,
      actionLabel: isMemoryStale
        ? isZh
          ? '刷新记忆 →'
          : 'Refresh →'
        : isZh
          ? '打开项目 →'
          : 'Open →',
      actionStrong: isMemoryStale,
    })
  })

  const quietWatch: BriefItem[] = []

  longSilentClients.slice(0, 2).forEach((client) => {
    const daysAgo = Math.floor((now - new Date(client.client_memory_updated_at!).getTime()) / ONE_DAY)
    quietWatch.push({
      key: `silent-${client.id}`,
      tone: 'green',
      title: isZh
        ? `${client.name} ${daysAgo} 天无新输入 — 关系信号正在变冷`
        : `${client.name} silent for ${daysAgo} days — relationship cooling`,
      source: isZh
        ? `${client.industry || '行业未填'} · ${client.project_names.length} 个进行中项目`
        : `${client.industry || 'No industry'} · ${client.project_names.length} active projects`,
      linkPath: `/clients/${client.id}`,
      actionLabel: isZh ? '查看客户' : 'Open client',
    })
  })

  staleMemoryClients
    .filter((c) => !longSilentClients.some((s) => s.id === c.id))
    .slice(0, Math.max(0, 3 - quietWatch.length))
    .forEach((client) => {
      quietWatch.push({
        key: `stale-${client.id}`,
        tone: 'green',
        title: isZh
          ? `${client.name} 客户记忆已滞后 — AI 建议刷新`
          : `${client.name} client memory is stale — refresh suggested`,
        source: isZh
          ? `${client.industry || '行业未填'} · ${client.project_names.length} 个进行中项目`
          : `${client.industry || 'No industry'} · ${client.project_names.length} active projects`,
        linkPath: `/clients/${client.id}/memory`,
        actionLabel: isZh ? '刷新' : 'Refresh',
      })
    })

  return {
    actionRequired,
    clientActivity,
    quietWatch,
    totalSignals: actionRequired.length + clientActivity.length + quietWatch.length,
  }
}

const sectionStyles: Record<BriefTone, { dot: string; label: string }> = {
  red: { dot: 'bg-rose-500', label: 'text-rose-600' },
  amber: { dot: 'bg-amber-500', label: 'text-amber-600' },
  green: { dot: 'bg-emerald-500', label: 'text-emerald-600' },
}

interface DailyBriefHeroProps {
  brief: DailyBrief
  totalAvailable: number
  isZh: boolean
  loading?: boolean
  onRefresh: () => void
}

export function DailyBriefHero({ brief, totalAvailable, isZh, loading, onRefresh }: DailyBriefHeroProps) {
  const navigate = useNavigate()
  const shown = brief.actionRequired.length + brief.clientActivity.length + brief.quietWatch.length
  const remaining = Math.max(0, totalAvailable - shown)

  const renderSection = (label: string, tone: BriefTone, items: BriefItem[]) => {
    if (items.length === 0) return null
    const styles = sectionStyles[tone]
    return (
      <div>
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
          <span className={`text-xs font-bold tracking-wide ${styles.label}`}>{label}</span>
          <span className="text-xs font-medium text-slate-500">{items.length}</span>
        </div>
        <div>
          {items.map((item, idx) => (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.linkPath)}
              className={`flex w-full items-center gap-4 px-5 py-2.5 text-left transition hover:bg-slate-50 ${
                idx < items.length - 1 ? 'border-b border-slate-100' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div
                  className={`flex flex-wrap items-center gap-2 text-sm ${
                    tone === 'green' ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'
                  }`}
                >
                  {item.pinLabel ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      {item.pinLabel}
                    </span>
                  ) : null}
                  <span className="line-clamp-1">{item.title}</span>
                </div>
                {item.source ? (
                  <div className={`mt-1 line-clamp-1 text-xs ${tone === 'green' ? 'text-slate-400' : 'text-slate-500'}`}>
                    {item.source}
                  </div>
                ) : null}
              </div>
              <span
                className={`shrink-0 text-xs font-medium ${
                  item.actionStrong ? 'text-primary' : tone === 'green' ? 'text-slate-500' : 'text-primary/80'
                }`}
              >
                {item.actionLabel}
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate text-base font-bold text-slate-900">
              {isZh ? '今天的客户关系简报' : 'Your client relationship brief'}
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {isZh
                ? `AriaAI 综合 ${totalAvailable} 条客户信号 · ${loading ? '生成中…' : '刚刚更新'}`
                : `AriaAI summarized ${totalAvailable} signals · ${loading ? 'generating…' : 'just updated'}`}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
          >
            <ListFilter className="h-3 w-3" />
            {isZh ? '全部客户' : 'All clients'}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {isZh ? '重新生成' : 'Refresh'}
          </button>
        </div>
      </header>
      <div className="border-t border-slate-100" />

      {brief.totalSignals === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">
          {isZh
            ? '今天没有需要处理的客户信号。AriaAI 会在出现新动态时第一时间提示你。'
            : 'No client signals today. AriaAI will surface new activity here.'}
        </div>
      ) : (
        <>
          {renderSection(isZh ? '需要立即处理' : 'Action required', 'red', brief.actionRequired)}
          {renderSection(isZh ? '客户动态' : 'Client activity', 'amber', brief.clientActivity)}
          {renderSection(isZh ? '安静观察' : 'Quiet watch', 'green', brief.quietWatch)}

          {remaining > 0 ? (
            <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
              <div className="text-xs text-slate-500">
                {isZh
                  ? `已显示 ${shown} 条 · 余下 ${remaining} 条信号已折叠`
                  : `Showing ${shown} · ${remaining} more collapsed`}
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {isZh ? `查看全部 ${totalAvailable} 条` : `View all ${totalAvailable}`}
                <ChevronDown className="h-3 w-3" />
              </button>
            </footer>
          ) : null}
        </>
      )}
    </section>
  )
}
