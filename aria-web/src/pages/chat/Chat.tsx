import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import {
  Paperclip,
  FolderKanban,
  Wrench,
  Search,
  Sparkles,
  Loader2,
  Plus,
  MessageSquare,
  Clock,
  ChevronUp,
  ArrowDown,
  Trash2,
  Send,
  Square,
  Copy,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  TriangleAlert
} from 'lucide-react'
import { api } from '../../api/client'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { PageTitle } from '../../components/PageTitle'
import type { Conversation, Message, Project, Skill } from '../../types/api'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
const PAGE_SIZE = 20

// ─── helpers ───────────────────────────────────────────────────────────────

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function groupConversations(conversations: Conversation[]) {
  const now = new Date()
  const today: Conversation[] = []
  const yesterday: Conversation[] = []
  const thisWeek: Conversation[] = []
  const older: Conversation[] = []

  for (const c of conversations) {
    const diff = Math.floor((now.getTime() - new Date(c.updated_at).getTime()) / 86400000)
    if (diff === 0) today.push(c)
    else if (diff === 1) yesterday.push(c)
    else if (diff < 7) thisWeek.push(c)
    else older.push(c)
  }

  return [
    ...(today.length ? [{ label: 'Today', items: today }] : []),
    ...(yesterday.length ? [{ label: 'Yesterday', items: yesterday }] : []),
    ...(thisWeek.length ? [{ label: 'This week', items: thisWeek }] : []),
    ...(older.length ? [{ label: 'Earlier', items: older }] : []),
  ]
}

// Suggestion chips shown on the empty state
const SUGGESTIONS = [
  'Summarize the latest project status',
  'Help me draft a client email',
  'Analyze this week\'s milestones',
  'What are the key risks in this project?',
]

// ─── CopyButton (for individual messages) ──────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <button
      onClick={handle}
      title="Copy message"
      className="p-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container-high text-on-surface-muted hover:text-on-surface transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export function Chat() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const conversationId = searchParams.get('conversation')
  const skillId = searchParams.get('skill')
  const projectId = searchParams.get('project')

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedProject, setSelectedProject] = useState<number | null>(projectId ? parseInt(projectId) : null)
  const [selectedSkill, setSelectedSkill] = useState<number | null>(skillId ? parseInt(skillId) : null)
  const [streamingContent, setStreamingContent] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [showSkillDropdown, setShowSkillDropdown] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const projectDropdownRef = useRef<HTMLDivElement>(null)
  const skillDropdownRef = useRef<HTMLDivElement>(null)
  const streamingContentRef = useRef('')
  const isStreamingRef = useRef(false)
  const scrollHeightBeforeLoadRef = useRef<number>(0)
  const isNearBottomRef = useRef(true)
  const abortControllerRef = useRef<AbortController | null>(null)
  // remember whether the current conversation was brand-new (so we refresh title after first reply)
  const isNewConvRef = useRef(false)

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { fetchInitialData() }, [])

  // Once conversations list loads, backfill conversation info if not yet set
  useEffect(() => {
    if (conversationId && conversations.length > 0 && !conversation) {
      const found = conversations.find(c => c.id === parseInt(conversationId))
      if (found) setConversation(found)
    }
  }, [conversations])

  useEffect(() => {
    if (conversationId) {
      loadConversation(parseInt(conversationId))
    } else {
      setLoading(false)
      setMessages([])
      setConversation(null)
      setStreamingContent('')
      setSending(false)
      setHasMore(false)
      setErrorMsg(null)
    }
  }, [conversationId])

  // close dropdowns on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node))
        setShowProjectDropdown(false)
      if (skillDropdownRef.current && !skillDropdownRef.current.contains(e.target as Node))
        setShowSkillDropdown(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── Data fetch ────────────────────────────────────────────────────────────
  const fetchInitialData = async () => {
    try {
      const [convsData, projectsData, skillsData] = await Promise.all([
        api.get<Conversation[]>('/chat/conversations'),
        api.get<Project[]>('/projects'),
        api.get<Skill[]>('/skills'),
      ])
      setConversations(convsData)
      setProjects(projectsData)
      setSkills(skillsData)
    } catch (err) {
      console.error('Failed to fetch initial data:', err)
    }
  }

  const loadConversation = async (id: number, beforeId?: number) => {
    try {
      if (beforeId) {
        setLoadingMore(true)
        const container = messagesContainerRef.current
        if (container) scrollHeightBeforeLoadRef.current = container.scrollHeight
      } else {
        setLoading(true)
        setMessages([])
        setHasMore(false)
        setErrorMsg(null)
      }

      // Set conv info from cached list (list may not be loaded yet on first render)
      if (!beforeId) {
        const cached = conversations.find(c => c.id === id)
        if (cached) setConversation(cached)
      }

      const url = beforeId
        ? `/chat/conversations/${id}/messages?before_id=${beforeId}&limit=${PAGE_SIZE}`
        : `/chat/conversations/${id}/messages?limit=${PAGE_SIZE}`
      const data = await api.get<Message[]>(url)

      if (beforeId) {
        setMessages(prev => [...data, ...prev])
      } else {
        setMessages(data)
      }
      setHasMore(data.length === PAGE_SIZE)
    } catch (err) {
      console.error('Failed to load conversation:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // ── Load more (pagination) ────────────────────────────────────────────────
  const loadMoreMessages = useCallback(async () => {
    if (!conversationId || loadingMore || !hasMore) return
    const oldestId = messages[0]?.id
    if (!oldestId) return
    await loadConversation(parseInt(conversationId), oldestId)
  }, [conversationId, loadingMore, hasMore, messages])

  // ── Scroll events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const distBottom = scrollHeight - scrollTop - clientHeight
      isNearBottomRef.current = distBottom < 120
      setShowScrollBtn(distBottom > 300)
      if (scrollTop < 100 && hasMore && !loadingMore && messages.length > 0) loadMoreMessages()
    }
    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [hasMore, loadingMore, messages.length, loadMoreMessages])

  // restore position after prepend
  useEffect(() => {
    if (loadingMore) return
    const container = messagesContainerRef.current
    if (container && scrollHeightBeforeLoadRef.current > 0) {
      container.scrollTop = container.scrollHeight - scrollHeightBeforeLoadRef.current
      scrollHeightBeforeLoadRef.current = 0
    }
  }, [loadingMore, messages.length])

  // auto-scroll on new messages
  useEffect(() => {
    if (!isStreamingRef.current && isNearBottomRef.current) scrollToBottom()
  }, [messages])

  // auto-scroll while streaming
  useEffect(() => {
    if (streamingContent && isNearBottomRef.current) scrollToBottom('auto')
  }, [streamingContent])

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  // ── Conversation actions ──────────────────────────────────────────────────
  const createNewConversation = async () => {
    try {
      setConversation(null); setMessages([]); setStreamingContent('')
      setSending(false); setHasMore(false); setErrorMsg(null)
      const newConv = await api.post<Conversation>('/chat/conversations', {
        project_id: selectedProject, skill_id: selectedSkill,
      })
      setConversations(prev => [newConv, ...prev])
      navigate(`/chat?conversation=${newConv.id}`, { replace: true })
    } catch (err) {
      console.error('Failed to create conversation:', err)
    }
  }

  const deleteConversation = async (e: React.MouseEvent, convId: number) => {
    e.preventDefault(); e.stopPropagation()
    try {
      await api.delete(`/chat/conversations/${convId}`)
      setConversations(prev => prev.filter(c => c.id !== convId))
      if (conversationId === String(convId)) navigate('/chat', { replace: true })
    } catch (err) {
      console.error('Failed to delete conversation:', err)
    }
  }

  // ── Input helpers ─────────────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const fillSuggestion = (text: string) => {
    setInput(text)
    textareaRef.current?.focus()
  }

  // ── Stop generation ───────────────────────────────────────────────────────
  const handleStop = () => {
    abortControllerRef.current?.abort()
  }

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim() || sending) return

    setSending(true)
    setErrorMsg(null)
    streamingContentRef.current = ''
    setStreamingContent('')
    isStreamingRef.current = true
    isNearBottomRef.current = true

    const msgText = input
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      let currentConvId = conversation?.id
      if (!currentConvId) {
        const newConv = await api.post<Conversation>('/chat/conversations', {
          project_id: selectedProject, skill_id: selectedSkill,
        })
        currentConvId = newConv.id
        setConversation(newConv)
        setConversations(prev => [newConv, ...prev])
        navigate(`/chat?conversation=${newConv.id}`, { replace: true })
        isNewConvRef.current = true
      }

      const userMsg: Message = {
        id: Date.now(),
        conversation_id: currentConvId,
        role: 'user',
        content: msgText,
        metadata_json: '{}',
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, userMsg])
      scrollToBottom()
      setIsThinking(true)

      const token = localStorage.getItem('authToken')
      const response = await fetch(`${API_BASE_URL}/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token || '' },
        body: JSON.stringify({
          conversation_id: currentConvId,
          content: msgText,
          project_id: selectedProject,
          skill_id: selectedSkill,
          rag_doc_ids: [],
          file_ids: [],
        }),
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(`Server error ${response.status}`)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      let assistantContent = ''
      let pendingContent = ''
      let updateTimer: ReturnType<typeof setTimeout> | null = null
      let streamDone = false

      const flushUpdate = () => {
        if (pendingContent !== assistantContent) {
          pendingContent = assistantContent
          setStreamingContent(assistantContent)
          setIsThinking(false)
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const lines = new TextDecoder().decode(value).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'chunk' && data.content) {
              assistantContent += data.content
              streamingContentRef.current = assistantContent
              if (!updateTimer) {
                updateTimer = setTimeout(() => { flushUpdate(); updateTimer = null }, 80)
              }
            } else if (data.type === 'done') {
              streamDone = true
              if (updateTimer) { clearTimeout(updateTimer); updateTimer = null }
              flushUpdate()
              await new Promise(r => setTimeout(r, 50))
              const assistantMsg: Message = {
                id: Date.now() + 1,
                conversation_id: currentConvId!,
                role: 'assistant',
                content: assistantContent,
                metadata_json: JSON.stringify({ references: data.references || [] }),
                created_at: new Date().toISOString(),
              }
              setMessages(prev => [...prev, assistantMsg])
              setStreamingContent('')
              streamingContentRef.current = ''
              isStreamingRef.current = false
              setIsThinking(false)

              // Refresh conversation list to pick up the auto-generated title
              if (isNewConvRef.current) {
                isNewConvRef.current = false
                api.get<Conversation[]>('/chat/conversations')
                  .then(data => setConversations(data))
                  .catch(() => {})
              }
            } else if (data.type === 'error') {
              if (updateTimer) { clearTimeout(updateTimer); updateTimer = null }
              setErrorMsg(data.error || 'An error occurred. Please try again.')
              isStreamingRef.current = false
              setIsThinking(false)
            }
          } catch (_) { /* partial chunk */ }
        }
      }

      // Stream ended but no 'done' event (e.g. aborted)
      if (!streamDone && assistantContent) {
        if (updateTimer) clearTimeout(updateTimer)
        flushUpdate()
        await new Promise(r => setTimeout(r, 50))
        const partialMsg: Message = {
          id: Date.now() + 1,
          conversation_id: currentConvId!,
          role: 'assistant',
          content: assistantContent + ' _(generation stopped)_',
          metadata_json: '{}',
          created_at: new Date().toISOString(),
        }
        setMessages(prev => [...prev, partialMsg])
        setStreamingContent('')
        streamingContentRef.current = ''
      }

      if (updateTimer) clearTimeout(updateTimer)
      isStreamingRef.current = false
      setIsThinking(false)
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // normal stop — already handled above
      } else {
        console.error('Send failed:', err)
        setErrorMsg('Failed to send message. Please check your connection.')
      }
      setIsThinking(false)
      isStreamingRef.current = false
      // Clear partial streaming content
      if (streamingContentRef.current) {
        setStreamingContent('')
        streamingContentRef.current = ''
      }
    } finally {
      setSending(false)
      abortControllerRef.current = null
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const selectedProjectData = projects.find(p => p.id === selectedProject)
  const selectedSkillData = skills.find(s => s.id === selectedSkill)

  const filteredConversations = sidebarSearch.trim()
    ? conversations.filter(c =>
        (c.title || '').toLowerCase().includes(sidebarSearch.toLowerCase())
      )
    : conversations
  const conversationGroups = groupConversations(filteredConversations)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex bg-surface">
      <PageTitle title="Chat" />

      {/* ── Sidebar ── */}
      {sidebarOpen && (
        <div className="w-72 border-r border-outline/10 flex flex-col bg-surface-container-low/30 flex-shrink-0">
          {/* Sidebar header */}
          <div className="p-3 border-b border-outline/10 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={createNewConversation}
                className="flex-1 btn-primary flex items-center justify-center gap-2 py-2.5"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2.5 rounded-xl hover:bg-surface-container-high text-on-surface-muted transition-colors"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-muted pointer-events-none" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={e => setSidebarSearch(e.target.value)}
                placeholder="Search conversations…"
                className="w-full pl-8 pr-3 py-2 bg-surface-container-lowest rounded-lg text-sm text-on-surface placeholder:text-on-surface-muted outline-none border border-outline/10 focus:border-primary/30 transition-colors"
              />
              {sidebarSearch && (
                <button
                  onClick={() => setSidebarSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-muted hover:text-on-surface"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-auto p-2">
            {filteredConversations.length === 0 && sidebarSearch ? (
              <p className="text-sm text-on-surface-muted text-center py-8">No results</p>
            ) : (
              conversationGroups.map(group => (
                <div key={group.label}>
                  <p className="px-3 py-1.5 text-label-sm text-on-surface-muted">{group.label}</p>
                  {group.items.map(conv => (
                    <Link
                      key={conv.id}
                      to={`/chat?conversation=${conv.id}`}
                      className={`group flex items-start gap-2.5 p-2.5 rounded-xl mb-0.5 transition-colors ${
                        conversationId === String(conv.id)
                          ? 'bg-secondary-container/50'
                          : 'hover:bg-surface-container-low'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4 text-on-surface-muted mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate leading-snug ${
                          conversationId === String(conv.id) ? 'text-primary font-medium' : 'text-on-surface'
                        }`}>
                          {conv.title || 'New Conversation'}
                        </p>
                        <p className="text-xs text-on-surface-muted flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {formatTime(conv.updated_at)}
                        </p>
                      </div>
                      <button
                        onClick={e => deleteConversation(e, conv.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-error/10 hover:text-error text-on-surface-muted transition-all flex-shrink-0 mt-0.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Link>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div className="glass border-b border-outline/10 px-5 py-3.5 flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Expand sidebar button (when collapsed) */}
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-xl hover:bg-surface-container-low text-on-surface-muted transition-colors"
                title="Open sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {(selectedProjectData || selectedSkillData) && (
                  <span className="px-2.5 py-1 rounded-full bg-secondary-container/50 text-label-sm text-primary">
                    {selectedProjectData ? 'PROJECT' : 'SKILL'}
                  </span>
                )}
                <h1 className="text-headline-sm text-on-surface truncate">
                  {conversation?.title || 'New Conversation'}
                </h1>
              </div>
              {(selectedProjectData || selectedSkillData) && (
                <p className="text-body-sm text-on-surface-muted mt-0.5">
                  {selectedProjectData
                    ? `${selectedProjectData.name} · ${selectedProjectData.client}`
                    : `${selectedSkillData!.name} · ${selectedSkillData!.category}`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-auto px-6 py-6 relative">
          <div className="max-w-3xl mx-auto">

            {/* Load more */}
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-on-surface-muted mb-4">
                <Loader2 className="w-4 h-4 animate-spin" />Loading earlier messages…
              </div>
            )}
            {!loadingMore && hasMore && messages.length > 0 && (
              <button
                onClick={loadMoreMessages}
                className="w-full flex items-center justify-center gap-2 py-2.5 mb-4 text-sm text-on-surface-muted hover:text-primary transition-colors"
              >
                <ChevronUp className="w-4 h-4" />
                Load earlier messages
              </button>
            )}

            {/* Loading skeleton */}
            {loading && conversationId && messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="relative w-12 h-12 rounded-2xl bg-gradient-primary flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-white" />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-primary animate-ping opacity-20" />
                </div>
                <p className="mt-4 text-body-md text-on-surface-muted">Loading conversation…</p>
              </div>

            ) : messages.length === 0 && !streamingContent ? (
              /* ── Empty state ── */
              <div className="text-center py-16">
                <div className="w-14 h-14 rounded-2xl bg-gradient-primary flex items-center justify-center mx-auto mb-5">
                  <Sparkles className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-headline-sm text-on-surface mb-2">How can I help you today?</h2>
                <p className="text-body-md text-on-surface-muted max-w-sm mx-auto mb-8">
                  Start a conversation or select a project/skill below.
                </p>
                {/* Suggestion chips */}
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => fillSuggestion(s)}
                      className="px-4 py-2 rounded-full bg-surface-container-low border border-outline/15 text-sm text-on-surface hover:bg-secondary-container/40 hover:border-primary/20 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

            ) : (
              <div className="space-y-5">
                {messages.map(msg => (
                  <MessageRow key={msg.id} message={msg} />
                ))}

                {/* Streaming / thinking bubble */}
                {(isThinking || streamingContent) && (
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-gradient-primary flex items-center justify-center flex-shrink-0 mt-1">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1 px-5 py-4 bg-surface-container-lowest rounded-2xl rounded-tl-sm border border-outline/10">
                      {streamingContent ? (
                        <>
                          <div className="md-root">
                            <MarkdownRenderer content={streamingContent} />
                          </div>
                          <span className="inline-block w-0.5 h-[1em] bg-primary ml-0.5 animate-pulse rounded-full align-middle" />
                        </>
                      ) : (
                        <div className="flex items-center gap-2 text-on-surface-muted py-0.5">
                          <span className="flex gap-1">
                            {[0, 150, 300].map(d => (
                              <span key={d} className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce"
                                style={{ animationDelay: `${d}ms` }} />
                            ))}
                          </span>
                          <span className="text-sm">Thinking…</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Error banner */}
                {errorMsg && (
                  <div className="flex items-start gap-3 px-5 py-3.5 rounded-xl bg-error/5 border border-error/20">
                    <TriangleAlert className="w-4 h-4 text-error flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-error flex-1">{errorMsg}</p>
                    <button onClick={() => setErrorMsg(null)} className="text-error/60 hover:text-error">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Scroll-to-bottom fab */}
          {showScrollBtn && (
            <button
              onClick={() => scrollToBottom()}
              className="absolute bottom-5 right-5 w-8 h-8 rounded-full bg-surface-container-lowest border border-outline/20 shadow-md flex items-center justify-center text-on-surface-muted hover:text-primary hover:border-primary/30 transition-all"
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Input area ── */}
        <div className="glass border-t border-outline/10 px-5 py-3.5 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            {/* Context pills */}
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <ContextPill
                ref={projectDropdownRef}
                icon={<FolderKanban className="w-4 h-4" />}
                label={selectedProjectData ? selectedProjectData.name : 'Project'}
                active={!!selectedProject}
                open={showProjectDropdown}
                onToggle={() => setShowProjectDropdown(v => !v)}
              >
                {showProjectDropdown && (
                  <DropdownMenu>
                    <DropdownItem onClick={() => { setSelectedProject(null); setShowProjectDropdown(false) }} muted>
                      Clear selection
                    </DropdownItem>
                    {projects.map(p => (
                      <DropdownItem key={p.id} onClick={() => { setSelectedProject(p.id); setShowProjectDropdown(false) }}>
                        {p.name}
                      </DropdownItem>
                    ))}
                  </DropdownMenu>
                )}
              </ContextPill>

              <ContextPill
                ref={skillDropdownRef}
                icon={<Wrench className="w-4 h-4" />}
                label={selectedSkillData ? selectedSkillData.name : '@ Skills'}
                active={!!selectedSkill}
                secondary
                open={showSkillDropdown}
                onToggle={() => setShowSkillDropdown(v => !v)}
              >
                {showSkillDropdown && (
                  <DropdownMenu>
                    <DropdownItem onClick={() => { setSelectedSkill(null); setShowSkillDropdown(false) }} muted>
                      Clear selection
                    </DropdownItem>
                    {skills.map(s => (
                      <DropdownItem key={s.id} onClick={() => { setSelectedSkill(s.id); setShowSkillDropdown(false) }}>
                        {s.name}
                      </DropdownItem>
                    ))}
                  </DropdownMenu>
                )}
              </ContextPill>
            </div>

            {/* Textarea + actions */}
            <div className="flex items-end gap-2 bg-surface-container-lowest rounded-2xl px-3 py-2 shadow-sm border border-outline/10 focus-within:border-primary/30 transition-colors">
              <button className="p-2.5 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-muted flex-shrink-0 mb-0.5">
                <Paperclip className="w-4.5 h-4.5" />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message… (Shift+Enter for new line)"
                disabled={sending}
                rows={1}
                className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-muted outline-none py-2.5 resize-none overflow-hidden disabled:opacity-50 leading-relaxed"
                style={{ minHeight: '40px', maxHeight: '180px' }}
              />
              {/* Stop / Send */}
              {sending ? (
                <button
                  onClick={handleStop}
                  title="Stop generation"
                  className="p-2.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface transition-colors flex-shrink-0 mb-0.5"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="p-2.5 rounded-xl bg-gradient-primary text-white hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-40 flex-shrink-0 mb-0.5"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-on-surface-muted mt-1.5 text-center">
              Shift+Enter for new line · Enter to send
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── MessageRow ─────────────────────────────────────────────────────────────
function MessageRow({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex items-start gap-3 group ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-1 text-xs font-semibold ${
        isUser
          ? 'bg-surface-container-high text-on-surface-muted'
          : 'bg-gradient-primary text-white'
      }`}>
        {isUser ? 'You' : <Sparkles className="w-3.5 h-3.5" />}
      </div>

      {/* Bubble + actions */}
      <div className={`flex-1 flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`max-w-[85%] px-5 py-3.5 ${
          isUser
            ? 'bg-surface-container-high rounded-2xl rounded-tr-sm'
            : 'bg-surface-container-lowest rounded-2xl rounded-tl-sm border border-outline/10'
        }`}>
          <div className="md-root">
            <MarkdownRenderer content={message.content} />
          </div>
        </div>

        {/* Timestamp + copy — visible on hover */}
        <div className={`flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs text-on-surface-muted px-1">{formatTime(message.created_at)}</span>
          <CopyButton text={message.content} />
        </div>
      </div>
    </div>
  )
}

// ─── Context pill wrapper ────────────────────────────────────────────────────
import { forwardRef } from 'react'

const ContextPill = forwardRef<HTMLDivElement, {
  icon: React.ReactNode
  label: string
  active?: boolean
  secondary?: boolean
  open: boolean
  onToggle: () => void
  children?: React.ReactNode
}>(({ icon, label, active, secondary, open: _open, onToggle, children }, ref) => (
  <div className="relative" ref={ref}>
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
        active
          ? secondary
            ? 'bg-secondary-container text-on-secondary-container'
            : 'bg-primary/10 text-primary'
          : 'bg-surface-container-low text-on-surface-muted hover:text-on-surface hover:bg-surface-container-high'
      }`}
    >
      {icon}
      {label}
    </button>
    {children}
  </div>
))
ContextPill.displayName = 'ContextPill'

// ─── Dropdown primitives ─────────────────────────────────────────────────────
function DropdownMenu({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute bottom-full left-0 mb-2 w-60 bg-surface-container-lowest rounded-xl shadow-lg border border-outline/10 py-1.5 z-50">
      {children}
    </div>
  )
}

function DropdownItem({ onClick, children, muted }: {
  onClick: () => void
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-2 text-left text-sm hover:bg-surface-container-low transition-colors ${
        muted ? 'text-on-surface-muted' : 'text-on-surface'
      }`}
    >
      {children}
    </button>
  )
}
