import type { TurnBriefInput } from '../../../types/api'

export interface ProjectTurnBriefDraft {
  goal: string
  constraintsText: string
}

export const EMPTY_PROJECT_TURN_BRIEF: ProjectTurnBriefDraft = {
  goal: '',
  constraintsText: '',
}

export function normalizeTurnBriefGoal(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 240)
}

export function normalizeTurnBriefConstraints(value: string): string[] {
  const constraints: string[] = []
  for (const item of value.split(/[\n；;]+/gu)) {
    const normalized = item.replace(/\s+/gu, ' ').trim().slice(0, 160)
    if (normalized && !constraints.includes(normalized)) constraints.push(normalized)
    if (constraints.length >= 8) break
  }
  return constraints
}

export function projectTurnBriefToInput(
  draft: ProjectTurnBriefDraft,
): TurnBriefInput | undefined {
  const goal = normalizeTurnBriefGoal(draft.goal)
  const constraints = normalizeTurnBriefConstraints(draft.constraintsText)
  return goal || constraints.length > 0 ? { goal, constraints } : undefined
}
