import type { ProjectQuestionReanswerInput } from '../../../types/api'

export interface ProjectQuestionReanswerDraft {
  content: string
  input: ProjectQuestionReanswerInput
  evidenceCount: number
}

function storageKey(projectId: number): string {
  return `aria.project-question-reanswer.v1:${projectId}`
}

function isDraft(value: unknown): value is ProjectQuestionReanswerDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<ProjectQuestionReanswerDraft>
  const input = draft.input as Partial<ProjectQuestionReanswerInput> | undefined
  return (
    typeof draft.content === 'string'
    && draft.content.trim().length > 0
    && Number.isInteger(draft.evidenceCount)
    && Number(draft.evidenceCount) > 0
    && typeof input?.question === 'string'
    && /^[a-f0-9]{64}$/.test(String(input.question_sha256 || ''))
    && /^[a-f0-9]{64}$/.test(String(input.contract_sha256 || ''))
    && Array.isArray(input.attachment_ids)
    && input.attachment_ids.length > 0
    && input.attachment_ids.length <= 8
    && input.attachment_ids.every((id) => Number.isInteger(id) && id > 0)
  )
}

export function saveProjectQuestionReanswerDraft(
  projectId: number,
  draft: ProjectQuestionReanswerDraft,
): void {
  window.sessionStorage.setItem(storageKey(projectId), JSON.stringify(draft))
}

export function loadProjectQuestionReanswerDraft(
  projectId: number,
): ProjectQuestionReanswerDraft | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(projectId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (isDraft(parsed)) return parsed
  } catch {
    // Corrupt or unavailable session storage must never create a chat Turn.
  }
  window.sessionStorage.removeItem(storageKey(projectId))
  return null
}

export function clearProjectQuestionReanswerDraft(projectId: number): void {
  window.sessionStorage.removeItem(storageKey(projectId))
}
