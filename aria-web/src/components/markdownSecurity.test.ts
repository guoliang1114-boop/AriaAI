import { describe, it, expect } from 'vitest'
import { sanitizeMarkdownHref } from './markdownSecurity'

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
