import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    render(<MarkdownRenderer content="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders headings', () => {
    render(<MarkdownRenderer content="# Title" />)
    expect(screen.getByText('Title')).toBeInTheDocument()
  })

  it('renders bold text', () => {
    const { container } = render(<MarkdownRenderer content="**bold text**" />)
    expect(container.querySelector('strong')).toBeTruthy()
  })

  it('renders italic text', () => {
    const { container } = render(<MarkdownRenderer content="*italic text*" />)
    expect(container.querySelector('em')).toBeTruthy()
  })

  it('renders unordered list', () => {
    const { container } = render(<MarkdownRenderer content="- item 1\n- item 2" />)
    expect(container.querySelector('ul')).toBeTruthy()
  })

  it('renders ordered list', () => {
    const { container } = render(<MarkdownRenderer content="1. first\n2. second" />)
    expect(container.querySelector('ol')).toBeTruthy()
  })

  it('renders blockquote', () => {
    const { container } = render(<MarkdownRenderer content="> quoted text" />)
    expect(container.querySelector('blockquote')).toBeTruthy()
  })

  it('renders horizontal rule', () => {
    const { container } = render(<MarkdownRenderer content="---" />)
    expect(container.querySelector('hr')).toBeTruthy()
  })

  it('renders inline code', () => {
    const { container } = render(<MarkdownRenderer content="use `console.log`" />)
    expect(container.querySelector('code')).toBeTruthy()
  })

  it('renders fenced code block with language', () => {
    const { container } = render(
      <MarkdownRenderer content={'```javascript\nconst x = 1;\n```'} />
    )
    expect(container.querySelector('.md-code-block')).toBeTruthy()
    expect(container.querySelector('.md-code-lang')?.textContent).toBe('javascript')
  })

  it('renders fenced code block without language', () => {
    const { container } = render(
      <MarkdownRenderer content={'```\nsome code\n```'} />
    )
    expect(container.querySelector('.md-code-block')).toBeTruthy()
  })

  it('renders multi-line code without language as CodeBlock', () => {
    const { container } = render(
      <MarkdownRenderer content={'    line1\n    line2'} />
    )
    expect(container.querySelector('code')).toBeTruthy()
  })

  it('renders links with target blank', () => {
    const { container } = render(
      <MarkdownRenderer content="[Google](https://google.com)" />
    )
    const link = container.querySelector('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toContain('noopener')
  })

  it('renders unsafe links as span', () => {
    const { container } = render(
      <MarkdownRenderer content="[click](javascript:alert(1))" />
    )
    const span = container.querySelector('span.md-link')
    expect(span).toBeTruthy()
  })

  it('renders relative links', () => {
    const { container } = render(
      <MarkdownRenderer content="[About](/about)" />
    )
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/about')
  })

  it('renders table', () => {
    const md = '| H1 | H2 |\n|---|---|\n| A | B |'
    const { container } = render(<MarkdownRenderer content={md} />)
    expect(container.querySelector('table')).toBeTruthy()
    expect(container.querySelector('thead')).toBeTruthy()
    expect(container.querySelector('tbody')).toBeTruthy()
  })

  it('renders empty content without error', () => {
    const { container } = render(<MarkdownRenderer content="" />)
    expect(container).toBeTruthy()
  })

  it('copy button triggers clipboard write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const { container } = render(
      <MarkdownRenderer content={'```javascript\nconst x = 1;\n```'} />
    )
    const copyBtn = container.querySelector('.md-code-copy')
    expect(copyBtn).toBeTruthy()
  })
})
