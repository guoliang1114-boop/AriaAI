import type { MentionContext, ProjectMentionables, SkillSummary } from '../../../types/api'

export type ProjectMentionKind = 'skill' | 'file' | 'stakeholder' | 'milestone'

export interface ProjectMentionOption {
  kind: ProjectMentionKind
  id: number
  label: string
  description: string
}

export interface SelectedProjectMention extends ProjectMentionOption {
  token: string
}

export interface ActiveProjectMention {
  start: number
  end: number
  query: string
}

export const PROJECT_MENTION_KIND_LABEL: Record<ProjectMentionKind, string> = {
  skill: 'Skill',
  file: '项目文件',
  stakeholder: '干系人',
  milestone: '里程碑',
}

export function buildProjectMentionOptions(
  skills: SkillSummary[],
  mentionables: ProjectMentionables,
): ProjectMentionOption[] {
  const options: ProjectMentionOption[] = [
    ...skills.map((skill) => ({
      kind: 'skill' as const,
      id: skill.id,
      label: skill.name,
      description: [skill.category, skill.description].filter(Boolean).join(' · '),
    })),
    ...mentionables.files.map((file) => ({
      kind: 'file' as const,
      id: file.id,
      label: file.name,
      description: `${file.file_type.toUpperCase()} 项目文件`,
    })),
    ...mentionables.stakeholders.map((stakeholder) => ({
      kind: 'stakeholder' as const,
      id: stakeholder.id,
      label: stakeholder.name,
      description: stakeholder.role || '项目干系人',
    })),
    ...mentionables.milestones.map((milestone) => ({
      kind: 'milestone' as const,
      id: milestone.id,
      label: milestone.title,
      description: [milestone.is_done ? '已完成' : '进行中', milestone.due_date]
        .filter(Boolean)
        .join(' · '),
    })),
  ]
  const seen = new Set<string>()
  return options.filter((option) => {
    const key = `${option.kind}:${option.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return Number.isSafeInteger(option.id) && option.id > 0 && option.label.trim() !== ''
  })
}

export function filterProjectMentionOptions(
  options: ProjectMentionOption[],
  query: string,
  limit = 12,
): ProjectMentionOption[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) {
    const kindOrder: ProjectMentionKind[] = ['skill', 'file', 'stakeholder', 'milestone']
    const perKindLimit = Math.max(1, Math.floor(limit / kindOrder.length))
    const balanced = kindOrder
      .flatMap((kind) => options.filter((option) => option.kind === kind).slice(0, perKindLimit))
    const selectedKeys = new Set(balanced.map((option) => `${option.kind}:${option.id}`))
    const remainder = options.filter((option) => !selectedKeys.has(`${option.kind}:${option.id}`))
    return [...balanced, ...remainder].slice(0, limit)
  }
  const ranked = options.flatMap((option, order) => {
    const label = option.label.toLocaleLowerCase()
    const haystack = `${label} ${option.description.toLocaleLowerCase()} ${PROJECT_MENTION_KIND_LABEL[option.kind].toLocaleLowerCase()}`
    if (!haystack.includes(normalized)) return []
    const score = label === normalized ? 0 : label.startsWith(normalized) ? 1 : 2
    return [{ option, order, score }]
  })
  return ranked
    .sort((left, right) => left.score - right.score || left.order - right.order)
    .slice(0, limit)
    .map(({ option }) => option)
}

/** Locate the unfinished @ query immediately before the caret.
 *
 * Selected mentions are inserted as closed ``@「label」`` tokens, so a
 * completed token cannot accidentally reopen the picker while the user keeps
 * typing. The result is positional and can therefore be replaced without
 * guessing which same-named entity the user intended.
 */
export function findActiveProjectMention(
  value: string,
  caret: number,
): ActiveProjectMention | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const beforeCaret = value.slice(0, safeCaret)
  const start = beforeCaret.lastIndexOf('@')
  if (start < 0) return null
  const boundary = start === 0 ? '' : beforeCaret[start - 1]
  if (boundary && /[A-Za-z0-9._%+-]/u.test(boundary)) return null
  const query = beforeCaret.slice(start + 1)
  if (query.length > 48 || /[\n\r@」]/u.test(query)) return null
  return { start, end: safeCaret, query }
}

export function replaceActiveProjectMention(
  value: string,
  active: ActiveProjectMention,
  option: ProjectMentionOption,
): { value: string; caret: number; selected: SelectedProjectMention } {
  const token = `@「${option.label.replace(/[「」]/gu, '')}」`
  const suffix = value.slice(active.end)
  const spacer = suffix.startsWith(' ') || suffix.startsWith('\n') || suffix === '' ? '' : ' '
  const next = `${value.slice(0, active.start)}${token}${spacer}${suffix}`
  return {
    value: next,
    caret: active.start + token.length + spacer.length,
    selected: { ...option, token },
  }
}

export function pruneSelectedProjectMentions(
  value: string,
  selected: SelectedProjectMention[],
): SelectedProjectMention[] {
  return selected.filter((mention) => value.includes(mention.token))
}

export function selectedProjectMentionsToContext(
  selected: SelectedProjectMention[],
): MentionContext | undefined {
  const uniqueIds = (kind: ProjectMentionKind) => [
    ...new Set(selected.filter((mention) => mention.kind === kind).map((mention) => mention.id)),
  ]
  const context: MentionContext = {
    file_ids: uniqueIds('file'),
    stakeholder_ids: uniqueIds('stakeholder'),
    milestone_ids: uniqueIds('milestone'),
  }
  return Object.values(context).some((ids) => ids.length > 0) ? context : undefined
}
