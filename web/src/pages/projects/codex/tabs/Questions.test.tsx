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
    includes_prompt_content: false,
    includes_tool_inputs: false,
    includes_tool_outputs: false,
    includes_hidden_reasoning: false,
  },
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
    vi.mocked(api.get).mockResolvedValue(workbench)
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
    expect(screen.getByRole('combobox', { name: '选择解决问题的回答' })).toBeDisabled()
  })
})
