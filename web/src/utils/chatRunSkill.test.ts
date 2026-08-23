import { describe, expect, it } from 'vitest'
import { describeRunSkill, normalizeRunSkill } from './chatRunSkill'

describe('chat run Skill receipt', () => {
  it('normalizes the backend Skill id and preserves activation source', () => {
    expect(normalizeRunSkill({ name: '会议纪要提取', id: '42', source: 'auto' })).toEqual({
      name: '会议纪要提取',
      id: 42,
      source: 'auto',
    })
  })

  it('rejects malformed receipts instead of showing an empty Skill', () => {
    expect(normalizeRunSkill({ id: '42' })).toBeNull()
    expect(normalizeRunSkill(null)).toBeNull()
  })

  it('explains automatic and conversation continuation activation', () => {
    expect(describeRunSkill({ name: '数字化战略', source: 'auto' })).toBe('已自动匹配 Skill：数字化战略')
    expect(describeRunSkill({ name: '会议纪要', source: 'conversation' })).toBe('已沿用相关 Skill：会议纪要')
  })
})
