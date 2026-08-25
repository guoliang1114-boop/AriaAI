import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../../types/api'
import { CxConversationRenameDialog } from './CxConversationActions'

const mockToast = {
  showToast: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => mockToast,
}))

vi.mock('../../../api/client', () => ({
  api: { patch: vi.fn() },
}))

function conversation(id: number, title: string): Conversation {
  return {
    id,
    project_id: 3,
    title,
    is_archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('CxConversationRenameDialog', () => {
  beforeEach(() => {
    Object.values(mockToast).forEach((mock) => mock.mockClear())
  })

  it('discards an abandoned draft when closed and follows the selected conversation', () => {
    const first = conversation(1, '第一段对话')
    const second = conversation(2, '第二段对话')
    const baseProps = { onClose: vi.fn(), onSaved: vi.fn() }
    const { rerender } = render(
      <CxConversationRenameDialog open conversation={first} {...baseProps} />,
    )

    const input = screen.getByRole('textbox', { name: '标题' })
    fireEvent.change(input, { target: { value: '未保存草稿' } })
    expect(input).toHaveValue('未保存草稿')

    rerender(<CxConversationRenameDialog open={false} conversation={first} {...baseProps} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<CxConversationRenameDialog open conversation={first} {...baseProps} />)
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('第一段对话')

    rerender(<CxConversationRenameDialog open conversation={second} {...baseProps} />)
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('第二段对话')
  })
})
