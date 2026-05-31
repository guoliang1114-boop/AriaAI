/**
 * Mock data for the codex project module. Lifted directly from the
 * design handoff so the page layouts get filled out without depending
 * on the live API yet. Live data wiring is a follow-up.
 */

export interface CxPipelineCard {
  name: string
  client: string
  owner: string
  cat: 'presale' | 'delivery'
  stage: string
  amt: number
  stale?: boolean
  updated?: string
  next?: string
  done?: number
  total?: number
  health?: 'ok' | 'watch' | 'risk'
  ms?: string
  msdate?: string
  outcome?: 'won' | 'lost'
  closed?: string
}

export const PIPELINE_PROJECTS: CxPipelineCard[] = [
  { name: '华兴生物 · AI 售前评估', client: '华兴生物', owner: '陈悦', cat: 'presale', stage: 'lead', amt: 0, stale: false, updated: '3 天前', next: '首次需求沟通' },
  { name: '顺驰物流 · 智能调度调研', client: '顺驰物流', owner: '苏明', cat: 'presale', stage: 'lead', amt: 0, stale: false, updated: '5 天前', next: '需求摸底' },
  { name: '东阿阿胶 · 新业务策略', client: '东阿阿胶', owner: '林宥', cat: 'presale', stage: 'qualify', amt: 320, stale: false, updated: '今天', next: '战略对齐会' },
  { name: '浩瀚科技 · RFP 应答', client: '浩瀚科技', owner: '苏明', cat: 'presale', stage: 'qualify', amt: 260, stale: false, updated: '今早', next: '招标文件澄清' },
  { name: '鼎和保险 · 数字化转型咨询', client: '鼎和保险', owner: '陈悦', cat: 'presale', stage: 'proposal', amt: 280, stale: false, updated: '2 小时前', next: 'Q3 W1 POC 报告' },
  { name: '瑞康医药 · 数据中台 POC', client: '瑞康医药', owner: '陈悦', cat: 'presale', stage: 'proposal', amt: 380, stale: true, updated: '2 天前', next: 'POC 指标对齐' },
  { name: '中信地产 · 智慧园区', client: '中信地产', owner: '林宥', cat: 'presale', stage: 'proposal', amt: 420, stale: true, updated: '昨天', next: '方案 V2 提交' },
  { name: '明德制造 · 智能质检', client: '明德制造', owner: '苏明', cat: 'presale', stage: 'negotiation', amt: 300, stale: false, updated: '今天', next: '商务终审 · 报价确认' },
  { name: '长虹电器 · 数据治理平台', client: '长虹电器', owner: '陈悦', cat: 'presale', stage: 'contract', amt: 520, stale: false, updated: '今天', next: '合同用印 · 法务复核' },
  { name: '金辉医疗 · 知识库迁移', client: '金辉医疗', owner: '苏明', cat: 'delivery', stage: 'live', amt: 180, stale: false, updated: '1 周前', done: 1, total: 8, health: 'ok', ms: '项目启动会', msdate: '06/14' },
  { name: '联泰集团 · 智能客服', client: '联泰集团', owner: '陈悦', cat: 'delivery', stage: 'live', amt: 240, stale: false, updated: '3 天前', done: 2, total: 10, health: 'watch', ms: '现状调研访谈', msdate: '06/20' },
  { name: '申通快运 · 中台升级', client: '申通快运', owner: '苏明', cat: 'delivery', stage: 'live', amt: 640, stale: false, updated: '今天', done: 5, total: 9, health: 'ok', ms: '灰度上线评审', msdate: '06/12' },
  { name: '合规审查优化项目', client: '正大集团', owner: '林宥', cat: 'delivery', stage: 'live', amt: 150, stale: true, updated: '4 天前', done: 4, total: 7, health: 'risk', ms: '方案评审', msdate: '逾期 2 天' },
  { name: '鼎和保险 · 续保数据闭环', client: '鼎和保险', owner: '陈悦', cat: 'delivery', stage: 'live', amt: 280, stale: false, updated: '昨天', done: 6, total: 9, health: 'ok', ms: '数据治理验收', msdate: '06/18' },
  { name: '星河零售 · 会员中台', client: '星河零售', owner: '陈悦', cat: 'delivery', stage: 'archived', amt: 360, outcome: 'won', closed: '2026-03' },
  { name: '长风物流 · 调度优化', client: '长风物流', owner: '苏明', cat: 'delivery', stage: 'archived', amt: 200, outcome: 'won', closed: '2026-02' },
  { name: '恒益银行 · 风控咨询', client: '恒益银行', owner: '林宥', cat: 'delivery', stage: 'archived', amt: 0, outcome: 'lost', closed: '2026-01' },
]

export const PIPELINE_STAGES = [
  { key: 'lead', name: '线索发现', sub: '初步接触 · 需求挖掘' },
  { key: 'qualify', name: '商机确认', sub: '需求明确 · 预算确认' },
  { key: 'proposal', name: '方案投标', sub: '方案设计 · 投标应标' },
  { key: 'negotiation', name: '商务谈判', sub: '价格商议 · 条款确定' },
  { key: 'contract', name: '合同签订', sub: '合同签署 · 正式立项' },
] as const

export interface CxProjectRecord {
  id: string
  name: string
  status: 'lead' | 'opportunity' | 'won' | 'delivering'
  statusLabel: string
  client: string
  clientShort: string
  industry: string
  region: string
  amountText: string
  owner: string
  team: { n: string; r: string }[]
  memoryVersion: number
  memoryUpdated: string
  start: string
  expectedClose: string
  oneLiner: string
}

export const DEMO_PROJECT: CxProjectRecord = {
  id: 'DH-2026-001',
  name: '鼎和保险 · 数字化转型咨询',
  status: 'opportunity',
  statusLabel: '机会期',
  client: '鼎和保险股份有限公司',
  clientShort: '鼎和保险',
  industry: '保险 · 财产险',
  region: '深圳',
  amountText: '¥280 万',
  owner: '陈悦',
  team: [
    { n: '陈悦', r: '项目经理' },
    { n: '林宥', r: '解决方案' },
    { n: '苏明', r: '数据顾问' },
  ],
  memoryVersion: 12,
  memoryUpdated: '2 小时前',
  start: '2026-04-12',
  expectedClose: '2026-08-31',
  oneLiner: '围绕续保与理赔两个高频场景搭建数据闭环,Q3 完成首批试点。',
}

export const PROJECT_TAB_ORDER = [
  { k: 'overview', label: '概览' },
  { k: 'chat', label: '项目对话' },
  { k: 'briefing', label: '会前简报' },
  { k: 'memory', label: '项目记忆' },
  { k: 'stakeholders', label: '干系人' },
  { k: 'milestones', label: '活动' },
  { k: 'finance', label: '财务' },
  { k: 'docs', label: '文档' },
] as const

export type CxProjectTabKey = (typeof PROJECT_TAB_ORDER)[number]['k']
