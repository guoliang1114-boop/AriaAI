import type { ConversationKnowledgeSelection } from './useConversationKnowledge'

export function ProjectKnowledgeControl({ selection, disabled }: {
  selection: ConversationKnowledgeSelection
  disabled: boolean
}) {
  return (
    <div aria-label="项目对话知识范围" style={{ marginBottom: 8, fontSize: 12, color: 'var(--ink-soft)' }}>
      {selection.pending ? <p role="status">正在恢复本对话的知识范围…</p>
        : selection.error ? <div role="alert">
          知识范围恢复失败，尚未发送。<button type="button" disabled={disabled} onClick={selection.refresh}>重试恢复资料</button>
        </div> : <>
          {selection.documents.length > 0 ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span>仅检索已选知识文档：</span>
            {selection.documents.map(document => <button
              key={document.id} type="button" disabled={disabled}
              aria-label={`移除知识文档 ${document.title}`}
              onClick={() => selection.remove(document.id)}
              style={{ padding: '3px 7px', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', maxWidth: '100%', overflowWrap: 'anywhere' }}
            >{document.title} ×</button>)}
            <button type="button" disabled={disabled} onClick={selection.clear}>清空资料，恢复项目默认范围</button>
          </div> : !selection.unavailable && <span>知识范围：项目默认（未指定文档）</span>}
          {selection.unavailable > 0 && <div role="alert" style={{ marginTop: 6 }}>
            {selection.unavailable} 份已选资料已不可用，确认范围前不会发送。
            <button type="button" disabled={disabled} onClick={selection.refresh}>重试恢复资料</button>
            <button type="button" disabled={disabled} onClick={selection.confirmRemaining}>
              {selection.documents.length ? '确认仅使用剩余资料' : '确认恢复项目默认范围'}
            </button>
          </div>}
          <div style={{ marginTop: 4, color: 'var(--ink-mute)', fontSize: 11 }}>移除最后一份资料后恢复项目默认范围；选择在下次发送后保存，不改变项目权限。</div>
        </>}
    </div>
  )
}
