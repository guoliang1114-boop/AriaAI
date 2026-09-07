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

  it('keeps project-memory citations without retaining memory content', () => {
    const refs = normalizeKnowledgeReferences([
      {
        type: 'memory',
        id: 26,
        title: '项目记忆 v4 · Key risks',
        citation_key: 'M2',
        memory_version: 4,
        memory_slot: 'key_risks',
        content: 'must not survive',
      },
    ])

    expect(refs[0]).toMatchObject({
      type: 'memory',
      citation_key: 'M2',
      memory_version: 4,
      memory_slot: 'key_risks',
    })
    expect(JSON.stringify(refs)).not.toContain('must not survive')
    expect(knowledgeReferenceLabel(refs[0], 0)).toBe('[M2]')
  })

  it('keeps source-scoped namespace and Source identity without content', () => {
    const refs = normalizeKnowledgeReferences([
      {
        type: 'doc',
        id: 7,
        title: 'Project playbook',
        document_namespace: 'source_scoped',
        knowledge_source_id: 31,
        content: 'must not survive',
      },
    ])

    expect(refs[0]).toMatchObject({
      type: 'doc',
      id: 7,
      document_namespace: 'source_scoped',
      knowledge_source_id: 31,
    })
    expect(JSON.stringify(refs)).not.toContain('must not survive')
  })

  it('drops a Source identity unless the document namespace is source-scoped', () => {
    const refs = normalizeKnowledgeReferences([
      {
        type: 'doc',
        id: 7,
        title: 'Legacy document',
        document_namespace: 'legacy',
        knowledge_source_id: 31,
      },
    ])

    expect(refs[0].document_namespace).toBe('legacy')
    expect(refs[0].knowledge_source_id).toBeUndefined()
  })
})
