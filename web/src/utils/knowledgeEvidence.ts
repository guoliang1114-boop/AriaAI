import type { Reference } from '../types/api'

const CITATION_KEY_PATTERN = /^(?:A|K|M)[1-9][0-9]{0,2}$/

export function knowledgeReferenceLabel(reference: Reference, index: number): string {
  const citationKey = String(reference.citation_key || '').trim()
  return CITATION_KEY_PATTERN.test(citationKey) ? `[${citationKey}]` : `[${index + 1}]`
}

export function normalizeKnowledgeReferences(value: unknown): Reference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate): Reference[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as Record<string, unknown>
    const type = String(item.type || '')
    const id = Number(item.id)
    const title = String(item.title || '').trim()
    if (!['skill', 'doc', 'file', 'milestone', 'memory', 'question_evidence'].includes(type)) return []
    if (!Number.isInteger(id) || id < 0 || !title) return []
    const citationKey = String(item.citation_key || '').trim()
    const documentNamespace = item.document_namespace === 'legacy'
      || item.document_namespace === 'source_scoped'
      ? item.document_namespace
      : undefined
    return [{
      type: type as Reference['type'],
      id,
      title,
      ...(documentNamespace
        ? { document_namespace: documentNamespace }
        : {}),
      ...(documentNamespace === 'source_scoped'
        && Number.isInteger(Number(item.knowledge_source_id))
        && Number(item.knowledge_source_id) > 0
        ? { knowledge_source_id: Number(item.knowledge_source_id) }
        : {}),
      ...(CITATION_KEY_PATTERN.test(citationKey) ? { citation_key: citationKey } : {}),
      ...(typeof item.evidence_id === 'string' ? { evidence_id: item.evidence_id } : {}),
      ...(Number.isInteger(Number(item.chunk_index)) ? { chunk_index: Number(item.chunk_index) } : {}),
      ...(typeof item.score === 'number' ? { score: item.score } : {}),
      ...(typeof item.content_sha256 === 'string' ? { content_sha256: item.content_sha256 } : {}),
      ...(Number.isInteger(Number(item.memory_version)) ? { memory_version: Number(item.memory_version) } : {}),
      ...(typeof item.memory_slot === 'string' ? { memory_slot: item.memory_slot } : {}),
      ...(item.schema_version === 1 ? { schema_version: 1 as const } : {}),
    }]
  }).slice(0, 12)
}
