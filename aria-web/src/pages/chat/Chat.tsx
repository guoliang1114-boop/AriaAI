import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { 
  Paperclip, 
  FolderKanban, 
  Wrench, 
  Search,
  Share,
  Download,
  Sparkles,
  ChevronRight,
  Loader2,
  Plus,
  MessageSquare,
  Clock,
  ChevronUp
} from 'lucide-react'
import { api } from '../../api/client'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { PageTitle } from '../../components/PageTitle'
import type { Conversation, Message, Project, Skill } from '../../types/api'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

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
  
  // 分页加载状态
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const projectDropdownRef = useRef<HTMLDivElement>(null)
  const skillDropdownRef = useRef<HTMLDivElement>(null)
  const streamingContentRef = useRef('')  // 用 ref 累积内容，减少重新渲染
  const isStreamingRef = useRef(false)
  const oldestMessageIdRef = useRef<number | null>(null)
  const scrollHeightBeforeLoadRef = useRef<number>(0)

  // Fetch initial data (conversations, projects, skills)
  useEffect(() => {
    fetchInitialData()
  }, [])

  // Load conversation if ID provided
  useEffect(() => {
    if (conversationId) {
      loadConversation(parseInt(conversationId))
    } else {
      // Reset state when creating new chat
      setLoading(false)
      setMessages([])
      setConversation(null)
      setStreamingContent('')
      setSending(false)
    }
  }, [conversationId])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setShowProjectDropdown(false)
      }
      if (skillDropdownRef.current && !skillDropdownRef.current.contains(event.target as Node)) {
        setShowSkillDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchInitialData = async () => {
    try {
      const [convsData, projectsData, skillsData] = await Promise.all([
        api.get<Conversation[]>('/chat/conversations'),
        api.get<Project[]>('/projects'),
        api.get<Skill[]>('/skills')
      ])
      setConversations(convsData)
      setProjects(projectsData)
      setSkills(skillsData)
    } catch (error) {
      console.error('Failed to fetch initial data:', error)
    }
  }

  const loadConversation = async (id: number, beforeId?: number) => {
    try {
      if (beforeId) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }
      
      // Find conversation from list
      const convData = conversations.find(c => c.id === id)
      if (convData && !beforeId) {
        setConversation(convData)
      }
      
      // Load messages with pagination
      const url = beforeId 
        ? `/chat/conversations/${id}/messages?before_id=${beforeId}&limit=3`
        : `/chat/conversations/${id}/messages?limit=3`
      const messagesData = await api.get<Message[]>(url)
      
      if (beforeId) {
        // 保存当前滚动高度
        const container = messagesContainerRef.current
        if (container) {
          scrollHeightBeforeLoadRef.current = container.scrollHeight
        }
        
        // 追加到现有消息前面
        setMessages(prev => [...messagesData, ...prev])
        
        // 检查是否还有更多
        setHasMore(messagesData.length === 3)
      } else {
        setMessages(messagesData)
        setHasMore(messagesData.length === 30)
        // 记录最老的消息ID
        if (messagesData.length > 0) {
          oldestMessageIdRef.current = messagesData[0].id
        }
      }
      
      console.log('[Chat] Loaded messages:', messagesData.length, beforeId ? '(more)' : '(initial)')
    } catch (error) {
      console.error('Failed to load conversation:', error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // 加载更多历史消息
  const loadMoreMessages = useCallback(async () => {
    if (!conversationId || loadingMore || !hasMore) return
    
    const oldestId = messages.length > 0 ? messages[0].id : null
    if (!oldestId) return
    
    await loadConversation(parseInt(conversationId), oldestId)
  }, [conversationId, loadingMore, hasMore, messages])

  // 滚动监听 - 接近顶部时加载更多
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      // 当滚动到顶部 100px 范围内时加载更多
      if (container.scrollTop < 100 && hasMore && !loadingMore && messages.length > 0) {
        loadMoreMessages()
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [hasMore, loadingMore, messages.length, loadMoreMessages])

  // 加载更多后保持滚动位置
  useEffect(() => {
    if (loadingMore) return
    
    const container = messagesContainerRef.current
    if (container && scrollHeightBeforeLoadRef.current > 0) {
      const newScrollHeight = container.scrollHeight
      const heightDiff = newScrollHeight - scrollHeightBeforeLoadRef.current
      container.scrollTop = heightDiff
      scrollHeightBeforeLoadRef.current = 0
    }
  }, [loadingMore, messages.length])

  const createNewConversation = async () => {
    try {
      // Clear current state first to prevent duplicate creation on refresh
      setConversation(null)
      setMessages([])
      setStreamingContent('')
      setSending(false)
      
      const newConv = await api.post<Conversation>('/chat/conversations', {
        project_id: selectedProject,
        skill_id: selectedSkill
      })
      setConversations(prev => [newConv, ...prev])
      navigate(`/chat?conversation=${newConv.id}`, { replace: true })
    } catch (error) {
      console.error('Failed to create conversation:', error)
    }
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  // 只在消息列表变化时自动滚动（流式时不滚动，让用户可以滚动查看）
  useEffect(() => {
    if (!isStreamingRef.current) {
      scrollToBottom()
    }
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || sending) return
    
    setSending(true)
    streamingContentRef.current = ''
    setStreamingContent('')
    isStreamingRef.current = true
    
    try {
      // Create new conversation if needed
      let currentConvId = conversation?.id
      if (!currentConvId) {
        const newConv = await api.post<Conversation>('/chat/conversations', {
          project_id: selectedProject,
          skill_id: selectedSkill
        })
        currentConvId = newConv.id
        setConversation(newConv)
        setConversations(prev => [newConv, ...prev])
        navigate(`/chat?conversation=${newConv.id}`, { replace: true })
      }

      // Add user message to UI immediately
      const userMessage: Message = {
        id: Date.now(),
        conversation_id: currentConvId,
        role: 'user',
        content: input,
        metadata_json: '{}',
        created_at: new Date().toISOString()
      }
      setMessages(prev => [...prev, userMessage])
      setInput('')
      
      // Show thinking state
      setIsThinking(true)

      // Send message via SSE
      const token = localStorage.getItem('authToken')
      const response = await fetch(`${API_BASE_URL}/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token || ''
        },
        body: JSON.stringify({
          conversation_id: currentConvId,
          content: userMessage.content,
          project_id: selectedProject,
          skill_id: selectedSkill,
          rag_doc_ids: [],
          file_ids: []
        })
      })

      if (!response.ok) {
        throw new Error('Failed to send message')
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      let assistantContent = ''
      let updateTimer: ReturnType<typeof setTimeout> | null = null
      let pendingContent = ''
      
      // 批量更新 UI 的函数
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
        
        const text = new TextDecoder().decode(value)
        const lines = text.split('\n')
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              if (data.type === 'chunk' && data.content) {
                assistantContent += data.content
                streamingContentRef.current = assistantContent
                
                // 节流：最多每 100ms 更新一次 UI
                if (!updateTimer) {
                  updateTimer = setTimeout(() => {
                    flushUpdate()
                    updateTimer = null
                  }, 100)
                }
              } else if (data.type === 'done') {
                // 清除待更新的 timer
                if (updateTimer) {
                  clearTimeout(updateTimer)
                  updateTimer = null
                }
                
                // 确保最后一次内容更新到 UI
                flushUpdate()
                
                // 稍等一下确保 UI 更新后再添加到消息列表
                await new Promise(resolve => setTimeout(resolve, 50))
                
                // Add complete assistant message
                const assistantMessage: Message = {
                  id: Date.now() + 1,
                  conversation_id: currentConvId,
                  role: 'assistant',
                  content: assistantContent,
                  metadata_json: JSON.stringify({ references: data.references || [] }),
                  created_at: new Date().toISOString()
                }
                setMessages(prev => [...prev, assistantMessage])
                setStreamingContent('')
                streamingContentRef.current = ''
                isStreamingRef.current = false
                setIsThinking(false)
              } else if (data.type === 'error') {
                console.error('Stream error:', data.error)
                if (updateTimer) {
                  clearTimeout(updateTimer)
                  updateTimer = null
                }
                setIsThinking(false)
                isStreamingRef.current = false
              }
            } catch (e) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }
      
      // 流正常结束时也要清理状态
      if (updateTimer) {
        clearTimeout(updateTimer)
      }
      isStreamingRef.current = false
      setIsThinking(false)
    } catch (error) {
      console.error('Failed to send message:', error)
      setIsThinking(false)
      isStreamingRef.current = false
    } finally {
      setSending(false)
    }
  }

  const selectedProjectData = projects.find(p => p.id === selectedProject)
  const selectedSkillData = skills.find(s => s.id === selectedSkill)

  return (
    <div className="h-full flex bg-surface">
      <PageTitle title="Chat" />
      {/* Sidebar - Conversation List */}
      <div className="w-72 border-r border-outline/10 flex flex-col bg-surface-container-low/30">
        <div className="p-4 border-b border-outline/10">
          <button
            onClick={createNewConversation}
            className="w-full btn-primary flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {conversations.map((conv) => (
            <Link
              key={conv.id}
              to={`/chat?conversation=${conv.id}`}
              className={`flex items-start gap-3 p-3 rounded-xl mb-1 transition-colors ${
                conversationId === String(conv.id)
                  ? 'bg-secondary-container/50'
                  : 'hover:bg-surface-container-low'
              }`}
            >
              <MessageSquare className="w-4 h-4 text-on-surface-muted mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${
                  conversationId === String(conv.id) ? 'text-primary font-medium' : 'text-on-surface'
                }`}>
                  {conv.title || 'New Conversation'}
                </p>
                <p className="text-xs text-on-surface-muted flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" />
                  {new Date(conv.updated_at).toLocaleDateString()}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="glass border-b border-outline/10 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              {(selectedProjectData || selectedSkillData) && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary-container/50 mb-2">
                  <span className="text-label-sm text-primary">
                    {selectedProjectData ? 'PROJECT CONTEXT' : selectedSkillData ? 'SKILL MODE' : 'CHAT'}
                  </span>
                </div>
              )}
              <h1 className="text-headline-sm text-on-surface">
                {conversation?.title || 'New Conversation'}
              </h1>
              <p className="text-body-sm text-on-surface-muted">
                {selectedProjectData ? `${selectedProjectData.name} • ${selectedProjectData.client}` : 
                 selectedSkillData ? `${selectedSkillData.name} • ${selectedSkillData.category}` : 
                 'General conversation'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container-low text-sm font-medium text-on-surface hover:bg-surface-container-high transition-colors">
                <Share className="w-4 h-4" />
                Share
              </button>
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container-low text-sm font-medium text-on-surface hover:bg-surface-container-high transition-colors">
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
          </div>
        </div>

        {/* Chat Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-auto px-6 py-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Load More Indicator */}
            {loadingMore && (
              <div className="flex flex-col items-center justify-center py-4">
                <Loader2 className="w-6 h-6 text-primary animate-spin mb-2" />
                <span className="text-sm text-on-surface-muted">Loading more...</span>
              </div>
            )}
            
            {/* Load More Button (fallback) */}
            {!loadingMore && hasMore && messages.length > 0 && (
              <button
                onClick={loadMoreMessages}
                className="w-full flex items-center justify-center gap-2 py-3 text-sm text-on-surface-muted hover:text-primary transition-colors"
              >
                <ChevronUp className="w-4 h-4" />
                Load earlier messages
              </button>
            )}
            
            {/* Loading State */}
            {loading && conversationId && messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="relative">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-primary flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-gradient-primary animate-ping opacity-20"></div>
                </div>
                <p className="mt-4 text-body-md text-on-surface-muted">Loading conversation history...</p>
              </div>
            ) : messages.length === 0 && !streamingContent ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 rounded-2xl bg-gradient-primary flex items-center justify-center mx-auto mb-6">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-headline-sm text-on-surface mb-2">How can I help you today?</h2>
                <p className="text-body-md text-on-surface-muted max-w-md mx-auto">
                  Start a conversation or select a project/skill from the options below to get context-aware assistance.
                </p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {message.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center flex-shrink-0 mr-3">
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div className={`max-w-3xl px-6 py-4 ${
                      message.role === 'user' 
                        ? 'bg-surface-container-high rounded-2xl rounded-tr-sm' 
                        : 'bg-surface-container-lowest rounded-2xl rounded-tl-sm border border-outline/10'
                    }`}>
                      <div className="md-root">
                        <MarkdownRenderer content={message.content} />
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* AI 回复状态：thinking 或 streaming，只显示一个 */}
                {(isThinking || streamingContent) && (
                  <div className="flex justify-start">
                    <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center flex-shrink-0 mr-3">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className="max-w-3xl px-6 py-4 bg-surface-container-lowest rounded-2xl rounded-tl-sm border border-outline/10">
                      {streamingContent ? (
                        <>
                          <div className="md-root">
                            <MarkdownRenderer content={streamingContent} />
                          </div>
                          <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse"></span>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 text-on-surface-muted">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm">AI is thinking...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="glass border-t border-outline/10 px-6 py-4">
          <div className="max-w-4xl mx-auto">
            {/* Context Pills */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {/* Project Selector */}
              <div className="relative" ref={projectDropdownRef}>
                <button 
                  onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    selectedProject 
                      ? 'bg-primary/10 text-primary' 
                      : 'bg-surface-container-low text-on-surface-muted hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  <FolderKanban className="w-4 h-4" />
                  {selectedProjectData ? selectedProjectData.name : 'Project'}
                </button>
                {showProjectDropdown && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-surface-container-lowest rounded-xl shadow-lg border border-outline/10 py-2 z-50">
                    <button 
                      onClick={() => { setSelectedProject(null); setShowProjectDropdown(false) }}
                      className="w-full px-4 py-2 text-left text-sm text-on-surface-muted hover:bg-surface-container-low"
                    >
                      Clear selection
                    </button>
                    <div className="border-t border-outline/10 my-1"></div>
                    {projects.map(p => (
                      <button 
                        key={p.id}
                        onClick={() => { setSelectedProject(p.id); setShowProjectDropdown(false) }}
                        className="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Skill Selector */}
              <div className="relative" ref={skillDropdownRef}>
                <button 
                  onClick={() => setShowSkillDropdown(!showSkillDropdown)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    selectedSkill 
                      ? 'bg-secondary-container text-on-secondary-container' 
                      : 'bg-surface-container-low text-on-surface-muted hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  <Wrench className="w-4 h-4" />
                  {selectedSkillData ? selectedSkillData.name : '@ Skills'}
                </button>
                {showSkillDropdown && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-surface-container-lowest rounded-xl shadow-lg border border-outline/10 py-2 z-50">
                    <button 
                      onClick={() => { setSelectedSkill(null); setShowSkillDropdown(false) }}
                      className="w-full px-4 py-2 text-left text-sm text-on-surface-muted hover:bg-surface-container-low"
                    >
                      Clear selection
                    </button>
                    <div className="border-t border-outline/10 my-1"></div>
                    {skills.map(s => (
                      <button 
                        key={s.id}
                        onClick={() => { setSelectedSkill(s.id); setShowSkillDropdown(false) }}
                        className="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low"
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-low text-sm text-on-surface-muted hover:text-on-surface hover:bg-surface-container-high transition-colors">
                <Search className="w-4 h-4" />
                / Context
              </button>
            </div>

            {/* Input Field */}
            <div className="flex items-center gap-3 bg-surface-container-lowest rounded-2xl p-2 shadow-sm">
              <button className="p-3 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-muted">
                <Paperclip className="w-5 h-5" />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="Type your message..."
                disabled={sending}
                className="flex-1 bg-transparent text-body-md text-on-surface placeholder:text-on-surface-muted outline-none py-3 disabled:opacity-50"
              />
              <button 
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="p-3 rounded-xl bg-gradient-primary text-white hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <ChevronRight className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
