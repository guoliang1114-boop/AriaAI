import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedArtifact } from '../../../types/api'
import { ChatArtifactPreview } from './ChatArtifactPreview'

const mockGet = vi.fn()

vi.mock('../../../api/client', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
}))

vi.mock('../../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
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
})
