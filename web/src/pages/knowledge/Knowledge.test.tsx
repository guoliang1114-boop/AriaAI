import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { Knowledge } from './Knowledge'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()

const source = {
  id: 10,
  name: '咨询案例库',
  source_type: 'manual_upload',
  scope_type: 'workspace',
  tags: 'general',
  status: 'active',
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
}

const v005Doc = ({
  category = 'general',
  file_type,
  id,
  name,
  path,
  size = 102400,
  status = 'indexed',
}: {
  category?: string
  file_type: string
  id: number
  name: string
  path: string
  size?: number
  status?: string
}) => ({
  id,
  source_id: source.id,
  title: name.replace(/\.[^.]+$/, ''),
  file_name: name,
  file_type,
  path,
  metadata_json: JSON.stringify({ template_key: category }),
  file_size_bytes: size,
  chunk_count: status === 'indexed' ? 4 : 0,
  scope_type: 'workspace',
  scope_id: null,
  status,
  created_at: '2025-01-01',
  updated_at: '2025-01-02',
})

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh' } }),
}))

describe('Knowledge', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockDelete.mockReset()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Knowledge />)
    expect(screen.getAllByTestId('cx-skeleton').length).toBeGreaterThan(0)
  })

  it('renders documents after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/sources') return Promise.resolve([source])
      if (url === '/knowledge/sources/10/documents') {
        return Promise.resolve([
          v005Doc({ id: 1, name: 'doc1.pdf', file_type: 'pdf', path: '/docs/1.pdf', category: 'general', status: 'indexed' }),
          v005Doc({ id: 2, name: 'doc2.docx', file_type: 'docx', path: '/docs/2.docx', category: 'research', status: 'uploaded', size: 51200 }),
        ])
      }
      return Promise.resolve([])
    })
    render(<Knowledge />)
    await waitFor(() => {
      expect(screen.getAllByText('doc1.pdf').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('doc2.docx').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows empty state when no documents', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/sources') return Promise.resolve([])
      return Promise.resolve([])
    })
    render(<Knowledge />)
    await waitFor(() => {
      expect(screen.getByText('还没有文档')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /上传文档/ }).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('filters documents by search', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/sources') return Promise.resolve([source])
      if (url === '/knowledge/sources/10/documents') {
        return Promise.resolve([
          v005Doc({ id: 1, name: 'report.pdf', file_type: 'pdf', path: '/docs/1.pdf', category: 'general', status: 'indexed' }),
          v005Doc({ id: 2, name: 'notes.txt', file_type: 'txt', path: '/docs/2.txt', category: 'research', status: 'indexed', size: 51200 }),
        ])
      }
      return Promise.resolve([])
    })
    mockPost.mockImplementation((url: string) => {
      if (url === '/knowledge/search') {
        return Promise.resolve({
          chunks: [{
            id: 100,
            document_id: 1,
            document_title: 'report.pdf',
            document_path: '/docs/1.pdf',
            heading_path: ['摘要'],
            content: 'report search result',
            scope_type: 'workspace',
            scope_id: null,
            source_id: source.id,
            relevance: 0.91,
            metadata: { template_key: 'general' },
          }],
          total_found: 1,
        })
      }
      return Promise.resolve({})
    })
    render(<Knowledge />)
    await waitFor(() => screen.getAllByText('report.pdf'))
    const searchInput = screen.getByLabelText('搜索知识库')
    fireEvent.change(searchInput, { target: { value: 'report' } })
    await waitFor(() => {
      const table = screen.getByRole('region', { name: '知识库文档' })
      expect(within(table).getByText('report.pdf')).toBeInTheDocument()
      expect(within(table).queryByText('notes.txt')).not.toBeInTheDocument()
    })
  })

  it('deletes a document via the confirm dialog', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/sources') return Promise.resolve([source])
      if (url === '/knowledge/sources/10/documents') return Promise.resolve([
        v005Doc({ id: 1, name: 'doc1.pdf', file_type: 'pdf', path: '/docs/1.pdf', category: 'general', status: 'indexed' }),
      ])
      return Promise.resolve([])
    })
    mockDelete.mockResolvedValue({})
    render(<Knowledge />)
    await waitFor(() => screen.getAllByText('doc1.pdf'))
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    const deleteBtn = screen.getByRole('button', { name: /删除 doc1.pdf/ })
    fireEvent.click(deleteBtn)
    // CxConfirmDialog opens — find and click "删除" inside it.
    const dialog = await screen.findByRole('dialog')
    const confirmBtn = within(dialog).getByRole('button', { name: '删除' })
    fireEvent.click(confirmBtn)
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/knowledge/documents/1')
    })
  })

  it('retries indexing a failed document', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/sources') return Promise.resolve([source])
      if (url === '/knowledge/sources/10/documents') return Promise.resolve([
        v005Doc({ id: 3, name: 'deck.pptx', file_type: 'pptx', path: '/docs/deck.pptx', category: 'general', status: 'failed' }),
      ])
      return Promise.resolve([])
    })
    mockPost.mockResolvedValue({})
    render(<Knowledge />)
    await waitFor(() => screen.getAllByText('deck.pptx'))
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('button', { name: '重新处理' }))
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/knowledge/sources/10/sync')
    })
  })

  it('shows failed documents as failed in find results', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/sources') return Promise.resolve([source])
      if (url === '/knowledge/sources/10/documents') return Promise.resolve([
        v005Doc({ id: 4, name: 'failed-deck.pptx', file_type: 'pptx', path: '/docs/failed-deck.pptx', category: 'general', status: 'failed' }),
      ])
      return Promise.resolve([])
    })
    mockPost.mockResolvedValue({})
    render(<Knowledge />)
    await waitFor(() => screen.getAllByText('failed-deck.pptx'))
    expect(screen.getByText(/无法索引/)).toBeInTheDocument()
    expect(screen.queryByText(/等待解析或索引/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新处理' }))
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/knowledge/sources/10/sync')
    })
  })
})
