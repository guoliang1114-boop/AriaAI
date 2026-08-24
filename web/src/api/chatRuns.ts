import { getApiBaseUrl } from '../config/api'

export interface ChatRunSteeringReceipt {
  run_id: string
  expected_run_id: string
  status: 'steering_accepted'
  conversation_id: number
  steering_id: string
  sequence: number
  message_id: number
}

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

export async function requestChatRunSteering(
  runId: string,
  content: string,
): Promise<ChatRunSteeringReceipt | null> {
  const normalizedRunId = runId.trim()
  const normalizedContent = content.trim()
  if (!normalizedRunId.startsWith('run_') || !normalizedContent) return null

  const token = localStorage.getItem('authToken') || ''
  const response = await fetch(
    `${getApiBaseUrl()}/chat/runs/${encodeURIComponent(normalizedRunId)}/steer`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': token,
      },
      body: JSON.stringify({
        expected_run_id: normalizedRunId,
        content: normalizedContent,
      }),
    },
  )
  if (!response.ok) return null
  return response.json() as Promise<ChatRunSteeringReceipt>
}
