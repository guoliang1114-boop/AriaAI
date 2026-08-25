import { describe, expect, it } from 'vitest'
import {
  normalizeTurnBriefConstraints,
  projectTurnBriefToInput,
} from './turnBrief'

describe('project turn brief', () => {
  it('normalizes, deduplicates, and bounds explicit constraints', () => {
    const constraints = normalizeTurnBriefConstraints(
      [
        '只分析',
        ' 只分析 ',
        '输出为   Markdown',
        ...Array.from({ length: 10 }, (_, index) => `约束${index}`),
      ].join('\n'),
    )

    expect(constraints).toHaveLength(8)
    expect(constraints.slice(0, 3)).toEqual(['只分析', '输出为 Markdown', '约束0'])
  })

  it('omits an empty brief and compacts an explicit goal', () => {
    expect(projectTurnBriefToInput({ goal: '', constraintsText: '' })).toBeUndefined()
    expect(projectTurnBriefToInput({ goal: '  识别   风险 ', constraintsText: '只分析；输出为 Markdown' })).toEqual({
      goal: '识别 风险',
      constraints: ['只分析', '输出为 Markdown'],
    })
  })
})
