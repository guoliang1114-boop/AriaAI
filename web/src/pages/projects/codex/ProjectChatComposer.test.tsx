import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectMentionables, SkillSummary, TurnSetupSuggestion } from '../../../types/api'
import { ProjectChatComposer } from './tabs/Chat'
import type { ProjectSkillSelection } from './ProjectSkillControl'
import { buildProjectMentionOptions, type SelectedProjectMention } from './projectMentions'
import { EMPTY_PROJECT_TURN_BRIEF, type ProjectTurnBriefDraft } from './turnBrief'

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
  const [turnBriefDraft, setTurnBriefDraft] = useState<ProjectTurnBriefDraft>(EMPTY_PROJECT_TURN_BRIEF)
  const [turnSetupSuggestion, setTurnSetupSuggestion] = useState<TurnSetupSuggestion | null>(null)
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
      turnBriefDraft={turnBriefDraft}
      onTurnBriefDraftChange={setTurnBriefDraft}
      recentTurnBriefs={[{
        key: 'recent-1',
        label: '复盘项目风险',
        draft: { goal: '复盘项目风险', constraintsText: '使用正式专业语气' },
      }]}
      turnRevision={null}
      onTurnRevisionCancel={vi.fn()}
      turnSetupSuggestion={turnSetupSuggestion}
      turnSetupLoading={false}
      onTurnSetupRequest={() => setTurnSetupSuggestion({
        template: {
          id: 'evidence_first',
          label: '证据优先',
          reason: '问题强调依据。',
        },
        skill: {
          state: 'recommended',
          reason: '问题与该 Skill 的业务场景高度匹配。',
          confidence: 0.94,
          skill_id: 7,
          skill_name: '舞弊风险评估',
          candidates: [],
        },
        catalog_fingerprint: 'catalog-1',
      })}
      onTurnSetupApply={() => {
        setTurnBriefDraft({ goal: '', constraintsText: '关键结论标明项目依据' })
        setSkillSelection({ mode: 'explicit', skillId: 7, name: '舞弊风险评估' })
        setTurnSetupSuggestion(null)
      }}
      onTurnSetupDismiss={() => setTurnSetupSuggestion(null)}
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

  it('edits and previews the next-turn goal and constraints', () => {
    render(<ComposerHarness />)

    fireEvent.click(screen.getByRole('button', { name: /^本轮 Brief：/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '本轮目标' }), {
      target: { value: '识别三项关键风险' },
    })
    fireEvent.click(screen.getByRole('button', { name: '+ 只分析，不修改项目内容' }))

    expect(screen.getByLabelText('本轮 Brief 预览')).toHaveTextContent('目标 · 识别三项关键风险')
    expect(screen.getByLabelText('本轮 Brief 预览')).toHaveTextContent('只分析，不修改项目内容')
  })

  it('applies built-in and recently used Briefs without retyping', () => {
    render(<ComposerHarness />)

    fireEvent.click(screen.getByRole('button', { name: /^本轮 Brief：/ }))
    fireEvent.click(screen.getByRole('button', { name: '应用 Brief 模板 只读分析' }))
    expect(screen.getByLabelText('本轮 Brief 预览')).toHaveTextContent('只分析，不修改项目内容')

    fireEvent.click(screen.getByRole('button', { name: '使用最近 Brief 复盘项目风险' }))
    expect(screen.getByLabelText('本轮 Brief 预览')).toHaveTextContent('目标 · 复盘项目风险')
    expect(screen.getByLabelText('本轮 Brief 预览')).toHaveTextContent('使用正式专业语气')
  })

  it('previews and explicitly applies a joint Brief and Skill suggestion', () => {
    render(<ComposerHarness />)
    const textbox = screen.getByRole('textbox')
    fireEvent.change(textbox, { target: { value: '请核验访谈中的舞弊风险', selectionStart: 12 } })

    fireEvent.click(screen.getByRole('button', { name: '获取本轮 Brief 与 Skill 配置建议' }))
    expect(screen.getByRole('dialog', { name: '本轮配置建议' })).toHaveTextContent('证据优先')
    expect(screen.getByRole('dialog', { name: '本轮配置建议' })).toHaveTextContent('舞弊风险评估')
    fireEvent.click(screen.getByRole('button', { name: '应用建议' }))

    expect(screen.getByLabelText('本轮 Brief 预览')).toHaveTextContent('关键结论标明项目依据')
    expect(screen.getByRole('button', { name: 'Skill 控制：舞弊风险评估' })).toBeInTheDocument()
  })
})
