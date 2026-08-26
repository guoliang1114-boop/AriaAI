import type {
  MentionContext,
  Message,
  TurnBriefInput,
  TurnRevisionField,
  TurnRevisionInput,
} from '../../../types/api'

export interface ProjectTurnBriefDraft {
  goal: string
  constraintsText: string
}

export const EMPTY_PROJECT_TURN_BRIEF: ProjectTurnBriefDraft = {
  goal: '',
  constraintsText: '',
}

export interface ProjectTurnBriefTemplate {
  id: string
  label: string
  description: string
  constraints: string[]
}

export interface ProjectTurnBriefHistoryItem {
  key: string
  label: string
  draft: ProjectTurnBriefDraft
}

export interface ProjectTurnReusePayload {
  content: string
  draft: ProjectTurnBriefDraft
  mentionContext?: MentionContext
  skillId?: number
  sourceMessageId: number
  sourceRole: 'user' | 'assistant'
  sourceFingerprint: string
}

export type ProjectTurnRevisionSource = ProjectTurnReusePayload

export interface ParsedProjectTurnRevision {
  sourceMessageId: number
  sourceFingerprint: string
  sourceRole: 'user' | 'assistant'
  changedFields: TurnRevisionField[]
}

export interface ParsedProjectTurnMetadata {
  draft: ProjectTurnBriefDraft
  source: 'brief' | 'receipt' | 'contract'
  mode?: string
  writeAllowed?: boolean
  mentionContext?: MentionContext
  skillId?: number
}

export const PROJECT_TURN_BRIEF_TEMPLATES: ProjectTurnBriefTemplate[] = [
  {
    id: 'read_only_analysis',
    label: '只读分析',
    description: '分析项目事实，但不执行或修改。',
    constraints: ['只分析，不修改项目内容', '区分事实、判断与建议'],
  },
  {
    id: 'executive_answer',
    label: '管理层结论',
    description: '先给结论，再说明依据与行动。',
    constraints: ['先给结论，再展开', '使用正式专业语气', '明确建议的优先级'],
  },
  {
    id: 'evidence_first',
    label: '证据优先',
    description: '约束无依据推断并标明信息缺口。',
    constraints: ['关键结论标明项目依据', '没有依据时明确说明信息缺口', '不要把假设写成事实'],
  },
  {
    id: 'plan_only',
    label: '仅做计划',
    description: '形成执行步骤、依赖和风险，不落地执行。',
    constraints: ['只提供执行计划，不执行或修改项目内容', '列出关键假设、依赖和风险'],
  },
]

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

export function turnBriefInputToDraft(value: unknown): ProjectTurnBriefDraft | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const goal = typeof record.goal === 'string' ? normalizeTurnBriefGoal(record.goal) : ''
  const constraints = Array.isArray(record.constraints)
    ? normalizeTurnBriefConstraints(record.constraints.filter((item): item is string => typeof item === 'string').join('\n'))
    : []
  return goal || constraints.length > 0 ? { goal, constraintsText: constraints.join('\n') } : undefined
}

export function applyProjectTurnBriefTemplate(
  draft: ProjectTurnBriefDraft,
  template: ProjectTurnBriefTemplate,
): ProjectTurnBriefDraft {
  const existing = normalizeTurnBriefConstraints(draft.constraintsText)
  // A template is a convenience layer, so it must not displace constraints the
  // user already wrote when the eight-item boundary is reached.
  const constraints = normalizeTurnBriefConstraints([...existing, ...template.constraints].join('\n'))
  return {
    goal: normalizeTurnBriefGoal(draft.goal),
    constraintsText: constraints.join('\n'),
  }
}

function parsePositiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(
    (item): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item > 0,
  ))].slice(0, 50)
}

function parseMentionContext(value: unknown): MentionContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const context: MentionContext = {
    file_ids: parsePositiveIds(record.file_ids),
    stakeholder_ids: parsePositiveIds(record.stakeholder_ids),
    milestone_ids: parsePositiveIds(record.milestone_ids),
  }
  return Object.values(context).some((ids) => ids.length > 0) ? context : undefined
}

function canonicalMentionContext(context: MentionContext | undefined): string {
  const ids = (values: number[] | undefined) => [...new Set(values || [])].sort((left, right) => left - right)
  return JSON.stringify({
    file_ids: ids(context?.file_ids),
    stakeholder_ids: ids(context?.stakeholder_ids),
    milestone_ids: ids(context?.milestone_ids),
  })
}

function normalizeTurnContent(content: string): string {
  return content.replace(/\s+/gu, ' ').trim()
}

export function projectTurnFingerprint({
  content,
  draft,
  sourceRole,
  skillId,
  mentionContext,
}: {
  content: string
  draft: ProjectTurnBriefDraft
  sourceRole: 'user' | 'assistant'
  skillId?: number
  mentionContext?: MentionContext
}): string {
  const canonical = JSON.stringify({
    role: sourceRole,
    content: normalizeTurnContent(content),
    brief: projectTurnBriefToInput(draft) || {},
    skill_id: skillId || null,
    mentions: canonicalMentionContext(mentionContext),
  })
  let hash = 0x811c9dc5
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `turn-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function findProjectTurnRevisionSource(
  messages: Pick<Message, 'id' | 'role' | 'content' | 'metadata_json'>[],
  sourceFingerprint: string,
): Pick<Message, 'id' | 'role' | 'content' | 'metadata_json'> | undefined {
  const matches = messages.filter((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return false
    const turn = parseProjectTurnMetadata(message.metadata_json)
    if (!turn) return false
    return projectTurnFingerprint({
      content: message.content,
      draft: turn.draft,
      sourceRole: message.role,
      skillId: turn.skillId,
      mentionContext: turn.mentionContext,
    }) === sourceFingerprint
  })
  return matches.length === 1 ? matches[0] : undefined
}

export function buildProjectTurnRevisionInput(
  source: ProjectTurnRevisionSource,
  current: {
    content: string
    draft: ProjectTurnBriefDraft
    skillMode: 'auto' | 'off' | 'explicit'
    skillId?: number
    mentionContext?: MentionContext
  },
): TurnRevisionInput {
  const changedFields: TurnRevisionField[] = []
  if (normalizeTurnContent(source.content) !== normalizeTurnContent(current.content)) {
    changedFields.push('content')
  }
  if (normalizeTurnBriefGoal(source.draft.goal) !== normalizeTurnBriefGoal(current.draft.goal)) {
    changedFields.push('goal')
  }
  if (JSON.stringify(normalizeTurnBriefConstraints(source.draft.constraintsText))
    !== JSON.stringify(normalizeTurnBriefConstraints(current.draft.constraintsText))) {
    changedFields.push('constraints')
  }
  const sourceSkill = source.skillId ? `explicit:${source.skillId}` : 'auto'
  const currentSkill = current.skillMode === 'explicit'
    ? `explicit:${current.skillId || 0}`
    : current.skillMode
  if (sourceSkill !== currentSkill) changedFields.push('skill')
  if (canonicalMentionContext(source.mentionContext) !== canonicalMentionContext(current.mentionContext)) {
    changedFields.push('references')
  }
  return {
    source_message_id: source.sourceMessageId,
    source_fingerprint: source.sourceFingerprint,
    source_role: source.sourceRole,
    changed_fields: changedFields,
  }
}

export function parseProjectTurnRevision(
  raw: string | Record<string, unknown> | undefined,
): ParsedProjectTurnRevision | undefined {
  if (!raw) return undefined
  try {
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined
    const revision = meta.turn_revision
    if (!revision || typeof revision !== 'object' || Array.isArray(revision)) return undefined
    const record = revision as Record<string, unknown>
    const sourceMessageId = Number(record.source_message_id)
    const sourceFingerprint = typeof record.source_fingerprint === 'string'
      ? record.source_fingerprint.trim().toLowerCase()
      : ''
    const sourceRole = record.source_role
    const allowedFields = new Set<TurnRevisionField>([
      'content', 'goal', 'constraints', 'skill', 'references',
    ])
    const changedFields = Array.isArray(record.changed_fields)
      ? record.changed_fields.filter(
        (item): item is TurnRevisionField => typeof item === 'string' && allowedFields.has(item as TurnRevisionField),
      ).filter((item, index, items) => items.indexOf(item) === index).slice(0, 5)
      : []
    if (
      !Number.isSafeInteger(sourceMessageId)
      || sourceMessageId <= 0
      || !/^turn-[a-f0-9]{3,59}$/u.test(sourceFingerprint)
      || (sourceRole !== 'user' && sourceRole !== 'assistant')
    ) return undefined
    return { sourceMessageId, sourceFingerprint, sourceRole, changedFields }
  } catch {
    return undefined
  }
}

export function parseProjectTurnMetadata(
  raw: string | Record<string, unknown> | undefined,
): ParsedProjectTurnMetadata | undefined {
  if (!raw) return undefined
  try {
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined
    const directDraft = turnBriefInputToDraft(meta.turn_brief)
    const receipt = meta.turn_receipt && typeof meta.turn_receipt === 'object'
      ? meta.turn_receipt as Record<string, unknown>
      : undefined
    const receiptDraft = receipt
      ? turnBriefInputToDraft({ goal: receipt.summary, constraints: receipt.user_constraints })
      : undefined
    const contract = meta.turn_contract && typeof meta.turn_contract === 'object'
      ? meta.turn_contract as Record<string, unknown>
      : undefined
    const contractDraft = contract
      ? turnBriefInputToDraft({ goal: contract.user_goal, constraints: contract.user_constraints })
      : undefined
    const draft = directDraft || receiptDraft || contractDraft
    if (!draft) return undefined
    const source = directDraft ? 'brief' : receiptDraft ? 'receipt' : 'contract'
    const execution = source === 'receipt' ? receipt : source === 'contract' ? contract : undefined
    const skillId = Number(meta.skill_id)
    const mentionContext = parseMentionContext(meta.mention_context)
    return {
      draft,
      source,
      ...(typeof execution?.mode === 'string' ? { mode: execution.mode.slice(0, 32) } : {}),
      ...(typeof execution?.write_allowed === 'boolean'
        ? { writeAllowed: execution.write_allowed }
        : {}),
      ...(mentionContext ? { mentionContext } : {}),
      ...(Number.isSafeInteger(skillId) && skillId > 0 ? { skillId } : {}),
    }
  } catch {
    return undefined
  }
}

export function collectRecentProjectTurnBriefs(
  messages: Pick<Message, 'id' | 'role' | 'metadata_json'>[],
  limit = 4,
): ProjectTurnBriefHistoryItem[] {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(20, Math.floor(limit)))
    : 4
  if (boundedLimit === 0) return []
  const history: ProjectTurnBriefHistoryItem[] = []
  const seen = new Set<string>()
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue
    const parsed = parseProjectTurnMetadata(message.metadata_json)
    if (!parsed || parsed.source !== 'brief') continue
    const input = projectTurnBriefToInput(parsed.draft)
    if (!input) continue
    const key = JSON.stringify(input)
    if (seen.has(key)) continue
    seen.add(key)
    history.push({
      key: `${message.id}:${key}`,
      label: input.goal || input.constraints?.[0] || '历史 Brief',
      draft: parsed.draft,
    })
    if (history.length >= boundedLimit) break
  }
  return history
}
