import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../../../api/client'
import { ToastProvider } from '../../../../contexts/ToastContext'
import type {
  ProjectDetail,
  ProjectQuestionEvidenceReview,
  ProjectQuestionRemediationPlan,
  ProjectQuestionRemediationExecutionList,
  ProjectQuestionRemediationPromotion,
  ProjectQuestionWorkbench,
} from '../../../../types/api'
import { CxProjectQuestions } from './Questions'


vi.mock('../../../../api/client', () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}))

vi.mock('../CxProjectShell', () => ({
  CxProjectShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const detail = {
  project: {
    id: 9,
    name: '验收项目',
    client: '测试客户',
    status: 'delivering',
    memory_version: 5,
    memory_stale: false,
    created_at: '2026-08-01T00:00:00',
    updated_at: '2026-08-31T08:00:00',
  },
  files: [{
    id: 31,
    project_id: 9,
    name: '客户签字确认.pdf',
    file_type: 'pdf',
    path: 'project/confirmation.pdf',
    size: 1024,
    uploaded_at: '2026-08-31T08:00:00',
  }],
} as unknown as ProjectDetail

const workbench: ProjectQuestionWorkbench = {
  schema_version: 1,
  project_id: 9,
  can_write: true,
  memory: {
    status: 'ready',
    memory_version: 5,
    slot_version: 3,
    stale: false,
  },
  counts: { open: 1, needs_review: 0, resolved: 0 },
  questions: [{
    question: '客户是否确认了最终验收范围？',
    question_sha256: 'a'.repeat(64),
    status: 'open',
    review_reason: '',
    profile: {
      owner_user_id: null,
      priority: 'normal',
      due_date: '',
      revision: 0,
      updated_at: '',
    },
    resolution: null,
  }],
  members: [
    { user_id: 2, display_name: '项目负责人', role: 'owner' },
    { user_id: 3, display_name: '交付经理', role: 'editor' },
  ],
  answer_candidates: [{
    message_id: 42,
    conversation_id: 12,
    conversation_title: '验收讨论',
    preview: '客户已经书面确认最终验收范围。',
    created_at: '2026-08-31T08:30:00',
  }],
  truncated: { resolutions: false, profiles: false, answer_candidates: false },
  privacy: {
    includes_bounded_answer_previews: true,
    includes_full_answer_content: false,
    includes_prompt_content: false,
    includes_tool_inputs: false,
    includes_hidden_reasoning: false,
  },
}

const evidenceReview: ProjectQuestionEvidenceReview = {
  schema_version: 1,
  project_id: 9,
  question: '客户是否确认了最终验收范围？',
  question_sha256: 'a'.repeat(64),
  question_evidence: {
    status: 'available',
    source_count: 2,
    supporting_source_count: 1,
    memory: {
      status: 'available',
      memory_version: 5,
      memory_stale: false,
      retrieval_mode: 'focused',
      selected_slots: ['project_brief', 'open_questions'],
      source_count: 1,
      supporting_source_count: 0,
      sources: [{
        source_type: 'project_memory',
        evidence_id: 'memory_evidence_1',
        citation_key: 'M1',
        title: '项目记忆 v5 · Open questions',
        memory_slot: 'open_questions',
        memory_version: 5,
        provenance_status: 'direct',
        fact_evidence_count: 1,
      }],
    },
    knowledge: {
      status: 'available',
      source_count: 1,
      supporting_source_count: 1,
      sources: [{
        source_type: 'knowledge_document',
        evidence_id: 'evidence_1',
        citation_key: 'K1',
        title: '验收确认函.pdf',
        document_id: 31,
        chunk_index: 2,
        retrieval_score: 0.91,
      }],
    },
    attachments: {
      status: 'not_available',
      source_count: 0,
      supporting_source_count: 0,
      sources: [],
    },
  },
  summary: {
    evaluated_candidate_count: 1,
    returned_candidate_count: 1,
    recommended_message_id: 42,
    bands: { strong: 1, review: 0, weak: 0, unrated: 0 },
    truncated: false,
  },
  candidates: [{
    ...workbench.answer_candidates[0],
    is_selected_resolution: false,
    assessment: {
      contract: 'deterministic_selection_readiness',
      readiness_score: 91,
      readiness_band: 'strong',
      relevance: { score: 82, matched_question_terms: ['客户', '确认'] },
      evidence: {
        status: 'cited',
        score: 100,
        available_count: 2,
        cited_count: 2,
        knowledge_cited_count: 1,
        memory_cited_count: 1,
        invalid_citation_count: 0,
        current_question_source_count: 2,
        question_aligned_count: 2,
        verified_aligned_count: 2,
        alignment_rate: 1,
        support_rate: 1,
        sources: [],
      },
      run_evaluation: { status: 'available', verdict: 'completed', score: 100 },
      feedback: { status: 'not_available', rating: '', reasons: [] },
      warnings: [],
      requires_human_confirmation: true,
      is_correctness_verdict: false,
    },
  }],
  assessment_contract: {
    name: 'deterministic_selection_readiness',
    dimensions: ['question_relevance', 'evidence_alignment'],
    requires_human_confirmation: true,
    is_correctness_verdict: false,
  },
  privacy: {
    includes_bounded_answer_previews: true,
    includes_full_answer_content: false,
    includes_retrieved_chunk_content: false,
    includes_bounded_attachment_notes: false,
    includes_bounded_review_reasons: false,
    includes_prompt_content: false,
    includes_tool_inputs: false,
    includes_tool_outputs: false,
    includes_hidden_reasoning: false,
  },
}

const remediationPlan: ProjectQuestionRemediationPlan = {
  schema_version: 1,
  project_id: 9,
  question: '客户是否确认了最终验收范围？',
  question_sha256: 'a'.repeat(64),
  status: 'evidence_collection_required',
  question_archetype: 'confirmation',
  evidence_target: 'written_confirmation',
  basis: {
    question_sha256: 'a'.repeat(64),
    evidence_status: 'context_only',
    source_count: 1,
    supporting_source_count: 0,
    memory_version: 5,
    memory_stale: false,
    evaluated_candidate_count: 1,
    strong_candidate_count: 0,
    recommended_message_id: 42,
    gap_codes: ['CONTEXT_ONLY_EVIDENCE', 'NO_STRONG_ANSWER_CANDIDATE'],
    evidence_identity_fingerprint: 'c'.repeat(64),
    fingerprint: 'b'.repeat(64),
  },
  gaps: [{
    code: 'CONTEXT_ONLY_EVIDENCE',
    severity: 'blocking',
    title: '当前只有问题上下文',
    detail: '开放问题不能证明候选答案为真。',
  }],
  actions: [
    {
      action_id: 'remediation_01',
      kind: 'evidence_request',
      title: '请求书面确认证据',
      draft: '请提供客户对最终验收范围的书面确认记录。',
      rationale: '当前只有问题上下文。',
      suggested_owner_role: 'evidence_owner',
      suggested_channel: 'manual',
      blocking: true,
      acceptance_criteria: '包含确认人、时间和范围。',
      editable_fields: ['title', 'draft', 'owner_user_id'],
      execution_mode: 'manual_only',
    },
    {
      action_id: 'remediation_02',
      kind: 'human_verification',
      title: '项目负责人最终确认',
      draft: '补证后再决定是否关单。',
      rationale: '准备度不是正确性裁决。',
      suggested_owner_role: 'project_owner',
      suggested_channel: 'manual',
      blocking: true,
      acceptance_criteria: '人工确认结论和来源。',
      editable_fields: ['title', 'draft', 'owner_user_id'],
      execution_mode: 'manual_only',
    },
  ],
  plan_contract: {
    name: 'deterministic_evidence_gap_remediation',
    generation_method: 'rules_only',
    persists_changes: false,
    sends_messages: false,
    executes_tools: false,
    requires_human_confirmation: true,
  },
  privacy: {
    includes_question_text: true,
    includes_answer_previews: false,
    includes_source_titles: false,
    includes_retrieved_chunk_content: false,
    includes_prompt_content: false,
    includes_tool_inputs: false,
    includes_tool_outputs: false,
    includes_hidden_reasoning: false,
  },
}

const pendingPromotion: ProjectQuestionRemediationPromotion = {
  schema_version: 1,
  id: 81,
  project_id: 9,
  question: '客户是否确认了最终验收范围？',
  question_sha256: 'a'.repeat(64),
  status: 'pending',
  revision: 1,
  snapshot_sha256: 'd'.repeat(64),
  evidence_basis_fingerprint: 'b'.repeat(64),
  preview: {
    project_id: 9,
    question_sha256: 'a'.repeat(64),
    target_kind: 'communication_request',
    action_kind: 'evidence_request',
    source_action_id: 'remediation_01',
    title: '请求书面确认证据',
    draft: '请提供客户对最终验收范围的书面确认记录。',
    owner_user_id: 3,
    due_date: '2026-09-15',
    recipient_label: '客户项目经理',
  },
  created_by_user_id: 2,
  decided_by_user_id: null,
  failure_code: '',
  decision_reason: '',
  expires_at: '2026-09-01T09:00:00',
  expired: false,
  decided_at: null,
  created_at: '2026-08-31T09:00:00',
  updated_at: '2026-08-31T09:00:00',
  target: null,
  contract: {
    name: 'project_question_remediation_promotion',
    persists_frozen_preview: true,
    requires_explicit_confirmation: true,
    reauthorizes_on_confirmation: true,
    rechecks_current_evidence_basis: true,
    creates_target_before_confirmation: false,
    sends_messages: false,
    executes_tools: false,
    outbound_delivery: false,
    delivery_mode: 'manual_only',
  },
}

const confirmedPromotion: ProjectQuestionRemediationPromotion = {
  ...pendingPromotion,
  status: 'confirmed',
  revision: 2,
  decided_by_user_id: 2,
  decision_reason: 'confirmed_by_user',
  decided_at: '2026-08-31T09:02:00',
  updated_at: '2026-08-31T09:02:00',
  target: {
    kind: 'communication_request',
    id: 91,
    subject: '请求书面确认证据',
    body: '请提供客户对最终验收范围的书面确认记录。',
    recipient_label: '客户项目经理',
    owner_user_id: 3,
    due_date: '2026-09-15',
    status: 'ready_for_manual_send',
    delivery_mode: 'manual_only',
    delivered: false,
  },
}

const emptyExecutions: ProjectQuestionRemediationExecutionList = {
  schema_version: 1,
  project_id: 9,
  items: [],
  count: 0,
  counts: {
    active: 0,
    ready_for_manual_send: 0,
    sent_manually: 0,
    completed: 0,
    cancelled: 0,
  },
  contract: {
    name: 'project_question_remediation_execution',
    manual_send_is_user_attestation: true,
    delivered_by_aria: false,
    outbound_delivery: false,
    sends_messages: false,
    executes_tools: false,
    completion_requires_evidence: true,
    evidence_is_project_scoped: true,
    evidence_events_are_append_only: true,
    automatically_resolves_question: false,
  },
}

const readyExecution: ProjectQuestionRemediationExecutionList = {
  ...emptyExecutions,
  count: 1,
  counts: { ...emptyExecutions.counts, ready_for_manual_send: 1 },
  items: [{
    schema_version: 1,
    id: 101,
    project_id: 9,
    source_promotion_id: 81,
    question: '客户是否确认了最终验收范围？',
    question_sha256: 'a'.repeat(64),
    target_kind: 'communication_request',
    status: 'ready_for_manual_send',
    revision: 1,
    evidence_count: 0,
    last_transition_note: 'confirmed_target_created',
    created_by_user_id: 2,
    last_transition_by_user_id: 2,
    last_transition_at: '2026-09-01T08:00:00',
    created_at: '2026-09-01T08:00:00',
    updated_at: '2026-09-01T08:00:00',
    target: {
      kind: 'communication_request',
      id: 91,
      subject: '请求书面确认证据',
      body: '请提供客户签字确认。',
      recipient_label: '客户项目经理',
      status: 'ready_for_manual_send',
      delivery_mode: 'manual_only',
      delivered_by_aria: false,
      manual_delivery_attested: false,
    },
    evidence: [],
    events: [{
      id: 1,
      revision: 1,
      action: 'created',
      status: 'ready_for_manual_send',
      actor_user_id: 2,
      evidence_attachment_id: null,
      note: 'confirmed_target_created',
      created_at: '2026-09-01T08:00:00',
    }],
    truncated: { evidence: false, events: false },
    allowed_actions: ['attach_evidence', 'mark_sent', 'cancel'],
    question_resolution_status: 'open',
    contract: emptyExecutions.contract,
    evidence_review_contract: {
      name: 'project_question_remediation_evidence_review',
      human_judgment_only: true,
      acceptance_is_truth_verdict: false,
      writes_long_term_memory: false,
      fetches_external_references: false,
      sends_messages: false,
      executes_tools: false,
      automatically_resolves_question: false,
      reauthorizes_on_decision: true,
      uses_optimistic_revision: true,
      events_are_append_only: true,
    },
  }],
}

function renderQuestions(refetch = vi.fn().mockResolvedValue(undefined)) {
  return {
    refetch,
    ...render(
      <MemoryRouter>
        <ToastProvider>
          <CxProjectQuestions projectId={9} detail={detail} refetch={refetch} />
        </ToastProvider>
      </MemoryRouter>,
    ),
  }
}

describe('project question workbench', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.patch).mockReset()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.get).mockImplementation(async (path: string) => (
      path.endsWith('/questions/remediation-executions') ? emptyExecutions : workbench
    ))
  })

  it('shows the project-level question, accountability controls, and answer candidates', async () => {
    renderQuestions()

    expect(await screen.findByText('客户是否确认了最终验收范围？')).toBeInTheDocument()
    expect(screen.getByText('项目问题工作台')).toBeInTheDocument()
    expect(screen.getByRole('option', {
      name: '[验收讨论] 客户已经书面确认最终验收范围。',
    })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '项目负责人' })).toBeInTheDocument()
    expect(screen.getByText('记忆 v5 · 问题槽位 v3')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/projects/9/questions')
  })

  it('saves owner, priority, and due date with the exact profile revision', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      ...workbench,
      questions: [{
        ...workbench.questions[0],
        profile: {
          owner_user_id: 3,
          priority: 'high',
          due_date: '2026-09-15',
          revision: 1,
          updated_at: '2026-08-31T09:00:00',
        },
      }],
    })
    renderQuestions()
    await screen.findByText('客户是否确认了最终验收范围？')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '问题负责人' }), '3')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '问题优先级' }), 'high')
    await userEvent.type(screen.getByLabelText('问题截止日期'), '2026-09-15')
    await userEvent.click(screen.getByRole('button', { name: '保存责任' }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/projects/9/questions/${'a'.repeat(64)}`,
      {
        question: '客户是否确认了最终验收范围？',
        owner_user_id: 3,
        priority: 'high',
        due_date: '2026-09-15',
        expected_revision: 0,
      },
    ))
    expect(await screen.findByText('责任版本 1')).toBeInTheDocument()
  })

  it('requires an explicit project answer and summary before resolving', async () => {
    const resolved: ProjectQuestionWorkbench = {
      ...workbench,
      memory: { ...workbench.memory, memory_version: 6, slot_version: 4 },
      counts: { open: 0, needs_review: 0, resolved: 1 },
      questions: [{
        ...workbench.questions[0],
        status: 'resolved',
        resolution: {
          id: 71,
          resolution_revision: 1,
          resolution_summary: '书面确认已归档。',
          answer_message_id: 42,
          answer_conversation_id: 12,
          answer_available: true,
          resolved_memory_version: 6,
          resolved_slot_version: 4,
          resolved_at: '2026-08-31T09:00:00',
        },
      }],
    }
    vi.mocked(api.post).mockResolvedValue(resolved)
    const { refetch } = renderQuestions()
    await screen.findByText('客户是否确认了最终验收范围？')

    const resolveButton = screen.getByRole('button', { name: '标记已解决' })
    expect(resolveButton).toBeDisabled()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '选择解决问题的回答' }),
      '42',
    )
    await userEvent.type(screen.getByRole('textbox', { name: '解决摘要' }), '书面确认已归档。')
    await userEvent.click(resolveButton)

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/projects/9/questions/resolve',
      {
        question: '客户是否确认了最终验收范围？',
        answer_message_id: 42,
        resolution_summary: '书面确认已归档。',
        expected_memory_version: 5,
        expected_slot_version: 3,
      },
    ))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('书面确认已归档。')).toBeInTheDocument()
  })

  it('recalls current evidence, ranks answers, and keeps the user in control', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(workbench)
    vi.mocked(api.post).mockResolvedValueOnce(evidenceReview)
    renderQuestions()
    await screen.findByText('客户是否确认了最终验收范围？')

    await userEvent.click(screen.getByRole('button', { name: '分析问题证据' }))

    expect(await screen.findByRole('region', { name: '问题证据分析' })).toBeInTheDocument()
    expect(screen.getByText(/验收确认函\.pdf · 项目记忆 v5 · Open questions/)).toBeInTheDocument()
    expect(screen.getByText('91')).toBeInTheDocument()
    expect(screen.getByText('证据较强')).toBeInTheDocument()
    expect(screen.getByText('确定性排序仅辅助人工选择，不代表答案正确。')).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith(
      `/projects/9/questions/${'a'.repeat(64)}/evidence`,
      { question: '客户是否确认了最终验收范围？' },
      { timeout: 60_000 },
    )
    expect(screen.getByRole('combobox', { name: '选择解决问题的回答' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '标记已解决' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '采用回答 42' }))
    expect(screen.getByRole('combobox', { name: '选择解决问题的回答' })).toHaveValue('42')
  })

  it('turns evidence gaps into editable local drafts without side effects', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(workbench)
    vi.mocked(api.post)
      .mockResolvedValueOnce(evidenceReview)
      .mockResolvedValueOnce(remediationPlan)
    renderQuestions()
    await screen.findByText('客户是否确认了最终验收范围？')

    await userEvent.click(screen.getByRole('button', { name: '分析问题证据' }))
    await screen.findByRole('region', { name: '问题证据分析' })
    await userEvent.click(screen.getByRole('button', { name: '生成补证计划' }))

    expect(await screen.findByRole('region', { name: '证据缺口补证计划' })).toBeInTheDocument()
    expect(screen.getByText('当前只有问题上下文')).toBeInTheDocument()
    expect(screen.getByText(/编辑内容仍只在当前页面；点击“准备创建”后仅保存冻结预览/)).toBeInTheDocument()
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      `/projects/9/questions/${'a'.repeat(64)}/remediation`,
      { question: '客户是否确认了最终验收范围？' },
      { timeout: 60_000 },
    )

    const title = screen.getByLabelText('补证动作标题 1')
    await userEvent.clear(title)
    await userEvent.type(title, '向客户项目经理请求签字版确认')
    expect(title).toHaveValue('向客户项目经理请求签字版确认')
    await userEvent.selectOptions(screen.getByLabelText('补证动作责任人 1'), '3')
    expect(screen.getByLabelText('补证动作责任人 1')).toHaveValue('3')
    await userEvent.click(screen.getByRole('button', { name: '移除补证动作 2' }))
    expect(screen.queryByText('项目负责人最终确认')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ 添加自定义补证动作' }))
    expect(screen.getByDisplayValue('自定义补证动作')).toBeInTheDocument()
    for (let index = 0; index < 6; index += 1) {
      await userEvent.click(screen.getByRole('button', { name: '+ 添加自定义补证动作' }))
    }
    expect(screen.getByRole('button', { name: '已达到 8 个草稿动作上限' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '发送补证请求' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存补证计划' })).not.toBeInTheDocument()
    expect(api.post).toHaveBeenCalledTimes(2)
  })

  it('persists a frozen preview and requires a second confirmation for manual communication', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce(evidenceReview)
      .mockResolvedValueOnce(remediationPlan)
      .mockResolvedValueOnce(pendingPromotion)
      .mockResolvedValueOnce(confirmedPromotion)
    const { refetch } = renderQuestions()
    await screen.findByText('客户是否确认了最终验收范围？')

    await userEvent.click(screen.getByRole('button', { name: '分析问题证据' }))
    await screen.findByRole('region', { name: '问题证据分析' })
    await userEvent.click(screen.getByRole('button', { name: '生成补证计划' }))
    await screen.findByRole('region', { name: '证据缺口补证计划' })

    expect(screen.getByLabelText('补证动作目标 1')).toHaveValue('communication_request')
    await userEvent.selectOptions(screen.getByLabelText('补证动作责任人 1'), '3')
    await userEvent.type(screen.getByLabelText('补证动作截止日期 1'), '2026-09-15')
    await userEvent.type(screen.getByLabelText('补证动作沟通对象 1'), '客户项目经理')
    await userEvent.click(screen.getByRole('button', { name: '准备创建人工沟通请求' }))

    await waitFor(() => expect(api.post).toHaveBeenNthCalledWith(
      3,
      `/projects/9/questions/${'a'.repeat(64)}/promotions/prepare`,
      {
        question: '客户是否确认了最终验收范围？',
        evidence_basis_fingerprint: 'b'.repeat(64),
        idempotency_key: expect.any(String),
        target_kind: 'communication_request',
        action_kind: 'evidence_request',
        source_action_id: 'remediation_01',
        title: '请求书面确认证据',
        draft: '请提供客户对最终验收范围的书面确认记录。',
        owner_user_id: 3,
        due_date: '2026-09-15',
        recipient_label: '客户项目经理',
      },
    ))
    expect(await screen.findByText('等待明确确认')).toBeInTheDocument()
    expect(screen.getByText(/Aria 不会替你发送/)).toBeInTheDocument()
    expect(screen.queryByText(/人工沟通请求 #91 已就绪/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '确认创建人工沟通请求' }))

    await waitFor(() => expect(api.post).toHaveBeenNthCalledWith(
      4,
      `/projects/9/questions/${'a'.repeat(64)}/promotions/81/confirm`,
      {
        snapshot_sha256: 'd'.repeat(64),
        expected_revision: 1,
        reason: '',
      },
    ))
    expect(await screen.findByText('人工沟通请求 #91 已就绪，尚未发送。')).toBeInTheDocument()
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(api.post).toHaveBeenCalledTimes(4)
    expect(api.post).not.toHaveBeenCalledWith('/projects/9/todos', expect.anything())
  })

  it('governs manual send, evidence attachment, and completion without auto-closing', async () => {
    const sentExecution: ProjectQuestionRemediationExecutionList = {
      ...readyExecution,
      counts: { ...readyExecution.counts, ready_for_manual_send: 0, sent_manually: 1 },
      items: [{
        ...readyExecution.items[0],
        status: 'sent_manually',
        revision: 2,
        target: {
          ...readyExecution.items[0].target,
          status: 'sent_manually',
          manual_delivery_attested: true,
          delivered_by_aria: false,
        },
        allowed_actions: ['attach_evidence', 'complete', 'cancel'],
      }],
    }
    const evidencedExecution: ProjectQuestionRemediationExecutionList = {
      ...sentExecution,
      items: [{
        ...sentExecution.items[0],
        revision: 3,
        evidence_count: 1,
        evidence: [{
          id: 201,
          execution_id: 101,
          project_id: 9,
          question_sha256: 'a'.repeat(64),
          execution_revision: 3,
          evidence_sha256: 'e'.repeat(64),
          evidence_kind: 'manual_note',
          support_level: 'review_required',
          title: '客户回复记录',
          note: '项目负责人已人工核对客户回复。',
          reference_locator: '',
          project_file_id: null,
          knowledge_document_id: null,
          message_id: null,
          attached_by_user_id: 2,
          attached_at: '2026-09-01T08:10:00',
          review: {
            schema_version: 1,
            status: 'pending',
            revision: 0,
            reason: '',
            reviewed_by_user_id: null,
            reviewed_at: null,
            history: [],
            history_truncated: false,
            allowed_decisions: ['accepted', 'rejected'],
            human_judgment_only: true,
            acceptance_is_truth_verdict: false,
          },
        }],
      }],
    }
    const acceptedExecution: ProjectQuestionRemediationExecutionList = {
      ...evidencedExecution,
      items: [{
        ...evidencedExecution.items[0],
        evidence: [{
          ...evidencedExecution.items[0].evidence[0],
          review: {
            ...evidencedExecution.items[0].evidence[0].review,
            status: 'accepted',
            revision: 1,
            reason: '已核对原始邮件与当前项目范围。',
            reviewed_by_user_id: 2,
            reviewed_at: '2026-09-01T08:12:00',
            history: [{
              id: 301,
              revision: 1,
              previous_status: 'pending',
              status: 'accepted',
              actor_user_id: 2,
              reason: '已核对原始邮件与当前项目范围。',
              created_at: '2026-09-01T08:12:00',
            }],
          },
        }],
      }],
    }
    const completedExecution: ProjectQuestionRemediationExecutionList = {
      ...acceptedExecution,
      counts: { ...acceptedExecution.counts, sent_manually: 0, completed: 1 },
      items: [{
        ...acceptedExecution.items[0],
        status: 'completed',
        revision: 4,
        target: {
          ...evidencedExecution.items[0].target,
          status: 'completed',
          manual_delivery_attested: true,
          delivered_by_aria: false,
        },
        allowed_actions: ['attach_evidence'],
        question_resolution_status: 'open',
      }],
    }
    let current = readyExecution
    vi.mocked(api.get).mockImplementation(async (path: string) => (
      path.endsWith('/questions/remediation-executions') ? current : workbench
    ))
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path.endsWith('/transition') && current === readyExecution) {
        current = sentExecution
      } else if (path.endsWith('/evidence')) {
        current = evidencedExecution
      } else if (path.endsWith('/review')) {
        current = acceptedExecution
      } else if (path.endsWith('/transition')) {
        current = completedExecution
      }
      return current.items[0]
    })
    renderQuestions()

    expect(await screen.findByRole('region', { name: '整改执行中心' })).toBeInTheDocument()
    expect(await screen.findByText('待人工发送')).toBeInTheDocument()
    expect(screen.getByText(/项目问题仍未关单/)).toBeInTheDocument()
    await userEvent.type(
      screen.getByLabelText('整改执行 101 状态说明'),
      '已通过企业邮箱人工发送。',
    )
    await userEvent.click(screen.getByRole('button', { name: '人工标记已发送' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/projects/9/questions/remediation-executions/101/transition',
      {
        action: 'mark_sent',
        expected_revision: 1,
        note: '已通过企业邮箱人工发送。',
      },
    ))
    expect(await screen.findByText('人工已发送')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '标记整改完成' })).toBeDisabled()

    await userEvent.selectOptions(
      screen.getByLabelText('整改执行 101 证据类型'),
      'manual_note',
    )
    await userEvent.type(
      screen.getByLabelText('整改执行 101 证据标题'),
      '客户回复记录',
    )
    await userEvent.type(
      screen.getByLabelText('整改执行 101 证据内容'),
      '项目负责人已人工核对客户回复。',
    )
    await userEvent.click(screen.getByRole('button', { name: '挂接证据' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/projects/9/questions/remediation-executions/101/evidence',
      {
        expected_revision: 2,
        idempotency_key: expect.any(String),
        evidence_kind: 'manual_note',
        title: '客户回复记录',
        note: '项目负责人已人工核对客户回复。',
        reference_locator: '',
        project_file_id: null,
        knowledge_document_id: null,
        message_id: null,
      },
    ))
    expect(await screen.findByText(/客户回复记录 · 待人工裁决/)).toBeInTheDocument()
    await userEvent.type(
      screen.getByLabelText('证据 201 裁决理由'),
      '已核对原始邮件与当前项目范围。',
    )
    await userEvent.click(screen.getByRole('button', { name: '接受为人工支持' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/projects/9/questions/remediation-executions/101/evidence/201/review',
      {
        decision: 'accepted',
        expected_revision: 0,
        reason: '已核对原始邮件与当前项目范围。',
      },
    ))
    expect(await screen.findByText(/客户回复记录 · 人工接受（不等同事实）/)).toBeInTheDocument()
    expect(screen.getByText(/最新裁决依据（v1）/)).toBeInTheDocument()
    const complete = screen.getByRole('button', { name: '标记整改完成' })
    expect(complete).toBeDisabled()
    await userEvent.type(
      screen.getByLabelText('整改执行 101 状态说明'),
      '客户回复与范围记录已人工核验。',
    )
    expect(complete).toBeEnabled()
    await userEvent.click(complete)

    expect(await screen.findByText('已完成')).toBeInTheDocument()
    expect(screen.getByText(/项目问题仍未关单/)).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalledWith(
      '/projects/9/questions/resolve',
      expect.anything(),
    )
  })

  it('does not expose answer evidence analysis to read-only project members', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...workbench,
      can_write: false,
      answer_candidates: [],
      privacy: {
        ...workbench.privacy,
        includes_bounded_answer_previews: false,
      },
    })
    renderQuestions()
    await screen.findByText('客户是否确认了最终验收范围？')

    expect(screen.queryByRole('button', { name: '分析问题证据' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成补证计划' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '选择解决问题的回答' })).toBeDisabled()
  })
})
