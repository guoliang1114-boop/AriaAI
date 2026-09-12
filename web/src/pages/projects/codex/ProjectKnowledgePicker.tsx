import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import { CxDialog } from '../../../components/codex'
import type { KnowledgeChatDocumentPage } from '../../../types/api'
import { MAX_KNOWLEDGE_CHAT_DOCUMENTS, type KnowledgeChatDocument } from '../../../utils/knowledgeChatHandoff'

const scopes = { project: '当前项目', workspace: '共享知识', user: '我的资料' } as const
const buttonStyle = { border: '1px solid var(--color-codex-line)', padding: '5px 10px', borderRadius: 4 }

export function ProjectKnowledgePicker({ projectId, selected, onApply, onClose }: {
  projectId: number
  selected: KnowledgeChatDocument[]
  onApply: (documents: KnowledgeChatDocument[]) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(selected)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<{ scope: keyof typeof scopes; query: string; offset: number }>({ scope: 'project', query: '', offset: 0 })
  const [retry, setRetry] = useState(0)
  const key = JSON.stringify([projectId, filter, retry])
  const [result, setResult] = useState<{ key: string; data?: KnowledgeChatDocumentPage; error?: boolean } | null>(null)
  const current = result?.key === key ? result : null
  const pending = current === null
  useEffect(() => {
    let active = true
    void api.get<KnowledgeChatDocumentPage>('/knowledge/chat-documents', { params: { project_id: projectId, ...filter, limit: 20 } })
      .then(data => {
        if (!data || data.namespace !== 'source_scoped' || !Array.isArray(data.items) || data.items.length > 20
          || !Number.isSafeInteger(data.total) || data.total < 0 || data.offset !== filter.offset || data.limit !== 20
          || new Set(data.items.map(item => item?.id)).size !== data.items.length
          || data.items.some(item => !item || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.title !== 'string' || !item.title.trim()
            || typeof item.file_type !== 'string' || typeof item.source_name !== 'string')) {
          throw new Error('Invalid document selection page')
        }
        if (active) setResult({ key, data })
      }).catch(() => { if (active) setResult({ key, error: true }) })
    return () => { active = false }
  }, [projectId, filter, key])
  const toggle = (document: KnowledgeChatDocument) => setDraft(previous => {
    if (previous.some(item => item.id === document.id)) return previous.filter(item => item.id !== document.id)
    return previous.length < MAX_KNOWLEDGE_CHAT_DOCUMENTS ? [...previous, { id: document.id, title: document.title.slice(0, 240) }] : previous
  })

  return <CxDialog open onClose={onClose} title="选择知识资料" size="lg"
    description="默认只列出当前项目的已索引文档。共享知识和我的资料需明确切换；选择仅用于对话，不移动文件或改变权限。"
    footer={<>
      <button type="button" style={buttonStyle} onClick={onClose}>取消</button>
      <button type="button" style={buttonStyle} disabled={pending || current?.error} onClick={() => onApply(draft)}>
        {draft.length ? `应用选择（${draft.length} 份）` : '应用空选择，恢复项目默认范围'}
      </button>
    </>}>
    <div style={{ color: 'var(--color-codex-ink)', fontSize: 12 }}>
      <div role="group" aria-label="资料来源范围" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {Object.entries(scopes).map(([scope, label]) => <button key={scope} type="button" aria-pressed={filter.scope === scope} style={buttonStyle}
          onClick={() => setFilter({ scope: scope as keyof typeof scopes, query: filter.query, offset: 0 })}>{label}</button>)}
      </div>
      <form onSubmit={event => { event.preventDefault(); setFilter({ ...filter, query: search.trim(), offset: 0 }) }} style={{ display: 'flex', gap: 8 }}>
        <input aria-label="搜索文档标题或文件名" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} style={{ ...buttonStyle, flex: 1, minWidth: 0 }} />
        <button type="submit" style={buttonStyle}>搜索</button>
      </form>
      <p>已选 {draft.length}/{MAX_KNOWLEDGE_CHAT_DOCUMENTS} 份；跨来源/分页保留，应用后仍需明确发送。</p>
      {draft.length > 0 && <div aria-label="待应用的资料" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {draft.map(item => <button key={item.id} type="button" aria-label={`取消选择 ${item.title}`} onClick={() => toggle(item)} style={{ ...buttonStyle, overflowWrap: 'anywhere', maxWidth: '100%' }}>{item.title} ×</button>)}
      </div>}
      <div style={{ maxHeight: '35vh', overflowY: 'auto' }}>
        {pending ? <p role="status">正在加载可选资料…</p> : current?.error ? <div role="alert">资料加载失败，不会应用未核对范围。<button type="button" onClick={() => setRetry(value => value + 1)}>重试加载资料</button></div>
          : current?.data?.items.length ? current.data.items.map(item => {
            const checked = draft.some(document => document.id === item.id)
            return <label key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--color-codex-line)' }}>
              <input type="checkbox" aria-label={`选择资料 ${item.title}`} checked={checked} disabled={!checked && draft.length >= MAX_KNOWLEDGE_CHAT_DOCUMENTS} onChange={() => toggle(item)} />
              <span style={{ overflowWrap: 'anywhere' }}>{item.title}<small style={{ display: 'block', color: 'var(--color-codex-ink-mute)' }}>{item.file_type} · {item.source_name}</small></span>
            </label>
          }) : <p>此范围没有匹配的已索引资料；不会自动搜索其他范围。</p>}
      </div>
      {current?.data && <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center' }}>
        <span>共 {current.data.total} 份 · 第 {Math.floor(filter.offset / 20) + 1} 页</span>
        <button type="button" style={buttonStyle} disabled={filter.offset === 0} onClick={() => setFilter({ ...filter, offset: Math.max(0, filter.offset - 20) })}>上一页</button>
        <button type="button" style={buttonStyle} disabled={filter.offset + 20 >= current.data.total || filter.offset >= 10000} onClick={() => setFilter({ ...filter, offset: filter.offset + 20 })}>下一页</button>
      </div>}
    </div>
  </CxDialog>
}
