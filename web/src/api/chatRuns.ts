import { getApiBaseUrl } from '../config/api'

export async function requestChatRunCancellation(runId: string): Promise<boolean> {
  const normalizedRunId = runId.trim()
  if (!normalizedRunId.startsWith('run_')) return false

  const token = localStorage.getItem('authToken') || ''
  const response = await fetch(
    `${getApiBaseUrl()}/chat/runs/${encodeURIComponent(normalizedRunId)}/cancel`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': token,
      },
    },
  )
  return response.ok
}
