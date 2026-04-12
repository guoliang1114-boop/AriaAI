import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Trash2, ChevronRight, Sparkles } from 'lucide-react'
import { api } from '../../api/client'
import type { Conversation } from '../../types'

export function Conversations() {
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchConversations()
  }, [])

  const fetchConversations = async () => {
    try {
      const data = await api.get<Conversation[]>('/chat/conversations')
      setConversations(data)
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个对话吗？')) return
    try {
      await api.delete(`/chat/conversations/${id}`)
      setConversations(prev => prev.filter(c => c.id !== id))
    } catch (error) {
      console.error('Failed to delete conversation:', error)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--color-accent-200)] border-t-[var(--color-accent-600)] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">历史对话</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">查看和管理你的对话记录</p>
          </div>
        </div>
        
        {conversations.length === 0 ? (
          <div className="text-center py-16 bg-[var(--color-bg-primary)] rounded-2xl border border-[var(--color-border-default)]">
            <div className="w-16 h-16 bg-[var(--color-bg-tertiary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-[var(--color-text-tertiary)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">暂无对话</h3>
            <p className="text-[var(--color-text-muted)]">还没有任何对话记录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map(conv => (
              <div
                key={conv.id}
                className="group bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-4 hover:shadow-lg hover:shadow-black/5 transition-all cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div
                    className="flex-1"
                    onClick={() => navigate(`/chat/${conv.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[var(--color-accent-50)] rounded-xl flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-[var(--color-accent-600)]" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-[var(--color-text-primary)]">{conv.title}</h3>
                        <p className="text-sm text-[var(--color-text-muted)]">
                          {formatDate(conv.updated_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDelete(conv.id)}
                      className="p-2 hover:bg-[var(--color-error-50)] rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4 text-[var(--color-error-500)]" />
                    </button>
                    <ChevronRight className="w-5 h-5 text-[var(--color-text-tertiary)]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
