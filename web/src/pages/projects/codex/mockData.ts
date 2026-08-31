/**
 * Layout constants for the codex project module.
 *
 * Started life as a mock-data file during the design-copy round
 * (R21–R22) before the pages were wired to /projects + /projects/:id
 * /detail. The mock arrays are gone now; what remains are layout
 * primitives that don't have a natural home in the backend:
 *
 *  - PIPELINE_STAGES — the five 商务阶段 column headers in the
 *    project list kanban. The backend's status enum only has three
 *    of them (lead / opportunity / won), but the design ships five
 *    columns and we leave the extras visible-but-empty so the funnel
 *    shape stays intact.
 *  - PROJECT_TAB_ORDER — the tab strip in the project detail shell.
 */

export const PIPELINE_STAGES = [
  { key: 'lead', name: '线索发现', sub: '初步接触 · 需求挖掘' },
  { key: 'qualify', name: '商机确认', sub: '需求明确 · 预算确认' },
  { key: 'proposal', name: '方案投标', sub: '方案设计 · 投标应标' },
  { key: 'negotiation', name: '商务谈判', sub: '价格商议 · 条款确定' },
  { key: 'contract', name: '合同签订', sub: '合同签署 · 正式立项' },
] as const

export const PROJECT_TAB_ORDER = [
  { k: 'overview', label: '概览' },
  { k: 'chat', label: '项目对话' },
  { k: 'briefing', label: '会前简报' },
  { k: 'memory', label: '项目记忆' },
  { k: 'questions', label: '问题' },
  { k: 'stakeholders', label: '干系人' },
  { k: 'milestones', label: '活动' },
  { k: 'finance', label: '财务' },
  { k: 'docs', label: '文档' },
] as const

export type CxProjectTabKey = (typeof PROJECT_TAB_ORDER)[number]['k']
