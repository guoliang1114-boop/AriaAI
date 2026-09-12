import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import { parseKnowledgeChatHandoff, type KnowledgeChatDocument } from '../../../utils/knowledgeChatHandoff'

interface Selection {
  documents: KnowledgeChatDocument[]
  unavailable: number
}

/** A malformed response must not silently turn an explicit scope into ambient retrieval. */
function parseSelection(value: unknown): Selection {
  if (!value || typeof value !== 'object') throw new Error('Invalid knowledge context')
  const raw = value as Record<string, unknown>
  if (raw.namespace !== 'source_scoped' || !Array.isArray(raw.documents)
    || typeof raw.unavailable_count !== 'number' || !Number.isSafeInteger(raw.unavailable_count)
    || raw.unavailable_count < 0 || raw.documents.length + raw.unavailable_count > 20) {
    throw new Error('Invalid knowledge context')
  }
  const context = parseKnowledgeChatHandoff(raw)
  if (raw.documents.length && !context) throw new Error('Invalid knowledge documents')
  return { documents: context?.documents ?? [], unavailable: raw.unavailable_count }
}

export function useConversationKnowledge(projectId: number, conversationId: number) {
  const [revision, setRevision] = useState(0)
  const key = `${projectId}:${conversationId}:${revision}`
  const [state, setState] = useState<{
    key: string
    selection?: Selection
    error?: boolean
  } | null>(null)
  const current = state?.key === key ? state : null

  useEffect(() => {
    let active = true
    void api.get<unknown>(`/chat/conversations/${conversationId}/knowledge-context`)
      .then(parseSelection)
      .then(selection => { if (active) setState({ key, selection }) })
      .catch(() => { if (active) setState({ key, error: true }) })
    return () => { active = false }
  }, [conversationId, key])

  const refresh = useCallback(() => setRevision(value => value + 1), [])
  const documents = current?.selection?.documents ?? []
  const unavailable = current?.selection?.unavailable ?? 0
  const pending = current === null
  const error = current?.error === true
  return {
    documents, unavailable, pending, error,
    blocked: pending || error || unavailable > 0,
    refresh,
    replace: (next: KnowledgeChatDocument[]) => {
      const parsed = next.length ? parseKnowledgeChatHandoff({ namespace: 'source_scoped', documents: next }) : null
      if (next.length && !parsed) return
      setState(previous => previous?.key === key && previous.selection && previous.selection.unavailable === 0
        ? { key, selection: { documents: parsed?.documents ?? [], unavailable: 0 } } : previous)
    },
    remove: (documentId: number) => setState(previous => (
      previous?.key === key && previous.selection
        ? { key, selection: { ...previous.selection, documents: previous.selection.documents.filter(document => document.id !== documentId) } }
        : previous
    )),
    confirmRemaining: () => setState(previous => (
      previous?.key === key && previous.selection
        ? { key, selection: { ...previous.selection, unavailable: 0 } }
        : previous
    )),
    clear: () => setState(previous => (
      previous?.key === key && previous.selection
        ? { key, selection: { documents: [], unavailable: 0 } }
        : previous
    )),
  }
}

export type ConversationKnowledgeSelection = ReturnType<typeof useConversationKnowledge>
