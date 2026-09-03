import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedArtifact } from '../../../types/api'
import { ChatArtifactPreview } from './ChatArtifactPreview'

const mockGet = vi.fn()
const mockDownloadArtifact = vi.fn()

vi.mock('../../../api/client', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
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
    mockGet.mockResolvedValue({
      ...verification,
      checks: [{ check_id: 'file_exists', status: 'passed' }],
      created_at: '2026-09-03T00:00:00',
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

    expect(mockGet).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /技术校验通过 5\/5/ }))
    await screen.findByText('文件存在 · 通过')
    expect(mockGet).toHaveBeenCalledWith('/artifacts/42/verification')
  })
})
