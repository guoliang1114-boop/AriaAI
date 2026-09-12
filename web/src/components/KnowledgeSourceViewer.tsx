import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { downloadKnowledgeOriginal } from '../api/knowledgeOriginal'

interface SourcePage {
  namespace: 'source_scoped'
  document_id: number
  title: string
  file_name: string
  total: number
  offset: number
  limit: number
  chunks: { chunk_index: number; content: string; truncated: boolean }[]
}

/** Plain-text extraction only: no remote HTML, inline scripts or Office renderer. */
export function KnowledgeSourceViewer({ documentId, onClose }: { documentId: number; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<{ key: string; page: SourcePage | null; error?: string } | null>(null)
  const [downloadError, setDownloadError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [retry, setRetry] = useState(0)
  const requestKey = `${documentId}/${offset}/${retry}`
  const loading = result?.key !== requestKey
  const page = !loading ? result?.page : null
  const error = downloadError || (!loading ? result?.error : '')
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => { dialog?.close() }
  }, [])
  useEffect(() => {
    let cancelled = false
    void api.get<SourcePage>(`/knowledge/documents/${documentId}/content?offset=${offset}&limit=3`).then(value => {
      if (!cancelled) setResult({ key: requestKey, page: value })
    }).catch(() => {
      if (!cancelled) setResult({ key: requestKey, page: null, error: '原文文本暂不可用，可能尚未索引或访问权限已变化。' })
    })
    return () => { cancelled = true }
  }, [documentId, offset, requestKey])
  const download = async () => {
    setDownloading(true)
    setDownloadError('')
    try { await downloadKnowledgeOriginal(documentId, page?.file_name || 'knowledge-document') }
    catch (err) { setDownloadError(err instanceof Error ? err.message : '下载失败，请重试。') }
    finally { setDownloading(false) }
  }
  return (
    <dialog ref={dialogRef} aria-label="知识原文" onCancel={event => { event.preventDefault(); onClose() }}
      className="m-auto w-[min(900px,95vw)] rounded-lg border p-0 backdrop:bg-black/40"
      style={{ background: 'var(--color-codex-bg-elev)', color: 'var(--color-codex-ink)' }}>
      <div className="flex items-center justify-between gap-4 border-b p-4">
        <h2 className="truncate font-semibold">{page?.title || '知识原文'}</h2>
        <button type="button" onClick={onClose} aria-label="关闭原文">关闭</button>
      </div>
      <div className="max-h-[65vh] overflow-y-auto p-4">
        <p className="mb-3 text-xs">以下为索引提取文本，不是文件排版预览；最新内容可能与历史引用不同。完整内容与格式请下载原文件核对。</p>
        {error && <p role="alert">{error} <button type="button" className="underline" onClick={() => { setDownloadError(''); setRetry(value => value + 1) }}>重新加载</button></p>}
        {loading ? <p role="status">正在读取原文…</p> : page?.chunks.map(chunk => (
          <section key={chunk.chunk_index} className="mb-5 border-b pb-4">
            <h3 className="mb-2 text-xs">分块 {chunk.chunk_index + 1}</h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">{chunk.content}</p>
            {chunk.truncated && <p className="text-xs">此分块仅显示前 12,000 字符，请下载查看完整原文。</p>}
          </section>
        ))}
        {!loading && page?.total === 0 && <p>暂无可预览文本，可下载原文件查看。</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm">
        <button type="button" disabled={downloading} onClick={() => { void download() }}>{downloading ? '下载中…' : '下载原文件'}</button>
        <div className="flex items-center gap-3">
          <button type="button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 3))}>上一页</button>
          <span>{page ? `${Math.min(offset + 1, page.total)}–${Math.min(offset + 3, page.total)} / ${page.total} 分块` : ''}</span>
          <button type="button" disabled={loading || !page || offset + 3 >= page.total} onClick={() => setOffset(value => value + 3)}>下一页</button>
        </div>
      </div>
    </dialog>
  )
}
