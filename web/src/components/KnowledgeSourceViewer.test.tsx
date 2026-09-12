import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KnowledgeSourceViewer } from './KnowledgeSourceViewer'
import { api } from '../api/client'
import { downloadKnowledgeOriginal } from '../api/knowledgeOriginal'

vi.mock('../api/client', () => ({ api: { get: vi.fn() } }))
vi.mock('../api/knowledgeOriginal', () => ({ downloadKnowledgeOriginal: vi.fn() }))

describe('KnowledgeSourceViewer', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
    HTMLDialogElement.prototype.close = vi.fn()
    vi.mocked(api.get).mockReset()
    vi.mocked(downloadKnowledgeOriginal).mockReset()
  })
  afterEach(() => vi.restoreAllMocks())
  it('pages exact document text, escapes markup and downloads the original', async () => {
    vi.mocked(api.get).mockImplementation(async <T,>(url: string) => ({
      document_id: 7, title: '市场洞察', file_name: '市场洞察.pptx', total: 4,
      chunks: [{ chunk_index: url.includes('offset=3') ? 3 : 0, content: '<script>不执行脚本</script>', truncated: true }],
    }) as T)
    const close = vi.fn()
    render(<KnowledgeSourceViewer documentId={7} onClose={close} />)
    await screen.findByText('<script>不执行脚本</script>')
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText(/此分块仅显示前/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('分块 4')
    expect(api.get).toHaveBeenLastCalledWith('/knowledge/documents/7/content?offset=3&limit=3')
    fireEvent.click(screen.getByRole('button', { name: '下载原文件' }))
    await waitFor(() => expect(downloadKnowledgeOriginal).toHaveBeenCalledWith(7, '市场洞察.pptx'))
    fireEvent.click(screen.getByRole('button', { name: '关闭原文' }))
    expect(close).toHaveBeenCalledOnce()
  })
  it('reports revoked access without stale content or fallback', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('404'))
    render(<KnowledgeSourceViewer documentId={7} onClose={vi.fn()} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    expect(api.get).toHaveBeenCalledOnce()
    expect(downloadKnowledgeOriginal).not.toHaveBeenCalled()
  })
})
