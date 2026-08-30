import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CxNewProject } from './CxNewProject'

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

const duplicateClients = [
  { id: 1, name: '同名客户' },
  { id: 2, name: '同名客户' },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <CxNewProject />
    </MemoryRouter>,
  )
}

function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('例: 鼎和保险 · 数字化转型咨询'), {
    target: { value: '客户身份测试项目' },
  })
  fireEvent.change(screen.getByPlaceholderText('搜索现有客户,或直接填写新客户名称'), {
    target: { value: '同名客户' },
  })
}

describe('CxNewProject client identity', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') return Promise.resolve(duplicateClients)
      if (url === '/projects') return Promise.resolve([])
      if (url === '/auth/me') {
        return Promise.resolve({
          id: 9,
          email: 'owner@example.com',
          display_name: 'Owner',
          is_admin: false,
          is_active: true,
        })
      }
      return Promise.resolve([])
    })
    mockPost.mockResolvedValue({ id: 99, name: '客户身份测试项目' })
  })

  it('does not silently choose the first duplicate client by name', async () => {
    renderPage()
    fillRequiredFields()

    await waitFor(() => expect(screen.getAllByText('同名客户').length).toBeGreaterThanOrEqual(2))
    fireEvent.click(screen.getByRole('button', { name: /^创建项目/ }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('client_id')
  })

  it('posts the exact id selected from duplicate-name candidates', async () => {
    renderPage()
    fillRequiredFields()

    const secondClientButton = await waitFor(() => {
      const button = screen
        .getAllByRole('button')
        .find((candidate) => candidate.textContent?.includes('#2'))
      expect(button).toBeDefined()
      return button as HTMLButtonElement
    })
    fireEvent.click(secondClientButton)
    expect(screen.getByText('#2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^创建项目/ }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockPost).toHaveBeenCalledWith(
      '/projects',
      expect.objectContaining({ client: '同名客户', client_id: 2 }),
    )
  })

  it('clears the selected id when the user switches back to free text', async () => {
    renderPage()
    fillRequiredFields()

    const selectedClientButton = await waitFor(() => {
      const button = screen
        .getAllByRole('button')
        .find((candidate) => candidate.textContent?.includes('#1'))
      expect(button).toBeDefined()
      return button as HTMLButtonElement
    })
    fireEvent.click(selectedClientButton)
    fireEvent.click(screen.getByRole('button', { name: '更换' }))
    fireEvent.change(screen.getByPlaceholderText('搜索现有客户,或直接填写新客户名称'), {
      target: { value: '自由文本客户' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^创建项目/ }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockPost.mock.calls[0][1]).toEqual(
      expect.objectContaining({ client: '自由文本客户' }),
    )
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('client_id')
  })

  it('does not show projects from a duplicate-name client after selecting an id', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/clients') return Promise.resolve(duplicateClients)
      if (url === '/projects') {
        return Promise.resolve([
          {
            id: 51,
            name: '另一条同名客户的项目',
            client: '同名客户',
            client_id: 1,
            status: 'lead',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ])
      }
      if (url === '/auth/me') {
        return Promise.resolve({
          id: 9,
          email: 'owner@example.com',
          display_name: 'Owner',
          is_admin: false,
          is_active: true,
        })
      }
      return Promise.resolve([])
    })
    renderPage()
    fillRequiredFields()

    const secondClientButton = await waitFor(() => {
      const button = screen
        .getAllByRole('button')
        .find((candidate) => candidate.textContent?.includes('#2'))
      expect(button).toBeDefined()
      return button as HTMLButtonElement
    })
    fireEvent.click(secondClientButton)

    await waitFor(() => {
      expect(screen.queryByText('另一条同名客户的项目')).not.toBeInTheDocument()
    })
  })
})
