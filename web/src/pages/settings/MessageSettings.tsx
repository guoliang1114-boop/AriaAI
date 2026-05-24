import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, CheckCircle2, Loader2, Megaphone, RefreshCw, Send } from 'lucide-react'
import { api } from '../../api/client'
import { formatDateTime, getResolvedAppTimeZone } from '../../utils/timezone'
import type { SystemMessageAdminItem } from '../../types/api'

interface MessageFormData {
  title: string
  content: string
  level: 'info' | 'success' | 'warning' | 'error'
  link: string
  is_published: boolean
}

const defaultFormData: MessageFormData = {
  title: '',
  content: '',
  level: 'info',
  link: '',
  is_published: true,
}

export function MessageSettings() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [messages, setMessages] = useState<SystemMessageAdminItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formData, setFormData] = useState<MessageFormData>(defaultFormData)

  const loadMessages = async () => {
    try {
      setLoading(true)
      setError('')
      const result = await api.get<SystemMessageAdminItem[]>('/messages/admin')
      setMessages(result)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMessages()
  }, [])

  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      setError(isZh ? '标题和内容不能为空。' : 'Title and content are required.')
      return
    }

    try {
      setSubmitting(true)
      setError('')
      setSuccess('')
      const created = await api.post<SystemMessageAdminItem>('/messages/admin', formData)
      setMessages((current) => [created, ...current])
      setFormData(defaultFormData)
      setSuccess(isZh ? '消息已发布。' : 'Message published.')
      window.dispatchEvent(new Event('messages:updated'))
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to publish message')
    } finally {
      setSubmitting(false)
    }
  }

  const totalRead = useMemo(
    () => messages.reduce((sum, message) => sum + message.read_count, 0),
    [messages],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Bell className="h-3.5 w-3.5" />
            {isZh ? '消息管理' : 'Message Manager'}
          </div>
          <h2 className="text-lg font-semibold text-on-surface">
            {isZh ? '发布系统消息并查看阅读情况' : 'Publish notices and review message engagement'}
          </h2>
          <p className="mt-1 text-sm text-on-surface-muted">
            {isZh
              ? '管理员可以在这里发布系统通知，用户会在右上角看到未读提醒并进入消息中心查看。'
              : 'Admins can publish system notices here. Users see the unread badge in the top bar and can open the message center.'}
          </p>
        </div>
        <button
          onClick={() => void loadMessages()}
          className="inline-flex items-center gap-2 rounded-xl border border-outline/20 px-4 py-2 text-sm text-on-surface-secondary transition hover:bg-surface-container-high"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {isZh ? '刷新列表' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-3xl border border-outline/10 bg-surface-container-low p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-on-surface">{isZh ? '发布新消息' : 'Publish a message'}</h3>
              <p className="text-sm text-on-surface-muted">
                {isZh ? '建议标题简洁，正文说明动作或背景。' : 'Keep the title concise and make the body actionable.'}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-on-surface-secondary">
                {isZh ? '标题' : 'Title'}
              </label>
              <input
                value={formData.title}
                onChange={(e) => setFormData((current) => ({ ...current, title: e.target.value }))}
                placeholder={isZh ? '例如：本周系统维护安排' : 'For example: Weekly maintenance notice'}
                className="w-full rounded-xl border border-outline/20 bg-surface-container-lowest px-4 py-2.5 text-on-surface outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-on-surface-secondary">
                {isZh ? '正文' : 'Content'}
              </label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData((current) => ({ ...current, content: e.target.value }))}
                rows={7}
                placeholder={isZh ? '输入消息正文...' : 'Write the announcement...'}
                className="w-full rounded-xl border border-outline/20 bg-surface-container-lowest px-4 py-3 text-on-surface outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-on-surface-secondary">
                  {isZh ? '消息级别' : 'Level'}
                </label>
                <select
                  value={formData.level}
                  onChange={(e) =>
                    setFormData((current) => ({
                      ...current,
                      level: e.target.value as MessageFormData['level'],
                    }))
                  }
                  className="w-full rounded-xl border border-outline/20 bg-surface-container-lowest px-4 py-2.5 text-on-surface outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                >
                  <option value="info">{isZh ? '普通通知' : 'Info'}</option>
                  <option value="success">{isZh ? '成功提醒' : 'Success'}</option>
                  <option value="warning">{isZh ? '警告提醒' : 'Warning'}</option>
                  <option value="error">{isZh ? '错误提醒' : 'Error'}</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-on-surface-secondary">
                  {isZh ? '跳转链接' : 'Open link'}
                </label>
                <input
                  value={formData.link}
                  onChange={(e) => setFormData((current) => ({ ...current, link: e.target.value }))}
                  placeholder={isZh ? '/projects 或 /settings/memory' : '/projects or /settings/memory'}
                  className="w-full rounded-xl border border-outline/20 bg-surface-container-lowest px-4 py-2.5 text-on-surface outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-xl bg-surface-container-high px-4 py-3">
              <input
                type="checkbox"
                checked={formData.is_published}
                onChange={(e) =>
                  setFormData((current) => ({ ...current, is_published: e.target.checked }))
                }
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm text-on-surface">
                {isZh ? '立即发布给所有用户' : 'Publish immediately to all users'}
              </span>
            </label>

            <button
              onClick={() => void handleCreate()}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isZh ? '发布消息' : 'Publish'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-outline/10 bg-surface-container-low p-5">
              <div className="text-sm text-on-surface-muted">{isZh ? '消息总数' : 'Messages'}</div>
              <div className="mt-2 text-3xl font-semibold text-on-surface">{messages.length}</div>
            </div>
            <div className="rounded-3xl border border-outline/10 bg-surface-container-low p-5">
              <div className="text-sm text-on-surface-muted">{isZh ? '已发布' : 'Published'}</div>
              <div className="mt-2 text-3xl font-semibold text-on-surface">
                {messages.filter((message) => message.is_published).length}
              </div>
            </div>
            <div className="rounded-3xl border border-outline/10 bg-surface-container-low p-5">
              <div className="text-sm text-on-surface-muted">{isZh ? '累计已读' : 'Total reads'}</div>
              <div className="mt-2 text-3xl font-semibold text-on-surface">{totalRead}</div>
            </div>
          </div>

          <div className="rounded-3xl border border-outline/10 bg-surface-container-low p-6">
            <div className="mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-on-surface">{isZh ? '消息列表' : 'Published messages'}</h3>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className="rounded-2xl border border-outline/10 bg-surface px-4 py-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        {message.level}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          message.is_published
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {message.is_published
                          ? isZh
                            ? '已发布'
                            : 'Published'
                          : isZh
                            ? '未发布'
                            : 'Draft'}
                      </span>
                      <span className="text-xs text-on-surface-muted">
                        {formatDateTime(message.created_at, isZh ? 'zh-CN' : 'en-US', undefined, getResolvedAppTimeZone())}
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold text-on-surface">{message.title}</h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-on-surface-secondary">
                      {message.content}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-on-surface-muted">
                      <span>
                        {isZh ? '已读人数：' : 'Read count: '}
                        {message.read_count}
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
                          {message.link}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {messages.length === 0 ? (
                  <div className="rounded-2xl bg-surface px-4 py-8 text-center text-sm text-on-surface-muted">
                    {isZh ? '还没有发布过系统消息。' : 'No messages have been published yet.'}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
