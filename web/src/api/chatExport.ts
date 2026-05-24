import { getApiBaseUrl } from '../config/api'

export type ChatExportFormat = 'markdown' | 'pdf'

function extractFilename(contentDisposition: string | null, fallbackTitle: string, format: ChatExportFormat) {
  const headerFilename = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1]
  if (headerFilename) return headerFilename

  const safeTitle = fallbackTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
  return `${safeTitle}.${format === 'markdown' ? 'md' : 'pdf'}`
}

export async function exportConversationFile(
  conversationId: number,
  format: ChatExportFormat,
  conversationTitle = 'conversation',
) {
  const token = localStorage.getItem('authToken')
  const response = await fetch(`${getApiBaseUrl()}/chat/conversations/${conversationId}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': token || '',
    },
    body: JSON.stringify({ format }),
  })

  if (!response.ok) {
    throw new Error(`Export failed: ${response.status}`)
  }

  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = extractFilename(
    response.headers.get('content-disposition'),
    conversationTitle,
    format,
  )

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}
