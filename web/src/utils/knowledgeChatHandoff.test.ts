import { describe, expect, it } from 'vitest'
import { parseKnowledgeChatHandoff } from './knowledgeChatHandoff'

describe('knowledge chat handoff boundary', () => {
  const valid = { namespace: 'source_scoped', documents: [{ id: 1, title: '文档' }], query: '权限如何审批？' }
  it('accepts and deduplicates only source-scoped identities', () => {
    expect(parseKnowledgeChatHandoff({ ...valid, documents: [...valid.documents, ...valid.documents] })).toEqual(valid)
  })
  it.each([null, {}, { ...valid, namespace: 'legacy' }, { ...valid, documents: [] },
    { ...valid, documents: Array(21).fill(valid.documents[0]) }, { ...valid, query: {} },
    ...[true, '1', 0, -1, 1.5, Number.NaN].map(id => ({ ...valid, documents: [{ id, title: '文档' }] })),
  ])('rejects malformed or ambiguous selections: %j', value => {
    expect(parseKnowledgeChatHandoff(value)).toBeNull()
  })
})
