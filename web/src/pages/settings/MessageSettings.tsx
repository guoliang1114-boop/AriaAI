import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, CheckCircle2, Loader2, Megaphone, RefreshCw, Send } from 'lucide-react'
import { api } from '../../api/client'
import { CxPagination } from '../../components/codex'
import { formatDateTime, getResolvedAppTimeZone } from '../../utils/timezone'
import type { SystemMessageAdminItem } from '../../types/api'

interface MessageFormData {
  title: string
  content: string
  level: 'info' | 'success' | 'warning' | 'error'
  link: string
  is_published: boolean
}

interface MessageAdminListResponse {
  items: SystemMessageAdminItem[]
  total: number
  limit: number
  offset: number
  published_count: number
  total_read_count: number
}

const defaultFormData: MessageFormData = {
  title: '',
  content: '',
  level: 'info',
  link: '',
  is_published: true,
}

const MESSAGES_PAGE_SIZE = 10

export function MessageSettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [messages, setMessages] = useState<SystemMessageAdminItem[]>([])
  const [messageTotal, setMessageTotal] = useState(0)
  const [publishedCount, setPublishedCount] = useState(0)
  const [totalReadCount, setTotalReadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formData, setFormData] = useState<MessageFormData>(defaultFormData)
  const [messagePage, setMessagePage] = useState(1)
  const [messagePageSize, setMessagePageSize] = useState(MESSAGES_PAGE_SIZE)

  const loadMessages = async (options: { page?: number } = {}) => {
    try {
      setLoading(true)
      setError('')
      const page = options.page ?? messagePage
      const result = await api.get<MessageAdminListResponse>('/messages/admin/list', {
        params: {
          limit: messagePageSize,
          offset: (page - 1) * messagePageSize,
        },
      })
      setMessages(result.items)
      setMessageTotal(result.total)
      setPublishedCount(result.published_count)
      setTotalReadCount(result.total_read_count)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMessages()
  }, [messagePage, messagePageSize])

  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      setError(isZh ? '标题和内容不能为空。' : 'Title and content are required.')
      return
    }

    try {
      setSubmitting(true)
      setError('')
      setSuccess('')
      await api.post<SystemMessageAdminItem>('/messages/admin', formData)
      setFormData(defaultFormData)
      setMessagePage(1)
      await loadMessages({ page: 1 })
      setSuccess(isZh ? '消息已发布。' : 'Message published.')
      window.dispatchEvent(new Event('messages:updated'))
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to publish message')
    } finally {
      setSubmitting(false)
    }
  }

  const messagePageCount = Math.max(1, Math.ceil(messageTotal / messagePageSize))
  const currentMessagePage = Math.min(messagePage, messagePageCount)

  useEffect(() => {
    setMessagePage((current) => Math.min(current, messagePageCount))
  }, [messagePageCount])

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    fontSize: 13.5,
    background: 'var(--color-codex-bg)',
    border: '1px solid var(--color-codex-line)',
    borderRadius: 'var(--codex-r-sm, 3px)',
    color: 'var(--color-codex-ink)',
    outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: 6,
    fontSize: 10.5,
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    color: 'var(--color-codex-ink-mute)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  }

  const statusBadgeStyle = (published: boolean): React.CSSProperties => ({
    padding: '2px 8px',
    fontSize: 10.5,
    background: published ? 'var(--color-codex-accent-bg)' : 'var(--color-codex-bg-tint)',
    color: published ? 'var(--color-codex-accent-ink)' : 'var(--color-codex-ink-mute)',
    borderRadius: 'var(--codex-r-pill, 999px)',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  })

  return (
    <div
      className="theme-codex"
      style={{
        background: 'var(--color-codex-bg)',
        color: 'var(--color-codex-ink)',
        padding: '8px 4px 32px',
      }}
    >
      <header
        className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
        style={{ marginBottom: 20 }}
      >
        <div>
          <div
            className="inline-flex items-center gap-1.5"
            style={{
              marginBottom: 6,
              padding: '2px 8px',
              fontSize: 10.5,
              background: 'var(--color-codex-bg-tint)',
              color: 'var(--color-codex-ink-soft)',
              borderRadius: 'var(--codex-r-pill, 999px)',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            <Bell className="h-3 w-3" />
            {isZh ? '消息管理' : 'Message Manager'}
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 500,
              color: 'var(--color-codex-ink)',
              letterSpacing: '-0.015em',
            }}
          >
            {isZh ? '发布系统消息并查看阅读情况' : 'Publish notices and review engagement'}
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 13,
              color: 'var(--color-codex-ink-mute)',
              lineHeight: 1.6,
              maxWidth: 640,
            }}
          >
            {isZh
              ? '管理员可以在这里发布系统通知，用户会在右上角看到未读提醒并进入消息中心查看。'
              : 'Admins can publish system notices here. Users see the unread badge in the top bar and can open the message center.'}
          </p>
        </div>
        <button
          onClick={() => void loadMessages()}
          className="inline-flex flex-shrink-0 items-center gap-2 px-3 py-2 transition-colors"
          style={{
            fontSize: 12.5,
            background: 'var(--color-codex-bg-elev)',
            color: 'var(--color-codex-ink-soft)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {isZh ? '刷新列表' : 'Refresh'}
        </button>
      </header>

      {error ? (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: 'color-mix(in oklch, var(--color-codex-bad) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-bad)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}
      {success ? (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: 'var(--color-codex-accent-bg)',
            border: '1px solid color-mix(in oklch, var(--color-codex-accent) 30%, transparent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-accent-ink)',
            fontSize: 13,
          }}
        >
          {success}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        {/* Publish form */}
        <section
          style={{
            padding: 20,
            background: 'var(--color-codex-bg-elev)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-md, 6px)',
          }}
        >
          <div className="mb-5 flex items-center gap-3">
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center"
              style={{
                background: 'var(--color-codex-accent-bg)',
                color: 'var(--color-codex-accent)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--color-codex-ink)',
                }}
              >
                {isZh ? '发布新消息' : 'Publish a message'}
              </h2>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: 12,
                  color: 'var(--color-codex-ink-mute)',
                }}
              >
                {isZh ? '建议标题简洁，正文说明动作或背景。' : 'Keep the title concise and the body actionable.'}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label style={labelStyle}>{isZh ? '标题' : 'Title'}</label>
              <input
                value={formData.title}
                onChange={(e) => setFormData((current) => ({ ...current, title: e.target.value }))}
                placeholder={isZh ? '例如：本周系统维护安排' : 'For example: Weekly maintenance notice'}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>{isZh ? '正文' : 'Content'}</label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData((current) => ({ ...current, content: e.target.value }))}
                rows={7}
                placeholder={isZh ? '输入消息正文...' : 'Write the announcement...'}
                style={{ ...inputStyle, padding: '10px 12px', resize: 'vertical' }}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label style={labelStyle}>{isZh ? '消息级别' : 'Level'}</label>
                <select
                  value={formData.level}
                  onChange={(e) =>
                    setFormData((current) => ({
                      ...current,
                      level: e.target.value as MessageFormData['level'],
                    }))
                  }
                  style={inputStyle}
                >
                  <option value="info">{isZh ? '普通通知' : 'Info'}</option>
                  <option value="success">{isZh ? '成功提醒' : 'Success'}</option>
                  <option value="warning">{isZh ? '警告提醒' : 'Warning'}</option>
                  <option value="error">{isZh ? '错误提醒' : 'Error'}</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>{isZh ? '跳转链接' : 'Open link'}</label>
                <input
                  value={formData.link}
                  onChange={(e) => setFormData((current) => ({ ...current, link: e.target.value }))}
                  placeholder={isZh ? '/projects 或 /settings/memory' : '/projects or /settings/memory'}
                  style={inputStyle}
                />
              </div>
            </div>

            <label
              className="flex items-center gap-3"
              style={{
                padding: '10px 14px',
                background: 'var(--color-codex-bg-tint)',
                border: '1px solid var(--color-codex-line-soft)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <input
                type="checkbox"
                checked={formData.is_published}
                onChange={(e) =>
                  setFormData((current) => ({ ...current, is_published: e.target.checked }))
                }
                className="h-4 w-4"
                style={{ accentColor: 'var(--color-codex-accent)' }}
              />
              <span style={{ fontSize: 13, color: 'var(--color-codex-ink)' }}>
                {isZh ? '立即发布给所有用户' : 'Publish immediately to all users'}
              </span>
            </label>

            <button
              onClick={() => void handleCreate()}
              disabled={submitting}
              className="inline-flex items-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                background: 'var(--color-codex-accent)',
                color: 'var(--color-codex-bg-elev)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isZh ? '发布消息' : 'Publish'}
            </button>
          </div>
        </section>

        <div className="space-y-4">
          {/* Stat cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: isZh ? '消息总数' : 'Messages', value: messageTotal },
              {
                label: isZh ? '已发布' : 'Published',
                value: publishedCount,
              },
              { label: isZh ? '累计已读' : 'Total reads', value: totalReadCount },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  padding: 16,
                  background: 'var(--color-codex-bg-elev)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-md, 6px)',
                }}
              >
                <div
                  className="font-mono"
                  style={{
                    fontSize: 10.5,
                    color: 'var(--color-codex-ink-mute)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {stat.label}
                </div>
                <div
                  className="font-mono"
                  style={{
                    marginTop: 6,
                    fontSize: 24,
                    fontWeight: 500,
                    color: 'var(--color-codex-ink)',
                  }}
                >
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Message list */}
          <section
            style={{
              padding: 20,
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
            }}
          >
            <div className="mb-4 flex items-center gap-2">
              <CheckCircle2
                className="h-4 w-4"
                style={{ color: 'var(--color-codex-accent)' }}
              />
              <h2
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--color-codex-ink)',
                }}
              >
                {isZh ? '消息列表' : 'Published messages'}
              </h2>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2
                  className="h-5 w-5 animate-spin"
                  style={{ color: 'var(--color-codex-accent)' }}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    style={{
                      padding: '14px 16px',
                      background: 'var(--color-codex-bg)',
                      border: '1px solid var(--color-codex-line-soft)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                    }}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className="font-mono"
                        style={{
                          padding: '2px 8px',
                          fontSize: 10.5,
                          background: 'var(--color-codex-bg-tint)',
                          color: 'var(--color-codex-ink-soft)',
                          borderRadius: 'var(--codex-r-pill, 999px)',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {message.level}
                      </span>
                      <span style={statusBadgeStyle(message.is_published)}>
                        {message.is_published
                          ? isZh
                            ? '已发布'
                            : 'Published'
                          : isZh
                            ? '未发布'
                            : 'Draft'}
                      </span>
                      <span
                        className="font-mono"
                        style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
                      >
                        {formatDateTime(
                          message.created_at,
                          isZh ? 'zh-CN' : 'en-US',
                          undefined,
                          getResolvedAppTimeZone(),
                        )}
                      </span>
                    </div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--color-codex-ink)',
                      }}
                    >
                      {message.title}
                    </h3>
                    <p
                      className="whitespace-pre-wrap"
                      style={{
                        marginTop: 8,
                        marginBottom: 0,
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: 'var(--color-codex-ink-soft)',
                      }}
                    >
                      {message.content}
                    </p>
                    <div
                      className="mt-3 flex flex-wrap items-center gap-4"
                      style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
                    >
                      <span>
                        {isZh ? '已读人数：' : 'Read count: '}
                        <span className="font-mono">{message.read_count}</span>
                      </span>
                      {message.created_by_display_name ? (
                        <span>
                          {isZh ? '发布人：' : 'Author: '}
                          {message.created_by_display_name}
                        </span>
                      ) : null}
                      {message.link ? (
                        <span>
                          {isZh ? '链接：' : 'Link: '}
                          <span className="font-mono">{message.link}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {messageTotal > 0 ? (
                  <CxPagination
                    page={currentMessagePage}
                    pageSize={messagePageSize}
                    totalItems={messageTotal}
                    onPageChange={setMessagePage}
                    onPageSizeChange={(nextPageSize) => {
                      setMessagePageSize(nextPageSize)
                      setMessagePage(1)
                    }}
                    isZh={isZh}
                    pageSizeOptions={[10, 20, 50]}
                  />
                ) : null}
                {messageTotal === 0 ? (
                  <div
                    className="text-center"
                    style={{
                      padding: '32px 16px',
                      background: 'var(--color-codex-bg-tint)',
                      border: '1px dashed var(--color-codex-line)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                      fontSize: 13,
                      color: 'var(--color-codex-ink-mute)',
                    }}
                  >
                    {isZh ? '还没有发布过系统消息。' : 'No messages have been published yet.'}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
