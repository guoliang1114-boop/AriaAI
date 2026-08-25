import type { MentionContext, Message, TurnBriefInput } from '../../../types/api'

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
