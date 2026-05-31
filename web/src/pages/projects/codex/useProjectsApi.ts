import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import type { Project, ProjectDetail as ProjectDetailType } from '../../../types/api'

/** Thin wrapper around the projects endpoints — used by the codex
 * redesign pages. We keep these isolated from the legacy
 * `useProjectDetailData` so the new pages can evolve without dragging
 * the old kanban/phase logic along.
 */

interface ListState {
  data: Project[] | null
  loading: boolean
  error: string | null
}

interface DetailState {
  data: ProjectDetailType | null
  loading: boolean
  error: string | null
}

function readError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '加载失败'
}

export function useProjectsList(): ListState {
  const [state, setState] = useState<ListState>({ data: null, loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    api
      .get<Project[]>('/projects')
      .then((data) => {
        if (cancelled) return
        setState({ data, loading: false, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        setState({ data: null, loading: false, error: readError(err) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

export function useProjectDetail(projectId: number | null): DetailState {
  const [state, setState] = useState<DetailState>({ data: null, loading: true, error: null })

  useEffect(() => {
    if (projectId == null || Number.isNaN(projectId)) {
      setState({ data: null, loading: false, error: '项目 id 无效' })
      return
    }
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    api
      .get<ProjectDetailType>(`/projects/${projectId}/detail`)
      .then((data) => {
        if (cancelled) return
        setState({ data, loading: false, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        setState({ data: null, loading: false, error: readError(err) })
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  return state
}

/** Friendly status label for top-bar chip. */
export const STATUS_LABEL: Record<Project['status'], string> = {
  lead: '线索期',
  opportunity: '机会期',
  won: '已签约',
  delivering: '交付中',
  archived: '已归档',
}

export const STATUS_TONE: Record<Project['status'], 'mute' | 'warn' | 'good' | 'accent' | 'neutral'> = {
  lead: 'mute',
  opportunity: 'warn',
  won: 'good',
  delivering: 'accent',
  archived: 'neutral',
}

/** Format a contract_amount (yuan) as "¥N万" / "—". */
export function formatAmountWan(amount: number | null | undefined): string {
  if (!amount || amount <= 0) return '—'
  const wan = Math.round(amount / 10000)
  return `¥${wan}万`
}

/** Relative-time helper for `updated_at`. Coarse — month-ish accuracy
 * is enough for the project rows. */
export function formatUpdatedRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : `${iso}Z`
  const t = new Date(normalized).getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} 天前`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w} 周前`
  return new Date(normalized).toLocaleDateString('zh-CN')
}

/** First glyph of a string, used for avatar tiles. */
export function firstGlyph(name: string | null | undefined): string {
  if (!name) return '—'
  return name.trim().slice(0, 1) || '—'
}
