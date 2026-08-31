import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ProjectDetail as ProjectDetailType,
  ProjectQuestionAnswerCandidate,
  ProjectQuestionEvidenceCandidate,
  ProjectQuestionEvidenceReview,
  ProjectQuestionPriority,
  ProjectQuestionReadinessBand,
  ProjectQuestionRemediationAction,
  ProjectQuestionRemediationPlan,
  ProjectQuestionRemediationStatus,
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

const MAX_EDITABLE_REMEDIATION_ACTIONS = 8

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

const READINESS_COPY: Record<ProjectQuestionReadinessBand, { label: string; tone: CxTone }> = {
  strong: { label: '证据较强', tone: 'good' },
  review: { label: '建议复核', tone: 'warn' },
  weak: { label: '证据较弱', tone: 'bad' },
  unrated: { label: '无法评分', tone: 'neutral' },
}

const REMEDIATION_STATUS_COPY: Record<
  ProjectQuestionRemediationStatus,
  { label: string; tone: CxTone }
> = {
  evidence_collection_required: { label: '待补证', tone: 'bad' },
  targeted_review_required: { label: '待定向复核', tone: 'warn' },
  verification_ready: { label: '可进入人工确认', tone: 'good' },
}

const REMEDIATION_ACTION_COPY: Record<ProjectQuestionRemediationAction['kind'], string> = {
  clarification_question: '干系人追问',
  evidence_request: '资料请求',
  internal_check: '内部核验',
  candidate_review: '候选回答复核',
  human_verification: '最终人工确认',
}

const EVIDENCE_WARNING_COPY: Record<string, string> = {
  LOW_QUESTION_RELEVANCE: '与当前问题的文本相关性较低',
  NO_PERSISTED_EVIDENCE: '该回答没有可验证的持久化证据',
  AVAILABLE_EVIDENCE_NOT_CITED: '回答生成时有证据，但正文没有有效引用',
  INVALID_CITATIONS: '回答包含无效引用',
  EVIDENCE_NOT_ALIGNED_WITH_CURRENT_QUESTION: '历史引用未命中当前重新召回的证据',
  CURRENT_QUESTION_EVIDENCE_UNAVAILABLE: '当前问题证据池不可用，不能确认历史引用仍然适用',
  WEAK_CURRENT_PROVENANCE: '当前对齐来源缺少直接或确定性溯源',
  RUN_EVALUATION_NOT_COMPLETED: '原始 Run 未通过完成裁决',
  ANSWER_MARKED_UNHELPFUL: '该回答曾被人工标记为无帮助',
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

function isEvidenceCandidate(
  candidate: ProjectQuestionAnswerCandidate | ProjectQuestionEvidenceCandidate,
): candidate is ProjectQuestionEvidenceCandidate {
  return 'assessment' in candidate && typeof candidate.assessment === 'object'
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
                  key={`${question.question_sha256}:${question.profile.revision}:${question.profile.owner_user_id ?? ''}:${question.profile.priority}:${question.profile.due_date}:${data?.memory.memory_version ?? 0}:${question.status}:${question.resolution?.resolution_revision ?? 0}`}
                  projectId={projectId}
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
  projectId: number
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
  projectId,
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
  const [evidenceReview, setEvidenceReview] = useState<ProjectQuestionEvidenceReview | null>(null)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [evidenceError, setEvidenceError] = useState('')
  const [remediationPlan, setRemediationPlan] = useState<ProjectQuestionRemediationPlan | null>(null)
  const [remediationLoading, setRemediationLoading] = useState(false)
  const [remediationError, setRemediationError] = useState('')

  const loadEvidence = useCallback(async () => {
    if (evidenceLoading) return
    setEvidenceLoading(true)
    setEvidenceError('')
    try {
      const review = await api.post<ProjectQuestionEvidenceReview>(
        `/projects/${projectId}/questions/${question.question_sha256}/evidence`,
        { question: question.question },
        { timeout: 60_000 },
      )
      setEvidenceReview(review)
      setRemediationPlan(null)
      setRemediationError('')
    } catch (error) {
      setEvidenceError(errorMessage(error))
    } finally {
      setEvidenceLoading(false)
    }
  }, [evidenceLoading, projectId, question.question, question.question_sha256])

  const loadRemediation = useCallback(async () => {
    if (remediationLoading) return
    setRemediationLoading(true)
    setRemediationError('')
    try {
      const plan = await api.post<ProjectQuestionRemediationPlan>(
        `/projects/${projectId}/questions/${question.question_sha256}/remediation`,
        { question: question.question },
        { timeout: 60_000 },
      )
      setRemediationPlan(plan)
    } catch (error) {
      setRemediationError(errorMessage(error))
    } finally {
      setRemediationLoading(false)
    }
  }, [projectId, question.question, question.question_sha256, remediationLoading])

  const answerCandidates = evidenceReview?.candidates ?? data.answer_candidates

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

      {data.can_write && (
        <div
          style={{
            marginTop: 13,
            paddingTop: 12,
            borderTop: '1px solid var(--line-soft)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={evidenceLoading || busy}
              onClick={() => void loadEvidence()}
              style={secondaryButtonStyle(evidenceLoading || busy)}
            >
              <CxIcon name="search" size={12} />{' '}
              {evidenceLoading ? '正在召回答案证据…' : evidenceReview ? '重新分析证据' : '分析问题证据'}
            </button>
            <span style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>
              确定性排序仅辅助人工选择，不代表答案正确。
            </span>
          </div>
          {evidenceError && (
            <div role="alert" style={{ marginTop: 7, color: 'var(--bad)', fontSize: 11.5 }}>
              {evidenceError}
            </div>
          )}
          {evidenceReview && (
            <>
              <QuestionEvidencePanel
                review={evidenceReview}
                canSelect={question.status === 'open'}
                onSelect={(messageId) => setAnswerId(String(messageId))}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 9 }}>
                <button
                  type="button"
                  disabled={remediationLoading || busy}
                  onClick={() => void loadRemediation()}
                  style={secondaryButtonStyle(remediationLoading || busy)}
                >
                  <CxIcon name="sparkle" size={12} />{' '}
                  {remediationLoading
                    ? '正在重新核验证据…'
                    : remediationPlan
                      ? '重新生成补证计划'
                      : '生成补证计划'}
                </button>
                <span style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>
                  生成时会重新核验当前证据，但不会保存或执行。
                </span>
              </div>
              {remediationError && (
                <div role="alert" style={{ marginTop: 7, color: 'var(--bad)', fontSize: 11.5 }}>
                  {remediationError}
                </div>
              )}
              {remediationPlan && (
                <QuestionRemediationPanel
                  key={remediationPlan.basis.fingerprint}
                  plan={remediationPlan}
                  members={data.members}
                />
              )}
            </>
          )}
        </div>
      )}

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
            {answerCandidates.map((answer) => (
              <option key={answer.message_id} value={answer.message_id}>
                {isEvidenceCandidate(answer)
                  ? `[${answer.assessment.readiness_score}分 · ${answer.conversation_title}] ${answer.preview}`
                  : `[${answer.conversation_title}] ${answer.preview}`}
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


interface EditableRemediationAction extends ProjectQuestionRemediationAction {
  ownerUserId: string
}

function QuestionRemediationPanel({
  plan,
  members,
}: {
  plan: ProjectQuestionRemediationPlan
  members: ProjectQuestionWorkbench['members']
}) {
  const [actions, setActions] = useState<EditableRemediationAction[]>(
    () => plan.actions.map((action) => ({ ...action, ownerUserId: '' })),
  )
  const customActionSequence = useRef(0)

  const updateAction = (
    actionId: string,
    field: 'title' | 'draft' | 'ownerUserId',
    value: string,
  ) => {
    setActions((current) => current.map((action) => (
      action.action_id === actionId ? { ...action, [field]: value } : action
    )))
  }
  const addAction = () => {
    customActionSequence.current += 1
    const sequence = customActionSequence.current
    setActions((current) => [
      ...current,
      {
        action_id: `custom_${sequence}_${plan.basis.fingerprint.slice(0, 6)}`,
        kind: 'internal_check',
        title: '自定义补证动作',
        draft: '',
        rationale: '用户在当前页面手工补充。',
        suggested_owner_role: 'project_member',
        suggested_channel: 'manual',
        blocking: false,
        acceptance_criteria: '由项目负责人确认。',
        editable_fields: ['title', 'draft', 'owner_user_id'],
        execution_mode: 'manual_only',
        ownerUserId: '',
      },
    ])
  }
  const readiness = REMEDIATION_STATUS_COPY[plan.status]

  return (
    <section
      aria-label="证据缺口补证计划"
      style={{
        marginTop: 10,
        padding: '12px',
        border: '1px solid color-mix(in srgb, var(--warn) 28%, var(--line))',
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-elev)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CxStatus tone={readiness.tone}>{readiness.label}</CxStatus>
          <span style={{ color: 'var(--ink-soft)', fontSize: 11.5 }}>
            {plan.gaps.length} 个证据缺口 · {actions.length} 个草稿动作
          </span>
        </div>
        <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>
          基准 {plan.basis.fingerprint.slice(0, 10)} · 记忆 v{plan.basis.memory_version}
        </span>
      </div>
      <div
        role="note"
        style={{
          marginTop: 8,
          padding: '8px 10px',
          color: 'var(--warn)',
          fontSize: 10.5,
          borderLeft: '2px solid var(--warn)',
          background: 'color-mix(in srgb, var(--warn) 7%, var(--bg))',
        }}
      >
        仅当前页面草稿：不会自动保存、向外部发送、调用工具或标记问题已解决。
      </div>
      {plan.gaps.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginTop: 9 }}>
          {plan.gaps.map((gap) => (
            <div
              key={gap.code}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr)',
                gap: 8,
                padding: '7px 8px',
                border: '1px solid var(--line-soft)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--bg-tint)',
              }}
            >
              <CxStatus tone={gap.severity === 'blocking' ? 'bad' : 'warn'}>
                {gap.severity === 'blocking' ? '阻断项' : '复核项'}
              </CxStatus>
              <div>
                <div style={{ color: 'var(--ink-soft)', fontSize: 11, fontWeight: 600 }}>
                  {gap.title}
                </div>
                <div style={{ marginTop: 2, color: 'var(--ink-mute)', fontSize: 10 }}>
                  {gap.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {actions.map((action, index) => (
          <div
            key={action.action_id}
            style={{
              padding: '9px',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--bg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
              <CxStatus tone={action.blocking ? 'bad' : 'neutral'}>
                {REMEDIATION_ACTION_COPY[action.kind]}
              </CxStatus>
              <span style={{ color: 'var(--ink-faint)', fontSize: 9.5 }}>
                {action.blocking ? '关单前完成' : '建议动作'} · 仅手动执行
              </span>
              <button
                type="button"
                aria-label={`移除补证动作 ${index + 1}`}
                onClick={() => setActions((current) => (
                  current.filter((item) => item.action_id !== action.action_id)
                ))}
                style={{ ...secondaryButtonStyle(false), marginLeft: 'auto', padding: '4px 7px' }}
              >
                移除
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 180px', gap: 7 }}>
              <input
                aria-label={`补证动作标题 ${index + 1}`}
                value={action.title}
                maxLength={120}
                onChange={(event) => updateAction(action.action_id, 'title', event.target.value)}
                style={controlStyle}
              />
              <select
                aria-label={`补证动作责任人 ${index + 1}`}
                value={action.ownerUserId}
                onChange={(event) => updateAction(action.action_id, 'ownerUserId', event.target.value)}
                style={controlStyle}
              >
                <option value="">草稿责任人未选择</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.display_name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              aria-label={`补证动作草稿 ${index + 1}`}
              value={action.draft}
              maxLength={600}
              rows={2}
              onChange={(event) => updateAction(action.action_id, 'draft', event.target.value)}
              style={{
                ...controlStyle,
                width: '100%',
                height: 'auto',
                minHeight: 56,
                marginTop: 7,
                padding: '7px 9px',
                resize: 'vertical',
              }}
            />
            <div style={{ marginTop: 5, color: 'var(--ink-faint)', fontSize: 9.5 }}>
              完成标准：{action.acceptance_criteria}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={actions.length >= MAX_EDITABLE_REMEDIATION_ACTIONS}
        onClick={addAction}
        style={{
          ...secondaryButtonStyle(actions.length >= MAX_EDITABLE_REMEDIATION_ACTIONS),
          marginTop: 9,
        }}
      >
        {actions.length >= MAX_EDITABLE_REMEDIATION_ACTIONS
          ? '已达到 8 个草稿动作上限'
          : '+ 添加自定义补证动作'}
      </button>
    </section>
  )
}


function QuestionEvidencePanel({
  review,
  canSelect,
  onSelect,
}: {
  review: ProjectQuestionEvidenceReview
  canSelect: boolean
  onSelect: (messageId: number) => void
}) {
  const sources = [
    ...review.question_evidence.knowledge.sources,
    ...review.question_evidence.memory.sources,
  ]
  return (
    <section
      aria-label="问题证据分析"
      style={{
        marginTop: 10,
        padding: '11px 12px',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-tint)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ color: 'var(--ink-soft)', fontSize: 11.5 }}>
          当前召回 {review.question_evidence.source_count} 条来源：知识文档{' '}
          {review.question_evidence.knowledge.source_count} · 项目记忆{' '}
          {review.question_evidence.memory.source_count} · 可用于支持{' '}
          {review.question_evidence.supporting_source_count}
        </div>
        <div style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>
          已评估 {review.summary.evaluated_candidate_count} 条回答
          {review.summary.truncated ? ' · 仅展示最高排序结果' : ''}
        </div>
      </div>
      {sources.length > 0 && (
        <div style={{ marginTop: 7, color: 'var(--ink-mute)', fontSize: 10.5 }}>
          来源：{sources.slice(0, 4).map((source) => source.title).join(' · ')}
          {sources.length > 4 ? ` · 另 ${sources.length - 4} 条` : ''}
        </div>
      )}
      {review.question_evidence.memory.memory_stale && (
        <div style={{ marginTop: 6, color: 'var(--warn)', fontSize: 10.5 }}>
          当前项目记忆含陈旧槽位，证据对齐结果需要额外复核。
        </div>
      )}
      <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
        {review.candidates.slice(0, 5).map((candidate) => (
          <EvidenceCandidateRow
            key={candidate.message_id}
            candidate={candidate}
            canSelect={canSelect}
            onSelect={onSelect}
          />
        ))}
        {review.candidates.length === 0 && (
          <div style={{ color: 'var(--ink-mute)', fontSize: 11.5 }}>
            项目中还没有可评估的 Assistant 回答。
          </div>
        )}
      </div>
    </section>
  )
}


function EvidenceCandidateRow({
  candidate,
  canSelect,
  onSelect,
}: {
  candidate: ProjectQuestionEvidenceCandidate
  canSelect: boolean
  onSelect: (messageId: number) => void
}) {
  const readiness = READINESS_COPY[candidate.assessment.readiness_band]
  const warning = candidate.assessment.warnings[0]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 9,
        padding: '8px 9px',
        border: '1px solid var(--line-soft)',
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-elev)',
      }}
    >
      <div style={{ textAlign: 'center', minWidth: 42 }}>
        <div style={{ color: 'var(--ink)', fontSize: 15, fontWeight: 650 }}>
          {candidate.assessment.readiness_score}
        </div>
        <div style={{ color: 'var(--ink-faint)', fontSize: 9.5 }}>准备度</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <CxStatus tone={readiness.tone}>{readiness.label}</CxStatus>
          <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>
            {candidate.conversation_title} · 相关性 {candidate.assessment.relevance.score} · 引用{' '}
            {candidate.assessment.evidence.cited_count} · 当前对齐{' '}
            {candidate.assessment.evidence.question_aligned_count} · 强溯源{' '}
            {candidate.assessment.evidence.verified_aligned_count}
          </span>
        </div>
        <div
          title={candidate.preview}
          style={{
            marginTop: 4,
            color: 'var(--ink-soft)',
            fontSize: 11,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {candidate.preview}
        </div>
        {warning && (
          <div style={{ marginTop: 3, color: 'var(--warn)', fontSize: 9.5 }}>
            {EVIDENCE_WARNING_COPY[warning] ?? warning}
          </div>
        )}
      </div>
      {canSelect && (
        <button
          type="button"
          aria-label={`采用回答 ${candidate.message_id}`}
          onClick={() => onSelect(candidate.message_id)}
          style={secondaryButtonStyle(false)}
        >
          采用
        </button>
      )}
    </div>
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
