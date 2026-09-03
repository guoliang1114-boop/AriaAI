import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillDeliverableCatalog } from '../../../types/api'
import { ProjectDeliverableControl } from './ProjectDeliverableControl'

const mockGet = vi.fn()

vi.mock('../../../api/client', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
}))

const catalog: SkillDeliverableCatalog = {
  schema_version: 1,
  skill_id: 7,
  skill_name: '数字化战略',
  skill_version: '1.2.0',
  skill_release_sha256: 'a'.repeat(64),
  catalog_sha256: 'b'.repeat(64),
  item_count: 1,
  source: 'immutable_skill_release_markdown',
  items: [{
    schema_version: 1,
    deliverable_id: 'executive-deck-1234567890',
    name: '管理层汇报材料',
    when_to_use: '管理层需要决策时',
    minimum_content: '关键结论、方案与建议',
    format_label: 'PPTX / PDF',
    formats: ['pptx', 'pdf'],
    default_format: 'pptx',
    stage: 'executive_communication',
    save_targets: ['project_documents', 'knowledge_base'],
    memory_policy: 'explicit_user_confirmation',
    requires_review: true,
    business_verifiers: [],
    contract_sha256: 'c'.repeat(64),
  }],
}

describe('ProjectDeliverableControl', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockGet.mockResolvedValue(catalog)
  })

  it('loads the exact Skill catalog and emits its immutable selection hashes', async () => {
    const onChange = vi.fn()
    render(
      <ProjectDeliverableControl
        projectId={26}
        skillId={7}
        skillName="数字化战略"
        selection={null}
        onChange={onChange}
      />,
    )

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(
      '/skills/7/deliverables',
      { params: { project_id: 26 } },
    ))
    fireEvent.click(await screen.findByRole('button', { name: '交付物控制：选择交付物' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /管理层汇报材料/ }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      skillId: 7,
      input: {
        deliverable_id: 'executive-deck-1234567890',
        catalog_sha256: 'b'.repeat(64),
        contract_sha256: 'c'.repeat(64),
      },
    }))
  })

  it('fails closed when the release catalog cannot be loaded', async () => {
    mockGet.mockRejectedValue(new Error('stale release'))
    render(
      <ProjectDeliverableControl
        projectId={26}
        skillId={7}
        skillName="数字化战略"
        selection={null}
        onChange={vi.fn()}
      />,
    )

    expect(await screen.findByRole('button', { name: '交付物控制：选择交付物' }))
      .toBeDisabled()
    expect(screen.getByTitle('stale release')).toBeInTheDocument()
  })
})
