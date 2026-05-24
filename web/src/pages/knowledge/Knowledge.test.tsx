import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Knowledge } from './Knowledge'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders documents after loading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/documents') {
        return Promise.resolve([
          { id: 1, name: 'doc1.pdf', file_type: 'pdf', path: '/docs/1.pdf', category: 'general', vector_status: 'synced', uploaded_at: '2025-01-01', size: 102400 },
          { id: 2, name: 'doc2.docx', file_type: 'docx', path: '/docs/2.docx', category: 'research', vector_status: 'pending', uploaded_at: '2025-01-02', size: 51200 },
        ])
      }
      if (url === '/knowledge/stats') {
        return Promise.resolve({ document_count: 2, total_vectors: 100 })
      }
      return Promise.resolve([])
    })
    render(<Knowledge />)
    await waitFor(() => {
      expect(screen.getByText('doc1.pdf')).toBeInTheDocument()
      expect(screen.getByText('doc2.docx')).toBeInTheDocument()
    })
  })

  it('shows empty state when no documents', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/documents') return Promise.resolve([])
      if (url === '/knowledge/stats') return Promise.resolve({ document_count: 0, total_vectors: 0 })
      return Promise.resolve([])
    })
    render(<Knowledge />)
    await waitFor(() => {
      expect(screen.getByText('knowledge.upload')).toBeInTheDocument()
    })
  })

  it('filters documents by search', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/documents') {
        return Promise.resolve([
          { id: 1, name: 'report.pdf', file_type: 'pdf', path: '/docs/1.pdf', category: 'general', vector_status: 'synced', uploaded_at: '2025-01-01', size: 102400 },
          { id: 2, name: 'notes.txt', file_type: 'txt', path: '/docs/2.txt', category: 'research', vector_status: 'synced', uploaded_at: '2025-01-02', size: 51200 },
        ])
      }
      if (url === '/knowledge/stats') return Promise.resolve({ document_count: 2, total_vectors: 100 })
      return Promise.resolve([])
    })
    render(<Knowledge />)
    await waitFor(() => screen.getByText('report.pdf'))
    const searchInput = screen.getByPlaceholderText(/knowledge.searchDocuments/)
    fireEvent.change(searchInput, { target: { value: 'report' } })
    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument()
    })
  })

  it('deletes a document', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/knowledge/documents') {
        return Promise.resolve([
          { id: 1, name: 'doc1.pdf', file_type: 'pdf', path: '/docs/1.pdf', category: 'general', vector_status: 'synced', uploaded_at: '2025-01-01', size: 102400 },
        ])
      }
      if (url === '/knowledge/stats') return Promise.resolve({ document_count: 1, total_vectors: 50 })
      return Promise.resolve([])
    })
    mockDelete.mockResolvedValue({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Knowledge />)
    await waitFor(() => screen.getByText('doc1.pdf'))
    const buttons = screen.getAllByRole('button')
    const deleteBtn = buttons[buttons.length - 1]
    fireEvent.click(deleteBtn)
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/knowledge/documents/1')
    })
    confirmSpy.mockRestore()
  })
})
