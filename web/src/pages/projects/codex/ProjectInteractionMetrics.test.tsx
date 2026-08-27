import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client'
import { ProjectInteractionMetricsPanel } from './ProjectInteractionMetrics'

vi.mock('../../../api/client', () => ({ api: { get: vi.fn() } }))

describe('ProjectInteractionMetricsPanel', () => {
  beforeEach(() => vi.mocked(api.get).mockReset())

  it('loads privacy-safe project quality metrics on demand', async () => {
    vi.mocked(api.get).mockResolvedValue({
      project_id: 9,
      sample_limit: 2000,
      schema_version: 1,
      assistant_turn_count: 10,
      feedback_count: 5,
      feedback_coverage: 0.5,
      helpful_count: 4,
      helpful_rate: 0.8,
      revision_feedback_count: 2,
      revision_success_rate: 0.5,
      turn_setup: { requested_count: 4, applied_count: 3, dismissed_count: 1, adoption_rate: 0.75 },
      negative_reasons: { incomplete: 1, inaccurate: 0 },
      privacy: { stores_message_content: false, stores_free_text_feedback: false, stores_user_identity: false },
    })

    await userEvent.click(render(<ProjectInteractionMetricsPanel projectId={9} />).getByRole('button', { name: '查看项目交互质量' }))

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/chat/projects/9/interaction-metrics'))
    expect(await screen.findByText('80%')).toBeInTheDocument()
    expect(screen.getByText('结果不完整')).toBeInTheDocument()
    expect(screen.getByText(/不读取或保存对话正文/)).toBeInTheDocument()
  })
})
