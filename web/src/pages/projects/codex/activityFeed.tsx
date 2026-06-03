import type {
  Milestone,
  Project,
  ProjectFile,
  ProjectProgressUpdate,
  ProjectTodo,
} from '../../../types/api'

/** Synthesise a "最近动态" feed from data the project detail endpoint
 * already returns. The backend doesn't expose an activity-log
 * endpoint yet, but milestones / files / todos / memory_updated_at
 * carry enough timestamps to reconstruct what changed.
 *
 * Each event has a tone tag (accent / good / warn / neutral) so the
 * timeline color-codes like the design handoff. Used by the Overview
 * tab's compact feed and by the Milestones (活动) tab's expanded
 * left column. */

export type FeedTone = 'accent' | 'good' | 'warn' | 'neutral'

export interface FeedEvent {
  id: string
  ts: Date
  tone: FeedTone
  who: string
  what: string
  href?: string
  /** Category badge for the expanded view ("文档" / "里程碑" / etc.). */
  category: '进展' | '记忆' | '里程碑' | '待办' | '文档' | '档案'
}

interface SynthInput {
  project: Project
  milestones: Milestone[]
  files: ProjectFile[]
  todos: ProjectTodo[]
  progressUpdates?: ProjectProgressUpdate[]
  projectId: number
  /** Max events to keep. Default 30 — Overview consumer slices
   * further. */
  limit?: number
}

export function synthesizeActivityFeed({
  project,
  milestones,
  files,
  todos,
  progressUpdates = [],
  projectId,
  limit = 30,
}: SynthInput): FeedEvent[] {
  const out: FeedEvent[] = []

  for (const update of progressUpdates) {
    const ts = parseIsoDate(update.created_at)
    if (!ts) continue
    const pieces = [update.content]
    if (update.next_step) pieces.push(`下一步: ${update.next_step}`)
    if (update.risk) pieces.push(`风险: ${update.risk}`)
    out.push({
      id: `progress:${update.id}`,
      ts,
      tone: update.risk ? 'warn' : 'accent',
      who: update.created_by?.display_name ?? '—',
      what: truncateText(pieces.join(' · '), 90),
      href: `/projects/${projectId}/milestones`,
      category: '进展',
    })
  }

  // Memory rebuilds — memory_updated_at marks the last time the
  // structured memory changed (manual edit or LLM rebuild).
  const memTs = parseIsoDate(project.memory_updated_at)
  if (memTs) {
    out.push({
      id: `memory:${memTs.getTime()}`,
      ts: memTs,
      tone: 'accent',
      who: 'Aria',
      what: `项目记忆 v${project.memory_version ?? '—'} 已${
        project.memory_stale ? '需刷新' : '更新'
      }`,
      href: `/projects/${projectId}/memory`,
      category: '记忆',
    })
  }

  // Milestones — created and completed events.
  for (const m of milestones) {
    const created = parseIsoDate(m.created_at)
    if (created) {
      out.push({
        id: `milestone-added:${m.id}`,
        ts: created,
        tone: 'neutral',
        who: '—',
        what: `添加里程碑「${m.title}」`,
        href: `/projects/${projectId}/milestones`,
        category: '里程碑',
      })
    }
    if (m.is_done) {
      const done = parseIsoDate(m.due_date)
      if (done) {
        out.push({
          id: `milestone-done:${m.id}`,
          ts: done,
          tone: 'good',
          who: '—',
          what: `完成里程碑「${m.title}」`,
          href: `/projects/${projectId}/milestones`,
          category: '里程碑',
        })
      }
    }
  }

  // File uploads.
  for (const f of files) {
    if (f.deleted_at) continue
    const ts = parseIsoDate(f.uploaded_at)
    if (!ts) continue
    out.push({
      id: `file:${f.id}`,
      ts,
      tone: 'neutral',
      who: '—',
      what: `上传文档「${f.name}」${
        f.summary ? ` · ${truncateText(f.summary, 40)}` : ''
      }`,
      href: `/projects/${projectId}/docs`,
      category: '文档',
    })
  }

  // Todos — added and completed.
  for (const t of todos) {
    const created = parseIsoDate(t.created_at)
    if (created) {
      out.push({
        id: `todo-added:${t.id}`,
        ts: created,
        tone: 'neutral',
        who: t.assigned_user?.display_name ?? '—',
        what: `添加待办「${truncateText(t.content, 36)}」`,
        href: `/projects/${projectId}/milestones`,
        category: '待办',
      })
    }
    if (t.is_done) {
      const done = parseIsoDate(t.updated_at)
      if (done) {
        out.push({
          id: `todo-done:${t.id}`,
          ts: done,
          tone: 'good',
          who: t.assigned_user?.display_name ?? '—',
          what: `完成待办「${truncateText(t.content, 36)}」`,
          href: `/projects/${projectId}/milestones`,
          category: '待办',
        })
      }
    }
  }

  // Last project edit signal — lowest priority.
  const projUpdated = parseIsoDate(project.updated_at)
  if (projUpdated) {
    out.push({
      id: `project-updated:${projUpdated.getTime()}`,
      ts: projUpdated,
      tone: 'neutral',
      who: '—',
      what: '项目档案有更新',
      category: '档案',
    })
  }

  // Dedupe by id + sort newest-first + cap.
  const seen = new Set<string>()
  return out
    .filter((e) => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())
    .slice(0, limit)
}

export function formatFeedTime(d: Date): string {
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const day = 86_400_000
  const sameDay =
    now.getFullYear() === d.getFullYear() &&
    now.getMonth() === d.getMonth() &&
    now.getDate() === d.getDate()
  if (sameDay) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) {
    const days = Math.floor(diff / day)
    return `${days} 天前`
  }
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function feedToneColor(tone: FeedTone): string {
  switch (tone) {
    case 'accent':
      return 'var(--accent)'
    case 'good':
      return 'var(--good)'
    case 'warn':
      return 'var(--warn)'
    default:
      return 'var(--ink-faint)'
  }
}

/** Group events by day for the expanded timeline. Keys are
 * "今天" / "昨天" / "YYYY-MM-DD" so the grouping survives the
 * timezone gap between fresh same-day events and older entries. */
export interface FeedDayGroup {
  label: string
  events: FeedEvent[]
}

export function groupFeedByDay(events: FeedEvent[]): FeedDayGroup[] {
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  const startOfYesterday = startOfToday - 86_400_000

  const groups = new Map<string, FeedEvent[]>()
  for (const ev of events) {
    let key: string
    const ts = ev.ts.getTime()
    if (ts >= startOfToday) {
      key = '今天'
    } else if (ts >= startOfYesterday) {
      key = '昨天'
    } else {
      key = ev.ts.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    }
    const list = groups.get(key)
    if (list) {
      list.push(ev)
    } else {
      groups.set(key, [ev])
    }
  }
  return Array.from(groups.entries()).map(([label, events]) => ({ label, events }))
}

function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : `${iso}Z`
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}
