import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, CheckCheck, ExternalLink, Loader2, MailOpen, RefreshCw } from 'lucide-react'
import { PageTitle } from '../../components/PageTitle'
import { api } from '../../api/client'
import type { SystemMessage, SystemMessageListResponse } from '../../types/api'

function getLevelClasses(level: SystemMessage['level']) {
  switch (level) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'error':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    default:
      return 'border-sky-200 bg-sky-50 text-sky-700'
  }
}

export function MessagesPage() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [error, setError] = useState('')
  const [messages, setMessages] = useState<SystemMessage[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const loadMessages = async () => {
    try {
      setLoading(true)
      setError('')
      const result = await api.get<SystemMessageListResponse>('/messages')
      setMessages(result.items)
      setUnreadCount(result.unread_count)
      window.dispatchEvent(new Event('messages:updated'))
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMessages()
  }, [])

  const markRead = async (messageId: number) => {
    try {
      await api.post(`/messages/${messageId}/read`)
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { ...message, is_read: true, read_at: new Date().toISOString() }
            : message,
        ),
      )
      setUnreadCount((current) => Math.max(0, current - 1))
      window.dispatchEvent(new Event('messages:updated'))
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to mark message as read')
    }
  }

  const markAllRead = async () => {
    try {
      setMarkingAll(true)
      await api.post('/messages/read-all')
      await loadMessages()
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to mark all messages as read')
    } finally {
      setMarkingAll(false)
    }
  }

  const unreadMessages = useMemo(
    () => messages.filter((message) => !message.is_read),
    [messages],
  )

  return (
    <>
      <PageTitle title={isZh ? '消息中心' : 'Messages'} />
      <div className="min-h-full bg-surface">
        <div className="w-full space-y-6 px-8 py-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Bell className="h-3.5 w-3.5" />
                {isZh ? '消息中心' : 'Messages'}
              </div>
              <h1 className="text-2xl font-semibold text-on-surface">
                {isZh ? '查看系统通知与管理员消息' : 'System notices and admin announcements'}
              </h1>
              <p className="mt-2 text-sm text-on-surface-muted">
                {isZh
                  ? `当前有 ${unreadCount} 条未读消息。`
                  : `You currently have ${unreadCount} unread message${unreadCount === 1 ? '' : 's'}.`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadMessages()}
                className="inline-flex items-center gap-2 rounded-xl border border-outline/20 px-4 py-2 text-sm text-on-surface-secondary transition hover:bg-surface-container-high"
              >
                <RefreshCw className="h-4 w-4" />
                {isZh ? '刷新' : 'Refresh'}
              </button>
              <button
                onClick={() => void markAllRead()}
                disabled={markingAll || unreadMessages.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {markingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCheck className="h-4 w-4" />
                )}
                {isZh ? '全部标记已读' : 'Mark all as read'}
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : null}

          {!loading && messages.length === 0 ? (
            <div className="rounded-3xl border border-outline/10 bg-surface-container-low px-6 py-20 text-center">
              <MailOpen className="mx-auto mb-4 h-10 w-10 text-on-surface-muted" />
              <p className="text-sm text-on-surface-muted">
                {isZh ? '暂时还没有系统消息。' : 'No system messages yet.'}
              </p>
            </div>
          ) : null}

          {!loading ? (
            <div className="grid gap-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-3xl border px-6 py-5 shadow-sm transition ${
                    message.is_read
                      ? 'border-outline/10 bg-surface-container-low'
                      : 'border-primary/15 bg-white'
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${getLevelClasses(message.level)}`}
                        >
                          {message.level}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            message.is_read
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-primary/10 text-primary'
                          }`}
                        >
                          {message.is_read ? (isZh ? '已读' : 'Read') : (isZh ? '未读' : 'Unread')}
                        </span>
                        <span className="text-xs text-on-surface-muted">
                          {new Date(message.created_at).toLocaleString(isZh ? 'zh-CN' : 'en-US')}
                        </span>
                      </div>

                      <h2 className="text-lg font-semibold text-on-surface">{message.title}</h2>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-on-surface-secondary">
                        {message.content}
                      </p>

                      {message.created_by_display_name ? (
                        <p className="mt-3 text-xs text-on-surface-muted">
                          {isZh ? '发布人：' : 'Published by: '}
                          {message.created_by_display_name}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {message.link ? (
                        <button
                          onClick={() => navigate(message.link)}
                          className="inline-flex items-center gap-2 rounded-xl border border-outline/20 px-3 py-2 text-sm text-on-surface-secondary transition hover:bg-surface-container-high"
                        >
                          <ExternalLink className="h-4 w-4" />
                          {isZh ? '打开链接' : 'Open'}
                        </button>
                      ) : null}

                      {!message.is_read ? (
                        <button
                          onClick={() => void markRead(message.id)}
                          className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary/90"
                        >
                          <CheckCheck className="h-4 w-4" />
                          {isZh ? '标记已读' : 'Mark read'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
