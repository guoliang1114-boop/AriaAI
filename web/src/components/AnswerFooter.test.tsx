import { fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AnswerFooter } from './AnswerFooter'
import type { Reference } from '../types/api'
import styles from './AnswerFooter.module.css'

vi.mock('./KnowledgeSourceViewer', () => ({ KnowledgeSourceViewer: ({ documentId, onClose }: { documentId: number; onClose: () => void }) =>
  <div role="dialog" aria-label={`原文 ${documentId}`}><button onClick={onClose}>关闭原文</button></div> }))
const reference: Reference = { type: 'doc', id: 7, title: 'IBM 方法文档', document_namespace: 'source_scoped', knowledge_source_id: 2, citation_key: 'K1', chunk_index: 0 }

describe('AnswerFooter', () => {
  it('contains the hidden source description within the toolbar positioning context', () => {
    // jsdom cannot measure scroll overflow. Check the CSS/DOM contract here;
    // real-browser QA also checks document height while scrolling messages.
    const stylesheet = document.createElement('style')
    const footerCss = readFileSync(`${import.meta.dirname}/AnswerFooter.module.css`, 'utf8')
    stylesheet.textContent = footerCss.replaceAll('.actions', `.${styles.actions}`)
    document.head.append(stylesheet)
    try {
      render(<AnswerFooter references={[reference]}>阶段耗时</AnswerFooter>)
      const group = screen.getByRole('group', { name: '回答辅助信息' })
      const source = within(group).getByRole('button', { name: '查看回答来源' })
      const description = document.getElementById(source.getAttribute('aria-describedby')!)
      expect(description).toHaveClass('sr-only')
      expect(group).toContainElement(description)
      expect(getComputedStyle(group).position).toBe('relative')
      expect(source).toHaveAccessibleDescription('1 项来源，1 处引用')
    } finally {
      stylesheet.remove()
    }
  })

  it('keeps the compact labels stable and counts out of the visible toolbar', () => {
    render(<AnswerFooter references={[reference, { ...reference, citation_key: 'K4' }]}>阶段耗时</AnswerFooter>)
    const sources = screen.getByRole('button', { name: '查看回答来源' })
    expect(sources).toHaveTextContent(/^来源1$/)
    expect(sources).toHaveAccessibleDescription('1 项来源，2 处引用')
    expect(sources).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: '查看回答详情' })).toHaveTextContent(/^详情$/)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByText('阶段耗时')).not.toBeInTheDocument()
    fireEvent.click(sources)
    expect(sources).toHaveTextContent(/^来源1$/)
    expect(screen.getByRole('region', { name: '回答来源' })).toHaveTextContent('1 项来源 · 2 处引用')
  })

  it('switches one panel at a time while both controls stay in the same group', async () => {
    const user = userEvent.setup()
    render(<AnswerFooter references={[reference]}>阶段耗时</AnswerFooter>)
    const group = screen.getByRole('group', { name: '回答辅助信息' })
    const sources = within(group).getByRole('button', { name: '查看回答来源' })
    const details = within(group).getByRole('button', { name: '查看回答详情' })
    await user.click(sources)
    expect(screen.getByRole('region', { name: '回答来源' })).toBeVisible()
    await user.click(details)
    expect(screen.queryByRole('region', { name: '回答来源' })).not.toBeInTheDocument()
    expect(sources).toHaveAttribute('aria-expanded', 'false')
    expect(details).toHaveAttribute('aria-expanded', 'true')
    expect(details).toHaveTextContent(/^详情$/)
    expect(screen.getByRole('region', { name: '回答详情' })).toBeVisible()
    expect(within(group).getAllByRole('button')).toEqual([sources, details])
    await user.click(details)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(details).toHaveFocus()
  })

  it('keeps keyboard order on the two controls before the expanded content', async () => {
    const user = userEvent.setup()
    render(<AnswerFooter references={[reference]}><button>查看诊断</button></AnswerFooter>)
    const sources = screen.getByRole('button', { name: '查看回答来源' })
    const details = screen.getByRole('button', { name: '查看回答详情' })
    await user.tab()
    expect(sources).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.tab()
    expect(details).toHaveFocus()
    await user.keyboard(' ')
    await user.tab()
    expect(screen.getByRole('button', { name: '查看诊断' })).toHaveFocus()
    await user.tab({ shift: true })
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('button', { name: '查看诊断' })).not.toBeInTheDocument()
    expect(details).toHaveFocus()
  })

  it('keeps adjacent messages independent with unique controls', async () => {
    const user = userEvent.setup()
    render(<><AnswerFooter references={[reference]}>第一轮</AnswerFooter><AnswerFooter references={[reference]}>第二轮</AnswerFooter></>)
    const buttons = screen.getAllByRole('button', { name: /查看回答/ })
    expect(new Set(buttons.map(button => button.getAttribute('aria-controls'))).size).toBe(4)
    await user.click(screen.getAllByRole('button', { name: '查看回答详情' })[0])
    expect(screen.getByText('第一轮')).toBeVisible()
    expect(screen.queryByText('第二轮')).not.toBeInTheDocument()
  })

  it('groups a document once without losing citation keys, fragments or source access', () => {
    render(<AnswerFooter references={[reference, { ...reference, citation_key: 'K4', chunk_index: 8 }]} />)
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
    render(<AnswerFooter references={[reference, { ...reference, id: 8, citation_key: 'K2' },
      { ...reference, document_namespace: 'legacy', citation_key: 'K3' },
      { ...reference, knowledge_source_id: 3, citation_key: 'K4' }]} />)
    expect(screen.getByRole('button', { name: '查看回答来源' })).toHaveTextContent(/^来源4$/)
    fireEvent.click(screen.getByRole('button', { name: '查看回答来源' }))
    expect(screen.queryByRole('button', { name: '查看原文 [K3] IBM 方法文档' })).not.toBeInTheDocument()
    expect(screen.getByText('[K3] · 片段 1')).toBeVisible()
  })

  it('does not show unavailable controls or an empty footer', () => {
    const { container, rerender } = render(<AnswerFooter references={[]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<AnswerFooter references={[]}>仅详情</AnswerFooter>)
    expect(screen.queryByRole('button', { name: '查看回答来源' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看回答详情' })).toBeVisible()
    rerender(<AnswerFooter references={[reference]} />)
    expect(screen.queryByRole('button', { name: '查看回答详情' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看回答来源' })).toBeVisible()
  })
})
