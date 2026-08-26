import { describe, expect, it } from 'vitest'
import {
  PROJECT_TURN_BRIEF_TEMPLATES,
  applyProjectTurnBriefTemplate,
  buildProjectTurnRevisionInput,
  collectRecentProjectTurnBriefs,
  findProjectTurnRevisionSource,
  normalizeTurnBriefConstraints,
  parseProjectTurnMetadata,
  parseProjectTurnRevision,
  projectTurnFingerprint,
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

  it('applies a template while preserving the current goal and constraints', () => {
    const template = PROJECT_TURN_BRIEF_TEMPLATES.find((item) => item.id === 'read_only_analysis')!
    const applied = applyProjectTurnBriefTemplate(
      { goal: '评估方案', constraintsText: '输出为 Markdown' },
      template,
    )

    expect(applied.goal).toBe('评估方案')
    expect(normalizeTurnBriefConstraints(applied.constraintsText)).toEqual([
      '输出为 Markdown',
      '只分析，不修改项目内容',
      '区分事实、判断与建议',
    ])
  })

  it('never displaces explicit constraints when applying a template at the limit', () => {
    const template = PROJECT_TURN_BRIEF_TEMPLATES.find((item) => item.id === 'executive_answer')!
    const existing = Array.from({ length: 8 }, (_, index) => `用户约束 ${index + 1}`)

    const applied = applyProjectTurnBriefTemplate(
      { goal: '', constraintsText: existing.join('\n') },
      template,
    )

    expect(normalizeTurnBriefConstraints(applied.constraintsText)).toEqual(existing)
  })

  it('parses a historical Brief with bounded exact IDs and Skill selection', () => {
    const parsed = parseProjectTurnMetadata(JSON.stringify({
      turn_brief: { goal: '复盘风险', constraints: ['只分析', '只分析'] },
      mention_context: { file_ids: [11, 11, -1, '12'], milestone_ids: [13] },
      skill_id: 7,
    }))

    expect(parsed).toMatchObject({
      source: 'brief',
      draft: { goal: '复盘风险', constraintsText: '只分析' },
      mentionContext: { file_ids: [11], stakeholder_ids: [], milestone_ids: [13] },
      skillId: 7,
    })
  })

  it('collects recent unique user Briefs in reverse chronological order', () => {
    const recent = collectRecentProjectTurnBriefs([
      { id: 1, role: 'user', metadata_json: JSON.stringify({ turn_brief: { goal: '旧目标' } }) },
      { id: 2, role: 'assistant', metadata_json: JSON.stringify({ turn_contract: { user_goal: '忽略助手契约' } }) },
      { id: 3, role: 'user', metadata_json: JSON.stringify({ turn_brief: { goal: '最新目标', constraints: ['只分析'] } }) },
      { id: 4, role: 'user', metadata_json: JSON.stringify({ turn_brief: { goal: '最新目标', constraints: ['只分析'] } }) },
    ])

    expect(recent.map((item) => item.label)).toEqual(['最新目标', '旧目标'])
    expect(collectRecentProjectTurnBriefs([], 0)).toEqual([])
  })

  it('creates a stable source fingerprint and a precise revision diff', () => {
    const source = {
      content: '分析 @「访谈纪要.docx」',
      draft: { goal: '识别风险', constraintsText: '只分析' },
      mentionContext: { file_ids: [11] },
      skillId: 7,
      sourceMessageId: 91,
      sourceRole: 'user' as const,
      sourceFingerprint: '',
    }
    source.sourceFingerprint = projectTurnFingerprint(source)

    const revision = buildProjectTurnRevisionInput(source, {
      content: '分析 @「访谈纪要.docx」并给出建议',
      draft: { goal: '识别并排序风险', constraintsText: '只分析\n先给结论' },
      skillMode: 'off',
      mentionContext: { file_ids: [11] },
    })

    expect(source.sourceFingerprint).toMatch(/^turn-[a-f0-9]{8}$/)
    expect(revision.changed_fields).toEqual(['content', 'goal', 'constraints', 'skill'])
    expect(parseProjectTurnRevision(JSON.stringify({ turn_revision: revision }))).toEqual({
      sourceMessageId: 91,
      sourceFingerprint: source.sourceFingerprint,
      sourceRole: 'user',
      changedFields: ['content', 'goal', 'constraints', 'skill'],
    })

    const sourceMessage = {
      id: 91,
      conversation_id: 4,
      role: 'user' as const,
      content: source.content,
      metadata_json: JSON.stringify({
        turn_brief: { goal: '识别风险', constraints: ['只分析'] },
        skill_id: 7,
        mention_context: { file_ids: [11] },
      }),
      created_at: '2026-08-26T00:00:00Z',
    }
    expect(findProjectTurnRevisionSource([sourceMessage], source.sourceFingerprint)?.id).toBe(91)
    expect(findProjectTurnRevisionSource([
      sourceMessage,
      { ...sourceMessage, id: 92 },
    ], source.sourceFingerprint)).toBeUndefined()
  })
})
