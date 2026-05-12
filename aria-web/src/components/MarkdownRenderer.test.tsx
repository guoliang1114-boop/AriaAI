import { describe, it, expect } from 'vitest'

describe('sanitizeMarkdownHref (via MarkdownRenderer)', () => {
  it('MarkdownRenderer can be imported', async () => {
    const mod = await import('./MarkdownRenderer')
    expect(mod.MarkdownRenderer).toBeDefined()
  })
})
