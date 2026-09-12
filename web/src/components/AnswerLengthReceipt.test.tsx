import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnswerLengthReceipt } from './AnswerLengthReceipt'

const receipt = { max_chars: 180, actual_chars: 160, repair_count: 1, status: 'passed', unit: 'non_whitespace_unicode_codepoints' }
describe('AnswerLengthReceipt', () => {
  it('shows only the saved body count and repair status', () => {
    render(<AnswerLengthReceipt metadataJson={JSON.stringify({ answer_length: receipt })} />)
    expect(screen.getByText('字数已核验 · 160/180 · 已修正一次')).toBeInTheDocument()
  })
  it('does not certify an inconsistent passed receipt', () => {
    render(<AnswerLengthReceipt metadataJson={JSON.stringify({ answer_length: { ...receipt, actual_chars: 181 } })} />)
    expect(screen.getByText('字数校验未通过 · 181/180 · 已修正一次')).toBeInTheDocument()
  })
  it.each(['{}', 'invalid', JSON.stringify({ answer_length: { ...receipt, actual_chars: '160' } }), JSON.stringify({ answer_length: { ...receipt, unit: 'words' } })])('ignores legacy or malformed metadata %s', metadata => {
    const { container } = render(<AnswerLengthReceipt metadataJson={metadata} />)
    expect(container).toBeEmptyDOMElement()
  })
})
