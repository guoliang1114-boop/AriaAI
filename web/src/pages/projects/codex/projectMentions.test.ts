import { describe, expect, it } from 'vitest'
import type { ProjectMentionables } from '../../../types/api'
import {
  buildProjectMentionOptions,
  rebaseProjectMentionTokens,
  restoreProjectMentionsFromContext,
} from './projectMentions'

const mentionables: ProjectMentionables = {
  files: [{ id: 11, name: '访谈纪要.docx', file_type: 'docx' }],
  stakeholders: [{ id: 12, name: '张总', role: '客户负责人' }],
  milestones: [],
}

describe('historical project mentions', () => {
  it('restores only IDs still available in the current project', () => {
    const options = buildProjectMentionOptions([], mentionables)
    const restored = restoreProjectMentionsFromContext(options, {
      file_ids: [11],
      stakeholder_ids: [12],
      milestone_ids: [13],
    })

    expect(restored.requestedCount).toBe(3)
    expect(restored.missingCount).toBe(1)
    expect(restored.selected.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'file:11',
      'stakeholder:12',
    ])
  })

  it('removes historical name tokens before appending revalidated mentions', () => {
    const options = buildProjectMentionOptions([], mentionables)
    const restored = restoreProjectMentionsFromContext(options, { file_ids: [11] })

    expect(rebaseProjectMentionTokens(
      '分析 @「旧文件名.docx」 的风险',
      restored.selected,
      true,
    )).toBe('分析 的风险 @「访谈纪要.docx」')
  })
})
