import { describe, it, expect } from 'vitest'
import { normalizeMarkdownTables, sanitizeMarkdownHref, stripUnsafeMarkdownHtml } from './markdownSecurity'

describe('sanitizeMarkdownHref', () => {
  it('returns null for empty or null href', () => {
    expect(sanitizeMarkdownHref(null)).toBeNull()
    expect(sanitizeMarkdownHref(undefined)).toBeNull()
    expect(sanitizeMarkdownHref('')).toBeNull()
    expect(sanitizeMarkdownHref('   ')).toBeNull()
  })

  it('allows relative paths starting with /', () => {
    expect(sanitizeMarkdownHref('/about')).toBe('/about')
    expect(sanitizeMarkdownHref('/projects/123')).toBe('/projects/123')
  })

  it('allows hash links starting with #', () => {
    expect(sanitizeMarkdownHref('#section')).toBe('#section')
    expect(sanitizeMarkdownHref('#top')).toBe('#top')
  })

  it('allows http and https URLs', () => {
    expect(sanitizeMarkdownHref('https://example.com')).toBe('https://example.com/')
    expect(sanitizeMarkdownHref('http://example.com/path')).toBe('http://example.com/path')
  })

  it('allows mailto links', () => {
    expect(sanitizeMarkdownHref('mailto:test@example.com')).toBe('mailto:test@example.com')
  })

  it('allows tel links', () => {
    expect(sanitizeMarkdownHref('tel:+1234567890')).toBe('tel:+1234567890')
  })

  it('blocks javascript: protocol', () => {
    expect(sanitizeMarkdownHref('javascript:alert(1)')).toBeNull()
  })

  it('blocks data: protocol', () => {
    expect(sanitizeMarkdownHref('data:text/html,<h1>hi</h1>')).toBeNull()
  })

  it('blocks protocol-relative URLs', () => {
    expect(sanitizeMarkdownHref('//evil.example/path')).toBeNull()
  })

  it('blocks javascript protocol with control characters', () => {
    expect(sanitizeMarkdownHref('java\u0000script:alert(1)')).toBeNull()
  })

  it('resolves bare strings as relative paths against origin', () => {
    // sanitizeMarkdownHref uses `new URL(href, origin)` which resolves
    // bare strings as relative paths — this is expected browser behavior
    const result = sanitizeMarkdownHref('not a url')
    expect(result).toBeTruthy()
  })

  it('resolves relative URLs against origin', () => {
    const result = sanitizeMarkdownHref('page', 'https://example.com')
    expect(result).toBe('https://example.com/page')
  })
})

describe('stripUnsafeMarkdownHtml', () => {
  it('removes script and style blocks before markdown rendering', () => {
    expect(stripUnsafeMarkdownHtml('<script>alert(1)</script><style>body{}</style>safe')).toBe('safe')
  })
})

describe('normalizeMarkdownTables', () => {
  it('repairs a delimiter row that has more cells than the header', () => {
    const input = [
      '| 优先级 | 风险 | 紧迫度 | 可控度 | 若失控的影响 |',
      '|:---:|---|---|:---:|:---:|---|',
      '| P0 | a | b | c | d |',
    ].join('\n')
    const out = normalizeMarkdownTables(input)
    const delimiter = out.split('\n')[1]
    // header has 5 columns -> delimiter must end up with 5 cells
    expect(delimiter).toBe('| :---: | --- | --- | :---: | :---: |')
  })

  it('repairs a delimiter row that has fewer cells than the header', () => {
    const input = ['| a | b | c |', '| --- | --- |', '| 1 | 2 | 3 |'].join('\n')
    const out = normalizeMarkdownTables(input)
    expect(out.split('\n')[1]).toBe('| --- | --- | --- |')
  })

  it('preserves per-column alignment markers where present', () => {
    const input = ['| a | b | c |', '|:--|--:|', '| 1 | 2 | 3 |'].join('\n')
    const out = normalizeMarkdownTables(input)
    expect(out.split('\n')[1]).toBe('| :--- | ---: | --- |')
  })

  it('leaves a well-formed table untouched', () => {
    const input = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    expect(normalizeMarkdownTables(input)).toBe(input)
  })

  it('does not touch delimiter-looking lines inside fenced code blocks', () => {
    const input = ['```', '| a | b |', '|---|---|---|', '```'].join('\n')
    expect(normalizeMarkdownTables(input)).toBe(input)
  })

  it('does not touch delimiter-looking lines in an indented code block', () => {
    const input = ['    | a | b |', '    |---|---|---|'].join('\n')
    expect(normalizeMarkdownTables(input)).toBe(input)
  })

  it('returns content unchanged when there are no tables', () => {
    const input = '# Heading\n\nSome **bold** text and a - list item'
    expect(normalizeMarkdownTables(input)).toBe(input)
  })
})
