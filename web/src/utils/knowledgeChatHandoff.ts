/** Content stays in Aria. Navigation carries document identities, never chunks. */
export interface KnowledgeChatDocument {
  id: number
  title: string
}

export interface KnowledgeChatHandoff {
  namespace: 'source_scoped'
  documents: KnowledgeChatDocument[]
  query?: string
}

export const MAX_KNOWLEDGE_CHAT_DOCUMENTS = 20

export function parseKnowledgeChatHandoff(value: unknown): KnowledgeChatHandoff | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.namespace !== 'source_scoped' || !Array.isArray(raw.documents)
    || !raw.documents.length || raw.documents.length > MAX_KNOWLEDGE_CHAT_DOCUMENTS) return null
  const documents: KnowledgeChatDocument[] = []
  for (const entry of raw.documents) {
    if (!entry || typeof entry !== 'object') return null
    const { id, title } = entry as Record<string, unknown>
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0
      || typeof title !== 'string' || !title.trim()) return null
    if (!documents.some(document => document.id === id)) documents.push({ id, title: title.slice(0, 240) })
  }
  if (raw.query !== undefined && typeof raw.query !== 'string') return null
  return { namespace: 'source_scoped', documents, ...(typeof raw.query === 'string' ? { query: raw.query.slice(0, 8000) } : {}) }
}
