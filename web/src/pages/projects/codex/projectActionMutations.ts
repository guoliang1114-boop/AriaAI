import { api } from '../../../api/client'
import type { Milestone, ProjectTodo } from '../../../types/api'

export const EDITABLE_SLOT_KEYS = new Set([
  'key_risks',
  'open_questions',
  'stakeholder_notes',
])

export async function toggleMilestoneDone(
  projectId: number,
  milestone: Milestone,
): Promise<void> {
  await api.patch<Milestone>(`/projects/${projectId}/milestones/${milestone.id}`, {
    is_done: !milestone.is_done,
  })
}

export async function toggleTodoDone(
  projectId: number,
  todo: ProjectTodo,
): Promise<void> {
  await api.patch<ProjectTodo>(`/projects/${projectId}/todos/${todo.id}`, {
    is_done: !todo.is_done,
  })
}

export async function promoteTodoToWeekly(
  todo: ProjectTodo,
): Promise<{ created: boolean }> {
  return api.post<{ created: boolean }>('/weekly/from-todo', { todo_id: todo.id })
}
