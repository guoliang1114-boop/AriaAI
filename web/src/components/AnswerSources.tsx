import { useId, useState } from 'react'
import { BookOpen, ChevronDown } from 'lucide-react'
import type { Reference } from '../types/api'
import { knowledgeReferenceLabel } from '../utils/knowledgeEvidence'
import { KnowledgeSourceViewer } from './KnowledgeSourceViewer'

/** Group presentation only; keep every citation and its original namespace. */
export function AnswerSources({ references }: { references: Reference[] }) {
  const [open, setOpen] = useState(false)
  const [documentId, setDocumentId] = useState<number | null>(null)
  const id = useId()
  const groups = new Map<string, { reference: Reference; citations: { reference: Reference; label: string }[] }>()
  references.forEach((reference, index) => {
    const key = JSON.stringify([reference.type, reference.document_namespace || '', reference.knowledge_source_id,
      reference.id, reference.id === 0 ? reference.title : undefined])
    const group = groups.get(key) || { reference, citations: [] }
    group.citations.push({ reference, label: knowledgeReferenceLabel(reference, index) })
    groups.set(key, group)
  })
  if (!references.length) return null
  return <div style={{ marginTop: 8, flexBasis: open ? '100%' : undefined, minWidth: 0, fontSize: 12, color: 'var(--color-codex-ink-soft)' }}>
    <button type="button" aria-label="查看回答来源" aria-expanded={open} aria-controls={id}
      className="inline-flex items-center gap-1.5 rounded px-1 py-1 focus-visible:outline-2 focus-visible:outline-offset-2"
      onClick={() => setOpen(value => !value)}>
      <BookOpen size={13} aria-hidden="true" />
      来源 · {groups.size} 项 · {references.length} 处引用
      <ChevronDown size={12} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
    </button>
    <div id={id} hidden={!open}>
      {open && <div role="region" aria-label="回答来源" style={{ display: 'grid', gap: 8, padding: '8px 4px' }}>
        {Array.from(groups.entries()).map(([key, group]) => <div key={key} style={{ minWidth: 0 }}>
          <div style={{ overflowWrap: 'anywhere' }}>{group.reference.title}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
            {group.citations.map(({ reference, label }, index) => {
              const description = `${label}${reference.chunk_index != null ? ` · 片段 ${reference.chunk_index + 1}` : ''}`
              return reference.type === 'doc' && reference.document_namespace === 'source_scoped' && reference.id > 0
                ? <button key={index} type="button" className="underline rounded focus-visible:outline-2"
                  aria-label={`查看原文 ${label} ${reference.title}`} onClick={() => setDocumentId(reference.id)}>
                  {description} · 原文
                </button>
                : <span key={index}>{description}</span>
            })}
          </div>
        </div>)}
      </div>}
    </div>
    {documentId !== null && <KnowledgeSourceViewer key={documentId} documentId={documentId} onClose={() => setDocumentId(null)} />}
  </div>
}
