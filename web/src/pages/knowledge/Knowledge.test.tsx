import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { Knowledge } from './Knowledge'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()

const wrapDocuments = (items: any[]) => ({
  items,
  total: items.length,
  limit: 10,
  offset: 0,
  categories: Object.entries(
    items.reduce<Record<string, number>>((counts, item) => {
      const key = item.category || 'uncategorized'
      counts[key] = (counts[key] || 0) + 1
      return counts
    }, {}),
  ).map(([category, count]) => ({ category, count })),
  recent: items,
  indexed_count: items.filter((item) => item.vector_status === 'synced').length,
  total_size: items.reduce((sum, item) => sum + (item.size_bytes || item.size || 0), 0),
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
    mockGet.mockClear()
    mockPost.mockClear()
    mockDelete.mockClear()
  })

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Knowledge />)
    expect(screen.getAllByTestId('cx-skeleton').length).toBeGreaterThan(0)
  })

  it('renders documents after loading', async () => {
    mockGet.mockImplementation((url: string, config?: any) => {
      if (url === '/knowledge/documents/list') {
        return Promise.resolve(wrapDocuments([
          { id: 1, name: 'doc1.pdf', file_type: 'pdf', path: '/docs/1.pdf', category: 'general', vector_status: 'synced', uploaded_at: '2025-01-01', size: 102400 },
          { id: 2, name: 'doc2.docx', file_type: 'docx', path: '/docs/2.docx', category: 'research', vector_status: 'pending', uploaded_at: '2025-01-02', size: 51200 },
        ]))
      }
      if (url === '/knowledge/stats') {
        return Promise.resolve({ document_count: 2, total_vectors: 100 })
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
      if (url === '/knowledge/documents/list') return Promise.resolve(wrapDocuments([]))
      if (url === '/knowledge/stats') return Promise.resolve({ document_count: 0, total_vectors: 0 })
      return Promise.resolve([])
    })
    render(<Knowledge />)
    await waitFor(() => {
      expect(screen.getByText('还没有文档')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /上传文档/ }).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('filters documents by search', async () => {
    mockGet.mockImplementation((url: string, config?: any) => {
      if (url === '/knowledge/documents/list') {
        const docs = [
          { id: 1, name: 'report.pdf', file_type: 'pdf', path: '/docs/1.pdf', category: 'general', vector_status: 'synced', uploaded_at: '2025-01-01', size: 102400 },
          { id: 2, name: 'notes.txt', file_type: 'txt', path: '/docs/2.txt', category: 'research', vector_status: 'synced', uploaded_at: '2025-01-02', size: 51200 },
        ]
        const keyword = config?.params?.search
        return Promise.resolve(wrapDocuments(keyword ? docs.filter((doc) => doc.name.includes(keyword)) : docs))
      }
      if (url === '/knowledge/stats') return Promise.resolve({ document_count: 2, total_vectors: 100 })
      return Promise.resolve([])
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
      if (url === '/knowledge/documents/list') {
        return Promise.resolve(wrapDocuments([
          { id: 1, name: 'doc1.pdf', file_type: 'pdf', path: '/docs/1.pdf', category: 'general', vector_status: 'synced', uploaded_at: '2025-01-01', size: 102400 },
        ]))
      }
      if (url === '/knowledge/stats') return Promise.resolve({ document_count: 1, total_vectors: 50 })
      return Promise.resolve([])
    })
    mockDelete.mockResolvedValue({})
    render(<Knowledge />)
    await waitFor(() => screen.getAllByText('doc1.pdf'))
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
})
