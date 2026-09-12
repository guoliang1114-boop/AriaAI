import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnswerSources } from './AnswerSources'
import type { Reference } from '../types/api'

vi.mock('./KnowledgeSourceViewer', () => ({ KnowledgeSourceViewer: ({ documentId, onClose }: { documentId: number; onClose: () => void }) =>
  <div role="dialog" aria-label={`原文 ${documentId}`}><button onClick={onClose}>关闭原文</button></div> }))
const reference: Reference = { type: 'doc', id: 7, title: 'IBM 方法文档', document_namespace: 'source_scoped', knowledge_source_id: 2, citation_key: 'K1', chunk_index: 0 }

describe('AnswerSources', () => {
  it('groups a document once without losing any citation or source access', () => {
    render(<AnswerSources references={[reference, { ...reference, citation_key: 'K4', chunk_index: 8 }]} />)
    expect(screen.getByRole('button', { name: '查看回答来源' })).toHaveTextContent('来源 · 1 项 · 2 处引用')
    expect(screen.queryByText('IBM 方法文档')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看回答来源' }))
    expect(screen.getAllByText('IBM 方法文档')).toHaveLength(1)
    expect(screen.getByText('[K4] · 片段 9 · 原文')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '查看原文 [K4] IBM 方法文档' }))
    expect(screen.getByRole('dialog', { name: '原文 7' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '关闭原文' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('never merges same-title documents across IDs, namespaces or source identities', () => {
    render(<AnswerSources references={[reference, { ...reference, id: 8, citation_key: 'K2' },
      { ...reference, document_namespace: 'legacy', citation_key: 'K3' },
      { ...reference, knowledge_source_id: 3, citation_key: 'K4' }]} />)
    expect(screen.getByRole('button', { name: '查看回答来源' })).toHaveTextContent('来源 · 4 项 · 4 处引用')
    fireEvent.click(screen.getByRole('button', { name: '查看回答来源' }))
    expect(screen.queryByRole('button', { name: '查看原文 [K3] IBM 方法文档' })).not.toBeInTheDocument()
    expect(screen.getByText('[K3] · 片段 1')).toBeVisible()
  })

  it('does not show an empty sources control', () => {
    const { container } = render(<AnswerSources references={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
