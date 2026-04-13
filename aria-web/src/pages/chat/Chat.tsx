import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  TriangleAlert,
  BookOpen,
  File as FileIcon,
  ChevronDown,
  Info,
  FileText,
  TrendingUp,
  Target,
  Users,
  Mail,
  Zap,
  Download,
  MoreVertical,
} from 'lucide-react'
import { api } from '../../api/client'
import { getApiBaseUrl } from '../../config/api'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { PageTitle } from '../../components/PageTitle'
import type { Conversation, Message, Project, Skill } from '../../types/api'

const API_BASE_URL = getApiBaseUrl()
const PAGE_SIZE = 20

// ─── helpers ───────────────────────────────────────────────────────────────

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function groupConversations(conversations: Conversation[], t: any) {
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
    ...(today.length ? [{ label: t('chat.today'), items: today }] : []),
    ...(yesterday.length ? [{ label: t('chat.yesterday'), items: yesterday }] : []),
    ...(thisWeek.length ? [{ label: t('chat.thisWeek'), items: thisWeek }] : []),
    ...(older.length ? [{ label: t('chat.earlier'), items: older }] : []),
  ]
}

// Prompt cards shown on the empty state
interface PromptCard {
  icon: React.ElementType
  label: string
  prompt: string
  color: string
  bg: string
}

const getPromptCards = (): PromptCard[] => [
  {
    icon: TrendingUp,
    label: '项目进展速报',
    prompt: '帮我总结一下当前所有进行中项目的最新进展和关键风险点',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50 hover:bg-indigo-100 border-indigo-100',
  },
  {
    icon: Target,
    label: '里程碑检查',
    prompt: '检查一下近期有哪些里程碑即将到期或已经逾期，给出优先级建议',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 hover:bg-emerald-100 border-emerald-100',
  },
  {
    icon: FileText,
    label: '起草项目方案',
    prompt: '我需要为客户起草一份项目实施方案，帮我梳理结构和关键内容',
    color: 'text-violet-600',
    bg: 'bg-violet-50 hover:bg-violet-100 border-violet-100',
  },
  {
    icon: Mail,
    label: '撰写客户邮件',
    prompt: '帮我写一封向客户汇报本阶段项目进展的邮件，语气专业且简洁',
    color: 'text-sky-600',
    bg: 'bg-sky-50 hover:bg-sky-100 border-sky-100',
  },
  {
    icon: Users,
    label: '商务谈判准备',
    prompt: '我们即将和客户进行合同续签谈判，帮我梳理谈判要点和注意事项',
    color: 'text-amber-600',
    bg: 'bg-amber-50 hover:bg-amber-100 border-amber-100',
  },
  {
    icon: Zap,
    label: '风险识别分析',
    prompt: '基于项目现状，帮我识别当前最主要的交付风险，并给出应对策略',
    color: 'text-rose-600',
    bg: 'bg-rose-50 hover:bg-rose-100 border-rose-100',
  },
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
      className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export function Chat() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const conversationId = searchParams.get('conversation')
  const skillId = searchParams.get('skill')
  const projectId = searchParams.get('project')
  const prefilledQ = searchParams.get('q')

  const [input, setInput] = useState(prefilledQ || '')
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
  const [skillCategoryFilter, setSkillCategoryFilter] = useState<string>('all')
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [isLoadingConversations, setIsLoadingConversations] = useState(true)
  const [showSkillTemplateModal, setShowSkillTemplateModal] = useState(false)
  const [skillTemplateData, setSkillTemplateData] = useState<{
    skill: Skill
    variables: { name: string; value: string }[]
    preview: string
  } | null>(null)
  const processedSkillRef = useRef<number | null>(null)
  // Track streaming state for recovery after navigation
  const streamingConvIdRef = useRef<number | null>(null)
  // Track conversation ID for reliable save on unmount
  const conversationIdRef = useRef<number | null>(null)

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
  // Store first message for auto-renaming
  const firstMessageRef = useRef('')
  // track if we just loaded a conversation (to avoid smooth scroll on initial load)
  const justLoadedRef = useRef(false)
  // prevent loadConversation from firing when sendMessage triggers navigate to the new conv
  const skipNextConvLoadRef = useRef(false)

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { fetchInitialData() }, [])

  // ── Recover streaming state on mount ───────────────────────────────────────
  useEffect(() => {
    // Check if we have a pending streaming conversation
    const pendingConvId = sessionStorage.getItem('pendingStreamingConvId')
    if (pendingConvId) {
      const convId = parseInt(pendingConvId)
      console.log('[Chat] Found pending conversation in sessionStorage:', convId, 'current:', conversationId)
      
      if (!conversationId || parseInt(conversationId) !== convId) {
        // Navigate to the pending conversation
        console.log('[Chat] Navigating to pending conversation:', convId)
        navigate(`/chat?conversation=${convId}`, { replace: true })
      } else {
        // Already on the conversation, force refresh messages
        console.log('[Chat] Already on pending conversation, refreshing messages:', convId)
        loadConversation(convId)
      }
    }
  }, [])

  // Once conversations list loads, backfill conversation info if not yet set
  useEffect(() => {
    if (conversationId && conversations.length > 0 && !conversation) {
      const found = conversations.find(c => c.id === parseInt(conversationId))
      if (found) setConversation(found)
    }
  }, [conversations])

  useEffect(() => {
    if (conversationId) {
      if (skipNextConvLoadRef.current) {
        skipNextConvLoadRef.current = false
        return
      }
      const convId = parseInt(conversationId)
      loadConversation(convId)
      
      // If we're recovering from a streaming interruption, poll for updates
      const pendingId = sessionStorage.getItem('pendingStreamingConvId')
      if (pendingId && parseInt(pendingId) === convId) {
        console.log('[Chat] Recovering streaming for conversation:', convId)
        // Force immediate reload of messages to get latest state
        loadConversation(convId)
        
        // Poll for message completion
        const pollInterval = setInterval(async () => {
          try {
            // Get latest messages
            const msgs = await api.get<Message[]>(`/chat/conversations/${convId}/messages?limit=20`)
            console.log('[Chat] Polling - got', msgs.length, 'messages')
            
            // Always update messages to get latest state
            setMessages(msgs)
            
            // Check if we have a complete assistant message as last message
            const lastMsg = msgs[msgs.length - 1]
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
              console.log('[Chat] Recovery complete - found assistant message')
              sessionStorage.removeItem('pendingStreamingConvId')
              clearInterval(pollInterval)
              return
            }
            
            // Check if streaming marker is cleared
            if (!sessionStorage.getItem('pendingStreamingConvId')) {
              console.log('[Chat] Recovery complete - marker cleared')
              clearInterval(pollInterval)
            }
          } catch (e) {
            console.error('[Chat] Poll error:', e)
          }
        }, 2000) // Poll every 2 seconds
        
        // Stop polling after 2 minutes
        const timeoutId = setTimeout(() => {
          console.log('[Chat] Polling timeout')
          sessionStorage.removeItem('pendingStreamingConvId')
          clearInterval(pollInterval)
        }, 120000)
        
        return () => {
          clearInterval(pollInterval)
          clearTimeout(timeoutId)
        }
      }
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

  // Save conversation ID when it changes
  useEffect(() => {
    if (conversation?.id) {
      conversationIdRef.current = conversation.id
    }
  }, [conversation?.id])

  // Save streaming state when component unmounts (user navigates away)
  useEffect(() => {
    return () => {
      // Use ref to get the most recent conversation ID
      // This is more reliable than state during unmount
      const currentConvId = streamingConvIdRef.current || conversationIdRef.current
      if (currentConvId) {
        console.log('[Chat] Component unmounting, saving conversation:', currentConvId)
        sessionStorage.setItem('pendingStreamingConvId', String(currentConvId))
      }
      // Abort any ongoing request to prevent memory leaks
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // ── Data fetch ────────────────────────────────────────────────────────────
  const fetchInitialData = async () => {
    try {
      const [convsData, projectsData, skillsData] = await Promise.all([
        api.get<Conversation[]>('/chat/conversations?standalone=true'),
        api.get<Project[]>('/projects'),
        api.get<Skill[]>('/skills'),
      ])
      setConversations(convsData)
      setProjects(projectsData)
      setSkills(skillsData)
      // Auto-select first conversation if none is active
      if (!searchParams.get('conversation') && convsData.length > 0) {
        navigate(`/chat?conversation=${convsData[0].id}`, { replace: true })
      }
    } catch (err) {
      console.error('Failed to fetch initial data:', err)
    } finally {
      setIsLoadingConversations(false)
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
        // Mark as just loaded so we can jump to bottom without animation
        justLoadedRef.current = true
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
    if (!isStreamingRef.current && isNearBottomRef.current) {
      // If we just loaded a conversation, jump directly without animation
      const behavior: ScrollBehavior = justLoadedRef.current ? 'auto' : 'smooth'
      justLoadedRef.current = false
      // Use setTimeout to ensure DOM has updated before scrolling
      setTimeout(() => scrollToBottom(behavior), 0)
    }
  }, [messages])

  // auto-scroll while streaming
  useEffect(() => {
    if (streamingContent && isNearBottomRef.current) scrollToBottom('auto')
  }, [streamingContent])

  // ── Skill Template Modal ─────────────────────────────────────────────────
  // Auto-open template modal when skill with user_template is selected
  useEffect(() => {
    if (selectedSkill && !showSkillTemplateModal && processedSkillRef.current !== selectedSkill) {
      const skill = skills.find(s => s.id === selectedSkill)
      if (skill?.user_template) {
        // Extract variables from template
        // Format 1: [变量名] or {{变量名}}
        // Format 2: 变量名： or 变量名: (lines ending with colon)
        const template = skill.user_template
        const varRegex = /\[([^\]]+)\]|\{\{([^}]+)\}\}/g
        const matches: string[] = []
        let match
        
        // Check for [variable] or {{variable}} format (skip [ ] checkboxes)
        while ((match = varRegex.exec(template)) !== null) {
          const varName = (match[1] || match[2] || '').trim()
          if (varName && !matches.includes(varName)) {
            matches.push(varName)
          }
        }

        // If no named placeholders found, extract lines that END with a colon as editable fields
        if (matches.length === 0) {
          const lines = template.split('\n')
          lines.forEach((line) => {
            const trimmed = line.trim()
            // Only match lines where colon is at the very end (field label without a value)
            const colonMatch = trimmed.match(/^(?:[-•]\s*)?(.+?)：\s*$/) || trimmed.match(/^(?:[-•]\s*)?(.+?):\s*$/)
            if (colonMatch && colonMatch[1].trim()) {
              const varName = colonMatch[1].trim()
              if (!matches.includes(varName) && varName.length < 50) {
                matches.push(varName)
              }
            }
          })
        }
        
        setSkillTemplateData({
          skill,
          variables: matches.map(name => ({ name, value: '' })),
          preview: template
        })
        setShowSkillTemplateModal(true)
        // Mark this skill as processed to prevent reopening
        processedSkillRef.current = selectedSkill
      }
    }
  }, [selectedSkill, skills, showSkillTemplateModal])

  const handleApplyTemplate = async (filledTemplate: string) => {
    setShowSkillTemplateModal(false)
    setSkillTemplateData(null)
    // Auto-send with the filled template content
    await sendMessage(filledTemplate)
  }

  const handleCancelTemplate = () => {
    setShowSkillTemplateModal(false)
    setSkillTemplateData(null)
    // Mark as processed so it doesn't reopen
    if (selectedSkill) {
      processedSkillRef.current = selectedSkill
    }
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  // ── Conversation actions ──────────────────────────────────────────────────
  const createNewConversation = () => {
    // Don't create conversation upfront — create lazily on first message send.
    // This avoids the flash: empty-state → loading → empty-state.
    setConversation(null)
    setMessages([])
    setStreamingContent('')
    setSending(false)
    setHasMore(false)
    setErrorMsg(null)
    navigate('/chat', { replace: true })
  }

  const deleteConversation = (e: React.MouseEvent, convId: number) => {
    e.preventDefault(); e.stopPropagation()
    setDeleteTargetId(convId)
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!deleteTargetId) return
    const targetId = deleteTargetId
    setShowDeleteDialog(false)
    setDeleteTargetId(null)
    // Start exit animation
    setDeletingId(targetId)
    // Wait for animation (300ms), then remove from list and call API
    setTimeout(async () => {
      setDeletingId(null)
      const remaining = conversations.filter(c => c.id !== targetId)
      setConversations(remaining)
      if (conversationId === String(targetId)) {
        const next = remaining[0]
        navigate(next ? `/chat?conversation=${next.id}` : '/chat', { replace: true })
      }
      try {
        await api.delete(`/chat/conversations/${targetId}`)
      } catch (err) {
        console.error('Failed to delete conversation:', err)
      }
    }, 280)
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

  // ── Send message wrapper ──────────────────────────────────────────────────
  const handleSend = () => sendMessage(input)

  // ── Send message (internal implementation) ─────────────────────────────────
  const sendMessage = async (msgText: string) => {
    if (!msgText.trim() || sending) return

    setSending(true)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setErrorMsg(null)
    streamingContentRef.current = ''
    setStreamingContent('')
    isStreamingRef.current = true

    const controller = new AbortController()
    abortControllerRef.current = controller
    
    // Will be set when conversation is created/confirmed
    let currentConvIdForCleanup: number | null = null

    try {
      let currentConvId = conversation?.id
      if (!currentConvId) {
        // Auto-generate title from first message
        const cleanContent = msgText.replace(/[#*`\[\]]/g, '').trim()
        const title = cleanContent
          ? cleanContent.slice(0, 15) + (cleanContent.length > 15 ? '...' : '')
          : t('chat.newChat', 'New Chat')
        
        const newConv = await api.post<Conversation>('/chat/conversations', {
          project_id: selectedProject, skill_id: selectedSkill, title,
        })
        currentConvId = newConv.id
        currentConvIdForCleanup = newConv.id
        streamingConvIdRef.current = newConv.id
        // Save to sessionStorage for recovery if user navigates away
        sessionStorage.setItem('pendingStreamingConvId', String(newConv.id))
        setConversation(newConv)
        setConversations(prev => [newConv, ...prev])
        skipNextConvLoadRef.current = true
        navigate(`/chat?conversation=${newConv.id}`, { replace: true })
        isNewConvRef.current = true
        firstMessageRef.current = msgText
      } else {
        currentConvIdForCleanup = currentConvId
        streamingConvIdRef.current = currentConvId
        sessionStorage.setItem('pendingStreamingConvId', String(currentConvId))
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
      // Scroll after DOM update
      setTimeout(() => scrollToBottom(), 0)
      setIsThinking(true)

      const token = localStorage.getItem('authToken')
      const response = await fetch(`${getApiBaseUrl()}/chat/send`, {
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
            if ((data.type === 'text' || data.type === 'chunk') && data.content) {
              assistantContent += data.content
              streamingContentRef.current = assistantContent
              if (!updateTimer) {
                updateTimer = setTimeout(() => { flushUpdate(); updateTimer = null }, 80)
              }
            } else if (data.type === 'tool_executing') {
              setToolStatus(data.tool_name ? `${t('chat.runningTool')}: ${data.tool_name}…` : t('chat.runningTool'))
            } else if (data.type === 'tool_result') {
              setToolStatus(null)
            } else if (data.type === 'done') {
              streamDone = true
              if (updateTimer) { clearTimeout(updateTimer); updateTimer = null }
              flushUpdate()
              // Clear pending streaming state as it's complete
              sessionStorage.removeItem('pendingStreamingConvId')
              streamingConvIdRef.current = null
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
              setToolStatus(null)

              // Refresh conversation list to pick up the auto-generated title.
              // Delay to allow backend background title generation to complete first.
              if (isNewConvRef.current) {
                isNewConvRef.current = false
                const targetConvId = currentConvId
                const targetTitle = firstMessageRef.current
                firstMessageRef.current = ''
                
                setTimeout(async () => {
                  try {
                    // First, try to rename the conversation with the first message
                    if (targetConvId && targetTitle) {
                      const cleanTitle = targetTitle
                        .replace(/[#*`\[\]]/g, '')
                        .trim()
                        .slice(0, 15) + (targetTitle.replace(/[#*`\[\]]/g, '').trim().length > 15 ? '...' : '')
                      
                      await api.patch(`/chat/conversations/${targetConvId}`, { title: cleanTitle })
                      
                      // Update current conversation
                      setConversation(prev => prev ? { ...prev, title: cleanTitle } : prev)
                    }
                    
                    // Then refresh the full list
                    const data = await api.get<Conversation[]>('/chat/conversations?standalone=true')
                    setConversations(data)
                  } catch (err) {
                    console.error('Failed to rename conversation:', err)
                  }
                }, 500)
              }
            } else if (data.type === 'error') {
              setToolStatus(null)
              if (updateTimer) { clearTimeout(updateTimer); updateTimer = null }
              setErrorMsg(data.message || data.error || 'An error occurred. Please try again.')
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
        // Keep sessionStorage in case user wants to resume
      } else {
        console.error('Send failed:', err)
        setErrorMsg('Failed to send message. Please check your connection.')
        // Clear pending state on actual errors
        sessionStorage.removeItem('pendingStreamingConvId')
        streamingConvIdRef.current = null
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
  const conversationGroups = groupConversations(filteredConversations, t)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex bg-[#f5f6f8]">
      <PageTitle title={t('chat.title')} />

      {/* ── Sidebar ── */}
      {sidebarOpen && (
        <div className="w-64 border-r border-gray-100 flex flex-col bg-white flex-shrink-0 shadow-sm">
          {/* Sidebar header */}
          <div className="px-3 pt-3 pb-2 flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={createNewConversation}
                className="flex-1 bg-primary text-white rounded-xl font-medium flex items-center justify-center gap-1.5 py-2 text-sm hover:bg-primary/90 active:scale-[0.98] transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('chat.newChat')}
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors"
                title={t('chat.collapseSidebar')}
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={e => setSidebarSearch(e.target.value)}
                placeholder={t('chat.searchConversations')}
                className="w-full pl-8 pr-3 py-1.5 bg-gray-50 rounded-lg text-[12px] text-gray-700 placeholder:text-gray-400 outline-none border border-gray-100 focus:border-primary/30 transition-colors"
              />
              {sidebarSearch && (
                <button onClick={() => setSidebarSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-auto px-2 pb-2">
            {isLoadingConversations ? (
              <div className="space-y-0.5 pt-1">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl animate-pulse">
                    <div className="w-3.5 h-3.5 rounded bg-gray-100 flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 rounded bg-gray-100" style={{ width: `${55 + (i % 3) * 18}%` }} />
                      <div className="h-2 rounded bg-gray-100 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !conversationId && !sidebarSearch ? (
              <div className="pt-1">
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-primary/8 mb-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] truncate text-primary font-medium">{t('chat.newConversation')}</p>
                  </div>
                </div>
                {conversationGroups.map(group => (
                  <div key={group.label}>
                    <p className="px-3 pt-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">{group.label}</p>
                    {group.items.map(conv => (
                      <Link key={conv.id} to={`/chat?conversation=${conv.id}`}
                        className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-0.5 transition-colors hover:bg-gray-50"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-200 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] truncate text-gray-700">{conv.title || t('chat.newConversation')}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{formatTime(conv.updated_at)}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            ) : filteredConversations.length === 0 && sidebarSearch ? (
              <p className="text-xs text-gray-300 text-center py-8">{t('chat.noResults')}</p>
            ) : (
              <div className="pt-1">
                {conversationGroups.map(group => (
                  <div key={group.label}>
                    <p className="px-3 pt-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">{group.label}</p>
                    {group.items.map(conv => (
                      <Link key={conv.id} to={`/chat?conversation=${conv.id}`}
                        className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-0.5 transition-all duration-200 overflow-hidden ${
                          deletingId === conv.id
                            ? 'opacity-0 scale-95 max-h-0 py-0 mb-0 pointer-events-none'
                            : conversationId === String(conv.id)
                            ? 'bg-primary/8'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
                          conversationId === String(conv.id) ? 'bg-primary' : 'bg-gray-200'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[13px] truncate transition-colors ${
                            conversationId === String(conv.id) ? 'text-primary font-medium' : 'text-gray-700'
                          }`}>
                            {conv.title || t('chat.newConversation')}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{formatTime(conv.updated_at)}</p>
                        </div>
                        <button
                          onClick={e => deleteConversation(e, conv.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-red-50 hover:text-red-400 text-gray-300 transition-all flex-shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div className="bg-white/80 backdrop-blur-sm border-b border-gray-100 px-5 py-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                title={t('chat.openSidebar')}
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <div className="flex-1 min-w-0 flex items-center gap-2.5">
              {(selectedProjectData || selectedSkillData) && (
                <span className="px-2 py-0.5 rounded-md bg-primary/8 text-xs font-medium text-primary flex-shrink-0">
                  {selectedProjectData ? selectedProjectData.name : selectedSkillData!.name}
                </span>
              )}
              <h1 className="text-[15px] font-semibold text-gray-800 truncate">
                {conversation?.title || t('chat.newConversation')}
              </h1>
            </div>
            
            {/* Export dropdown */}
            {conversation?.id && (
              <ExportDropdown 
                conversationId={conversation.id} 
                conversationTitle={conversation.title}
              />
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-auto py-8 relative">
          <div className={`mx-auto px-8 ${sidebarOpen ? 'max-w-4xl' : 'max-w-5xl'}`}>

            {/* Load more */}
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-400 mb-4">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-xs">加载中…</span>
              </div>
            )}
            {!loadingMore && hasMore && messages.length > 0 && (
              <button onClick={loadMoreMessages}
                className="w-full flex items-center justify-center gap-2 py-2 mb-6 text-xs text-gray-400 hover:text-primary transition-colors"
              >
                <ChevronUp className="w-3.5 h-3.5" />
                {t('chat.loadEarlierMessages')}
              </button>
            )}

            {/* Loading skeleton */}
            {loading && conversationId && messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32">
                <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                  <Sparkles className="w-5 h-5 text-white" />
                  <div className="absolute inset-0 rounded-2xl bg-primary animate-ping opacity-15" />
                </div>
                <p className="mt-4 text-sm text-gray-400">{t('chat.loading')}</p>
              </div>

            ) : messages.length === 0 && !streamingContent ? (
              /* ── Empty state ── */
              <div className="flex flex-col items-center py-16 animate-fade-in">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center mb-4 shadow-lg shadow-primary/25">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-xl font-semibold text-gray-800 mb-1.5">你好，我是 Aria</h2>
                <p className="text-sm text-gray-400 max-w-xs text-center mb-10 leading-relaxed">
                  你的咨询项目 AI 助手，随时帮你推进项目、准备材料、分析风险
                </p>
                <div className="w-full max-w-2xl grid grid-cols-2 gap-2.5">
                  {getPromptCards().map(card => {
                    const Icon = card.icon
                    return (
                      <button key={card.label} onClick={() => fillSuggestion(card.prompt)}
                        className={`flex items-start gap-3 p-4 rounded-2xl border text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.98] ${card.bg}`}
                      >
                        <div className="w-7 h-7 rounded-xl bg-white/80 flex items-center justify-center flex-shrink-0 shadow-sm">
                          <Icon className={`w-3.5 h-3.5 ${card.color}`} />
                        </div>
                        <div>
                          <p className={`text-[13px] font-semibold ${card.color} mb-0.5`}>{card.label}</p>
                          <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{card.prompt}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

            ) : (
              <div className="space-y-8">
                {messages.map(msg => (
                  <MessageRow key={msg.id} message={msg} />
                ))}

                {/* Streaming / thinking */}
                {(isThinking || streamingContent) && (
                  <div className="flex items-start gap-3.5 animate-fade-in">
                    <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm shadow-primary/20">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-gray-300 mb-2">Aria</p>
                      <div className="text-[15px] text-gray-700 leading-[1.8]">
                        {streamingContent ? (
                          <>
                            <div className="md-root">
                              <MarkdownRenderer content={streamingContent} />
                            </div>
                            {toolStatus && (
                              <div className="flex items-center gap-2 mt-3 text-xs text-primary/70">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                {toolStatus}
                              </div>
                            )}
                            <span className="inline-block w-0.5 h-[1.1em] bg-primary/50 ml-0.5 animate-pulse rounded-full align-middle" />
                          </>
                        ) : toolStatus ? (
                          <div className="flex items-center gap-2 text-gray-400 py-1">
                            <Loader2 className="w-4 h-4 animate-spin text-primary/60" />
                            <span className="text-sm text-primary/70">{toolStatus}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 py-1">
                            {[0, 120, 240].map(d => (
                              <span key={d} className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce"
                                style={{ animationDelay: `${d}ms` }} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Error banner */}
                {errorMsg && (
                  <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-red-50 border border-red-100">
                    <TriangleAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-500 flex-1">{errorMsg}</p>
                    <button onClick={() => setErrorMsg(null)} className="text-red-300 hover:text-red-500">
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
            <button onClick={() => scrollToBottom()}
              className="absolute bottom-6 right-6 w-8 h-8 rounded-full bg-white border border-gray-200 shadow-md flex items-center justify-center text-gray-400 hover:text-primary hover:border-primary/30 hover:shadow-lg transition-all"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ── Input area ── */}
        <div className="relative flex-shrink-0 px-6 pb-5 pt-3 bg-[#f5f6f8]">
          {/* Gradient fade — blends messages area into footer */}
          <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent to-[#f5f6f8] -translate-y-full pointer-events-none" />
          <div className={`mx-auto ${sidebarOpen ? 'max-w-4xl' : 'max-w-5xl'}`}>
            {/* Context pills */}
            <div className="flex items-center gap-1 mb-2 flex-wrap">
              <ContextPill
                ref={projectDropdownRef}
                icon={<FolderKanban className="w-3 h-3" />}
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
                icon={<Wrench className="w-3 h-3" />}
                label={selectedSkillData ? selectedSkillData.name : '@ Skills'}
                active={!!selectedSkill}
                secondary
                open={showSkillDropdown}
                onToggle={() => setShowSkillDropdown(v => !v)}
              >
                {showSkillDropdown && (
                  <DropdownMenu wide>
                    <DropdownItem onClick={() => { setSelectedSkill(null); setSkillCategoryFilter('all'); setShowSkillDropdown(false) }} muted>
                      {t('skills.clearSelection') || 'Clear selection'}
                    </DropdownItem>
                    {(() => {
                      const categories = ['all', ...Array.from(new Set(skills.map(s => s.category)))]
                      return (
                        <div className="px-3 py-2 border-b border-gray-100">
                          <div className="flex flex-wrap gap-1">
                            {categories.map(cat => (
                              <button key={cat} onClick={e => { e.stopPropagation(); setSkillCategoryFilter(cat) }}
                                className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
                                  skillCategoryFilter === cat ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                }`}
                              >
                                {cat === 'all' ? (t('skills.allCategories') || '全部') : cat}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                    <div className="max-h-60 overflow-y-auto">
                      {(() => {
                        const filteredSkills = skillCategoryFilter === 'all' ? skills : skills.filter(s => s.category === skillCategoryFilter)
                        if (skillCategoryFilter === 'all') {
                          const grouped = filteredSkills.reduce((acc, s) => {
                            if (!acc[s.category]) acc[s.category] = []
                            acc[s.category].push(s)
                            return acc
                          }, {} as Record<string, Skill[]>)
                          return Object.entries(grouped).map(([category, categorySkills]) => (
                            <div key={category}>
                              <div className="px-4 py-1.5 text-xs font-medium text-gray-400 bg-gray-50">{category}</div>
                              {categorySkills.map(s => (
                                <DropdownItem key={s.id} onClick={() => { setSelectedSkill(s.id); setShowSkillDropdown(false) }}>
                                  <div className="flex flex-col">
                                    <span>{s.name}</span>
                                    {s.estimated_time && <span className="text-xs text-gray-400">{s.estimated_time}</span>}
                                  </div>
                                </DropdownItem>
                              ))}
                            </div>
                          ))
                        }
                        return filteredSkills.map(s => (
                          <DropdownItem key={s.id} onClick={() => { setSelectedSkill(s.id); setShowSkillDropdown(false) }}>
                            <div className="flex flex-col">
                              <span>{s.name}</span>
                              {s.estimated_time && <span className="text-xs text-gray-400">{s.estimated_time}</span>}
                            </div>
                          </DropdownItem>
                        ))
                      })()}
                    </div>
                  </DropdownMenu>
                )}
              </ContextPill>
            </div>

            {selectedSkillData && <SkillRequirementsPanel skill={selectedSkillData} />}

            {/* Textarea + actions */}
            <div className="flex items-end gap-3 bg-white rounded-2xl px-4 py-3 shadow-[0_2px_14px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] focus-within:ring-primary/20 focus-within:shadow-[0_4px_20px_rgba(0,63,177,0.09)] transition-all duration-200">
              <button className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-300 hover:text-gray-500 flex-shrink-0 mb-0.5">
                <Paperclip className="w-4 h-4" />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={t('chat.placeholder')}
                disabled={sending}
                rows={1}
                className="flex-1 bg-transparent text-[15px] text-gray-700 placeholder:text-gray-300 outline-none py-1.5 resize-none overflow-hidden disabled:opacity-50 leading-relaxed"
                style={{ minHeight: '36px', maxHeight: '180px' }}
              />
              {sending ? (
                <button onClick={handleStop} title={t('chat.stopGeneration')}
                  className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors flex-shrink-0 mb-0.5"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button onClick={handleSend} disabled={!input.trim()}
                  className="p-2 rounded-xl bg-gradient-to-br from-primary to-indigo-500 text-white hover:opacity-90 active:scale-95 transition-all disabled:opacity-25 flex-shrink-0 mb-0.5 shadow-sm shadow-primary/20"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-300 mt-2 text-center tracking-wide">
              {t('chat.shiftEnter')} · {t('chat.enterToSend')}
            </p>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('chat.deleteTitle')}</h3>
            <p className="text-sm text-gray-500 mb-6">
              {t('chat.deleteConfirm')} {t('chat.deleteWarning')}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteDialog(false); setDeleteTargetId(null) }}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skill Template Modal */}
      {showSkillTemplateModal && skillTemplateData && (
        <SkillTemplateModal
          skill={skillTemplateData.skill}
          variables={skillTemplateData.variables}
          onApply={handleApplyTemplate}
          onCancel={handleCancelTemplate}
        />
      )}
    </div>
  )
}

// Helper to extract minutes from estimated_time like "~2 min", "~10 min", "15–20 分钟"
const extractMinutes = (estimatedTime?: string): number => {
  if (!estimatedTime) return 0
  const match = estimatedTime.match(/(\d+)/)
  return match ? parseInt(match[1]) : 0
}

// ─── SkillRequirementsPanel ─────────────────────────────────────────────────
function SkillRequirementsPanel({ skill }: { skill: Skill }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  
  const isQuick = extractMinutes(skill.estimated_time) <= 10
  
  return (
    <div className="mb-3 rounded-xl bg-primary/5 border border-gray-200 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-primary/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-gray-700">
            {t('chat.skillRequirements') || '技能要求'}
          </span>
          <span className="text-xs text-gray-400">
            {skill.name}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            isQuick ? 'bg-emerald-500/10 text-emerald-600' : 'bg-primary/10 text-primary'
          }`}>
            {isQuick ? (t('skills.types.quick') || '快速') : (t('skills.types.deep') || '深度')}
          </span>
          {skill.estimated_time && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="w-3 h-3" />
              {skill.estimated_time}
            </span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      
      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-200">
          <div className="pt-3 space-y-3">
            {/* Description */}
            {skill.description && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">
                  {t('skills.description') || '描述'}
                </p>
                <p className="text-sm text-gray-700">{skill.description}</p>
              </div>
            )}
            
            {/* System Prompt */}
            {skill.system_prompt && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">
                  {t('skills.systemPrompt') || '系统提示词'}
                </p>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <p className="text-xs text-gray-700 leading-relaxed line-clamp-4 font-mono">
                    {skill.system_prompt}
                  </p>
                </div>
              </div>
            )}
            
            {/* User Template */}
            {skill.user_template && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">
                  {t('skills.userTemplate') || '用户模板'}
                </p>
                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                  <p className="text-xs text-gray-700 leading-relaxed font-mono">
                    {skill.user_template}
                  </p>
                </div>
              </div>
            )}
            
            {/* Category & Tools */}
            <div className="flex items-center gap-4 pt-1">
              <div>
                <span className="text-xs text-gray-400">{t('skills.category') || '类别'}: </span>
                <span className="text-xs font-medium text-gray-700">{skill.category}</span>
              </div>
              {skill.tools_definition_json && (
                <div>
                  <span className="text-xs text-gray-400">{t('skills.tools') || '工具'}: </span>
                  <span className="text-xs font-medium text-gray-700">
                    {(() => {
                      try {
                        const tools = JSON.parse(skill.tools_definition_json)
                        return Array.isArray(tools) ? tools.length + ' tools' : 'enabled'
                      } catch {
                        return 'enabled'
                      }
                    })()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper to escape special regex characters
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ─── SkillTemplateModal ─────────────────────────────────────────────────────
interface SkillTemplateModalProps {
  skill: Skill
  variables: { name: string; value: string }[]
  onApply: (filledTemplate: string) => void | Promise<void>
  onCancel: () => void
}

function SkillTemplateModal({ skill, variables, onApply, onCancel }: SkillTemplateModalProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    variables.forEach(v => { initial[v.name] = v.value })
    return initial
  })

  // Generate preview by replacing variables in template
  const preview = useMemo(() => {
    let result = skill.user_template || ''
    Object.entries(values).forEach(([name, value]) => {
      if (!value) return
      
      // Format 1: [变量名] or {{变量名}}
      const placeholderRegex = new RegExp(`\\[${escapeRegex(name)}\\]|\\{\\{${escapeRegex(name)}\\}\\}`, 'g')
      result = result.replace(placeholderRegex, value)
      
      // Format 2: 变量名： or 变量名: (append value after colon)
      // Match lines like "公司 / 产品：" or "- 客户数量级："
      const lines = result.split('\n')
      const updatedLines = lines.map(line => {
        const trimmed = line.trim()
        // Check if line starts with the variable name followed by colon
        const colonMatch = trimmed.match(/^(?:[-•]\s*)?(.+?)([：:])\s*$/)
        if (colonMatch) {
          const lineVarName = colonMatch[1].trim()
          if (lineVarName === name || lineVarName.includes(name)) {
            // Replace empty line with filled value
            return line + value
          }
        }
        return line
      })
      result = updatedLines.join('\n')
    })
    return result
  }, [values, skill.user_template])

  const handleApply = async () => {
    await onApply(preview)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Wrench className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{skill.name}</h3>
              <p className="text-xs text-gray-500">{t('chat.fillTemplate') || '填写模板变量'}</p>
            </div>
          </div>
          <button 
            onClick={onCancel}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[60vh] overflow-auto">
          {/* Description */}
          {skill.description && (
            <p className="text-sm text-gray-500 mb-4">{skill.description}</p>
          )}

          {/* Variable Inputs */}
          {variables.length > 0 ? (
            <div className="space-y-3 mb-4">
              {variables.map((variable, idx) => (
                <div key={variable.name}>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    {variable.name}
                  </label>
                  <input
                    type="text"
                    value={values[variable.name] || ''}
                    onChange={(e) => setValues(prev => ({ ...prev, [variable.name]: e.target.value }))}
                    placeholder={`请输入${variable.name}...`}
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:border-primary/50 transition-colors"
                    autoFocus={idx === 0}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="mb-4 p-3 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-sm text-gray-500">{t('chat.noVariables') || '此模板没有需要填写的变量'}</p>
            </div>
          )}

          {/* Preview */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">{t('chat.preview') || '预览'}</p>
            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{preview}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl transition-colors flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            {t('chat.applyAndSend') || '应用并发送'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Export Dropdown Component ──────────────────────────────────────────────
function ExportDropdown({ conversationId, conversationTitle }: { 
  conversationId: number
  conversationTitle?: string 
}) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])
  
  const handleExport = async (format: 'markdown' | 'pdf') => {
    setIsExporting(true)
    try {
      const token = localStorage.getItem('authToken')
      const response = await fetch(`${getApiBaseUrl()}/chat/conversations/${conversationId}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token || '',
        },
        body: JSON.stringify({ format }),
      })
      
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`)
      }
      
      // Download the file
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      
      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('content-disposition')
      let filename = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1]
      if (!filename) {
        const safeTitle = (conversationTitle || 'conversation').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
        filename = `${safeTitle}.${format === 'markdown' ? 'md' : 'pdf'}`
      }
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      
      setIsOpen(false)
    } catch (err) {
      console.error('Export failed:', err)
      alert(t('chat.exportFailed'))
    } finally {
      setIsExporting(false)
    }
  }
  
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        title={t('chat.export')}
      >
        {isExporting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">{t('chat.export')}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 animate-fade-in">
          <button
            onClick={() => handleExport('markdown')}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-4 h-4 text-gray-400" />
            {t('chat.exportMarkdown')}
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileIcon className="w-4 h-4 text-red-400" />
            {t('chat.exportPDF')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── MessageRow ─────────────────────────────────────────────────────────────
function MessageRow({ message }: { message: Message }) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'

  // Parse references from metadata_json
  let references: Array<{ type: string; id: number; title: string }> = []
  try {
    const meta = JSON.parse(message.metadata_json || '{}')
    references = meta.references || []
  } catch (_) {}

  return (
    <div className={`flex items-start gap-3.5 group ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
        isUser
          ? 'bg-gray-200'
          : 'bg-gradient-to-br from-primary to-indigo-500 shadow-sm shadow-primary/20'
      }`}>
        {isUser ? (
          <span className="text-[10px] font-semibold text-gray-500">{t('chat.you')}</span>
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-white" />
        )}
      </div>

      {/* Content + actions */}
      <div className={`flex-1 flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Role label */}
        <p className="text-[11px] font-medium text-gray-300 mb-1.5 px-0.5">
          {isUser ? t('chat.you') : 'Aria'}
        </p>

        <div className={`max-w-[85%] ${
          isUser
            ? 'px-4 py-2.5 bg-gray-900 text-white rounded-2xl rounded-tr-sm text-[15px] leading-[1.7]'
            : 'text-[15px] leading-[1.8] text-gray-700'
        }`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="md-root">
              <MarkdownRenderer content={message.content} />
            </div>
          )}
        </div>

        {/* References */}
        {!isUser && references.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {references.map((ref, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-[11px] text-gray-500 border border-gray-200">
                {ref.type === 'skill' && <Wrench className="w-3 h-3" />}
                {ref.type === 'doc' && <BookOpen className="w-3 h-3" />}
                {ref.type === 'file' && <FileIcon className="w-3 h-3" />}
                {ref.title}
              </span>
            ))}
          </div>
        )}

        {/* Timestamp + copy — visible on hover */}
        <div className={`flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-[11px] text-gray-300 px-0.5">{formatTime(message.created_at)}</span>
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
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] transition-colors ${
        active
          ? secondary
            ? 'bg-gray-100/80 text-gray-600'
            : 'bg-primary/8 text-primary'
          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/70'
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
function DropdownMenu({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 z-50 ${wide ? 'w-80' : 'w-60'}`}>
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
      className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors ${
        muted ? 'text-gray-400' : 'text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}
