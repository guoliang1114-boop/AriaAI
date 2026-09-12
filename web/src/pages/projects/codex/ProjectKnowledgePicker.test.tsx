import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client'
import { ProjectKnowledgePicker } from './ProjectKnowledgePicker'

vi.mock('../../../api/client', () => ({ api: { get: vi.fn() } }))
const document = (id: number) => ({ id, title: `资料 ${id}`, file_name: `${id}.md`, file_type: 'md', source_id: 90, source_name: '授权来源' })
const page = (id: number, offset = 0, total = 1) => ({ namespace: 'source_scoped', items: [document(id)], offset, total, limit: 20 })
function mount(selected: { id: number; title: string }[] = []) {
  const onApply = vi.fn(), onClose = vi.fn()
  render(<ProjectKnowledgePicker projectId={3} selected={selected} onApply={onApply} onClose={onClose} />)
  return { onApply, onClose }
}

describe('project document picker', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.get).mockResolvedValue(page(7)) })

  it('defaults to project scope, stages document identities and cancels without applying', async () => {
    const { onApply, onClose } = mount()
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择资料 资料 7' }))
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/knowledge/chat-documents', { params: { project_id: 3, scope: 'project', query: '', offset: 0, limit: 20 } })
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('retains draft across explicit scopes and pages; search is submitted explicitly', async () => {
    const { onApply } = mount()
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择资料 资料 7' }))
    vi.mocked(api.get).mockResolvedValue(page(8, 0, 21))
    fireEvent.click(screen.getByRole('button', { name: '共享知识' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择资料 资料 8' }))
    expect(api.get).toHaveBeenLastCalledWith('/knowledge/chat-documents', { params: { project_id: 3, scope: 'workspace', query: '', offset: 0, limit: 20 } })
    vi.mocked(api.get).mockResolvedValue(page(9, 20, 21))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择资料 资料 9' }))
    const calls = vi.mocked(api.get).mock.calls.length
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'IBM' } })
    expect(api.get).toHaveBeenCalledTimes(calls)
    vi.mocked(api.get).mockResolvedValue(page(10))
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await screen.findByRole('checkbox', { name: '选择资料 资料 10' })
    expect(api.get).toHaveBeenLastCalledWith('/knowledge/chat-documents', { params: { project_id: 3, scope: 'workspace', query: 'IBM', offset: 0, limit: 20 } })
    fireEvent.click(screen.getByRole('button', { name: '应用选择（3 份）' }))
    expect(onApply).toHaveBeenCalledExactlyOnceWith([7, 8, 9].map(id => ({ id, title: `资料 ${id}` })))
  })

  it('discards late results from another scope', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(api.get).mockReturnValueOnce(new Promise(done => { resolve = done }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: '我的资料' }))
    await screen.findByRole('checkbox', { name: '选择资料 资料 7' })
    await act(async () => resolve(page(99)))
    expect(screen.queryByRole('checkbox', { name: '选择资料 资料 99' })).not.toBeInTheDocument()
  })

  it.each(['offline', 'namespace', 'invalid_row', 'duplicate'])('blocks apply on invalid page and retries without applying (%s)', async reason => {
    if (reason === 'offline') vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
    else vi.mocked(api.get).mockResolvedValueOnce(reason === 'namespace' ? { ...page(7), namespace: 'legacy' }
      : reason === 'duplicate' ? { ...page(7), items: [document(7), document(7)] } : { ...page(7), items: [{ ...document(7), source_name: {} }] })
    const { onApply } = mount()
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '应用空选择，恢复项目默认范围' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试加载资料' }))
    await screen.findByRole('checkbox', { name: '选择资料 资料 7' })
    await waitFor(() => expect(screen.getByRole('button', { name: '应用空选择，恢复项目默认范围' })).toBeEnabled())
    expect(onApply).not.toHaveBeenCalled()
  })

  it('caps selection at 20 and allows explicit removal', async () => {
    const { onApply } = mount(Array.from({ length: 20 }, (_, id) => ({ id: id + 100, title: `已选 ${id}` })))
    const checkbox = await screen.findByRole('checkbox', { name: '选择资料 资料 7' })
    expect(checkbox).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '取消选择 已选 0' }))
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '应用选择（20 份）' }))
    expect(onApply.mock.calls[0][0]).toHaveLength(20)
    expect(onApply.mock.calls[0][0]).toContainEqual({ id: 7, title: '资料 7' })
  })
})
