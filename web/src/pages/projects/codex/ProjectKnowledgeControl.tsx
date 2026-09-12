import { useId, useState } from 'react'
import { BookOpen, ChevronDown } from 'lucide-react'
import type { ConversationKnowledgeSelection } from './useConversationKnowledge'
import { ProjectKnowledgePicker } from './ProjectKnowledgePicker'

export function ProjectKnowledgeControl({ projectId, selection, disabled }: {
  projectId: number
  selection: ConversationKnowledgeSelection
  disabled: boolean
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  return (
    <div aria-label="项目对话知识范围" style={{ marginBottom: 8, fontSize: 12, color: 'var(--ink-soft)' }}>
      {selection.pending ? <p role="status">正在恢复本对话的知识范围…</p>
        : selection.error ? <div role="alert">
          知识范围恢复失败，尚未发送。<button type="button" disabled={disabled} onClick={selection.refresh}>重试恢复资料</button>
        </div> : <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <button type="button" aria-label="管理知识范围" aria-describedby={`${panelId}-summary`} aria-expanded={expanded} aria-controls={panelId}
              onClick={() => setExpanded(value => !value)} title={selection.documents.map(document => document.title).join('、')}
              className="inline-flex max-w-full items-center gap-1.5 rounded py-1 focus-visible:outline-2">
              <BookOpen size={13} aria-hidden="true" />
              <span id={`${panelId}-summary`} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                资料 · {selection.documents.length ? selection.documents[0].title : selection.unavailable ? '范围待确认' : '项目默认'}
              </span>
              {selection.documents.length > 1 && <span>等 {selection.documents.length} 份</span>}
              <ChevronDown size={12} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
            </button>
            <button type="button" aria-label="选择知识资料" disabled={disabled || selection.blocked}
              onClick={() => setPickerOpen(true)} style={{ color: 'var(--ink-mute)' }}>添加资料</button>
          </div>
          {selection.unavailable > 0 && <div role="alert" style={{ marginTop: 6 }}>
            {selection.unavailable} 份已选资料已不可用，确认范围前不会发送。
            <button type="button" disabled={disabled} onClick={selection.refresh}>重试恢复资料</button>
            <button type="button" disabled={disabled} onClick={selection.confirmRemaining}>
              {selection.documents.length ? '确认仅使用剩余资料' : '确认恢复项目默认范围'}
            </button>
          </div>}
          <div id={panelId} hidden={!expanded}>
            {expanded && <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--bg-tint)', borderRadius: 'var(--r-sm)' }}>
              {selection.documents.length > 0 ? <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selection.documents.map(document => <button key={document.id} type="button" disabled={disabled}
                    aria-label={`移除知识文档 ${document.title}`} onClick={() => selection.remove(document.id)}
                    style={{ padding: '3px 7px', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', maxWidth: '100%', overflowWrap: 'anywhere' }}>
                    {document.title} ×
                  </button>)}
                </div>
                <button type="button" disabled={disabled} onClick={selection.clear} style={{ marginTop: 6 }}>清空资料，恢复项目默认范围</button>
              </> : !selection.unavailable && <span>知识范围：项目默认（未指定文档）</span>}
              <div style={{ marginTop: 4, color: 'var(--ink-mute)', fontSize: 11 }}>移除最后一份资料后恢复项目默认范围；选择在下次发送后保存，不改变项目权限。</div>
            </div>}
          </div>
        </>}
      {pickerOpen && !disabled && !selection.blocked && <ProjectKnowledgePicker projectId={projectId} selected={selection.documents}
        onApply={documents => { selection.replace(documents); setPickerOpen(false) }} onClose={() => setPickerOpen(false)} />}
    </div>
  )
}
