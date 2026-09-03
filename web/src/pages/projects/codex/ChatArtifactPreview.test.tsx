import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedArtifact } from '../../../types/api'
import { ChatArtifactPreview } from './ChatArtifactPreview'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockDownloadArtifact = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

vi.mock('../../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('../downloadArtifact', () => ({
  downloadArtifact: (...args: unknown[]) => mockDownloadArtifact(...args),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function artifact(fileId: number, name: string): GeneratedArtifact {
  return {
    project_file_id: fileId,
    name,
    file_type: 'md',
    path: `/tmp/${name}`,
  }
}

describe('ChatArtifactPreview', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockDownloadArtifact.mockReset()
  })

  it('does not let an old artifact response overwrite the newly selected file', async () => {
    const oldRequest = deferred<{ id: number; name: string; content: string; summary: null; uploaded_at: null }>()
    const newRequest = deferred<{ id: number; name: string; content: string; summary: null; uploaded_at: null }>()
    mockGet.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)

    const common = { projectId: 3, onClose: vi.fn(), width: 380, onResize: vi.fn() }
    const { rerender } = render(
      <ChatArtifactPreview artifact={artifact(1, '旧文档.md')} {...common} />,
    )
    rerender(<ChatArtifactPreview artifact={artifact(2, '新文档.md')} {...common} />)

    await act(async () => newRequest.resolve({
      id: 2,
      name: '新文档.md',
      content: '最新内容',
      summary: null,
      uploaded_at: null,
    }))
    await screen.findByText('最新内容')

    await act(async () => oldRequest.resolve({
      id: 1,
      name: '旧文档.md',
      content: '过期内容',
      summary: null,
      uploaded_at: null,
    }))
    expect(screen.getByText('最新内容')).toBeInTheDocument()
    expect(screen.queryByText('过期内容')).not.toBeInTheDocument()
  })

  it('downloads a persisted generated artifact without a project file row', async () => {
    mockDownloadArtifact.mockResolvedValue(undefined)
    const generated: GeneratedArtifact = {
      id: 42,
      name: '已核验的旧报告.pdf',
      file_type: 'pdf',
      path: 'generated/verified-report.pdf',
      recovery_verified: true,
    }

    render(
      <ChatArtifactPreview
        artifact={generated}
        projectId={3}
        onClose={vi.fn()}
        width={380}
        onResize={vi.fn()}
      />,
    )

    expect(screen.getByText(/尚未保存为项目文档/)).toBeInTheDocument()
    const download = screen.getByRole('button', { name: '下载' })
    expect(download).toBeEnabled()
    fireEvent.click(download)

    await waitFor(() => expect(mockDownloadArtifact).toHaveBeenCalledWith({
      artifactId: 42,
      fileName: '已核验的旧报告.pdf',
    }))
  })

  it('loads bounded verification evidence only when the user expands it', async () => {
    const verification = {
      schema_version: 1 as const,
      verification_id: 7,
      verifier_version: 1,
      status: 'passed' as const,
      technical_status: 'passed' as const,
      skill_status: 'not_declared' as const,
      content_sha256: 'a'.repeat(64),
      evidence_sha256: 'b'.repeat(64),
      automated_check_count: 5,
      automated_passed_count: 5,
      automated_failed_count: 0,
      automated_skipped_count: 0,
      skill_check_count: 0,
      metrics: {},
    }
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/acceptance')) {
        return Promise.resolve({
          schema_version: 1,
          artifact_id: 42,
          verification_id: 7,
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
            status: 'not_configured',
            registered_verifier_count: 8,
            skill_package_code_executable: false,
          },
        })
      }
      return Promise.resolve({
        ...verification,
        checks: [{ check_id: 'file_exists', status: 'passed' }],
        created_at: '2026-09-03T00:00:00',
      })
    })

    render(
      <ChatArtifactPreview
        artifact={{
          id: 42,
          name: 'evidence.txt',
          file_type: 'txt',
          path: 'generated/evidence.txt',
          verification,
        }}
        projectId={3}
        onClose={vi.fn()}
        width={380}
        onResize={vi.fn()}
      />,
    )

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/artifacts/42/acceptance'))
    expect(mockGet).not.toHaveBeenCalledWith('/artifacts/42/verification')
    fireEvent.click(screen.getByRole('button', { name: /技术校验通过 5\/5/ }))
    await screen.findByText('文件存在 · 通过')
    expect(mockGet).toHaveBeenCalledWith('/artifacts/42/verification')
  })

  it('saves a technically verified generated artifact to project documents explicitly', async () => {
    const verification = {
      schema_version: 1 as const,
      verification_id: 9,
      verifier_version: 1,
      status: 'passed' as const,
      technical_status: 'passed' as const,
      skill_status: 'not_declared' as const,
      content_sha256: 'a'.repeat(64),
      evidence_sha256: 'b'.repeat(64),
      automated_check_count: 5,
      automated_passed_count: 5,
      automated_failed_count: 0,
      automated_skipped_count: 0,
      skill_check_count: 0,
      metrics: {},
    }
    mockGet.mockResolvedValue({
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
        status: 'not_configured',
        registered_verifier_count: 8,
        skill_package_code_executable: false,
      },
    })
    mockPost.mockResolvedValue({
      schema_version: 1,
      artifact_id: 44,
      project_id: 3,
      project_file_id: 91,
      target: 'project_documents',
      created: true,
      content_sha256: 'a'.repeat(64),
      saved_by_user_id: 1,
      saved_at: '2026-09-03T00:00:00',
      delivery_status: 'ready',
      final_delivery_allowed: true,
      writes_memory: false,
      invalidates_derived_project_memory: true,
      writes_knowledge_base: false,
      sends_external_messages: false,
    })
    const onSaved = vi.fn()

    render(
      <ChatArtifactPreview
        artifact={{
          id: 44,
          project_id: 3,
          name: 'verified.txt',
          file_type: 'txt',
          path: 'generated/verified.txt',
          content_sha256: 'a'.repeat(64),
          verification,
        }}
        projectId={3}
        onClose={vi.fn()}
        width={380}
        onResize={vi.fn()}
        onProjectDocumentSaved={onSaved}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '保存到项目文档' }))
    await screen.findByRole('button', { name: '已保存到项目文档' })
    expect(mockPost).toHaveBeenCalledWith('/artifacts/44/save-to-project', {
      expected_content_sha256: 'a'.repeat(64),
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('records a reasoned business acceptance from the verification panel', async () => {
    const verification = {
      schema_version: 1 as const,
      verification_id: 8,
      verifier_version: 1,
      status: 'manual_required' as const,
      technical_status: 'passed' as const,
      skill_status: 'manual_required' as const,
      content_sha256: 'c'.repeat(64),
      evidence_sha256: 'd'.repeat(64),
      automated_check_count: 5,
      automated_passed_count: 5,
      automated_failed_count: 0,
      automated_skipped_count: 0,
      skill_check_count: 3,
      metrics: {},
    }
    const pending = {
      schema_version: 1 as const,
      artifact_id: 43,
      verification_id: 8,
      content_sha256: 'c'.repeat(64),
      evidence_sha256: 'd'.repeat(64),
      verification_plan_sha256: 'e'.repeat(64),
      verification_status: 'manual_required' as const,
      technical_status: 'passed' as const,
      review_status: 'pending' as const,
      delivery_status: 'review_required' as const,
      final_delivery_allowed: false,
      revision: 0,
      reason: '',
      history: [],
      history_limit: 20,
      allowed_decisions: ['accepted' as const, 'rejected' as const],
      human_judgment_only: true as const,
      acceptance_is_truth_verdict: false as const,
      business_automation: {
        registry_version: 1,
        status: 'not_configured' as const,
        registered_verifier_count: 8,
        skill_package_code_executable: false as const,
      },
    }
    mockGet.mockImplementation((url: string) => Promise.resolve(
      url.endsWith('/acceptance')
        ? pending
        : { ...verification, checks: [], created_at: '2026-09-03T00:00:00' },
    ))
    mockPost.mockResolvedValue({
      ...pending,
      review_status: 'accepted',
      delivery_status: 'ready',
      final_delivery_allowed: true,
      revision: 1,
      reason: '已逐项核对。',
      history: [{
        id: 1,
        revision: 1,
        previous_status: 'pending',
        status: 'accepted',
        actor_user_id: 1,
        reason: '已逐项核对。',
        created_at: '2026-09-03T00:00:00',
      }],
    })

    render(
      <ChatArtifactPreview
        artifact={{
          id: 43,
          name: 'manual.txt',
          file_type: 'txt',
          path: 'generated/manual.txt',
          verification,
        }}
        projectId={3}
        onClose={vi.fn()}
        width={380}
        onResize={vi.fn()}
      />,
    )

    await screen.findByRole('button', { name: /3 项待业务验收/ })
    fireEvent.click(screen.getByRole('button', { name: /3 项待业务验收/ }))
    await screen.findByText(/等待业务验收/)
    fireEvent.change(screen.getByLabelText('业务验收依据'), {
      target: { value: '已逐项核对。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '验收通过' }))

    await screen.findByRole('button', { name: /业务验收通过 · 可最终交付/ })
    expect(mockPost).toHaveBeenCalledWith('/artifacts/43/acceptance', {
      decision: 'accepted',
      expected_revision: 0,
      reason: '已逐项核对。',
    })
  })
})
