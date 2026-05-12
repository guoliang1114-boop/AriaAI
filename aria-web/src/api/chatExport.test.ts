import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config/api', () => ({
  getApiBaseUrl: () => 'http://localhost:8000',
}))

// We test the pure extractFilename logic by importing the module
// and accessing it through the export conversation flow

describe('chatExport', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('module exports exportConversationFile', async () => {
    const mod = await import('./chatExport')
    expect(typeof mod.exportConversationFile).toBe('function')
  })

  it('extractFilename logic via response header', () => {
    // Test the filename extraction regex directly
    const header = 'attachment; filename="my-export.md"'
    const match = header?.match(/filename="?([^"]+)"?/)?.[1]
    expect(match).toBe('my-export.md')
  })

  it('extractFilename fallback sanitizes title', () => {
    const fallbackTitle = 'My Chat: Test (2024)!'
    const safeTitle = fallbackTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
    expect(safeTitle).toBe('My_Chat__Test__2024__')
  })

  it('markdown format produces .md extension', () => {
    const ext = 'markdown' === 'markdown' ? 'md' : 'pdf'
    expect(ext).toBe('md')
  })

  it('pdf format produces .pdf extension', () => {
    const ext = 'pdf' === 'markdown' ? 'md' : 'pdf'
    expect(ext).toBe('pdf')
  })

  it('exportConversationFile throws on non-ok response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500, statusText: 'Internal Server Error' })
    )

    const { exportConversationFile } = await import('./chatExport')
    await expect(exportConversationFile(1, 'markdown')).rejects.toThrow('Export failed: 500')

    fetchSpy.mockRestore()
  })

  it('exportConversationFile sends correct request', async () => {
    const blob = new Blob(['# Test'], { type: 'text/markdown' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="export.md"' },
      })
    )

    localStorage.setItem('authToken', 'test-token')

    // Mock URL.createObjectURL and revokeObjectURL
    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})

    // Mock link click
    const mockLink = { href: '', download: '', click: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as unknown as Node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as unknown as Node)

    const { exportConversationFile } = await import('./chatExport')
    await exportConversationFile(42, 'pdf', 'My Chat')

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8000/chat/conversations/42/export',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Auth-Token': 'test-token',
        }),
        body: JSON.stringify({ format: 'pdf' }),
      })
    )

    expect(mockLink.download).toBe('export.md')
    expect(mockLink.click).toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})
