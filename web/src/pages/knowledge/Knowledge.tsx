import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Database, FileText, Loader2, Search, Trash2, Upload, X } from 'lucide-react'

import { api } from '../../api/client'
import { CxConfirmDialog, CxSkeleton, CxStatus, CxTopProgress, type CxStatusTone } from '../../components/codex'
import { PageTitle } from '../../components/PageTitle'
import type { KnowledgeDocument, KnowledgeStats } from '../../types/api'
import { formatDateOnly, parseAppDateTime } from '../../utils/timezone'

const DOC_GRID = '54px minmax(260px,1fr) 92px 82px 74px'
const DOC_TABLE_MIN_WIDTH = 760

const CATEGORY_ORDER = ['all', 'research', 'interview', 'technical', 'methodology', 'weekly', 'general', 'consulting', 'templates']
const UPLOAD_CATEGORIES = ['general', 'research', 'consulting', 'templates']

function isZhLanguage(language?: string) {
  return !language || language.startsWith('zh')
}

function categoryLabel(category: string, isZh: boolean) {
  const labels: Record<string, { zh: string; en: string }> = {
    all: { zh: '全部', en: 'All' },
    research: { zh: '行业资料', en: 'Research' },
    industry: { zh: '行业资料', en: 'Industry' },
    interview: { zh: '客户访谈', en: 'Interviews' },
    customer_interview: { zh: '客户访谈', en: 'Client interviews' },
    technical: { zh: '技术参考', en: 'Technical' },
    tech: { zh: '技术参考', en: 'Technical' },
    methodology: { zh: '方法论', en: 'Methodology' },
    consulting: { zh: '方法论', en: 'Consulting' },
    weekly: { zh: '周报', en: 'Weekly' },
    report: { zh: '周报', en: 'Reports' },
    templates: { zh: '模板', en: 'Templates' },
    template: { zh: '模板', en: 'Template' },
    general: { zh: '通用', en: 'General' },
    uncategorized: { zh: '未分类', en: 'Uncategorized' },
  }
  const normalized = category || 'uncategorized'
  const found = labels[normalized]
  if (found) return isZh ? found.zh : found.en
  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeCategory(value?: string | null) {
  return value?.trim() || 'uncategorized'
}

function fileType(value: string) {
  const type = value?.trim().replace(/^\./, '').toUpperCase()
  return type || 'DOC'
}

function formatFileSize(size?: number) {
  if (size == null || Number.isNaN(size)) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatRelativeTime(value: string, isZh: boolean) {
  const date = parseAppDateTime(value)
  const diffHours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60))
  if (Number.isFinite(diffHours)) {
    if (diffHours < 1) return isZh ? '刚刚' : 'Just now'
    if (diffHours < 24) return isZh ? '今天' : 'Today'
    if (diffHours < 48) return isZh ? '昨天' : 'Yesterday'
    if (diffHours < 24 * 7) return isZh ? `${Math.max(1, Math.floor(diffHours / 24))} 天前` : `${Math.max(1, Math.floor(diffHours / 24))}d ago`
    if (diffHours < 24 * 30) return isZh ? `${Math.max(1, Math.floor(diffHours / (24 * 7)))} 周前` : `${Math.max(1, Math.floor(diffHours / (24 * 7)))}w ago`
  }
  return formatDateOnly(value, { month: 'short', day: 'numeric' })
}

function statusMeta(status: KnowledgeDocument['vector_status'], isZh: boolean): { label: string; tone: CxStatusTone; pulse?: boolean } {
  if (status === 'synced') return { label: isZh ? '已索引' : 'Indexed', tone: 'good' }
  if (status === 'failed') return { label: isZh ? '失败' : 'Failed', tone: 'bad' }
  if (status === 'processing') return { label: isZh ? '处理中' : 'Processing', tone: 'warn', pulse: true }
  return { label: isZh ? '排队中' : 'Queued', tone: 'neutral', pulse: true }
}

function docMatches(doc: KnowledgeDocument, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  return [doc.name, doc.file_type, doc.category, doc.path]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(keyword))
}

function sortDocuments(left: KnowledgeDocument, right: KnowledgeDocument) {
  const leftTime = parseAppDateTime(left.uploaded_at).getTime() || 0
  const rightTime = parseAppDateTime(right.uploaded_at).getTime() || 0
  if (rightTime !== leftTime) return rightTime - leftTime
  return left.name.localeCompare(right.name)
}

export function Knowledge() {
  const { i18n } = useTranslation()
  const isZh = isZhLanguage(i18n?.language)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [stats, setStats] = useState<KnowledgeStats>({ document_count: 0, total_vectors: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [uploadCategory, setUploadCategory] = useState('general')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Pending delete confirmation: the id of the document the user is
  // about to delete, or null when the dialog is closed. We hold the id
  // (not the document) so the dialog survives an upstream refresh.
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchData = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [docsData, statsData] = await Promise.all([
        api.get<KnowledgeDocument[]>('/knowledge/documents'),
        api.get<KnowledgeStats>('/knowledge/stats'),
      ])
      setDocuments([...docsData].sort(sortDocuments))
      setStats(statsData)
    } catch (err) {
      console.error('Failed to fetch knowledge data:', err)
      setError(isZh ? '知识库加载失败' : 'Failed to load knowledge base')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void fetchData()
  }, [])

  const categories = useMemo(() => {
    const present = new Set(documents.map((doc) => normalizeCategory(doc.category)))
    const ordered = CATEGORY_ORDER.filter((category) => category === 'all' || present.has(category))
    const extra = [...present].filter((category) => !ordered.includes(category)).sort()
    return [...ordered, ...extra]
  }, [documents])

  const filteredDocuments = useMemo(
    () =>
      documents.filter((doc) => {
        if (!docMatches(doc, searchQuery)) return false
        if (selectedCategory === 'all') return true
        return normalizeCategory(doc.category) === selectedCategory
      }),
    [documents, searchQuery, selectedCategory],
  )

  const distribution = useMemo(() => {
    const counts = new Map<string, number>()
    documents.forEach((doc) => {
      const category = normalizeCategory(doc.category)
      counts.set(category, (counts.get(category) || 0) + 1)
    })
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
  }, [documents])

  const indexedCount = documents.filter((doc) => doc.vector_status === 'synced').length
  const totalSize = documents.reduce((sum, doc) => sum + (doc.size || 0), 0)
  const latestDoc = documents[0]

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', uploadCategory)

      await api.post('/knowledge/documents', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      await fetchData({ silent: true })
    } catch (err) {
      console.error('Failed to upload file:', err)
      setError(isZh ? '文档上传失败' : 'Failed to upload document')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const confirmDelete = async () => {
    if (pendingDeleteId == null) return
    setDeleting(true)
    try {
      await api.delete(`/knowledge/documents/${pendingDeleteId}`)
      setPendingDeleteId(null)
      await fetchData({ silent: true })
    } catch (err) {
      console.error('Failed to delete document:', err)
      setError(isZh ? '文档删除失败' : 'Failed to delete document')
      setPendingDeleteId(null)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return <KnowledgeLoading isZh={isZh} />
  }

  return (
    <>
      <PageTitle title={isZh ? '知识库' : 'Knowledge'} />
      <main
        className="theme-codex min-h-full"
        style={{
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-ink)',
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        <div
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]"
          style={{ padding: '32px clamp(24px, 4vw, 56px) 40px', minWidth: 0 }}
        >
          <div className="min-w-0">
            <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between" style={{ marginBottom: 26 }}>
              <div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 28,
                    fontWeight: 500,
                    letterSpacing: '-0.02em',
                    color: 'var(--color-codex-ink)',
                  }}
                >
                  {isZh ? '知识库' : 'Knowledge'}
                </h1>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--color-codex-ink-mute)' }}>
                  {isZh
                    ? `${stats.document_count || documents.length} 份文档 · ${formatFileSize(totalSize)} 已索引 · ${latestDoc ? formatRelativeTime(latestDoc.uploaded_at, isZh) + '同步' : '等待入库'}`
                    : `${stats.document_count || documents.length} docs · ${formatFileSize(totalSize)} indexed · ${latestDoc ? 'Synced ' + formatRelativeTime(latestDoc.uploaded_at, isZh) : 'Waiting for ingest'}`}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div
                  className="flex items-center gap-2"
                  style={{
                    width: 'min(100%, 260px)',
                    padding: '7px 12px',
                    border: '1px solid var(--color-codex-line)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                    background: 'var(--color-codex-bg-elev)',
                    color: 'var(--color-codex-ink-mute)',
                  }}
                >
                  <Search size={13} strokeWidth={1.5} aria-hidden="true" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={isZh ? '搜索文档 / 标签' : 'Search docs / tags'}
                    className="codex-input min-w-0 flex-1 bg-transparent outline-none"
                    style={{ color: 'var(--color-codex-ink)', fontSize: 13 }}
                    aria-label={isZh ? '搜索知识库' : 'Search knowledge'}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="cx-no-hover inline-flex items-center"
                      style={{ color: 'var(--color-codex-ink-faint)' }}
                      aria-label={isZh ? '清空搜索' : 'Clear search'}
                    >
                      <X size={13} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>

                <select
                  value={uploadCategory}
                  onChange={(event) => setUploadCategory(event.target.value)}
                  className="codex-input"
                  style={{
                    minHeight: 36,
                    padding: '0 10px',
                    border: '1px solid var(--color-codex-line)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                    background: 'var(--color-codex-bg-elev)',
                    color: 'var(--color-codex-ink-soft)',
                    fontSize: 12.5,
                  }}
                  aria-label={isZh ? '上传分类' : 'Upload category'}
                >
                  {UPLOAD_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {categoryLabel(category, isZh)}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="cx-primary-action cx-no-hover"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload size={13} strokeWidth={1.5} aria-hidden="true" />}
                  {isZh ? '上传文档' : 'Upload'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileUpload}
                  accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.xls,.pptx,.ppt"
                  className="hidden"
                />
              </div>
            </header>

            <div className="flex flex-wrap gap-1.5" style={{ marginBottom: 18 }}>
              {categories.map((category) => (
                <FilterPill
                  key={category}
                  active={selectedCategory === category}
                  count={category === 'all' ? documents.length : documents.filter((doc) => normalizeCategory(doc.category) === category).length}
                  label={categoryLabel(category, isZh)}
                  onClick={() => setSelectedCategory(category)}
                />
              ))}
            </div>

            {error ? (
              <div
                style={{
                  marginBottom: 18,
                  padding: '10px 12px',
                  border: '1px solid color-mix(in oklab, var(--color-codex-bad) 24%, var(--color-codex-line))',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  color: 'var(--color-codex-bad)',
                  background: 'color-mix(in oklab, var(--color-codex-bad) 7%, var(--color-codex-bg-elev))',
                }}
              >
                {error}
              </div>
            ) : null}

            <section aria-label={isZh ? '知识库文档' : 'Knowledge documents'}>
              <div className="overflow-x-auto">
                <div style={{ minWidth: DOC_TABLE_MIN_WIDTH }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: DOC_GRID,
                      gap: 12,
                      padding: '8px 6px',
                      fontSize: 11.5,
                      color: 'var(--color-codex-ink-faint)',
                    }}
                  >
                    <span>{isZh ? '类型' : 'Type'}</span>
                    <span>{isZh ? '标题与标签' : 'Title & tags'}</span>
                    <span>{isZh ? '大小' : 'Size'}</span>
                    <span>{isZh ? '更新' : 'Updated'}</span>
                    <span />
                  </div>

                  {filteredDocuments.length === 0 ? (
                    <KnowledgeEmptyState
                      hasSearch={Boolean(searchQuery.trim()) || selectedCategory !== 'all'}
                      isZh={isZh}
                      onClear={() => {
                        setSearchQuery('')
                        setSelectedCategory('all')
                      }}
                      onUpload={() => fileInputRef.current?.click()}
                    />
                  ) : (
                    filteredDocuments.map((doc) => (
                      <KnowledgeRow
                        key={doc.id}
                        doc={doc}
                        isZh={isZh}
                        onDelete={() => setPendingDeleteId(doc.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>

          <aside className="lg:border-l lg:pl-8" style={{ borderColor: 'var(--color-codex-line)' }}>
            <RailHeading>{isZh ? '索引状态' : 'Index status'}</RailHeading>
            <div style={{ marginBottom: 24 }}>
              <div className="codex-num" style={{ fontSize: 36, color: 'var(--color-codex-ink)', lineHeight: 1, fontWeight: 500 }}>
                {stats.document_count || documents.length}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)', marginTop: 6 }}>
                {isZh ? `份文档 · ${formatFileSize(totalSize)}` : `documents · ${formatFileSize(totalSize)}`}
              </div>
              <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
                <CxStatus tone={indexedCount === documents.length && documents.length > 0 ? 'good' : 'warn'}>
                  {indexedCount === documents.length && documents.length > 0 ? (isZh ? '已同步' : 'Synced') : isZh ? '索引中' : 'Indexing'}
                </CxStatus>
                <span style={{ color: 'var(--color-codex-ink-faint)', fontSize: 11 }}>
                  {latestDoc ? formatRelativeTime(latestDoc.uploaded_at, isZh) : '—'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void fetchData({ silent: true })}
                disabled={refreshing}
                className="cx-no-hover mt-3 inline-flex items-center gap-1.5"
                style={{
                  padding: '6px 10px',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  color: 'var(--color-codex-ink-soft)',
                  fontSize: 12,
                }}
              >
                <Database size={12} strokeWidth={1.5} aria-hidden="true" />
                {refreshing ? (isZh ? '同步中' : 'Syncing') : isZh ? '刷新索引' : 'Refresh index'}
              </button>
            </div>

            <RailHeading>{isZh ? '分布' : 'Distribution'}</RailHeading>
            <div style={{ marginBottom: 24 }}>
              {distribution.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>{isZh ? '暂无分类数据' : 'No category data'}</p>
              ) : (
                distribution.map(([category, count], index) => (
                  <DistributionBar
                    key={category}
                    color={barColor(index)}
                    label={categoryLabel(category, isZh)}
                    max={Math.max(...distribution.map(([, value]) => value), 1)}
                    value={count}
                  />
                ))
              )}
            </div>

            <RailHeading>{isZh ? '最近入库' : 'Recent ingest'}</RailHeading>
            <div>
              {documents.slice(0, 5).map((doc) => (
                <div key={doc.id} className="flex gap-3" style={{ padding: '6px 0', fontSize: 12, color: 'var(--color-codex-ink-soft)' }}>
                  <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                  <span style={{ color: 'var(--color-codex-ink-faint)' }}>{formatRelativeTime(doc.uploaded_at, isZh)}</span>
                </div>
              ))}
              {documents.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>{isZh ? '暂无入库记录' : 'No ingest records'}</p>
              ) : null}
            </div>
          </aside>
        </div>
      </main>
      <CxConfirmDialog
        open={pendingDeleteId != null}
        onClose={() => {
          if (!deleting) setPendingDeleteId(null)
        }}
        onConfirm={() => void confirmDelete()}
        tone="danger"
        title={isZh ? '删除这份文档？' : 'Delete this document?'}
        description={
          isZh
            ? '删除后此文档不再可被搜索或用于上下文，操作不可撤销。'
            : 'After deletion this document is no longer searchable or used in context. This cannot be undone.'
        }
        confirmLabel={isZh ? '删除' : 'Delete'}
        cancelLabel={isZh ? '取消' : 'Cancel'}
        busy={deleting}
      />
    </>
  )
}

function FilterPill({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cx-no-hover inline-flex items-center gap-1.5"
      style={{
        padding: '5px 12px',
        borderRadius: 'var(--codex-r-sm, 3px)',
        background: active ? 'var(--color-codex-ink)' : 'transparent',
        color: active ? 'var(--color-codex-bg-elev)' : 'var(--color-codex-ink-soft)',
        border: active ? '1px solid var(--color-codex-ink)' : '1px solid var(--color-codex-line)',
        fontSize: 12.5,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{label}</span>
      <span className="codex-mono" style={{ opacity: active ? 0.72 : 0.6 }}>
        {count}
      </span>
    </button>
  )
}

function KnowledgeRow({
  doc,
  isZh,
  onDelete,
}: {
  doc: KnowledgeDocument
  isZh: boolean
  onDelete: () => void
}) {
  const status = statusMeta(doc.vector_status, isZh)
  const tags = [categoryLabel(normalizeCategory(doc.category), isZh), fileType(doc.file_type)].filter(Boolean)

  return (
    <div
      className="row-hov"
      style={{
        display: 'grid',
        gridTemplateColumns: DOC_GRID,
        gap: 12,
        alignItems: 'center',
        padding: '14px 6px',
        borderTop: '1px solid var(--color-codex-line-soft)',
      }}
    >
      <span style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)', letterSpacing: '0.04em' }}>{fileType(doc.file_type)}</span>
      <div className="min-w-0">
        <div className="truncate" style={{ fontSize: 14, color: 'var(--color-codex-ink)', fontWeight: 500 }}>
          {doc.name}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 gap-y-1" style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
          {tags.map((tag) => (
            <span key={tag}>· {tag}</span>
          ))}
          <CxStatus tone={status.tone} pulse={status.pulse}>
            {status.label}
          </CxStatus>
        </div>
      </div>
      <span className="codex-num" style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
        {formatFileSize(doc.size)}
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--color-codex-ink-faint)' }}>{formatRelativeTime(doc.uploaded_at, isZh)}</span>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onDelete}
          className="cx-no-hover inline-flex items-center justify-center"
          style={{
            width: 26,
            height: 26,
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'color-mix(in oklab, var(--color-codex-bad) 78%, var(--color-codex-ink-soft))',
          }}
          aria-label={isZh ? `删除 ${doc.name}` : `Delete ${doc.name}`}
        >
          <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <ArrowRight size={12} strokeWidth={1.5} style={{ color: 'var(--color-codex-ink-faint)' }} aria-hidden="true" />
      </div>
    </div>
  )
}

function KnowledgeEmptyState({
  hasSearch,
  isZh,
  onClear,
  onUpload,
}: {
  hasSearch: boolean
  isZh: boolean
  onClear: () => void
  onUpload: () => void
}) {
  return (
    <div
      className="text-center"
      style={{
        padding: '72px 16px',
        borderTop: '1px solid var(--color-codex-line-soft)',
        color: 'var(--color-codex-ink-mute)',
      }}
    >
      <FileText size={30} strokeWidth={1.4} style={{ margin: '0 auto 14px', color: 'var(--color-codex-ink-faint)' }} />
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, color: 'var(--color-codex-ink)' }}>
        {hasSearch ? (isZh ? '没有匹配的文档' : 'No matching documents') : isZh ? '还没有文档' : 'No documents yet'}
      </h2>
      <p style={{ margin: '6px auto 0', maxWidth: 420, fontSize: 13 }}>
        {hasSearch
          ? isZh
            ? '试试换一个关键词，或清空筛选后重新查看知识库。'
            : 'Try another keyword, or clear filters to review the full library.'
          : isZh
            ? '上传 PDF、Word、PPT 或 Markdown 后，AI 就可以在对话和 Skill 中调用这些知识。'
            : 'Upload PDFs, Word docs, slides, or Markdown so AI can reuse them in chat and Skills.'}
      </p>
      <button
        type="button"
        onClick={hasSearch ? onClear : onUpload}
        className={hasSearch ? undefined : 'cx-primary-action cx-no-hover'}
        style={
          hasSearch
            ? {
                marginTop: 16,
                padding: '7px 12px',
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-sm, 3px)',
                color: 'var(--color-codex-ink-soft)',
              }
            : { marginTop: 16 }
        }
      >
        {hasSearch ? (isZh ? '清空筛选' : 'Clear filters') : isZh ? '上传文档' : 'Upload document'}
      </button>
    </div>
  )
}

function KnowledgeLoading({ isZh }: { isZh: boolean }) {
  return (
    <>
      <PageTitle title={isZh ? '知识库' : 'Knowledge'} />
      <main className="theme-codex min-h-full" style={{ background: 'var(--color-codex-bg)', color: 'var(--color-codex-ink)' }}>
        <CxTopProgress />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]" style={{ padding: '32px clamp(24px, 4vw, 56px) 40px' }}>
          <div>
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <CxSkeleton w={96} h={30} />
                <CxSkeleton w={260} h={14} style={{ marginTop: 12 }} />
              </div>
              <CxSkeleton w={460} h={38} />
            </div>
            <div className="mb-4 flex gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <CxSkeleton key={index} w={index === 1 ? 90 : 72} h={30} />
              ))}
            </div>
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="grid items-center gap-3" style={{ gridTemplateColumns: DOC_GRID, padding: '14px 6px', borderTop: '1px solid var(--color-codex-line-soft)' }}>
                <CxSkeleton h={14} />
                <CxSkeleton h={34} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
              </div>
            ))}
          </div>
          <aside className="lg:border-l lg:pl-8" style={{ borderColor: 'var(--color-codex-line)' }}>
            <CxSkeleton w={72} h={12} />
            <CxSkeleton w={88} h={36} style={{ marginTop: 18 }} />
            <CxSkeleton w={140} h={12} style={{ marginTop: 10 }} />
            <CxSkeleton w={72} h={12} style={{ marginTop: 34 }} />
            {Array.from({ length: 4 }).map((_, index) => (
              <CxSkeleton key={index} w="100%" h={18} style={{ marginTop: 14 }} />
            ))}
          </aside>
        </div>
      </main>
    </>
  )
}

function RailHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        margin: '0 0 12px',
        fontSize: 11.5,
        fontWeight: 500,
        color: 'var(--color-codex-ink-mute)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </h2>
  )
}

function DistributionBar({
  color,
  label,
  max,
  value,
}: {
  color: string
  label: string
  max: number
  value: number
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="flex justify-between" style={{ fontSize: 12, marginBottom: 5 }}>
        <span style={{ color: 'var(--color-codex-ink-soft)' }}>{label}</span>
        <span className="codex-num" style={{ color: 'var(--color-codex-ink-mute)' }}>{value}</span>
      </div>
      <div style={{ height: 2, background: 'var(--color-codex-bg-sunken)' }}>
        <div style={{ height: '100%', width: `${Math.max(8, Math.round((value / max) * 100))}%`, background: color }} />
      </div>
    </div>
  )
}

function barColor(index: number) {
  return [
    'var(--color-codex-bad)',
    'var(--color-codex-info)',
    'var(--color-codex-ink-soft)',
    'var(--color-codex-accent)',
    'var(--color-codex-warn)',
    'var(--color-codex-good)',
  ][index % 6]
}
