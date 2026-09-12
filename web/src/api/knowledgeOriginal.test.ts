import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadKnowledgeOriginal } from './knowledgeOriginal'

describe('knowledge original download', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
  it('uses native auth headers and source-scoped document identity', async () => {
    localStorage.setItem('authToken', 'test-token')
    const fetch = vi.fn().mockResolvedValue(new Response('file bytes'))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await downloadKnowledgeOriginal(7, '市场洞察.pptx')
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/knowledge\/documents\/7\/original$/), { headers: { 'X-Auth-Token': 'test-token' } })
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download]')).toBeNull()
  })
  it.each([403, 404, 409, 500])('does not download an error response (%s)', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status })))
    const blob = vi.spyOn(URL, 'createObjectURL')
    await expect(downloadKnowledgeOriginal(7, 'file')).rejects.toThrow(String(status))
    expect(blob).not.toHaveBeenCalled()
  })
  it.each([0, -1, 1.5, Number.NaN])('rejects invalid document ID (%s)', async id => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(downloadKnowledgeOriginal(id, 'file')).rejects.toThrow('Invalid')
    expect(fetch).not.toHaveBeenCalled()
  })
})
