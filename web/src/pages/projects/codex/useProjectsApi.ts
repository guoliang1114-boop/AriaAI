import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** True while a background refetch is in flight after the initial
   * load has resolved. UI that wants to show a subtle "saving" hint
   * can listen to this without blanking the page. */
  refreshing: boolean
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
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `loading` is the "first paint" gate that the detail wrapper uses
  // to decide whether to show the full skeleton. Once we have any
  // data on hand, subsequent fetches go through the `refreshing`
  // flag instead so editing / toggling / adding doesn't blank the
  // whole tab to a skeleton mid-flight.
  const hasDataRef = useRef(false)

  const fetchOnce = useCallback(async () => {
    if (projectId == null || Number.isNaN(projectId)) {
      setData(null)
      setLoading(false)
      setError('项目 id 无效')
      return
    }
    if (hasDataRef.current) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const fresh = await api.get<ProjectDetailType>(`/projects/${projectId}/detail`)
      setData(fresh)
      hasDataRef.current = true
      setError(null)
    } catch (err) {
      setError(readError(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [projectId])

  useEffect(() => {
    // Project id change means we navigated to a different project —
    // reset the "have data" gate so the new project gets a proper
    // first-paint skeleton again instead of inheriting the previous
    // project's content.
    hasDataRef.current = false
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

  return { data, loading, refreshing, error, refetch }
}

/** Friendly status label for top-bar chip. */
export const STATUS_LABEL: Record<Project['status'], string> = {
  lead: '线索期',
  lead_discovery: '线索发现',
  opportunity: '机会期',
  opportunity_qualified: '确认机会',
  proposal: '方案投标',
  negotiation: '商务谈判',
  contracting: '合同签署',
  won: '已签约',
  delivering: '交付中',
  kickoff: '项目启动',
  execution: '执行中',
  delivery: '交付验收',
  support: '运维支持',
  archived: '已归档',
}

export const STATUS_TONE: Record<Project['status'], 'mute' | 'warn' | 'good' | 'accent' | 'neutral'> = {
  lead: 'mute',
  lead_discovery: 'mute',
  opportunity: 'warn',
  opportunity_qualified: 'warn',
  proposal: 'warn',
  negotiation: 'warn',
  contracting: 'good',
  won: 'good',
  delivering: 'accent',
  kickoff: 'accent',
  execution: 'accent',
  delivery: 'accent',
  support: 'accent',
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
  refetch: () => Promise<void>
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
  removeLocal: (conversationId: number) => void
}

export function useProjectConversations(projectId: number | null): ConversationsState {
  const [data, setData] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)

  const fetchOnce = useCallback(async () => {
    if (projectId == null || Number.isNaN(projectId)) {
      setData([])
      setLoading(false)
      hasLoadedRef.current = true
      return
    }
    if (!hasLoadedRef.current) setLoading(true)
    setError(null)
    try {
      const rows = await api.get<Conversation[]>(
        `/chat/conversations?project_id=${projectId}`,
      )
      setData(rows)
      hasLoadedRef.current = true
    } catch (err) {
      setError(readError(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    hasLoadedRef.current = false
    void fetchOnce()
  }, [fetchOnce])

  const refetch = useCallback(async () => {
    await fetchOnce()
  }, [fetchOnce])

  const removeLocal = useCallback((conversationId: number) => {
    setData((current) => current.filter((item) => item.id !== conversationId))
  }, [])

  return { data, loading, error, refetch, removeLocal }
}

interface MessagesState {
  data: Message[]
  loading: boolean
  error: string | null
  /** Re-pull the thread from the server. Used after a HITAS
   * confirm/reject persists a result message. */
  refetch: () => Promise<void>
}

export function useConversationMessages(conversationId: number | null): MessagesState {
  const [data, setData] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards against a stale response from a previous conversation
  // overwriting the current one when the user switches quickly.
  const activeConvRef = useRef<number | null>(conversationId)
  activeConvRef.current = conversationId

  const refetch = useCallback(async () => {
    if (conversationId == null) {
      setData([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await api.get<Message[]>(`/chat/conversations/${conversationId}/messages`)
      if (activeConvRef.current === conversationId) setData(rows)
    } catch (err) {
      if (activeConvRef.current === conversationId) setError(readError(err))
    } finally {
      if (activeConvRef.current === conversationId) setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { data, loading, error, refetch }
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
  const [matchedClientId, setMatchedId] = useState<number | null>(null)
  const [matchedClientName, setMatchedName] = useState<string | null>(null)
  const [stakeholders, setStakeholders] = useState<ClientStakeholder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOnce = useCallback(async () => {
    const trimmed = clientName?.trim() ?? ''
    if (!trimmed) {
      setMatchedId(null)
      setMatchedName(null)
      setStakeholders([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const clients = await api.get<ClientListItem[]>('/clients')
      const match = clients.find(
        (item) => normalizeClientName(item.name) === normalizeClientName(trimmed),
      )
      if (!match) {
        setMatchedId(null)
        setMatchedName(null)
        setStakeholders([])
        setLoading(false)
        return
      }
      const rows = await api.get<ClientStakeholder[]>(`/clients/${match.id}/stakeholders`)
      setMatchedId(match.id)
      setMatchedName(match.name)
      setStakeholders(rows)
    } catch (err) {
      setMatchedId(null)
      setMatchedName(null)
      setStakeholders([])
      setError(readError(err))
    } finally {
      setLoading(false)
    }
  }, [clientName])

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

  return { matchedClientId, matchedClientName, stakeholders, loading, error, refetch }
}
