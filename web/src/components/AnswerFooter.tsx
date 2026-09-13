import { useId, useState, type ReactNode } from 'react'
import { BookOpen, Info } from 'lucide-react'
import type { Reference } from '../types/api'
import { knowledgeReferenceLabel } from '../utils/knowledgeEvidence'
import { KnowledgeSourceViewer } from './KnowledgeSourceViewer'
import { ChatIconButton } from './ChatIconButton'
import { MessageCopyButton } from './MessageCopyButton'
import styles from './AnswerFooter.module.css'

/** Optional answer metadata only. Errors, approvals and live status stay outside. */
export function AnswerFooter({ references, children, copyText, actions }: {
  references: Reference[]; children?: ReactNode; copyText?: string; actions?: ReactNode
}) {
  const [panel, setPanel] = useState<'sources' | 'details' | null>(null)
  const [documentId, setDocumentId] = useState<number | null>(null)
  const id = useId()
  // Group presentation only; preserve every citation and its original namespace.
  const groups = new Map<string, { reference: Reference; citations: { reference: Reference; label: string }[] }>()
  references.forEach((reference, index) => {
    const key = JSON.stringify([reference.type, reference.document_namespace || '', reference.knowledge_source_id,
      reference.id, reference.id === 0 ? reference.title : undefined])
    const group = groups.get(key) || { reference, citations: [] }
    group.citations.push({ reference, label: knowledgeReferenceLabel(reference, index) })
    groups.set(key, group)
  })
  if (!references.length && !children && copyText === undefined && !actions) return null
  const toggle = (next: 'sources' | 'details') => {
    setPanel(current => current === next ? null : next)
    setDocumentId(null)
  }
  return <div className={styles.footer}>
    <div className={styles.actions} role="group" aria-label="回答操作">
      {copyText !== undefined && <MessageCopyButton key={copyText} text={copyText} />}
      {references.length > 0 && <>
        <ChatIconButton label="查看回答来源" aria-expanded={panel === 'sources'}
          aria-controls={`${id}-sources`} aria-describedby={`${id}-source-count`}
          onClick={() => toggle('sources')}>
          <BookOpen size={14} aria-hidden="true" />
        </ChatIconButton>
        <span id={`${id}-source-count`} className="sr-only">{groups.size} 项来源，{references.length} 处引用</span>
      </>}
      {!!children && <ChatIconButton label="查看回答详情" aria-expanded={panel === 'details'}
        aria-controls={`${id}-details`} onClick={() => toggle('details')}>
        <Info size={14} aria-hidden="true" />
      </ChatIconButton>}
      {actions}
    </div>
    {references.length > 0 && <div id={`${id}-sources`} hidden={panel !== 'sources'}>
      {panel === 'sources' && <div role="region" aria-label="回答来源" className={styles.panel}>
        <p className={styles.summary}>{groups.size} 项来源 · {references.length} 处引用</p>
        {Array.from(groups.entries()).map(([key, group]) => <div key={key} className={styles.source}>
          <div className={styles.sourceTitle}>{group.reference.title}</div>
          <div className={styles.citations}>
            {group.citations.map(({ reference, label }, index) => {
              const description = `${label}${reference.chunk_index != null ? ` · 片段 ${reference.chunk_index + 1}` : ''}`
              return reference.type === 'doc' && reference.document_namespace === 'source_scoped' && reference.id > 0
                ? <button key={index} type="button" className={styles.citation}
                  aria-label={`查看原文 ${label} ${reference.title}`} onClick={() => setDocumentId(reference.id)}>
                  {description} · 原文
                </button>
                : <span key={index} className={styles.citationText}>{description}</span>
            })}
          </div>
        </div>)}
      </div>}
    </div>}
    {!!children && <div id={`${id}-details`} hidden={panel !== 'details'}>
      {panel === 'details' && <div role="region" aria-label="回答详情" className={styles.panel}>{children}</div>}
    </div>}
    {documentId !== null && <KnowledgeSourceViewer key={documentId} documentId={documentId} onClose={() => setDocumentId(null)} />}
  </div>
}
