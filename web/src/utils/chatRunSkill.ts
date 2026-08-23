import type { RunStartedEvent, RunSkillSource } from '../types/productRunEvent'

// UI receipt for Aria's Python adaptation of Codex's per-turn Skill selection
// boundary (codex-rs/skills/src/selection.rs at 83d1fe0e67b1323f71febc2925817732b449f1d9).
// This consumes Aria Product Run Events only; it does not use a Codex runtime.

export interface ActiveRunSkill {
  id?: number
  name: string
  source?: RunSkillSource
}

function normalizeRunSkillSource(value: unknown): RunSkillSource | undefined {
  return value === 'explicit' || value === 'auto' || value === 'conversation' ? value : undefined
}

/** Normalize the backend run receipt before it enters chat UI state. */
export function normalizeRunSkill(skill: RunStartedEvent['skill'] | unknown): ActiveRunSkill | null {
  if (!skill || typeof skill !== 'object') return null
  const candidate = skill as { id?: unknown; name?: unknown; source?: unknown }
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  if (!name) return null

  const numericId = typeof candidate.id === 'number'
    ? candidate.id
    : typeof candidate.id === 'string' && candidate.id.trim()
      ? Number(candidate.id)
      : Number.NaN

  return {
    name,
    id: Number.isInteger(numericId) && numericId > 0 ? numericId : undefined,
    source: normalizeRunSkillSource(candidate.source),
  }
}

/** User-facing receipt that explains why a Skill became active this turn. */
export function describeRunSkill(skill: ActiveRunSkill): string {
  if (skill.source === 'auto') return `已自动匹配 Skill：${skill.name}`
  if (skill.source === 'conversation') return `已沿用相关 Skill：${skill.name}`
  return `已启用 Skill：${skill.name}`
}
