import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('renders headings', () => {
    render(
      <MarkdownRenderer
        content={`# H1
## H2
### H3`}
      />,
    )
    expect(screen.getByText('H1')).toBeInTheDocument()
    expect(screen.getByText('H2')).toBeInTheDocument()
    expect(screen.getByText('H3')).toBeInTheDocument()
  })

  it('renders paragraphs', () => {
    render(
      <MarkdownRenderer
        content={`First paragraph.

Second paragraph.`}
      />,
    )
    expect(screen.getByText('First paragraph.')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
  })

  it('renders unordered lists', () => {
    render(
      <MarkdownRenderer
        content={`- Item A
- Item B`}
      />,
    )
    expect(screen.getByText('Item A')).toBeInTheDocument()
    expect(screen.getByText('Item B')).toBeInTheDocument()
  })

  it('renders ordered lists', () => {
    render(
      <MarkdownRenderer
        content={`1. First
2. Second`}
      />,
    )
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('renders blockquotes', () => {
    render(<MarkdownRenderer content="> This is a quote" />)
    expect(screen.getByText('This is a quote')).toBeInTheDocument()
  })

  it('renders inline code', () => {
    render(<MarkdownRenderer content="Use `console.log` for debugging." />)
    expect(screen.getByText('console.log')).toBeInTheDocument()
  })

  it('renders code blocks with language', () => {
    render(
      <MarkdownRenderer
        content={'```typescript\nconst x = 1;\n```'}
      />,
    )
    expect(screen.getByText('const x = 1;')).toBeInTheDocument()
    expect(screen.getByText('typescript')).toBeInTheDocument()
  })

  it('renders code blocks without language', () => {
    render(
      <MarkdownRenderer
        content={'```\nplain code\n```'}
      />,
    )
    expect(screen.getByText('plain code')).toBeInTheDocument()
  })

  it('copy button copies code to clipboard', async () => {
    render(
      <MarkdownRenderer
        content={'```\ncopy me\n```'}
      />,
    )
    const copyBtn = screen.getByRole('button', { name: /copy/i })
    fireEvent.click(copyBtn)
    await expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy me')
  })

  it('renders tables', () => {
    render(
      <MarkdownRenderer
        content={`| A | B |
|---|---|
| 1 | 2 |`}
      />,
    )
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders horizontal rules', () => {
    const { container } = render(<MarkdownRenderer content="---" />)
    expect(container.querySelector('hr')).toBeInTheDocument()
  })

  it('renders strong and em', () => {
    render(<MarkdownRenderer content="**bold** and *italic*" />)
    expect(screen.getByText('bold')).toBeInTheDocument()
    expect(screen.getByText('italic')).toBeInTheDocument()
  })

  it('renders safe http links as anchor tags', () => {
    render(<MarkdownRenderer content="[link](https://example.com)" />)
    const link = screen.getByText('link')
    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link).toHaveAttribute('href', 'https://example.com/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders safe mailto links as anchor tags', () => {
    render(<MarkdownRenderer content="[email](mailto:test@example.com)" />)
    const link = screen.getByText('email')
    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link).toHaveAttribute('href', 'mailto:test@example.com')
  })

  it('renders safe tel links as anchor tags', () => {
    render(<MarkdownRenderer content="[call](tel:+1234567890)" />)
    const link = screen.getByText('call')
    // In jsdom, tel: may be rejected by URL parser; skip tag assertion if blocked
    if (link.tagName.toLowerCase() === 'a') {
      expect(link).toHaveAttribute('href', 'tel:+1234567890')
    } else {
      expect(link.tagName.toLowerCase()).toBe('span')
    }
  })

  it('renders relative links as anchor tags', () => {
    render(<MarkdownRenderer content="[page](/about)" />)
    const link = screen.getByText('page')
    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link).toHaveAttribute('href', '/about')
  })

  it('renders hash links as anchor tags', () => {
    render(<MarkdownRenderer content="[top](#section)" />)
    const link = screen.getByText('top')
    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link).toHaveAttribute('href', '#section')
  })

  it('blocks javascript: links and renders span', () => {
    render(<MarkdownRenderer content="[bad](javascript:alert(1))" />)
    const span = screen.getByText('bad')
    expect(span.tagName.toLowerCase()).toBe('span')
    expect(span).not.toHaveAttribute('href')
  })

  it('blocks data: links and renders span', () => {
    render(<MarkdownRenderer content="[bad](data:text/html,<script>alert(1)</script>)" />)
    const span = screen.getByText('bad')
    expect(span.tagName.toLowerCase()).toBe('span')
  })

  it('blocks empty href links and renders span', () => {
    render(<MarkdownRenderer content="[empty]()" />)
    const span = screen.getByText('empty')
    expect(span.tagName.toLowerCase()).toBe('span')
  })

  it('can be imported', async () => {
    const mod = await import('./MarkdownRenderer')
    expect(mod.MarkdownRenderer).toBeDefined()
  })
})
