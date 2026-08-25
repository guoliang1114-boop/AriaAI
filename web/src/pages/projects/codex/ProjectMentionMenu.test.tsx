import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectMentionables, SkillSummary } from '../../../types/api'
import { ProjectMentionMenu } from './ProjectMentionMenu'
import {
  buildProjectMentionOptions,
  filterProjectMentionOptions,
  findActiveProjectMention,
  pruneSelectedProjectMentions,
  replaceActiveProjectMention,
  selectedProjectMentionsToContext,
} from './projectMentions'

const skills: SkillSummary[] = [{
  id: 7,
  name: '舞弊风险评估',
  category: '风险与合规',
  description: '识别舞弊红旗',
  estimated_time: '2 分钟',
}]

const mentionables: ProjectMentionables = {
  files: [{ id: 11, name: '访谈纪要.docx', file_type: 'docx' }],
  stakeholders: [{ id: 12, name: '张总', role: '客户负责人' }],
  milestones: [{ id: 13, title: '提交诊断报告', due_date: '2026-09-01', is_done: false }],
}

describe('ProjectMentionMenu', () => {
  it('builds one searchable catalog across Skills and exact project objects', () => {
    const options = buildProjectMentionOptions(skills, mentionables)

    expect(options.map((option) => option.kind)).toEqual([
      'skill',
      'file',
      'stakeholder',
      'milestone',
    ])
    expect(filterProjectMentionOptions(options, '客户负责人')).toMatchObject([
      { kind: 'stakeholder', id: 12, label: '张总' },
    ])
  })

  it('keeps every object kind discoverable when many Skills precede them', () => {
    const manySkills = Array.from({ length: 15 }, (_, index) => ({
      ...skills[0],
      id: 100 + index,
      name: `专业 Skill ${index + 1}`,
    }))
    const options = buildProjectMentionOptions(manySkills, mentionables)

    const visible = filterProjectMentionOptions(options, '')
    expect(visible).toHaveLength(12)
    expect(new Set(visible.map((option) => option.kind))).toEqual(new Set([
      'skill', 'file', 'stakeholder', 'milestone',
    ]))
  })

  it('replaces only the active @ query and closes completed structured tokens', () => {
    const value = '请分析 @访谈'
    const active = findActiveProjectMention(value, value.length)
    expect(active).not.toBeNull()

    const option = buildProjectMentionOptions(skills, mentionables)[1]
    const replacement = replaceActiveProjectMention(value, active!, option)
    expect(replacement.value).toBe('请分析 @「访谈纪要.docx」')
    expect(findActiveProjectMention(replacement.value, replacement.value.length)).toBeNull()
    expect(findActiveProjectMention('请分析@张', '请分析@张'.length)?.query).toBe('张')
    expect(findActiveProjectMention('user@example', 'user@example'.length)).toBeNull()
    expect(pruneSelectedProjectMentions(replacement.value, [replacement.selected])).toHaveLength(1)
    expect(pruneSelectedProjectMentions('请分析', [replacement.selected])).toHaveLength(0)
    expect(selectedProjectMentionsToContext([replacement.selected])).toEqual({
      file_ids: [11],
      stakeholder_ids: [],
      milestone_ids: [],
    })
  })

  it('exposes the active option as a keyboard-selectable listbox item', () => {
    const options = buildProjectMentionOptions(skills, mentionables)
    const onSelect = vi.fn()
    render(
      <ProjectMentionMenu
        id="mention-menu"
        options={options}
        activeIndex={1}
        onActiveIndexChange={vi.fn()}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole('option', { name: /访谈纪要/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.mouseDown(screen.getByRole('option', { name: /访谈纪要/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file', id: 11 }))
  })
})
