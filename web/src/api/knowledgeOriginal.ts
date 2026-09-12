import { getApiBaseUrl } from '../config/api'

export async function downloadKnowledgeOriginal(documentId: number, filename: string) {
  if (!Number.isSafeInteger(documentId) || documentId <= 0) throw new Error('Invalid document identity')
  const response = await fetch(`${getApiBaseUrl()}/knowledge/documents/${documentId}/original`, {
    headers: { 'X-Auth-Token': localStorage.getItem('authToken') || '' },
  })
  if (!response.ok) throw new Error(`原文下载失败（${response.status}），请检查权限或稍后重试。`)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = Array.from(filename).map(character => character.charCodeAt(0) < 32 || '/\\'.includes(character) ? '_' : character).join('') || 'knowledge-document'
  document.body.appendChild(link)
  try { link.click() } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
