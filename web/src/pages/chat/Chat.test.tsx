import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import zh from '../../i18n/locales/zh.json'
import { Chat } from './Chat'
import { api } from '../../api/client'

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => url === '/chat/conversations?standalone=true'
      ? [{ id: 1, title: '回归测试', created_at: '2026-09-12T00:00:00Z', updated_at: '2026-09-12T00:00:00Z' }]
      : []),
    post: vi.fn(async () => ({ id: 1, title: '回归测试', created_at: '2026-09-12T00:00:00Z', updated_at: '2026-09-12T00:00:00Z' })),
    patch: vi.fn(async () => ({})),
  },
}))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('../../hooks/useAppTimeZone', () => ({ useAppTimeZone: () => ({ resolvedTimeZone: 'Asia/Shanghai' }) }))

describe('standalone chat failure handling', () => {
  beforeEach(async () => {
    vi.mocked(api.get).mockClear()
    vi.mocked(api.get).mockImplementation(async <T,>(url: string) => (url === '/chat/conversations?standalone=true'
      ? [{ id: 1, title: '回归测试', created_at: '2026-09-12T00:00:00Z', updated_at: '2026-09-12T00:00:00Z' }] : []) as T)
    sessionStorage.clear()
    localStorage.setItem('authToken', 'test-token')
    await i18n.use(initReactI18next).init({
      resources: { 'zh-CN': { translation: zh } },
      lng: 'zh-CN', interpolation: { escapeValue: false },
    })
  })

  it.each(['direct', 'cancel', 'apply'])('selects a Skill without forcing a form and preserves the draft (%s)', async action => {
    const skill = { id: 24, name: '数字化战略设计', category: '数字化', description: '战略分析', estimated_time: '5分钟', user_template: '公司：[公司]' }
    vi.mocked(api.get).mockImplementation(async <T,>(url: string) => (url === '/skills/meta/summary' ? [skill] : url === '/skills/24' ? skill : []) as T)
    const mockFetch = vi.fn(async () => new Response('data: {"type":"done"}\n\n'))
    vi.stubGlobal('fetch', mockFetch)
    render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/chat?skill=24']}><Chat /></MemoryRouter></I18nextProvider>)
    await screen.findByRole('button', { name: '填写模板（可选）' })
    const input = screen.getByPlaceholderText(zh.chat.placeholder)
    fireEvent.change(input, { target: { value: '只给两个建议，不生成文件。' } })
    expect(screen.queryByPlaceholderText('请输入公司...')).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalledWith('/skills')
    expect(api.get).not.toHaveBeenCalledWith('/skills/24')
    if (action !== 'direct') {
      fireEvent.click(screen.getByRole('button', { name: '填写模板（可选）' }))
      const company = await screen.findByPlaceholderText('请输入公司...')
      fireEvent.change(company, { target: { value: '样例企业' } })
      fireEvent.click(screen.getByRole('button', { name: action === 'cancel' ? zh.common.cancel : '写入草稿' }))
    }
    expect(mockFetch).not.toHaveBeenCalled()
    expect(input).toHaveValue(action === 'apply' ? '只给两个建议，不生成文件。\n\n公司：样例企业' : '只给两个建议，不生成文件。')
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.skill_id).toBe(24)
    expect(body.force_skill).toBe(true)
    await waitFor(() => expect(screen.getByPlaceholderText(zh.chat.placeholder)).toBeEnabled())
  })

  it.each(['restore', 'remove', 'unavailable', 'error'])('restores durable selection with explicit clear and failure handling (%s)', async action => {
    vi.mocked(api.get).mockImplementation(async <T,>(url: string) => {
      if (url.endsWith('/knowledge-context')) {
        if (action === 'error') throw new Error('temporary failure')
        return { namespace: 'source_scoped', documents: [{ id: 7, title: '市场洞察.pdf' }], unavailable_count: action === 'unavailable' ? 1 : 0 } as T
      }
      return [] as T
    })
    const mockFetch = vi.fn(async () => new Response('data: {"type":"done"}\n\n'))
    vi.stubGlobal('fetch', mockFetch)
    render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/chat?conversation=1']}><Chat /></MemoryRouter></I18nextProvider>)
    const input = await screen.findByPlaceholderText(zh.chat.placeholder)
    fireEvent.change(input, { target: { value: '精简成两条' } })
    if (action === 'error') {
      await screen.findByText('知识范围恢复失败，请重试。')
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
      expect(mockFetch).not.toHaveBeenCalled()
      return
    }
    const remove = await screen.findByRole('button', { name: '移除知识文档 市场洞察.pdf' })
    if (action === 'remove') fireEvent.click(remove)
    if (action === 'unavailable') {
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: '确认当前知识范围' }))
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.knowledge_document_ids).toEqual(action === 'remove' ? undefined : [7])
    await waitFor(() => expect(input).toBeEnabled())
  })

  it('discards a delayed template after switching conversations', async () => {
    const skill = { id: 24, name: '数字化战略设计', category: '数字化', description: '战略分析', estimated_time: '5分钟', user_template: '公司：[公司]' }
    let resolveTemplate!: (value: unknown) => void
    const pending = new Promise(resolve => { resolveTemplate = resolve })
    vi.mocked(api.get).mockImplementation(async <T,>(url: string) => (url === '/skills/meta/summary' ? [skill] : url === '/skills/24' ? await pending : []) as T)
    function SwitchConversation() {
      const navigate = useNavigate()
      return <button onClick={() => navigate('/chat?conversation=2')}>切换模板测试对话</button>
    }
    render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/chat?skill=24']}><Chat /><SwitchConversation /></MemoryRouter></I18nextProvider>)
    fireEvent.click(await screen.findByRole('button', { name: '填写模板（可选）' }))
    await screen.findByText('加载模板…')
    fireEvent.click(screen.getByRole('button', { name: '切换模板测试对话' }))
    await waitFor(() => expect(screen.queryByText('加载模板…')).not.toBeInTheDocument())
    resolveTemplate(skill)
    await waitFor(() => expect(screen.queryByPlaceholderText('请输入公司...')).not.toBeInTheDocument())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
    localStorage.removeItem('authToken')
  })

  it.each(['keep', 'remove', 'new', 'switch'])('preserves knowledge only in its conversation (%s)', async action => {
    const mockFetch = vi.fn(async () => new Response('data: {"type":"done"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', mockFetch)
    function SwitchConversation() {
      const navigate = useNavigate()
      return <button onClick={() => navigate('/chat?conversation=1')}>切换验证对话</button>
    }
    render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[{
      pathname: '/chat', state: { knowledgeHandoff: {
        namespace: 'source_scoped', documents: [{ id: 7, title: '市场洞察.pdf' }], query: '战略规划如何分析市场洞察？',
      } },
    }]}><Chat /><SwitchConversation /></MemoryRouter></I18nextProvider>)
    const input = await screen.findByPlaceholderText(zh.chat.placeholder)
    await waitFor(() => expect(input).toBeEnabled())
    expect(input).toHaveValue('战略规划如何分析市场洞察？')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '移除知识文档 市场洞察.pdf' })).toBeInTheDocument()
    if (action === 'remove') fireEvent.click(screen.getByRole('button', { name: '移除知识文档 市场洞察.pdf' }))
    if (action === 'new') {
      fireEvent.click(screen.getByRole('button', { name: '打开侧边栏' }))
      fireEvent.click(screen.getByRole('button', { name: /新建对话/ }))
    }
    if (action === 'switch') fireEvent.click(screen.getByRole('button', { name: '切换验证对话' }))
    if (action !== 'keep') await waitFor(() => expect(screen.queryByRole('button', { name: '移除知识文档 市场洞察.pdf' })).not.toBeInTheDocument())
    fireEvent.change(input, { target: { value: '数据权限如何审批？' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.knowledge_document_ids).toEqual(action === 'keep' ? [7] : undefined)
    expect(body.rag_doc_ids).toEqual([])
    await waitFor(() => expect(input).toBeEnabled())
    if (action === 'keep') {
      expect(screen.getByRole('button', { name: '移除知识文档 市场洞察.pdf' })).toBeInTheDocument()
      expect(input).toHaveValue('')
    }
  })

  it.each([true, false])('consumes run_failed without done (streamed text: %s)', async (withText) => {
    const savedFailure = '本轮没有完成。模型不可用，失败状态已保存。'
    const events = [
      { type: 'run_started', run_id: 'run_failure' },
      ...(withText ? [{ type: 'text', content: savedFailure }] : []),
      { type: 'run_failed', run_id: 'run_failure', error_message: '模型不可用', fallback_content: savedFailure },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )))
    render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/chat?conversation=1']}><Chat /></MemoryRouter></I18nextProvider>)
    const input = await screen.findByPlaceholderText(zh.chat.placeholder)
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: '帮我总结一下当前所有进行中项目的最新进展和关键风险点' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await waitFor(() => expect(screen.getAllByText(savedFailure)).toHaveLength(1))
    expect(screen.queryByText(/连接中断/)).not.toBeInTheDocument()
    expect(sessionStorage.getItem('pendingStreamingConvId')).toBeNull()
    await waitFor(() => expect(screen.getByPlaceholderText(zh.chat.placeholder)).toBeEnabled())
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
