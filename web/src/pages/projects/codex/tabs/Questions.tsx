import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ProjectDetail as ProjectDetailType,
  ProjectQuestionPriority,
  ProjectQuestionWorkbench,
  ProjectQuestionWorkbenchItem,
  ProjectQuestionWorkbenchStatus,
} from '../../../../types/api'
import { api } from '../../../../api/client'
import { useToast } from '../../../../contexts/ToastContext'
import { CxIcon } from '../CxIcons'
import { CxPanel, CxStatus, type CxTone } from '../CxPrimitives'
import { CxProjectShell } from '../CxProjectShell'


interface QuestionsProps {
  projectId: number
  detail: ProjectDetailType
  refetch: () => Promise<void>
}

type Filter = 'all' | ProjectQuestionWorkbenchStatus

const STATUS_COPY: Record<ProjectQuestionWorkbenchStatus, { label: string; tone: CxTone }> = {
  open: { label: '待确认', tone: 'warn' },
  needs_review: { label: '待复核', tone: 'bad' },
  resolved: { label: '已解决', tone: 'good' },
}

const PRIORITY_COPY: Record<ProjectQuestionPriority, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  critical: '紧急',
}

const REVIEW_COPY: Record<string, string> = {
  question_reappeared: '同一问题再次出现在项目记忆中，请重新核对结论。',
  project_memory_stale: '项目记忆当前已陈旧，旧结论不能直接沿用。',
  project_memory_changed: '解决后项目记忆发生过变化，请确认结论仍然有效。',
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    if (typeof response?.data?.detail === 'string') return response.data.detail
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '操作失败，请稍后重试。'
}

function formatDateTime(value: string): string {
  if (!value) return '—'
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function dueTone(value: string): string {
  if (!value) return 'var(--ink-mute)'
  const due = new Date(`${value}T23:59:59`)
  if (Number.isNaN(due.getTime())) return 'var(--ink-mute)'
  const remaining = due.getTime() - Date.now()
  if (remaining < 0) return 'var(--bad)'
  if (remaining < 3 * 86400000) return 'var(--warn)'
  return 'var(--ink-soft)'
}

export function CxProjectQuestions({ projectId, detail, refetch }: QuestionsProps) {
  const toast = useToast()
  const [data, setData] = useState<ProjectQuestionWorkbench | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [busyQuestion, setBusyQuestion] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.get<ProjectQuestionWorkbench>(`/projects/${projectId}/questions`))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    let active = true
    api
      .get<ProjectQuestionWorkbench>(`/projects/${projectId}/questions`)
      .then((next) => {
        if (active) setData(next)
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [projectId])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (data?.questions ?? []).filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false
      if (!query) return true
      const owner = data?.members.find(
        (member) => member.user_id === item.profile.owner_user_id,
      )?.display_name
      return `${item.question} ${item.resolution?.resolution_summary ?? ''} ${owner ?? ''}`
        .toLowerCase()
        .includes(query)
    })
  }, [data, filter, search])

  const mutate = useCallback(
    async (
      question: ProjectQuestionWorkbenchItem,
      action: () => Promise<ProjectQuestionWorkbench>,
      successTitle: string,
      memoryChanged = false,
    ) => {
      if (busyQuestion) return
      setBusyQuestion(question.question_sha256)
      try {
        const next = await action()
        setData(next)
        toast.success({ title: successTitle })
        if (memoryChanged) await refetch()
      } catch (err) {
        toast.error({ title: '操作失败', description: errorMessage(err) })
      } finally {
        setBusyQuestion('')
      }
    },
    [busyQuestion, refetch, toast],
  )

  const saveProfile = useCallback(
    (
      question: ProjectQuestionWorkbenchItem,
      values: { owner_user_id: number | null; priority: ProjectQuestionPriority; due_date: string },
    ) => mutate(
      question,
      () => api.patch<ProjectQuestionWorkbench>(
        `/projects/${projectId}/questions/${question.question_sha256}`,
        {
          question: question.question,
          ...values,
          expected_revision: question.profile.revision,
        },
      ),
      '问题责任信息已保存',
    ),
    [mutate, projectId],
  )

  const resolveQuestion = useCallback(
    (question: ProjectQuestionWorkbenchItem, answerMessageId: number, summary: string) => {
      if (!data) return Promise.resolve()
      return mutate(
        question,
        () => api.post<ProjectQuestionWorkbench>(`/projects/${projectId}/questions/resolve`, {
          question: question.question,
          answer_message_id: answerMessageId,
          resolution_summary: summary,
          expected_memory_version: data.memory.memory_version,
          expected_slot_version: data.memory.slot_version,
        }),
        '问题已解决并写入审计账本',
        true,
      )
    },
    [data, mutate, projectId],
  )

  const reopenQuestion = useCallback(
    (question: ProjectQuestionWorkbenchItem, reason: string) => {
      if (!data || !question.resolution) return Promise.resolve()
      return mutate(
        question,
        () => api.post<ProjectQuestionWorkbench>(
          `/projects/${projectId}/questions/${question.resolution?.id}/reopen`,
          {
            reason,
            expected_resolution_revision: question.resolution?.resolution_revision,
            expected_memory_version: data.memory.memory_version,
            expected_slot_version: data.memory.slot_version,
          },
        ),
        '问题已重新打开',
        true,
      )
    },
    [data, mutate, projectId],
  )

  return (
    <CxProjectShell activeTab="questions" projectId={projectId} project={detail.project}>
      <main
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px 36px 36px',
          background: 'var(--bg)',
        }}
      >
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 20,
              marginBottom: 20,
            }}
          >
            <div>
              <h1
                className="ui"
                style={{ margin: 0, color: 'var(--ink)', fontSize: 22, fontWeight: 600 }}
              >
                项目问题工作台
              </h1>
              <p style={{ margin: '5px 0 0', color: 'var(--ink-mute)', fontSize: 12.5 }}>
                集中跟踪待确认问题、责任人和截止日期；人工选择项目回答后才会关单。
              </p>
            </div>
            <button
              type="button"
              className="row-hov"
              onClick={() => void load()}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 11px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                color: 'var(--ink-soft)',
                opacity: loading ? 0.55 : 1,
              }}
            >
              <CxIcon name="clock" size={13} /> 刷新
            </button>
          </div>

          {data?.memory.stale && (
            <div
              role="alert"
              style={{
                marginBottom: 16,
                padding: '10px 12px',
                border: '1px solid color-mix(in srgb, var(--warn) 35%, var(--line))',
                borderRadius: 'var(--r-sm)',
                background: 'color-mix(in srgb, var(--warn) 8%, var(--bg-elev))',
                color: 'var(--warn)',
                fontSize: 12.5,
              }}
            >
              项目记忆或开放问题槽位已陈旧。可以整理负责人，但解决/重开前需先刷新项目记忆。
            </div>
          )}

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {(['open', 'needs_review', 'resolved'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setFilter(filter === status ? 'all' : status)}
                style={{
                  textAlign: 'left',
                  padding: '13px 15px',
                  background: filter === status ? 'var(--bg-tint)' : 'var(--bg-elev)',
                  border: `1px solid ${filter === status ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 'var(--r-md)',
                }}
              >
                <CxStatus tone={STATUS_COPY[status].tone}>{STATUS_COPY[status].label}</CxStatus>
                <div style={{ marginTop: 5, fontSize: 24, color: 'var(--ink)', fontWeight: 600 }}>
                  {data?.counts[status] ?? 0}
                </div>
              </button>
            ))}
          </section>

          <CxPanel
            style={{ marginBottom: 16, padding: 12 }}
            action={
              data ? (
                <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                  记忆 v{data.memory.memory_version} · 问题槽位 v{data.memory.slot_version}
                </span>
              ) : null
            }
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                padding: '7px 10px',
                background: 'var(--bg)',
              }}
            >
              <CxIcon name="search" size={13} style={{ color: 'var(--ink-faint)' }} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索问题、解决摘要或负责人"
                aria-label="搜索项目问题"
                style={{
                  flex: 1,
                  border: 0,
                  outline: 0,
                  color: 'var(--ink)',
                  background: 'transparent',
                  fontSize: 12.5,
                }}
              />
              {filter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  style={{ color: 'var(--accent)', fontSize: 11.5 }}
                >
                  清除筛选
                </button>
              )}
            </div>
          </CxPanel>

          {loading && !data ? (
            <CxPanel>
              <div style={{ color: 'var(--ink-mute)', padding: 24, textAlign: 'center' }}>
                正在加载问题工作台…
              </div>
            </CxPanel>
          ) : error && !data ? (
            <CxPanel>
              <div role="alert" style={{ color: 'var(--bad)', padding: 16, textAlign: 'center' }}>
                {error}
              </div>
            </CxPanel>
          ) : filtered.length === 0 ? (
            <CxPanel>
              <div style={{ textAlign: 'center', padding: '34px 16px' }}>
                <CxIcon name="check" size={24} style={{ color: 'var(--good)' }} />
                <div style={{ marginTop: 8, color: 'var(--ink)', fontWeight: 500 }}>
                  {data?.questions.length ? '没有匹配的问题' : '当前没有项目问题'}
                </div>
                <div style={{ marginTop: 4, color: 'var(--ink-mute)', fontSize: 12 }}>
                  新问题会从经人工确认或重建后的项目记忆进入这里。
                </div>
              </div>
            </CxPanel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filtered.map((question) => (
                <QuestionCard
                  key={`${question.question_sha256}:${question.profile.revision}:${question.profile.owner_user_id ?? ''}:${question.profile.priority}:${question.profile.due_date}`}
                  question={question}
                  data={data as ProjectQuestionWorkbench}
                  busy={busyQuestion === question.question_sha256}
                  onSaveProfile={saveProfile}
                  onResolve={resolveQuestion}
                  onReopen={reopenQuestion}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </CxProjectShell>
  )
}


interface QuestionCardProps {
  question: ProjectQuestionWorkbenchItem
  data: ProjectQuestionWorkbench
  busy: boolean
  onSaveProfile: (
    question: ProjectQuestionWorkbenchItem,
    values: { owner_user_id: number | null; priority: ProjectQuestionPriority; due_date: string },
  ) => Promise<void>
  onResolve: (
    question: ProjectQuestionWorkbenchItem,
    answerMessageId: number,
    summary: string,
  ) => Promise<void>
  onReopen: (question: ProjectQuestionWorkbenchItem, reason: string) => Promise<void>
}

function QuestionCard({
  question,
  data,
  busy,
  onSaveProfile,
  onResolve,
  onReopen,
}: QuestionCardProps) {
  const [ownerId, setOwnerId] = useState(question.profile.owner_user_id?.toString() ?? '')
  const [priority, setPriority] = useState<ProjectQuestionPriority>(question.profile.priority)
  const [dueDate, setDueDate] = useState(question.profile.due_date)
  const [answerId, setAnswerId] = useState('')
  const [summary, setSummary] = useState('')
  const [reopenReason, setReopenReason] = useState('')

  const profileChanged =
    ownerId !== (question.profile.owner_user_id?.toString() ?? '')
    || priority !== question.profile.priority
    || dueDate !== question.profile.due_date
  const canResolve =
    data.can_write
    && data.memory.status === 'ready'
    && !!answerId
    && !!summary.trim()
    && !busy
  const canReopen =
    data.can_write
    && data.memory.status === 'ready'
    && !!question.resolution
    && !!reopenReason.trim()
    && !busy

  return (
    <CxPanel style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
            <CxStatus tone={STATUS_COPY[question.status].tone}>
              {STATUS_COPY[question.status].label}
            </CxStatus>
            <span style={{ color: 'var(--ink-faint)', fontSize: 11 }}>
              {question.profile.revision > 0 ? `责任版本 ${question.profile.revision}` : '尚未分配'}
            </span>
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.55,
              color: 'var(--ink)',
            }}
          >
            {question.question}
          </h2>
          {question.review_reason && (
            <p style={{ margin: '6px 0 0', color: 'var(--bad)', fontSize: 12 }}>
              {REVIEW_COPY[question.review_reason] ?? '该问题需要人工复核。'}
            </p>
          )}
          {question.resolution && (
            <div
              style={{
                marginTop: 10,
                padding: '9px 11px',
                borderLeft: '2px solid var(--good)',
                background: 'var(--bg-tint)',
                borderRadius: '0 var(--r-sm) var(--r-sm) 0',
              }}
            >
              <div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>
                {question.resolution.resolution_summary}
              </div>
              <div style={{ marginTop: 4, color: 'var(--ink-faint)', fontSize: 10.5 }}>
                {formatDateTime(question.resolution.resolved_at)} · 回答
                {question.resolution.answer_available ? '可定位' : '已不可用'} · 解决版本{' '}
                {question.resolution.resolution_revision}
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            minWidth: 300,
            display: 'grid',
            gridTemplateColumns: '1fr 92px',
            gap: 8,
            alignContent: 'start',
          }}
        >
          <label style={{ fontSize: 10.5, color: 'var(--ink-faint)', gridColumn: '1 / -1' }}>
            责任人 / 优先级 / 截止日期
          </label>
          <select
            aria-label="问题负责人"
            value={ownerId}
            disabled={!data.can_write || busy}
            onChange={(event) => setOwnerId(event.target.value)}
            style={controlStyle}
          >
            <option value="">未分配</option>
            {data.members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name}
              </option>
            ))}
          </select>
          <select
            aria-label="问题优先级"
            value={priority}
            disabled={!data.can_write || busy}
            onChange={(event) => setPriority(event.target.value as ProjectQuestionPriority)}
            style={controlStyle}
          >
            {(Object.keys(PRIORITY_COPY) as ProjectQuestionPriority[]).map((value) => (
              <option key={value} value={value}>{PRIORITY_COPY[value]}</option>
            ))}
          </select>
          <input
            aria-label="问题截止日期"
            type="date"
            value={dueDate}
            disabled={!data.can_write || busy}
            onChange={(event) => setDueDate(event.target.value)}
            style={{ ...controlStyle, color: dueTone(dueDate) }}
          />
          <button
            type="button"
            disabled={!data.can_write || !profileChanged || busy}
            onClick={() => void onSaveProfile(question, {
              owner_user_id: ownerId ? Number(ownerId) : null,
              priority,
              due_date: dueDate,
            })}
            style={secondaryButtonStyle(!data.can_write || !profileChanged || busy)}
          >
            {busy ? '保存中…' : '保存责任'}
          </button>
        </div>
      </div>

      {question.status === 'open' && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 13,
            borderTop: '1px solid var(--line-soft)',
            display: 'grid',
            gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr) auto',
            gap: 8,
          }}
        >
          <select
            aria-label="选择解决问题的回答"
            value={answerId}
            disabled={!data.can_write || busy || data.memory.status !== 'ready'}
            onChange={(event) => setAnswerId(event.target.value)}
            style={controlStyle}
          >
            <option value="">选择项目内的 Assistant 回答…</option>
            {data.answer_candidates.map((answer) => (
              <option key={answer.message_id} value={answer.message_id}>
                [{answer.conversation_title}] {answer.preview}
              </option>
            ))}
          </select>
          <input
            aria-label="解决摘要"
            value={summary}
            maxLength={600}
            disabled={!data.can_write || busy || data.memory.status !== 'ready'}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="填写人工核对后的解决摘要"
            style={controlStyle}
          />
          <button
            type="button"
            disabled={!canResolve}
            onClick={() => void onResolve(question, Number(answerId), summary.trim())}
            style={primaryButtonStyle(!canResolve)}
          >
            标记已解决
          </button>
        </div>
      )}

      {question.status !== 'open' && question.resolution && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 13,
            borderTop: '1px solid var(--line-soft)',
            display: 'flex',
            gap: 8,
          }}
        >
          <input
            aria-label="重新打开原因"
            value={reopenReason}
            maxLength={600}
            disabled={!data.can_write || busy || data.memory.status !== 'ready'}
            onChange={(event) => setReopenReason(event.target.value)}
            placeholder="填写重新打开原因，问题将回到 pinned 待确认列表"
            style={{ ...controlStyle, flex: 1 }}
          />
          <button
            type="button"
            disabled={!canReopen}
            onClick={() => void onReopen(question, reopenReason.trim())}
            style={secondaryButtonStyle(!canReopen)}
          >
            重新打开
          </button>
        </div>
      )}
    </CxPanel>
  )
}


const controlStyle = {
  minWidth: 0,
  height: 34,
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-sm)',
  padding: '0 9px',
  background: 'var(--bg)',
  color: 'var(--ink-soft)',
  fontSize: 11.5,
} as const

function primaryButtonStyle(disabled: boolean) {
  return {
    minHeight: 34,
    padding: '0 12px',
    borderRadius: 'var(--r-sm)',
    background: disabled ? 'var(--bg-tint)' : 'var(--accent)',
    color: disabled ? 'var(--ink-faint)' : 'white',
    whiteSpace: 'nowrap' as const,
    opacity: disabled ? 0.7 : 1,
  }
}

function secondaryButtonStyle(disabled: boolean) {
  return {
    minHeight: 34,
    padding: '0 11px',
    border: '1px solid var(--line)',
    borderRadius: 'var(--r-sm)',
    color: disabled ? 'var(--ink-faint)' : 'var(--ink-soft)',
    background: 'var(--bg-elev)',
    whiteSpace: 'nowrap' as const,
    opacity: disabled ? 0.65 : 1,
  }
}
