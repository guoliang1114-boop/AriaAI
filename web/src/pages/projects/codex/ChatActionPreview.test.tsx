import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PendingToolAction } from '../../../types/api'
import { ChatActionPreview } from './ChatActionPreview'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('ChatActionPreview', () => {
  it('renders a frozen structured diff as preformatted review content', () => {
    const action: PendingToolAction = {
      id: 7,
      trace_id: 'trace-patch',
      conversation_id: 3,
      project_id: 9,
      tool_name: 'update_project_markdown_document',
      tool_input: { mode: 'patch', file_id: 12 },
      action_type: 'modify_document',
      title: '确认修改文档',
      description: '执行前会再次校验基线。',
      details: [
        '目标文档：风险.md',
        'Diff 预览：\n```diff\n--- a/风险.md\n+++ b/风险.md\n-old\n+new\n```',
      ],
      status: 'pending',
      created_at: '2026-08-22T00:00:00',
    }

    render(
      <ChatActionPreview
        batches={[{ batchId: '', actions: [action] }]}
        actingKey={null}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    )

    const diff = screen.getByText(/--- a\/风险\.md/)
    expect(diff.tagName).toBe('PRE')
    expect(diff).toHaveTextContent('+new')
    expect(screen.getByText('目标文档')).toBeInTheDocument()
  })
})
