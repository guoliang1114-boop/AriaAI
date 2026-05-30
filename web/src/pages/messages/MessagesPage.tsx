import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Info,
  Loader2,
  MailOpen,
  RefreshCw,
  ArrowRight,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { PageTitle } from '../../components/PageTitle'
import { api } from '../../api/client'
import type { SystemMessage, SystemMessageListResponse } from '../../types/api'
import { useAppTimeZone } from '../../hooks/useAppTimeZone'
import { formatDateTime, parseAppDateTime } from '../../utils/timezone'

type FilterKey = 'all' | 'unread'

const LEVEL_ICON: Record<SystemMessage['level'], LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  error: XCircle,
}

const LEVEL_TONE: Record<SystemMessage['level'], { color: string; bg: string }> = {
  info: {
    color: 'var(--color-codex-accent)',
    bg: 'color-mix(in oklch, var(--color-codex-accent) 14%, transparent)',
  },
  success: {
    color: 'var(--color-codex-good)',
    bg: 'color-mix(in oklch, var(--color-codex-good) 14%, transparent)',
  },
  warning: {
    color: 'var(--color-codex-warn)',
    bg: 'color-mix(in oklch, var(--color-codex-warn) 16%, transparent)',
  },
  error: {
    color: 'var(--color-codex-bad)',
    bg: 'color-mix(in oklch, var(--color-codex-bad) 14%, transparent)',
  },
}

function relativeTime(dateStr: string, isZh: boolean, timeZone?: string) {
  const d = parseAppDateTime(dateStr)
  const now = Date.now()
  const diff = now - d.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  if (minutes < 1) return isZh ? '刚刚' : 'just now'
  if (minutes < 60) return isZh ? `${minutes} 分钟前` : `${minutes}m ago`
  if (hours < 24) return isZh ? `${hours} 小时前` : `${hours}h ago`
  // yesterday vs date
  const day = 86400000
  if (diff < 2 * day) return isZh ? '昨天' : 'yesterday'
  return formatDateTime(
    dateStr,
    isZh ? 'zh-CN' : 'en-US',
    { year: 'numeric', month: '2-digit', day: '2-digit' },
    timeZone,
  )
}

export function MessagesPage() {
  const { i18n } = useTranslation()
  const { resolvedTimeZone } = useAppTimeZone()
  const isZh = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [error, setError] = useState('')
  const [messages, setMessages] = useState<SystemMessage[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  const loadMessages = async () => {
    try {
      setLoading(true)
      setError('')
      const result = await api.get<SystemMessageListResponse>('/messages')
      const items = Array.isArray(result?.items) ? result.items : []
      setMessages(items)
      setUnreadCount(
        Number.isFinite(result?.unread_count)
          ? result.unread_count
          : items.filter((message) => !message.is_read).length,
      )
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

  const filteredMessages = useMemo(() => {
    if (filter === 'unread') return messages.filter((message) => !message.is_read)
    return messages
  }, [messages, filter])

  // Keep a selection in sync with the current filter. When the active message
  // falls off (e.g. user switches to "unread" but the selected one is read),
  // jump to the first item in the new view.
  useEffect(() => {
    if (!filteredMessages.length) {
      setActiveId(null)
      return
    }
    if (activeId == null || !filteredMessages.some((m) => m.id === activeId)) {
      setActiveId(filteredMessages[0].id)
    }
  }, [filteredMessages, activeId])

  // Opening a message implies reading it. The earlier flow required a
  // second click on "标记已读" in the detail pane — a chore. This effect
  // covers both manual clicks and the auto-select-first behavior above.
  useEffect(() => {
    if (activeId == null) return
    const active = messages.find((m) => m.id === activeId)
    if (active && !active.is_read) void markRead(activeId)
    // markRead is stable across renders (no React deps); we only want to
    // fire when the selected message changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messages])

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

  const activeMessage = useMemo(
    () => messages.find((m) => m.id === activeId) || null,
    [messages, activeId],
  )

  const totalCount = messages.length

  return (
    <>
      <PageTitle title={isZh ? '消息中心' : 'Messages'} />
      <div
        className="theme-codex grid h-full min-h-0 overflow-hidden"
        style={{
          gridTemplateColumns: '340px 1fr',
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-ink)',
        }}
      >
        {/* ── LEFT: list ── */}
        <aside
          className="flex min-h-0 flex-col overflow-hidden"
          style={{
            background: 'var(--color-codex-bg-elev)',
            borderRight: '1px solid var(--color-codex-line)',
          }}
        >
          {/* Header */}
          <div className="flex-shrink-0" style={{ padding: '18px 20px 12px' }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 500,
                    letterSpacing: '-0.015em',
                    color: 'var(--color-codex-ink)',
                  }}
                >
                  {isZh ? '消息中心' : 'Messages'}
                </h1>
                <p
                  style={{
                    margin: '4px 0 0',
                    fontSize: 12,
                    color: 'var(--color-codex-ink-mute)',
                  }}
                >
                  {isZh
                    ? `${totalCount} 条消息 · ${unreadCount} 条未读`
                    : `${totalCount} message${totalCount === 1 ? '' : 's'} · ${unreadCount} unread`}
                </p>
              </div>
              <button
                onClick={() => void loadMessages()}
                aria-label={isZh ? '刷新' : 'Refresh'}
                title={isZh ? '刷新' : 'Refresh'}
                className="p-1.5"
                style={{
                  color: 'var(--color-codex-ink-mute)',
                  borderRadius: 'var(--codex-r-sm, 6px)',
                }}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex flex-shrink-0 gap-1" style={{ padding: '0 16px 10px' }}>
            {(
              [
                { key: 'all' as FilterKey, label: isZh ? '全部' : 'All', count: totalCount },
                { key: 'unread' as FilterKey, label: isZh ? '未读' : 'Unread', count: unreadCount },
              ]
            ).map((tab) => {
              const isActive = filter === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className="inline-flex items-center gap-1.5 transition-colors"
                  style={{
                    padding: '5px 10px',
                    fontSize: 12,
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? 'var(--color-codex-ink)' : 'var(--color-codex-ink-mute)',
                    background: isActive ? 'var(--color-codex-bg-tint)' : 'transparent',
                    borderRadius: 'var(--codex-r-sm, 6px)',
                  }}
                >
                  {tab.label}
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 10.5,
                      color: isActive
                        ? 'var(--color-codex-accent)'
                        : 'var(--color-codex-ink-faint)',
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Scrolling list */}
          <div className="flex-1 overflow-auto" style={{ padding: '0 12px 14px' }}>
            {loading && messages.length === 0 ? (
              <div className="flex items-center justify-center" style={{ padding: '64px 0' }}>
                <Loader2
                  className="h-5 w-5 animate-spin"
                  style={{ color: 'var(--color-codex-accent)' }}
                />
              </div>
            ) : filteredMessages.length === 0 ? (
              <div
                className="text-center"
                style={{ padding: '48px 16px', color: 'var(--color-codex-ink-mute)' }}
              >
                <MailOpen
                  className="mx-auto mb-3 h-7 w-7"
                  style={{ color: 'var(--color-codex-ink-faint)' }}
                />
                <p style={{ margin: 0, fontSize: 12 }}>
                  {isZh ? '暂时没有消息。' : 'No messages yet.'}
                </p>
              </div>
            ) : (
              <div>
                {filteredMessages.map((message) => {
                  const isActive = message.id === activeId
                  const isUnread = !message.is_read
                  const Icon = LEVEL_ICON[message.level] || Bell
                  const tone = LEVEL_TONE[message.level] || LEVEL_TONE.info
                  return (
                    <button
                      key={message.id}
                      type="button"
                      onClick={() => setActiveId(message.id)}
                      className="row-hov block w-full cursor-pointer text-left"
                      style={{
                        position: 'relative',
                        padding: '12px 12px',
                        borderRadius: 'var(--codex-r-sm, 6px)',
                        borderBottom: '1px solid var(--color-codex-line-soft)',
                        background: isActive ? 'var(--color-codex-bg-tint)' : 'transparent',
                      }}
                    >
                      {isActive && (
                        <span
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 10,
                            bottom: 10,
                            width: 2,
                            background: 'var(--color-codex-accent)',
                            borderRadius: 99,
                          }}
                        />
                      )}
                      <div className="mb-1.5 flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="inline-flex flex-shrink-0 items-center justify-center"
                          style={{
                            width: 26,
                            height: 26,
                            background: tone.bg,
                            color: tone.color,
                            borderRadius: 'var(--codex-r-sm, 6px)',
                          }}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate"
                          style={{
                            fontSize: 13,
                            fontWeight: isUnread ? 600 : 500,
                            color: 'var(--color-codex-ink)',
                          }}
                        >
                          {message.title}
                        </span>
                        {isUnread && (
                          <span
                            aria-label={isZh ? '未读' : 'Unread'}
                            className="flex-shrink-0"
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: 'var(--color-codex-accent)',
                            }}
                          />
                        )}
                      </div>
                      <p
                        className="line-clamp-2"
                        style={{
                          margin: 0,
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: 'var(--color-codex-ink-mute)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {message.content}
                      </p>
                      <p
                        className="font-mono"
                        style={{
                          margin: '5px 0 0',
                          fontSize: 10.5,
                          color: 'var(--color-codex-ink-faint)',
                        }}
                      >
                        {relativeTime(message.created_at, isZh, resolvedTimeZone)}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ── RIGHT: detail ── */}
        <section className="flex min-h-0 flex-col overflow-hidden">
          {activeMessage ? (
            <>
              {/* Detail header */}
              <div
                className="flex-shrink-0"
                style={{
                  padding: '24px 40px 18px',
                  borderBottom: '1px solid var(--color-codex-line)',
                  background: 'var(--color-codex-bg-elev)',
                }}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    style={{
                      padding: '2px 8px',
                      fontSize: 10.5,
                      fontWeight: 500,
                      borderRadius: 999,
                      background: LEVEL_TONE[activeMessage.level].bg,
                      color: LEVEL_TONE[activeMessage.level].color,
                    }}
                  >
                    {activeMessage.level}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5"
                    style={{
                      fontSize: 12,
                      color: activeMessage.is_read
                        ? 'var(--color-codex-ink-faint)'
                        : 'var(--color-codex-accent-ink)',
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: 'currentColor',
                      }}
                    />
                    {activeMessage.is_read
                      ? (isZh ? '已读' : 'Read')
                      : (isZh ? '未读' : 'Unread')}
                  </span>
                  <span
                    className="num font-mono"
                    style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
                  >
                    {formatDateTime(
                      activeMessage.created_at,
                      isZh ? 'zh-CN' : 'en-US',
                      undefined,
                      resolvedTimeZone,
                    )}
                  </span>
                </div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 22,
                    fontWeight: 500,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.3,
                    color: 'var(--color-codex-ink)',
                  }}
                >
                  {activeMessage.title}
                </h1>
                <div
                  className="flex items-center gap-3"
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: 'var(--color-codex-ink-mute)',
                  }}
                >
                  <span>{isZh ? '系统通知' : 'System notice'}</span>
                  {activeMessage.created_by_display_name ? (
                    <>
                      <span style={{ color: 'var(--color-codex-ink-faint)' }}>·</span>
                      <span>
                        {isZh ? '发布人 ' : 'By '}
                        {activeMessage.created_by_display_name}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Detail body */}
              <div className="flex-1 overflow-auto" style={{ padding: '28px 40px' }}>
                <div style={{ maxWidth: 720 }}>
                  <p
                    className="whitespace-pre-wrap"
                    style={{
                      margin: 0,
                      fontSize: 14.5,
                      lineHeight: 1.8,
                      color: 'var(--color-codex-ink)',
                    }}
                  >
                    {activeMessage.content}
                  </p>
                </div>
              </div>

              {/* Detail actions */}
              <div
                className="flex flex-shrink-0 items-center gap-2"
                style={{
                  padding: '16px 40px',
                  borderTop: '1px solid var(--color-codex-line)',
                  background: 'var(--color-codex-bg-elev)',
                }}
              >
                {activeMessage.link ? (
                  <button
                    onClick={() => navigate(activeMessage.link)}
                    className="inline-flex items-center gap-1.5"
                    style={{
                      padding: '8px 16px',
                      background: 'var(--color-codex-ink)',
                      color: 'var(--color-codex-bg-elev)',
                      borderRadius: 'var(--codex-r-sm, 6px)',
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {isZh ? '打开链接' : 'Open'}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {!activeMessage.is_read ? (
                  <button
                    onClick={() => void markRead(activeMessage.id)}
                    className="inline-flex items-center gap-1.5"
                    style={{
                      padding: '8px 14px',
                      border: '1px solid var(--color-codex-line)',
                      borderRadius: 'var(--codex-r-sm, 6px)',
                      fontSize: 13,
                      color: 'var(--color-codex-ink-soft)',
                    }}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    {isZh ? '标记已读' : 'Mark read'}
                  </button>
                ) : null}
                {unreadCount > 0 ? (
                  <button
                    onClick={() => void markAllRead()}
                    disabled={markingAll}
                    className="inline-flex items-center gap-1.5 disabled:opacity-50"
                    style={{
                      padding: '8px 14px',
                      border: '1px solid var(--color-codex-line)',
                      borderRadius: 'var(--codex-r-sm, 6px)',
                      fontSize: 13,
                      color: 'var(--color-codex-ink-soft)',
                    }}
                  >
                    {markingAll ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCheck className="h-3.5 w-3.5" />
                    )}
                    {isZh ? '全部标记已读' : 'Mark all read'}
                  </button>
                ) : null}
                <span
                  className="font-mono"
                  style={{
                    marginLeft: 'auto',
                    fontSize: 11.5,
                    color: 'var(--color-codex-ink-faint)',
                  }}
                >
                  {isZh ? '消息编号 ' : 'MSG-'}
                  <span className="num">MSG-{String(activeMessage.id).padStart(6, '0')}</span>
                </span>
              </div>
            </>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2
                className="h-6 w-6 animate-spin"
                style={{ color: 'var(--color-codex-accent)' }}
              />
            </div>
          ) : error ? (
            <div
              role="alert"
              className="flex flex-1 flex-col items-center justify-center text-center"
              style={{ padding: '32px', color: 'var(--color-codex-bad)' }}
            >
              <p style={{ margin: '0 0 16px', fontSize: 14 }}>{error}</p>
              <button
                type="button"
                onClick={() => void loadMessages()}
                className="inline-flex items-center gap-1.5"
                style={{
                  padding: '8px 14px',
                  background: 'var(--color-codex-bg-tint)',
                  color: 'var(--color-codex-ink-soft)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 6px)',
                  fontSize: 13,
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {isZh ? '重试' : 'Retry'}
              </button>
            </div>
          ) : (
            <div
              className="flex flex-1 flex-col items-center justify-center text-center"
              style={{ padding: '32px', color: 'var(--color-codex-ink-mute)' }}
            >
              <MailOpen
                className="mb-3 h-10 w-10"
                style={{ color: 'var(--color-codex-ink-faint)' }}
              />
              <p style={{ margin: 0, fontSize: 13 }}>
                {isZh ? '暂时还没有系统消息。' : 'No system messages yet.'}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
