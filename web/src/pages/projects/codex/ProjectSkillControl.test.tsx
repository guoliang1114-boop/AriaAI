import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectSkillControl, type ProjectSkillSelection } from './ProjectSkillControl'

const skills = [
  {
    id: 7,
    name: '舞弊风险评估',
    category: '风险与合规',
    description: '识别舞弊红旗和控制缺口。',
    estimated_time: '2 分钟',
  },
]

describe('ProjectSkillControl', () => {
  it('offers auto, off, and explicit one-turn Skill choices', () => {
    const onChange = vi.fn<(selection: ProjectSkillSelection) => void>()
    const { rerender } = render(
      <ProjectSkillControl skills={skills} selection={{ mode: 'auto' }} onChange={onChange} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Skill 控制：Skill 自动匹配' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /舞弊风险评估/ }))
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'explicit',
      skillId: 7,
      name: '舞弊风险评估',
    })

    rerender(
      <ProjectSkillControl skills={skills} selection={{ mode: 'auto' }} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skill 控制：Skill 自动匹配' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /本轮不用 Skill/ }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'off' })

    rerender(
      <ProjectSkillControl skills={skills} selection={{ mode: 'off' }} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skill 控制：本轮不用 Skill' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /自动匹配/ }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'auto' })
  })
})
