import { describe, expect, it } from 'vitest'
import { knowledgeReferenceLabel, normalizeKnowledgeReferences } from './knowledgeEvidence'

describe('knowledge evidence references', () => {
  it('uses the canonical citation key instead of renumbering filtered evidence', () => {
    const refs = normalizeKnowledgeReferences([
      { type: 'doc', id: 7, title: 'Project brief', citation_key: 'K3', content: 'must not survive' },
    ])

    expect(refs).toEqual([{ type: 'doc', id: 7, title: 'Project brief', citation_key: 'K3' }])
    expect(knowledgeReferenceLabel(refs[0], 0)).toBe('[K3]')
  })

  it('drops malformed references and retains the legacy numeric label', () => {
    const refs = normalizeKnowledgeReferences([
      { type: 'doc', id: 1, title: 'Valid legacy reference' },
      { type: 'doc', id: 'nope', title: 'Invalid' },
      { type: 'unknown', id: 2, title: 'Invalid type' },
    ])

    expect(refs).toHaveLength(1)
    expect(knowledgeReferenceLabel(refs[0], 0)).toBe('[1]')
  })
})
