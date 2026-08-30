import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Project } from '../../../types/api'
import { CxEditProjectDialog } from './CxProjectActions'

const mockPatch = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}))

vi.mock('./useProjectsApi', () => ({
  useClientsList: () => ({
    data: [
      { id: 7, name: '同名客户' },
      { id: 8, name: '同名客户' },
      { id: 9, name: '后建客户' },
    ],
    loading: false,
  }),
}))

const project: Project = {
  id: 41,
  name: '身份保留项目',
  client: '同名客户',
  client_id: 7,
  description: '',
  status: 'lead',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('CxEditProjectDialog client identity', () => {
  beforeEach(() => {
    mockPatch.mockReset()
    mockPatch.mockResolvedValue(project)
  })

  it('preserves the linked client identity by omitting untouched client fields', async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(
      <CxEditProjectDialog
        open
        project={project}
        onClose={onClose}
        onSaved={onSaved}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
    expect(mockPatch.mock.calls[0][0]).toBe('/projects/41')
    const payload = mockPatch.mock.calls[0][1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('client')
    expect(payload).not.toHaveProperty('client_id')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('does not let a later same-name client claim an untouched unlinked project', async () => {
    const unlinkedProject: Project = {
      ...project,
      id: 42,
      client: '后建客户',
      client_id: null,
    }
    render(
      <CxEditProjectDialog
        open
        project={unlinkedProject}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
    const payload = mockPatch.mock.calls[0][1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('client')
    expect(payload).not.toHaveProperty('client_id')
  })

  it('sends a stable client id after an explicit candidate selection', async () => {
    const unlinkedProject: Project = {
      ...project,
      id: 43,
      client: '',
      client_id: null,
    }
    render(
      <CxEditProjectDialog
        open
        project={unlinkedProject}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('搜索现有客户,或直接填写新客户名称')
    fireEvent.change(input, { target: { value: '同名' } })
    fireEvent.click(screen.getByRole('button', { name: /同名客户.*#7/ }))
    expect(screen.getByText('#7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
    expect(mockPatch).toHaveBeenCalledWith(
      '/projects/43',
      expect.objectContaining({ client: '同名客户', client_id: 7 }),
    )
  })
})
