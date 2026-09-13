import { useId, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import type { ContextReceiptEvent, TurnReceiptEvent } from '../types/productRunEvent'
import { contextHistoryEvidenceLabel, contextMemoryLayerLabel } from '../utils/contextReceipt'
import { AnswerContextNotice } from './AnswerContextNotice'
import { ChatIconButton } from './ChatIconButton'
import styles from './LiveTurnDetails.module.css'

const modes = { answer_only: '直接回答', plan_only: '只做规划', execute_now: '执行任务', plan_then_execute: '规划后执行' }
const scopes = { chat: '当前对话', project: '当前项目', workspace: '工作区' }

/** One shared live header. Receipts are optional metadata, not business authorization. */
export function LiveTurnDetails({ status, receipt, contextReceipt, children }: {
  status: string
  receipt?: TurnReceiptEvent | null
  contextReceipt?: ContextReceiptEvent | null
  children?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const hasDetails = Boolean(receipt || contextReceipt || children)
  return <div className={styles.root}>
    <div className={styles.header}>
      <span className={styles.name}>Aria</span>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.status} role="status">{status}</span>
      {hasDetails && <ChatIconButton label="本轮详情"
        aria-expanded={expanded} aria-controls={`${id}-details`}
        onClick={() => setExpanded(value => !value)}>
        <Info aria-hidden="true" />
      </ChatIconButton>}
    </div>
    {receipt?.requires_confirmation && <p className={styles.attention} role="status">
      涉及高风险操作时会先请你确认，尚未获得确认的操作不会执行。
    </p>}
    <AnswerContextNotice receipt={contextReceipt || null} />
    <div id={`${id}-details`} hidden={!expanded}>
      {expanded && <section className={styles.panel} aria-label="本轮详情">
        {receipt && <>
          <h3>任务理解</h3>
          <p>{receipt.summary}</p>
          <p className={styles.muted}>{modes[receipt.mode]} · {scopes[receipt.target_scope]} · {receipt.write_allowed
            ? '涉及内容变更，按权限和确认流程执行' : '不会修改项目内容'}</p>
          {receipt.user_constraints.length > 0 && <p>{receipt.user_constraints.join(' · ')}</p>}
          {receipt.steering_supported && <p className={styles.muted}>可在输入框追加本轮要求</p>}
        </>}
        {contextReceipt && <ContextDetails receipt={contextReceipt} />}
        {children && <div className={styles.process}><h3>执行过程</h3>{children}</div>}
      </section>}
    </div>
  </div>
}

function ContextDetails({ receipt }: { receipt: ContextReceiptEvent }) {
  const { memory, skill, evidence } = receipt
  const layers = memory.layers || []
  const scopeNames = { user: '个人偏好', client: '客户记忆', project: '项目记忆' }
  const used = layers.filter(layer => layer.selected_item_count > 0).map(layer => scopeNames[layer.scope])
  if (!used.includes('项目记忆') && memory.selected_item_count > 0) used.push('项目记忆')
  if (!used.includes('个人偏好') && evidence.user_preferences) used.push('个人偏好')
  if (memory.raw_context_available && ['missing', 'stale'].includes(memory.status)) used.push('当前项目原始信息')
  if (evidence.workspace_context) used.push('工作区信息')
  if (evidence.attached_file_count > 0) used.push(`${evidence.attached_file_count} 个指定文件`)
  if (evidence.knowledge_reference_count > 0) used.push(`${evidence.knowledge_reference_count} 处知识引用`)
  if (evidence.history_message_count > 0) used.push('历史对话')
  return <div className={styles.context}>
    <h3>使用依据</h3>
    <p>{used.length ? used.join(' · ') : '未额外调用记忆或资料'}</p>
    <p className={styles.muted}>{skill.status === 'applied'
      ? `已启用技能：${skill.name || '未命名技能'}`
      : skill.status === 'ambiguous' ? '技能待选择' : '未额外启用技能'}</p>
    {skill.status === 'ambiguous' && Boolean(skill.candidates?.length) && <p>候选技能：{skill.candidates?.map(candidate => candidate.name).join('、')}</p>}
    <details className={styles.diagnostics}>
      <summary>诊断信息</summary>
      <div>
        <p>项目记忆 v{memory.version} · 召回 {memory.selected_item_count} 条记忆 / {memory.selected_slot_count} 个槽位</p>
        {layers.map(layer => <p key={layer.scope}>{contextMemoryLayerLabel(layer)}</p>)}
        <p>{contextHistoryEvidenceLabel(evidence)}</p>
        {receipt.world_state && <p>项目状态版本 · {receipt.world_state.current_version} · {receipt.world_state.changed
          ? '检测到变化，已使用当前状态' : receipt.world_state.baseline ? '已建立本对话基线' : '与上一轮一致'}</p>}
        {skill.runtime && <p>技能版本 {skill.runtime.version} · 加载状态 {skill.runtime.load_status}</p>}
      </div>
    </details>
  </div>
}
