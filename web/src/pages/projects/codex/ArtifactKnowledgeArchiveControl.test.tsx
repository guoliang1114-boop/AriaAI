import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactKnowledgeArchiveControl } from './ArtifactKnowledgeArchiveControl'

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

const acceptance = {
  schema_version: 1,
  artifact_id: 44,
  verification_id: 9,
  content_sha256: 'a'.repeat(64),
  evidence_sha256: 'b'.repeat(64),
  verification_plan_sha256: '',
  verification_status: 'passed',
  technical_status: 'passed',
  review_status: 'not_required',
  delivery_status: 'ready',
  final_delivery_allowed: true,
  revision: 0,
  reason: '',
  history: [],
  history_limit: 20,
  allowed_decisions: [],
  human_judgment_only: true,
  acceptance_is_truth_verdict: false,
  business_automation: {
    registry_version: 1,
    status: 'passed',
    check_count: 1,
    passed_count: 1,
    failed_count: 0,
    skipped_count: 0,
    checks: [],
    registered_verifier_count: 8,
    skill_package_code_executable: false,
  },
}

describe('ArtifactKnowledgeArchiveControl', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockGet.mockImplementation((path: string) => {
      if (path === '/knowledge/sources') {
        return Promise.resolve([{
          id: 8,
          name: '项目知识源',
          source_type: 'manual_upload',
          scope_type: 'project',
          scope_id: 3,
          status: 'active',
          can_write: true,
        }])
      }
      if (path === '/artifacts/44/knowledge-archives') return Promise.resolve([])
      if (path === '/artifacts/44/acceptance') return Promise.resolve(acceptance)
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    mockPost.mockResolvedValue({
      schema_version: 1,
      archive_id: 12,
      artifact_id: 44,
      source_id: 8,
      source_name: '项目知识源',
      source_scope_type: 'project',
      source_scope_id: 3,
      document_id: 19,
      document_status: 'queued',
      job_id: 21,
      job_status: 'queued',
      content_sha256: 'a'.repeat(64),
      deliverable_contract_sha256: 'c'.repeat(64),
      requested_by_user_id: 1,
      created_at: '2026-09-03T00:00:00',
      writes_project_memory: false,
      writes_client_memory: false,
      sends_external_messages: false,
      archive_created: true,
      document_created: true,
      indexing_enqueued: true,
    })
  })

  it('requires an explicit writable Source selection before indexing', async () => {
    render(
      <ArtifactKnowledgeArchiveControl
        artifactId={44}
        contentSha256={'a'.repeat(64)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /归档到知识库/ }))
    const source = await screen.findByRole('combobox', {
      name: '目标 Knowledge Source',
    })
    expect(screen.getByRole('button', { name: '确认归档' })).toBeDisabled()
    fireEvent.change(source, { target: { value: '8' } })
    expect(screen.getByRole('button', { name: '确认归档' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '确认写入' }))
    fireEvent.click(screen.getByRole('button', { name: '确认归档' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/artifacts/44/archive-to-knowledge',
      {
        source_id: 8,
        confirm_archive: true,
        expected_content_sha256: 'a'.repeat(64),
      },
    ))
    expect(await screen.findByText(/项目知识源 · queued/)).toBeInTheDocument()
  })
})
