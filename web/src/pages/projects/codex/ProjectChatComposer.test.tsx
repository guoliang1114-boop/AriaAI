import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectMentionables, SkillSummary } from '../../../types/api'
import { ProjectChatComposer } from './tabs/Chat'
import type { ProjectSkillSelection } from './ProjectSkillControl'
import { buildProjectMentionOptions, type SelectedProjectMention } from './projectMentions'

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
  milestones: [{ id: 13, title: '提交诊断报告', due_date: null, is_done: false }],
}

function ComposerHarness() {
  const [value, setValue] = useState('')
  const [skillSelection, setSkillSelection] = useState<ProjectSkillSelection>({ mode: 'auto' })
  const [selectedMentions, setSelectedMentions] = useState<SelectedProjectMention[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  return (
    <ProjectChatComposer
      value={value}
      onChange={setValue}
      onSend={vi.fn()}
      onSteer={vi.fn()}
      onStop={vi.fn()}
      busy={false}
      canSteer={false}
      skills={skills}
      skillSelection={skillSelection}
      onSkillSelectionChange={setSkillSelection}
      mentionOptions={buildProjectMentionOptions(skills, mentionables)}
      selectedMentions={selectedMentions}
      onSelectedMentionsChange={setSelectedMentions}
      textareaRef={textareaRef}
    />
  )
}

describe('ProjectChatComposer', () => {
  it('selects exact project objects with Arrow keys and Enter', () => {
    render(<ComposerHarness />)
    const textbox = screen.getByRole('textbox')

    fireEvent.change(textbox, { target: { value: '分析 @', selectionStart: 4 } })
    expect(screen.getByRole('listbox', { name: '选择 Skill 或项目对象' })).toBeInTheDocument()

    fireEvent.keyDown(textbox, { key: 'ArrowDown' })
    fireEvent.keyDown(textbox, { key: 'Enter' })

    expect(textbox).toHaveValue('分析 @「访谈纪要.docx」')
    expect(screen.getByRole('button', { name: '移除项目文件引用 访谈纪要.docx' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
