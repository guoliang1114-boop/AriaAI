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

interface ProjectDetailResult {
  projectId: number
  data: ProjectDetailType | null
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
  const validProjectId = projectId != null && !Number.isNaN(projectId)
  const [result, setResult] = useState<ProjectDetailResult | null>(null)
  const [refreshingProjectId, setRefreshingProjectId] = useState<number | null>(null)
  const requestIdRef = useRef(0)
  const loadedProjectIdRef = useRef<number | null>(null)

  const fetchOnce = useCallback(() => {
    const requestId = ++requestIdRef.current
    if (!validProjectId) return Promise.resolve()
    return api
      .get<ProjectDetailType>(`/projects/${projectId}/detail`)
      .then((fresh) => {
        if (requestId !== requestIdRef.current) return
        loadedProjectIdRef.current = projectId
        setResult({ projectId, data: fresh, error: null })
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return
        setResult((current) => ({
          projectId,
          data: current?.projectId === projectId ? current.data : null,
          error: readError(err),
        }))
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setRefreshingProjectId(null)
      })
  }, [projectId, validProjectId])

  useEffect(() => {
    void fetchOnce()
  }, [fetchOnce])

  const refetch = useCallback(async () => {
    if (validProjectId && loadedProjectIdRef.current === projectId) {
      setRefreshingProjectId(projectId)
    }
    await fetchOnce()
  }, [fetchOnce, projectId, validProjectId])

  if (!validProjectId) {
    return { data: null, loading: false, refreshing: false, error: '项目 id 无效', refetch }
  }
  const current = result?.projectId === projectId ? result : null
  return {
    data: current?.data ?? null,
    loading: current == null,
    refreshing: refreshingProjectId === projectId,
    error: current?.error ?? null,
    refetch,
  }
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

interface ClientStakeholdersResult {
  clientKey: string
  matchedClientId: number | null
  matchedClientName: string | null
  stakeholders: ClientStakeholder[]
  error: string | null
}

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

interface ProjectConversationsResult {
  projectId: number
  data: Conversation[]
  error: string | null
}

export function useProjectConversations(projectId: number | null): ConversationsState {
  const [result, setResult] = useState<ProjectConversationsResult | null>(null)
  const [loadingProjectId, setLoadingProjectId] = useState<number | null>(null)
  const requestIdRef = useRef(0)

  const fetchOnce = useCallback(() => {
    const requestId = ++requestIdRef.current
    if (projectId == null || Number.isNaN(projectId)) return Promise.resolve()
    return api
      .get<Conversation[]>(`/chat/conversations?project_id=${projectId}`)
      .then((data) => {
        if (requestId === requestIdRef.current) {
          setResult({ projectId, data, error: null })
        }
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return
        setResult((current) => ({
          projectId,
          data: current?.projectId === projectId ? current.data : [],
          error: readError(err),
        }))
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoadingProjectId(null)
      })
  }, [projectId])

  useEffect(() => {
    void fetchOnce()
  }, [fetchOnce])

  const refetch = useCallback(async () => {
    if (projectId != null && !Number.isNaN(projectId)) setLoadingProjectId(projectId)
    await fetchOnce()
  }, [fetchOnce, projectId])

  const removeLocal = useCallback((conversationId: number) => {
    setResult((current) => current?.projectId === projectId
      ? { ...current, data: current.data.filter((item) => item.id !== conversationId) }
      : current)
  }, [projectId])

  if (projectId == null || Number.isNaN(projectId)) {
    return { data: [], loading: false, error: null, refetch, removeLocal }
  }
  const current = result?.projectId === projectId ? result : null
  return {
    data: current?.data ?? [],
    loading: current == null || loadingProjectId === projectId,
    error: current?.error ?? null,
    refetch,
    removeLocal,
  }
}

interface MessagesState {
  data: Message[]
  loading: boolean
  error: string | null
  /** Re-pull the thread from the server. Used after a HITAS
   * confirm/reject persists a result message. */
  refetch: () => Promise<void>
}

interface ConversationMessagesResult {
  conversationId: number
  data: Message[]
  error: string | null
}

export function useConversationMessages(conversationId: number | null): MessagesState {
  const [result, setResult] = useState<ConversationMessagesResult | null>(null)
  const [loadingConversationId, setLoadingConversationId] = useState<number | null>(null)
  const requestIdRef = useRef(0)

  const fetchOnce = useCallback(() => {
    const requestId = ++requestIdRef.current
    if (conversationId == null) return Promise.resolve()
    return api
      .get<Message[]>(`/chat/conversations/${conversationId}/messages`)
      .then((data) => {
        if (requestId === requestIdRef.current) {
          setResult({ conversationId, data, error: null })
        }
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return
        setResult((current) => ({
          conversationId,
          data: current?.conversationId === conversationId ? current.data : [],
          error: readError(err),
        }))
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoadingConversationId(null)
      })
  }, [conversationId])

  useEffect(() => {
    void fetchOnce()
  }, [fetchOnce])

  const refetch = useCallback(async () => {
    if (conversationId != null) setLoadingConversationId(conversationId)
    await fetchOnce()
  }, [conversationId, fetchOnce])

  if (conversationId == null) return { data: [], loading: false, error: null, refetch }
  const current = result?.conversationId === conversationId ? result : null
  return {
    data: current?.data ?? [],
    loading: current == null || loadingConversationId === conversationId,
    error: current?.error ?? null,
    refetch,
  }
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

interface ProjectBriefingResult {
  projectId: number
  data: ProjectMeetingBriefing | null
  error: string | null
}

export function useProjectBriefing(projectId: number | null): BriefingState {
  const [result, setResult] = useState<ProjectBriefingResult | null>(null)
  const [loadingProjectId, setLoadingProjectId] = useState<number | null>(null)
  const requestIdRef = useRef(0)

  const fetchOnce = useCallback(() => {
    const requestId = ++requestIdRef.current
    if (projectId == null || Number.isNaN(projectId)) return Promise.resolve()
    return api
      .get<ProjectMeetingBriefing>(`/projects/${projectId}/briefing`)
      .then((data) => {
        if (requestId === requestIdRef.current) setResult({ projectId, data, error: null })
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return
        setResult((current) => ({
          projectId,
          data: current?.projectId === projectId ? current.data : null,
          error: readError(err),
        }))
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoadingProjectId(null)
      })
  }, [projectId])

  useEffect(() => {
    void fetchOnce()
  }, [fetchOnce])

  const refetch = useCallback(async () => {
    if (projectId != null && !Number.isNaN(projectId)) setLoadingProjectId(projectId)
    await fetchOnce()
  }, [fetchOnce, projectId])

  if (projectId == null || Number.isNaN(projectId)) {
    return { data: null, loading: false, error: '项目 id 无效', refetch }
  }
  const current = result?.projectId === projectId ? result : null
  return {
    data: current?.data ?? null,
    loading: current == null || loadingProjectId === projectId,
    error: current?.error ?? null,
    refetch,
  }
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

/** Resolve client-side stakeholders for a project. Stable `client_id` is the
 * sole authority; a missing ID means the project is not linked to a client. */
export function useClientStakeholders(
  clientId: number | null | undefined,
  clientName: string | null | undefined,
): ClientStakeholdersState {
  const directClientId =
    typeof clientId === 'number' && Number.isInteger(clientId) && clientId > 0
      ? clientId
      : null
  const clientKey = directClientId != null ? `id:${directClientId}` : ''
  const [result, setResult] = useState<ClientStakeholdersResult | null>(null)
  const [loadingClientKey, setLoadingClientKey] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const fetchOnce = useCallback(() => {
    const requestId = ++requestIdRef.current
    if (!clientKey) return Promise.resolve()
    return api
      .get<ClientStakeholder[]>(`/clients/${directClientId}/stakeholders`)
      .then((stakeholders) => {
        if (requestId !== requestIdRef.current) return
        setResult({
          clientKey,
          matchedClientId: directClientId,
          matchedClientName: String(clientName || '').trim() || `#${directClientId}`,
          stakeholders,
          error: null,
        })
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return
        setResult({
          clientKey,
          matchedClientId: null,
          matchedClientName: null,
          stakeholders: [],
          error: readError(err),
        })
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoadingClientKey(null)
      })
  }, [clientKey, clientName, directClientId])

  useEffect(() => {
    void fetchOnce()
  }, [fetchOnce])

  const refetch = useCallback(async () => {
    if (clientKey) setLoadingClientKey(clientKey)
    await fetchOnce()
  }, [clientKey, fetchOnce])

  if (!clientKey) {
    return {
      matchedClientId: null,
      matchedClientName: null,
      stakeholders: [],
      loading: false,
      error: null,
      refetch,
    }
  }
  const current = result?.clientKey === clientKey ? result : null
  return {
    matchedClientId: current?.matchedClientId ?? null,
    matchedClientName: current?.matchedClientName ?? null,
    stakeholders: current?.stakeholders ?? [],
    loading: current == null || loadingClientKey === clientKey,
    error: current?.error ?? null,
    refetch,
  }
}
