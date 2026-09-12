import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client'
import type { ProjectDetail } from '../../../types/api'
import { CxProjectChat } from './tabs/Chat'

const mocks = vi.hoisted(() => ({
  send: vi.fn(), refetch: vi.fn().mockResolvedValue(undefined),
  messages: [], batches: [],
  conversations: [4, 5].map(id => ({ id, project_id: 3, title: `验收对话 ${id}`, created_at: '2026-09-12T00:00:00Z', updated_at: '2026-09-12T00:00:00Z' })),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => mocks.toast }))
vi.mock('./CxProjectShell', () => ({ CxProjectShell: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('./ChatEmptyState', () => ({ ChatEmptyState: () => null }))
vi.mock('./ConversationContinuityPanel', () => ({ ConversationContinuityPanel: () => null }))
vi.mock('./ProjectInteractionMetrics', () => ({ ProjectInteractionMetricsPanel: () => null }))
vi.mock('./useProjectsApi', () => ({
  useProjectConversations: () => ({ data: mocks.conversations, loading: false, error: null, refetch: mocks.refetch, removeLocal: vi.fn() }),
  useConversationMessages: () => ({ data: mocks.messages, loading: false, error: null, refetch: mocks.refetch }),
  formatUpdatedRelative: () => '刚刚',
}))
vi.mock('./usePendingActions', () => ({ usePendingActions: () => ({ batches: mocks.batches, actingKey: null, refetch: mocks.refetch }) }))
vi.mock('./useChatStream', () => ({ useChatStream: () => ({ status: 'idle', send: mocks.send }) }))

const selected = { namespace: 'source_scoped', documents: [{ id: 7, title: 'IBM 方法文档' }], unavailable_count: 0 }
const empty = { namespace: 'source_scoped', documents: [], unavailable_count: 0 }
const detail = { project: { id: 3, name: '示例项目' }, files: [], folders: [] } as unknown as ProjectDetail
function auxiliaryResponse(url: string) {
  if (url === '/chat/mentionables') return { files: [], stakeholders: [], milestones: [] }
  if (url.endsWith('/recovery-center')) return { summary: { attention_count: 0 }, items: [] }
  return []
}
function mount() {
  return render(<MemoryRouter><CxProjectChat projectId={3} detail={detail} /></MemoryRouter>)
}
function enter(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
}

describe('native project knowledge scope integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Element.prototype.scrollTo = vi.fn()
    mocks.send.mockResolvedValue(undefined)
    vi.mocked(api.get).mockImplementation(async url => {
      if (url.endsWith('/knowledge-context')) return selected
      return auxiliaryResponse(url)
    })
  })

  it('carries restored documents on actual composer sends and drops them after explicit clear', async () => {
    mount()
    expect(await screen.findByRole('button', { name: '移除知识文档 IBM 方法文档' })).toBeInTheDocument()
    enter('精简成两条')
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('精简成两条', { knowledgeDocumentIds: [7] }))
    expect(screen.getByRole('button', { name: '移除知识文档 IBM 方法文档' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清空资料，恢复项目默认范围' }))
    expect(screen.getByLabelText('项目对话知识范围')).toHaveTextContent('项目默认（未指定文档）')
    enter('分析当前项目')
    await waitFor(() => expect(mocks.send).toHaveBeenLastCalledWith('分析当前项目', {}))
  })

  it('blocks during restore, preserves the draft on failure, and retries without auto-sending', async () => {
    let reject!: (reason: Error) => void
    vi.mocked(api.get).mockImplementation(url => url.endsWith('/knowledge-context')
      ? new Promise((_resolve, fail) => { reject = fail }) : Promise.resolve(auxiliaryResponse(url)))
    mount()
    enter('继续回答')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    await act(async () => reject(new Error('offline')))
    expect(screen.getByRole('alert')).toHaveTextContent('知识范围恢复失败')
    expect(screen.getByRole('textbox')).toHaveValue('继续回答')
    vi.mocked(api.get).mockImplementation(async url => url.endsWith('/knowledge-context') ? selected : auxiliaryResponse(url))
    fireEvent.click(screen.getByRole('button', { name: '重试恢复资料' }))
    await screen.findByRole('button', { name: '移除知识文档 IBM 方法文档' })
    expect(mocks.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('继续回答', { knowledgeDocumentIds: [7] }))
  })

  it('does not carry one conversation selection into another', async () => {
    mount()
    await screen.findByRole('button', { name: '移除知识文档 IBM 方法文档' })
    vi.mocked(api.get).mockImplementation(async url => url.endsWith('/knowledge-context') ? empty : auxiliaryResponse(url))
    fireEvent.click(screen.getByRole('button', { name: '验收对话 5 刚刚' }))
    expect(screen.queryByRole('button', { name: '移除知识文档 IBM 方法文档' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('项目对话知识范围')).toHaveTextContent('项目默认（未指定文档）'))
    enter('这个项目进展如何')
    await waitFor(() => expect(mocks.send).toHaveBeenLastCalledWith('这个项目进展如何', {}))
    expect(api.get).toHaveBeenCalledWith('/chat/conversations/5/knowledge-context')
  })

  it('requires explicit default-scope confirmation when every selected document is unavailable', async () => {
    vi.mocked(api.get).mockImplementation(async url => url.endsWith('/knowledge-context')
      ? { ...empty, unavailable_count: 1 } : auxiliaryResponse(url))
    mount()
    await screen.findByRole('button', { name: '确认恢复项目默认范围' })
    enter('继续')
    expect(mocks.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认恢复项目默认范围' }))
    expect(mocks.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('继续', {}))
  })
})
