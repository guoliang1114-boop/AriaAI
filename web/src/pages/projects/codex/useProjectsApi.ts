import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import type {
  ClientStakeholder,
  Conversation,
  Message,
  Project,
  ProjectDetail as ProjectDetailType,
  ProjectMeetingBriefing,
} from '../../../types/api'

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
  refetch: () => Promise<void>
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
  const [data, setData] = useState<ProjectDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOnce = useCallback(async () => {
    if (projectId == null || Number.isNaN(projectId)) {
      setData(null)
      setLoading(false)
      setError('项目 id 无效')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const fresh = await api.get<ProjectDetailType>(`/projects/${projectId}/detail`)
      setData(fresh)
      setError(null)
    } catch (err) {
      setError(readError(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await fetchOnce()
    })()
    return () => {
      cancelled = true
    }
  }, [fetchOnce])

  const refetch = useCallback(async () => {
    await fetchOnce()
  }, [fetchOnce])

  return { data, loading, error, refetch }
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

interface ClientStakeholdersState {
  matchedClientId: number | null
  matchedClientName: string | null
  stakeholders: ClientStakeholder[]
  loading: boolean
  /** A null error after loading still means "no matched client" — the
   * caller renders an empty state with guidance to link the client. */
  error: string | null
}

interface ClientListItem {
  id: number
  name: string
}

const normalizeClientName = (v: string) => v.trim().toLowerCase()

/** Conversations for a project — used by the project Chat tab. The
 * list is fetched once on mount; refetch() lets the new-conversation
 * CTA refresh after creating one. */
interface ConversationsState {
  data: Conversation[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useProjectConversations(projectId: number | null): ConversationsState {
  const [data, setData] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOnce = useCallback(async () => {
    if (projectId == null || Number.isNaN(projectId)) {
      setData([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await api.get<Conversation[]>(
        `/chat/conversations?project_id=${projectId}`,
      )
      setData(rows)
    } catch (err) {
      setError(readError(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void fetchOnce()
  }, [fetchOnce])

  const refetch = useCallback(async () => {
    await fetchOnce()
  }, [fetchOnce])

  return { data, loading, error, refetch }
}

interface MessagesState {
  data: Message[]
  loading: boolean
  error: string | null
}

export function useConversationMessages(conversationId: number | null): MessagesState {
  const [data, setData] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (conversationId == null) {
      setData([])
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get<Message[]>(`/chat/conversations/${conversationId}/messages`)
      .then((rows) => {
        if (!cancelled) setData(rows)
      })
      .catch((err) => {
        if (!cancelled) setError(readError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  return { data, loading, error }
}

/** Project meeting briefing — single fetch on mount + a manual
 * refresh trigger so the briefing tab can re-pull after the user
 * clicks "重新生成". */
interface BriefingState {
  data: ProjectMeetingBriefing | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useProjectBriefing(projectId: number | null): BriefingState {
  const [data, setData] = useState<ProjectMeetingBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOnce = useCallback(async () => {
    if (projectId == null || Number.isNaN(projectId)) {
      setData(null)
      setLoading(false)
      setError('项目 id 无效')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const fresh = await api.get<ProjectMeetingBriefing>(`/projects/${projectId}/briefing`)
      setData(fresh)
    } catch (err) {
      setError(readError(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void fetchOnce()
  }, [fetchOnce])

  const refetch = useCallback(async () => {
    await fetchOnce()
  }, [fetchOnce])

  return { data, loading, error, refetch }
}

/** Lightweight clients list — used by the project list filter
 * dropdown and elsewhere. Cached per-mount, not globally. */
interface ClientsListItem {
  id: number
  name: string
}

interface ClientsListState {
  data: ClientsListItem[]
  loading: boolean
}

export function useClientsList(): ClientsListState {
  const [data, setData] = useState<ClientsListItem[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<ClientsListItem[]>('/clients')
      .then((rows) => {
        if (!cancelled) setData(rows)
      })
      .catch(() => {
        if (!cancelled) setData([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return { data, loading }
}

/** Resolve client-side stakeholders for a project: match `project.client`
 * (free-text name) against `/clients` to find the linked client_id,
 * then load `/clients/:id/stakeholders`. Mirrors the legacy
 * ProjectStakeholdersTab approach. */
export function useClientStakeholders(clientName: string | null | undefined): ClientStakeholdersState {
  const [state, setState] = useState<ClientStakeholdersState>({
    matchedClientId: null,
    matchedClientName: null,
    stakeholders: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    const trimmed = clientName?.trim() ?? ''
    if (!trimmed) {
      setState({
        matchedClientId: null,
        matchedClientName: null,
        stakeholders: [],
        loading: false,
        error: null,
      })
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    ;(async () => {
      try {
        const clients = await api.get<ClientListItem[]>('/clients')
        if (cancelled) return
        const match = clients.find(
          (item) => normalizeClientName(item.name) === normalizeClientName(trimmed),
        )
        if (!match) {
          setState({
            matchedClientId: null,
            matchedClientName: null,
            stakeholders: [],
            loading: false,
            error: null,
          })
          return
        }
        const stakeholders = await api.get<ClientStakeholder[]>(
          `/clients/${match.id}/stakeholders`,
        )
        if (cancelled) return
        setState({
          matchedClientId: match.id,
          matchedClientName: match.name,
          stakeholders,
          loading: false,
          error: null,
        })
      } catch (err) {
        if (cancelled) return
        setState({
          matchedClientId: null,
          matchedClientName: null,
          stakeholders: [],
          loading: false,
          error: readError(err),
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientName])

  return state
}
