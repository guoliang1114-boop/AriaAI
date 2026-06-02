import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Check,
  ChevronDown,
  Database,
  FileText,
  Folder,
  Loader2,
  Quote,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import { api } from '../../api/client'
import { CxConfirmDialog, CxPagination, CxSkeleton, CxStatus, CxTopProgress, type CxStatusTone } from '../../components/codex'
import { PageTitle } from '../../components/PageTitle'
import { useToast } from '../../contexts/ToastContext'
import type { KnowledgeDocument, KnowledgeStats } from '../../types/api'
import { formatDateOnly, parseAppDateTime } from '../../utils/timezone'

const DOC_PAGE_SIZE = 10
const MANAGE_GRID = '26px 38px minmax(260px,1fr) 180px 104px 78px 86px 34px'
const MANAGE_TABLE_MIN_WIDTH = 980

const CATEGORY_ORDER = ['all', 'research', 'interview', 'technical', 'methodology', 'weekly', 'general', 'consulting', 'templates']
const UPLOAD_CATEGORIES = ['general', 'research', 'consulting', 'templates']

type KnowledgeViewMode = 'find' | 'manage'

interface KnowledgeCategoryCount {
  category: string
  count: number
}

interface KnowledgeDocumentListResponse {
  items: KnowledgeDocument[]
  total: number
  limit: number
  offset: number
  categories: KnowledgeCategoryCount[]
  recent: KnowledgeDocument[]
  indexed_count: number
  total_size: number
}

function isZhLanguage(language?: string) {
  return !language || language.startsWith('zh')
}

function categoryLabel(category: string, isZh: boolean) {
  const labels: Record<string, { zh: string; en: string }> = {
    all: { zh: '全部文件', en: 'All files' },
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

function docSizeBytes(doc: KnowledgeDocument) {
  return doc.size_bytes ?? (doc as unknown as { size?: number }).size
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

function statusMeta(status: KnowledgeDocument['vector_status'], isZh: boolean): { label: string; tone: CxStatusTone; pulse?: boolean; progress?: number } {
  if (status === 'synced') return { label: isZh ? '可用' : 'Ready', tone: 'good' }
  if (status === 'failed') return { label: isZh ? '失败' : 'Failed', tone: 'bad' }
  if (status === 'processing') return { label: isZh ? '解析中' : 'Parsing', tone: 'accent', pulse: true, progress: 48 }
  return { label: isZh ? '排队中' : 'Queued', tone: 'warn', pulse: true }
}

function statusCount(documents: KnowledgeDocument[], status: KnowledgeDocument['vector_status']) {
  return documents.filter((doc) => doc.vector_status === status).length
}

export function Knowledge() {
  const { i18n } = useTranslation()
  const toast = useToast()
  const isZh = isZhLanguage(i18n?.language)

  const [viewMode, setViewMode] = useState<KnowledgeViewMode>('find')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [documentListLoading, setDocumentListLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [documentTotal, setDocumentTotal] = useState(0)
  const [categoryCounts, setCategoryCounts] = useState<KnowledgeCategoryCount[]>([])
  const [recentDocuments, setRecentDocuments] = useState<KnowledgeDocument[]>([])
  const [indexedCount, setIndexedCount] = useState(0)
  const [totalSize, setTotalSize] = useState(0)
  const [stats, setStats] = useState<KnowledgeStats>({ document_count: 0, total_vectors: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [uploadCategory, setUploadCategory] = useState('general')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [documentPage, setDocumentPage] = useState(1)
  const [documentPageSize, setDocumentPageSize] = useState(DOC_PAGE_SIZE)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchData = async ({ silent = false }: { silent?: boolean } = {}) => {
    const isInitialLoad = !silent && !hasLoaded
    if (silent) {
      setRefreshing(true)
    } else if (isInitialLoad) {
      setLoading(true)
    } else {
      setDocumentListLoading(true)
    }
    setError(null)
    try {
      const [docsData, statsData] = await Promise.all([
        api.get<KnowledgeDocumentListResponse>('/knowledge/documents/list', {
          params: {
            search: searchQuery.trim(),
            category: selectedCategory,
            limit: documentPageSize,
            offset: (documentPage - 1) * documentPageSize,
          },
        }),
        api.get<KnowledgeStats>('/knowledge/stats'),
      ])
      setDocuments(docsData.items)
      setDocumentTotal(docsData.total)
      setCategoryCounts(docsData.categories)
      setRecentDocuments(docsData.recent)
      setIndexedCount(docsData.indexed_count)
      setTotalSize(docsData.total_size)
      setStats(statsData)
      setHasLoaded(true)
    } catch (err) {
      console.error('Failed to fetch knowledge data:', err)
      setError(isZh ? '知识库加载失败' : 'Failed to load knowledge base')
    } finally {
      if (isInitialLoad) {
        setLoading(false)
      } else {
        setDocumentListLoading(false)
      }
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void fetchData()
  }, [documentPage, documentPageSize, searchQuery, selectedCategory])

  useEffect(() => {
    setDocumentPage(1)
  }, [searchQuery, selectedCategory])

  const categories = useMemo(() => {
    const present = new Set(categoryCounts.map((item) => normalizeCategory(item.category)))
    const ordered = CATEGORY_ORDER.filter((category) => category === 'all' || present.has(category))
    const extra = [...present].filter((category) => !ordered.includes(category)).sort()
    return [...ordered, ...extra]
  }, [categoryCounts])

  const documentPageCount = Math.max(1, Math.ceil(documentTotal / documentPageSize))
  const currentDocumentPage = Math.min(documentPage, documentPageCount)

  useEffect(() => {
    setDocumentPage((current) => Math.min(current, documentPageCount))
  }, [documentPageCount])

  const allDocumentCount = stats.document_count || categoryCounts.reduce((sum, item) => sum + item.count, 0) || documentTotal
  const latestDoc = recentDocuments[0]
  const localTotalSize = totalSize || documents.reduce((sum, doc) => sum + (docSizeBytes(doc) || 0), 0)
  const processingCount = statusCount(documents, 'processing') + statusCount(documents, 'pending')
  const failedCount = statusCount(documents, 'failed')

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
      toast.success({ title: isZh ? '文档已上传' : 'Document uploaded', description: isZh ? '系统会在后台解析并索引。' : 'Aria will parse and index it in the background.' })
      await fetchData({ silent: true })
    } catch (err) {
      console.error('Failed to upload file:', err)
      setError(isZh ? '文档上传失败' : 'Failed to upload document')
      toast.error({ title: isZh ? '文档上传失败' : 'Upload failed' })
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
      toast.success({ title: isZh ? '文档已删除' : 'Document deleted' })
      await fetchData({ silent: true })
    } catch (err) {
      console.error('Failed to delete document:', err)
      setError(isZh ? '文档删除失败' : 'Failed to delete document')
      toast.error({ title: isZh ? '文档删除失败' : 'Delete failed' })
      setPendingDeleteId(null)
    } finally {
      setDeleting(false)
    }
  }

  const copyCitation = async (doc: KnowledgeDocument) => {
    const text = `${doc.name}\n${doc.path}`
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(text)
      toast.success({ title: isZh ? '已复制引用' : 'Citation copied' })
    } catch (err) {
      console.warn('Failed to copy citation:', err)
      toast.error({ title: isZh ? '复制失败' : 'Copy failed' })
    }
  }

  if (loading && !hasLoaded) {
    return <KnowledgeLoading isZh={isZh} />
  }

  return (
    <>
      <PageTitle title={isZh ? '知识库' : 'Knowledge'} />
      <main
        className="theme-codex flex min-h-[calc(100vh-56px)] flex-col"
        style={{
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-ink)',
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        <KnowledgeTopTabs active={viewMode} isZh={isZh} onChange={setViewMode} />

        {viewMode === 'find' ? (
          <KnowledgeFindView
            allDocumentCount={allDocumentCount}
            categories={categories}
            categoryCounts={categoryCounts}
            currentDocumentPage={currentDocumentPage}
            documentListLoading={documentListLoading}
            documents={documents}
            documentPageSize={documentPageSize}
            documentTotal={documentTotal}
            error={error}
            indexedCount={indexedCount}
            isZh={isZh}
            latestDoc={latestDoc}
            onCategoryChange={(category) => {
              setSelectedCategory(category)
              setDocumentPage(1)
            }}
            onClear={() => {
              setSearchQuery('')
              setSelectedCategory('all')
              setDocumentPage(1)
            }}
            onCopyCitation={(doc) => void copyCitation(doc)}
            onPageChange={setDocumentPage}
            onPageSizeChange={(nextPageSize) => {
              setDocumentPageSize(nextPageSize)
              setDocumentPage(1)
            }}
            onUpload={() => fileInputRef.current?.click()}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
            setSearchQuery={(value) => {
              setSearchQuery(value)
              setDocumentPage(1)
            }}
            totalSize={localTotalSize}
          />
        ) : (
          <KnowledgeManageView
            allDocumentCount={allDocumentCount}
            categories={categories}
            categoryCounts={categoryCounts}
            currentDocumentPage={currentDocumentPage}
            documentListLoading={documentListLoading}
            documents={documents}
            documentPageSize={documentPageSize}
            documentTotal={documentTotal}
            error={error}
            failedCount={failedCount}
            indexedCount={indexedCount}
            isZh={isZh}
            onCategoryChange={(category) => {
              setSelectedCategory(category)
              setDocumentPage(1)
            }}
            onClear={() => {
              setSearchQuery('')
              setSelectedCategory('all')
              setDocumentPage(1)
            }}
            onDelete={(doc) => setPendingDeleteId(doc.id)}
            onPageChange={setDocumentPage}
            onPageSizeChange={(nextPageSize) => {
              setDocumentPageSize(nextPageSize)
              setDocumentPage(1)
            }}
            onRefresh={() => void fetchData({ silent: true })}
            onUpload={() => fileInputRef.current?.click()}
            processingCount={processingCount}
            refreshing={refreshing}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
            setSearchQuery={(value) => {
              setSearchQuery(value)
              setDocumentPage(1)
            }}
            totalSize={localTotalSize}
            uploadCategory={uploadCategory}
            uploading={uploading}
            setUploadCategory={setUploadCategory}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileUpload}
          accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.xls,.pptx,.ppt"
          className="hidden"
        />
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

function KnowledgeTopTabs({
  active,
  isZh,
  onChange,
}: {
  active: KnowledgeViewMode
  isZh: boolean
  onChange: (mode: KnowledgeViewMode) => void
}) {
  const tabs: Array<{ key: KnowledgeViewMode; labelZh: string; labelEn: string }> = [
    { key: 'find', labelZh: '查找', labelEn: 'Find' },
    { key: 'manage', labelZh: '管理', labelEn: 'Manage' },
  ]

  return (
    <div
      className="flex flex-shrink-0 items-center"
      style={{
        gap: 2,
        padding: '0 28px',
        borderBottom: '1px solid var(--color-codex-line)',
      }}
    >
      {tabs.map((tab) => {
        const selected = active === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className="cx-no-hover"
            style={{
              padding: '12px 14px',
              fontSize: 13.5,
              color: selected ? 'var(--color-codex-ink)' : 'var(--color-codex-ink-mute)',
              fontWeight: selected ? 500 : 400,
              borderBottom: selected ? '2px solid var(--color-codex-accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {isZh ? tab.labelZh : tab.labelEn}
          </button>
        )
      })}
    </div>
  )
}

function KnowledgeFindView({
  allDocumentCount,
  categories,
  categoryCounts,
  currentDocumentPage,
  documentListLoading,
  documents,
  documentPageSize,
  documentTotal,
  error,
  indexedCount,
  isZh,
  latestDoc,
  onCategoryChange,
  onClear,
  onCopyCitation,
  onPageChange,
  onPageSizeChange,
  onUpload,
  searchQuery,
  selectedCategory,
  setSearchQuery,
  totalSize,
}: {
  allDocumentCount: number
  categories: string[]
  categoryCounts: KnowledgeCategoryCount[]
  currentDocumentPage: number
  documentListLoading: boolean
  documents: KnowledgeDocument[]
  documentPageSize: number
  documentTotal: number
  error: string | null
  indexedCount: number
  isZh: boolean
  latestDoc?: KnowledgeDocument
  onCategoryChange: (category: string) => void
  onClear: () => void
  onCopyCitation: (doc: KnowledgeDocument) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onUpload: () => void
  searchQuery: string
  selectedCategory: string
  setSearchQuery: (value: string) => void
  totalSize: number
}) {
  const hasSearch = Boolean(searchQuery.trim()) || selectedCategory !== 'all'
  const topCategories = categoryCounts.slice(0, 5)

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[212px_minmax(0,1fr)]">
      <aside
        className="hidden min-h-0 border-r lg:block"
        style={{
          borderColor: 'var(--color-codex-line)',
          padding: '24px 14px 24px 28px',
          overflow: 'hidden',
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-codex-ink)' }}>{isZh ? '筛选' : 'Filters'}</span>
          <button type="button" onClick={onClear} className="cx-no-hover" style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
            {isZh ? '清空' : 'Clear'}
          </button>
        </div>
        <FacetBlock title={isZh ? '分类' : 'Category'}>
          {categories.map((category) => (
            <FacetOption
              key={category}
              active={selectedCategory === category}
              count={category === 'all' ? allDocumentCount : categoryCounts.find((item) => normalizeCategory(item.category) === category)?.count || 0}
              label={categoryLabel(category, isZh)}
              onClick={() => onCategoryChange(category)}
            />
          ))}
        </FacetBlock>
        <FacetBlock title={isZh ? '状态' : 'Status'}>
          <FacetReadonly label={isZh ? '已索引' : 'Indexed'} count={indexedCount} />
          <FacetReadonly label={isZh ? '等待入库' : 'Waiting'} count={Math.max(0, allDocumentCount - indexedCount)} />
        </FacetBlock>
      </aside>

      <div className="flex min-w-0 flex-col overflow-hidden">
        <div style={{ padding: '26px clamp(24px, 4vw, 48px) 0', flexShrink: 0 }}>
          <div
            style={{
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line-strong)',
              borderRadius: 'var(--codex-r-md, 6px)',
              padding: '13px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 13,
            }}
          >
            <Search size={18} strokeWidth={1.6} style={{ color: 'var(--color-codex-ink-mute)', flexShrink: 0 }} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={isZh ? '搜索文档、标签、来源' : 'Search documents, tags, sources'}
              className="codex-input min-w-0 flex-1 bg-transparent outline-none"
              style={{ color: 'var(--color-codex-ink)', fontSize: 15.5 }}
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
                <X size={15} strokeWidth={1.6} aria-hidden="true" />
              </button>
            ) : null}
            <div className="hidden shrink-0 overflow-hidden sm:flex" style={{ border: '1px solid var(--color-codex-line)', borderRadius: 'var(--codex-r-sm, 3px)' }}>
              <span style={{ padding: '5px 12px', fontSize: 12, color: 'var(--color-codex-bg-elev)', background: 'var(--color-codex-ink)' }}>{isZh ? '语义' : 'Semantic'}</span>
              <span style={{ padding: '5px 12px', fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>{isZh ? '关键词' : 'Keyword'}</span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span style={{ fontSize: 13, color: 'var(--color-codex-ink-soft)' }}>
              {isZh ? (
                <>
                  在 <span className="codex-num">{allDocumentCount}</span> 份文件中找到 <span className="codex-num" style={{ color: 'var(--color-codex-ink)', fontWeight: 500 }}>{documentTotal}</span> 条相关
                </>
              ) : (
                <>
                  Found <span className="codex-num" style={{ color: 'var(--color-codex-ink)', fontWeight: 500 }}>{documentTotal}</span> results in <span className="codex-num">{allDocumentCount}</span> documents
                </>
              )}
            </span>
            <span className="codex-mono" style={{ fontSize: 11, color: 'var(--color-codex-ink-faint)' }}>
              · {formatFileSize(totalSize)}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {topCategories.map((item) => (
                <button
                  key={item.category}
                  type="button"
                  onClick={() => onCategoryChange(normalizeCategory(item.category))}
                  className="cx-no-hover"
                  style={{
                    padding: '3px 9px',
                    borderRadius: 'var(--codex-r-pill, 999px)',
                    background: 'var(--color-codex-bg-tint)',
                    color: 'var(--color-codex-ink-soft)',
                    fontSize: 11.5,
                  }}
                >
                  {categoryLabel(normalizeCategory(item.category), isZh)}
                </button>
              ))}
            </div>
          </div>

          {error ? <KnowledgeError message={error} /> : null}

          <div
            className="mt-4 flex items-center gap-3"
            style={{
              padding: '12px 16px',
              background: 'var(--color-codex-accent-bg)',
              borderRadius: 'var(--codex-r-md, 6px)',
            }}
          >
            <span
              className="inline-flex shrink-0 items-center justify-center"
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                background: 'var(--color-codex-bg-elev)',
                color: 'var(--color-codex-accent)',
              }}
            >
              <Sparkles size={15} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span style={{ fontSize: 13, color: 'var(--color-codex-accent-ink)', flex: 1 }}>
              {isZh ? '查找结果可以作为对话和 Skill 的引用上下文。' : 'Search results can be reused as context in conversations and Skills.'}
            </span>
          </div>
        </div>

        <section aria-label={isZh ? '知识库文档' : 'Knowledge documents'} className="relative min-h-0 flex-1 overflow-hidden" style={{ padding: '8px clamp(24px, 4vw, 48px) 24px' }}>
          <div
            className="h-full overflow-auto"
            style={{
              opacity: documentListLoading ? 0.48 : 1,
              transition: 'opacity 140ms ease',
            }}
          >
            {documentTotal === 0 ? (
              <KnowledgeEmptyState hasSearch={hasSearch} isZh={isZh} onClear={onClear} onUpload={onUpload} />
            ) : (
              <>
                {documents.map((doc, index) => (
                  <SearchResultRow
                    key={doc.id}
                    doc={doc}
                    index={index}
                    isZh={isZh}
                    onCopyCitation={() => onCopyCitation(doc)}
                  />
                ))}
                <CxPagination
                  page={currentDocumentPage}
                  pageSize={documentPageSize}
                  totalItems={documentTotal}
                  onPageChange={onPageChange}
                  onPageSizeChange={onPageSizeChange}
                  isZh={isZh}
                  pageSizeOptions={[10, 20, 50]}
                  style={{ marginTop: 18 }}
                />
              </>
            )}
          </div>
          {documentListLoading ? <InlineTableLoading isZh={isZh} /> : null}
        </section>
      </div>
    </div>
  )
}

function KnowledgeManageView({
  allDocumentCount,
  categories,
  categoryCounts,
  currentDocumentPage,
  documentListLoading,
  documents,
  documentPageSize,
  documentTotal,
  error,
  failedCount,
  indexedCount,
  isZh,
  onCategoryChange,
  onClear,
  onDelete,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onUpload,
  processingCount,
  refreshing,
  searchQuery,
  selectedCategory,
  setSearchQuery,
  totalSize,
  uploadCategory,
  uploading,
  setUploadCategory,
}: {
  allDocumentCount: number
  categories: string[]
  categoryCounts: KnowledgeCategoryCount[]
  currentDocumentPage: number
  documentListLoading: boolean
  documents: KnowledgeDocument[]
  documentPageSize: number
  documentTotal: number
  error: string | null
  failedCount: number
  indexedCount: number
  isZh: boolean
  onCategoryChange: (category: string) => void
  onClear: () => void
  onDelete: (doc: KnowledgeDocument) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onRefresh: () => void
  onUpload: () => void
  processingCount: number
  refreshing: boolean
  searchQuery: string
  selectedCategory: string
  setSearchQuery: (value: string) => void
  totalSize: number
  uploadCategory: string
  uploading: boolean
  setUploadCategory: (category: string) => void
}) {
  const hasSearch = Boolean(searchQuery.trim()) || selectedCategory !== 'all'

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside
        className="hidden min-h-0 border-r lg:flex lg:flex-col"
        style={{
          borderColor: 'var(--color-codex-line)',
          padding: '22px 14px 22px 28px',
          overflow: 'hidden',
        }}
      >
        <SourceTreeRow
          active={selectedCategory === 'all'}
          count={allDocumentCount}
          icon={<BookOpen size={13} strokeWidth={1.5} />}
          label={isZh ? '全部文件' : 'All files'}
          onClick={() => onCategoryChange('all')}
        />
        <div style={{ height: 1, background: 'var(--color-codex-line-soft)', margin: '10px 6px' }} />
        <div className="codex-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-faint)', padding: '2px 10px 8px' }}>
          {isZh ? '按分类' : 'By category'}
        </div>
        {categories.filter((category) => category !== 'all').map((category) => (
          <SourceTreeRow
            key={category}
            active={selectedCategory === category}
            count={categoryCounts.find((item) => normalizeCategory(item.category) === category)?.count || 0}
            icon={<Folder size={13} strokeWidth={1.5} />}
            label={categoryLabel(category, isZh)}
            onClick={() => onCategoryChange(category)}
          />
        ))}

        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--color-codex-line-soft)' }}>
          <div className="codex-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-faint)', padding: '2px 10px 8px' }}>
            {isZh ? '需要处理' : 'Needs attention'}
          </div>
          <SourceStatusRow count={processingCount} isZh={isZh} tone="accent" pulse labelZh="解析中" labelEn="Parsing" />
          <SourceStatusRow count={failedCount} isZh={isZh} tone="bad" labelZh="失败" labelEn="Failed" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col overflow-hidden">
        <div style={{ padding: '22px clamp(24px, 4vw, 48px) 0', flexShrink: 0 }}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div
              className="inline-flex min-w-0 items-center gap-2 self-start"
              style={{
                padding: '5px 12px 5px 10px',
                background: 'var(--color-codex-accent-bg)',
                borderRadius: 'var(--codex-r-pill, 999px)',
              }}
            >
              <Check size={13} strokeWidth={2} style={{ color: 'var(--color-codex-accent)', flexShrink: 0 }} aria-hidden="true" />
              <span className="truncate" style={{ fontSize: 12.5, color: 'var(--color-codex-accent-ink)' }}>
                {isZh ? '全公司共享 · Aria 在项目对话中自动引用已索引文件' : 'Company shared · indexed files are available to Aria conversations'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              <button type="button" onClick={onRefresh} disabled={refreshing} className="cx-no-hover inline-flex items-center gap-1.5" style={ghostButtonStyle}>
                <Database size={13} strokeWidth={1.5} aria-hidden="true" />
                {refreshing ? (isZh ? '同步中' : 'Syncing') : isZh ? '刷新索引' : 'Refresh index'}
              </button>
              <button type="button" onClick={onUpload} disabled={uploading} className="cx-primary-action cx-no-hover">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload size={13} strokeWidth={1.5} aria-hidden="true" />}
                {isZh ? '上传文档' : 'Upload'}
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-b pb-3" style={{ borderColor: 'var(--color-codex-line)' }}>
            <div
              className="flex items-center gap-2"
              style={{
                width: 260,
                maxWidth: '100%',
                padding: '7px 12px',
                fontSize: 13,
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-sm, 3px)',
                color: 'var(--color-codex-ink-mute)',
                background: 'var(--color-codex-bg-elev)',
              }}
            >
              <Search size={13} strokeWidth={1.5} aria-hidden="true" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={isZh ? '搜索文件名、项目、标签' : 'Search file, project, tags'}
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
            <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => (
                <FilterPill
                  key={category}
                  active={selectedCategory === category}
                  count={category === 'all' ? allDocumentCount : categoryCounts.find((item) => normalizeCategory(item.category) === category)?.count || 0}
                  label={categoryLabel(category, isZh)}
                  onClick={() => onCategoryChange(category)}
                />
              ))}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-codex-ink-faint)' }}>
              {isZh ? (
                <>
                  共 <span className="codex-num" style={{ color: 'var(--color-codex-ink-soft)' }}>{allDocumentCount}</span> 份 · <span className="codex-num">{indexedCount}</span> 可用
                </>
              ) : (
                <>
                  <span className="codex-num" style={{ color: 'var(--color-codex-ink-soft)' }}>{allDocumentCount}</span> total · <span className="codex-num">{indexedCount}</span> ready
                </>
              )}
            </span>
          </div>

          {error ? <KnowledgeError message={error} /> : null}
        </div>

        <section aria-label={isZh ? '知识库文档' : 'Knowledge documents'} className="relative min-h-0 flex-1 overflow-hidden" style={{ padding: '0 clamp(24px, 4vw, 48px)' }}>
          <div
            className="h-full overflow-auto"
            style={{
              opacity: documentListLoading ? 0.48 : 1,
              transition: 'opacity 140ms ease',
            }}
          >
            <div style={{ minWidth: MANAGE_TABLE_MIN_WIDTH }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: MANAGE_GRID,
                  padding: '12px 8px 10px',
                  gap: 14,
                  fontSize: 11,
                  color: 'var(--color-codex-ink-faint)',
                  alignItems: 'center',
                }}
              >
                <span />
                <span />
                <span>{isZh ? '文件名 · 标签' : 'File · tags'}</span>
                <span>{isZh ? '来源' : 'Source'}</span>
                <span>{isZh ? '状态' : 'Status'}</span>
                <span>{isZh ? '大小' : 'Size'}</span>
                <span>{isZh ? '更新' : 'Updated'}</span>
                <span />
              </div>

              {documentTotal === 0 ? (
                <KnowledgeEmptyState hasSearch={hasSearch} isZh={isZh} onClear={onClear} onUpload={onUpload} />
              ) : (
                <>
                  {documents.map((doc) => (
                    <ManageDocumentRow
                      key={doc.id}
                      doc={doc}
                      isZh={isZh}
                      onDelete={() => onDelete(doc)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
          {documentListLoading ? <InlineTableLoading isZh={isZh} /> : null}
        </section>

        <div className="flex-shrink-0 border-t" style={{ borderColor: 'var(--color-codex-line)', padding: '12px clamp(24px, 4vw, 48px)' }}>
          <CxPagination
            page={currentDocumentPage}
            pageSize={documentPageSize}
            totalItems={documentTotal}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            isZh={isZh}
            pageSizeOptions={[10, 20, 50]}
          />
        </div>
      </div>
    </div>
  )
}

const ghostButtonStyle = {
  padding: '7px 12px',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  color: 'var(--color-codex-ink-soft)',
  fontSize: 12.5,
  background: 'var(--color-codex-bg-elev)',
}

function ManageDocumentRow({
  doc,
  isZh,
  onDelete,
}: {
  doc: KnowledgeDocument
  isZh: boolean
  onDelete: () => void
}) {
  const status = statusMeta(doc.vector_status, isZh)
  const type = fileType(doc.file_type)
  const source = doc.project_id
    ? isZh ? `项目 · #${doc.project_id}` : `Project · #${doc.project_id}`
    : doc.client_id
      ? isZh ? `客户 · #${doc.client_id}` : `Client · #${doc.client_id}`
      : categoryLabel(normalizeCategory(doc.category), isZh)

  return (
    <div>
      <div
        className="row-hov"
        style={{
          display: 'grid',
          gridTemplateColumns: MANAGE_GRID,
          padding: '11px 8px',
          gap: 14,
          alignItems: 'center',
          borderTop: '1px solid var(--color-codex-line-soft)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            border: '1.5px solid var(--color-codex-line-strong)',
          }}
        />
        <FileTypeBadge type={type} size={30} />
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 13.5, color: 'var(--color-codex-ink)', fontWeight: 500 }}>
            {doc.name}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            <TagChip>{categoryLabel(normalizeCategory(doc.category), isZh)}</TagChip>
            {doc.vector_status === 'synced' ? (
              <span className="codex-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-faint)', whiteSpace: 'nowrap' }}>
                {isZh ? '可被引用' : 'citable'}
              </span>
            ) : null}
          </div>
        </div>
        <span className="truncate" style={{ fontSize: 12, color: 'var(--color-codex-ink-soft)' }}>
          {source}
        </span>
        <CxStatus tone={status.tone} pulse={status.pulse}>
          {status.progress ? `${status.label} ${status.progress}%` : status.label}
        </CxStatus>
        <span className="codex-num" style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
          {formatFileSize(docSizeBytes(doc))}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--color-codex-ink-faint)' }}>{formatRelativeTime(doc.uploaded_at, isZh)}</span>
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
      </div>
      {doc.vector_status === 'processing' && status.progress ? (
        <div style={{ height: 2, background: 'var(--color-codex-bg-sunken)', margin: '0 8px' }}>
          <div style={{ width: `${status.progress}%`, height: '100%', background: 'var(--color-codex-accent)' }} />
        </div>
      ) : null}
      {doc.vector_status === 'failed' ? (
        <div
          className="flex items-center gap-3"
          style={{
            margin: '1px 8px 0 60px',
            padding: '8px 14px',
            background: 'var(--color-codex-bg-elev)',
            border: '1px solid var(--color-codex-line)',
            borderLeft: '2px solid var(--color-codex-bad)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-codex-ink-soft)' }}>
            <span style={{ color: 'var(--color-codex-bad)' }}>{isZh ? '无法索引 — ' : 'Index failed — '}</span>
            {isZh ? '当前文件未生成可检索内容。' : 'This file has no searchable content yet.'}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function SearchResultRow({
  doc,
  index,
  isZh,
  onCopyCitation,
}: {
  doc: KnowledgeDocument
  index: number
  isZh: boolean
  onCopyCitation: () => void
}) {
  const status = statusMeta(doc.vector_status, isZh)
  return (
    <div
      className="row-hov"
      style={{
        display: 'grid',
        gridTemplateColumns: '44px minmax(0,1fr)',
        gap: 16,
        padding: '18px 10px',
        marginLeft: -10,
        marginRight: -10,
        borderRadius: 'var(--codex-r-md, 6px)',
        borderTop: index === 0 ? 'none' : '1px solid var(--color-codex-line-soft)',
      }}
    >
      <FileTypeBadge type={fileType(doc.file_type)} size={36} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate" style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-codex-ink)' }}>
            {doc.name}
          </span>
          <CxStatus tone={status.tone} pulse={status.pulse}>
            {status.label}
          </CxStatus>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2" style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
          <span>{categoryLabel(normalizeCategory(doc.category), isZh)}</span>
          <span style={{ color: 'var(--color-codex-ink-faint)' }}>·</span>
          <TagChip>{fileType(doc.file_type)}</TagChip>
          <span className="codex-mono" style={{ color: 'var(--color-codex-ink-faint)' }}>
            {formatFileSize(docSizeBytes(doc))}
          </span>
          <span style={{ color: 'var(--color-codex-ink-faint)' }}>{formatRelativeTime(doc.uploaded_at, isZh)}</span>
        </div>
        <p
          style={{
            margin: '10px 0 0',
            paddingLeft: 13,
            borderLeft: '2px solid var(--color-codex-line)',
            fontSize: 13.5,
            color: 'var(--color-codex-ink-soft)',
            lineHeight: 1.7,
          }}
        >
          {doc.vector_status === 'synced'
            ? isZh
              ? '这份文件已进入知识库，可在对话、项目上下文和 Skill 工作流中作为引用资料。'
              : 'This file is indexed and can be reused in conversations, project context, and Skills.'
            : isZh
              ? '文件正在等待解析或索引，完成后会出现在可引用知识中。'
              : 'This file is waiting for parsing or indexing before it becomes citable.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4" style={{ paddingLeft: 13 }}>
          <button type="button" onClick={onCopyCitation} className="cx-no-hover inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
            <Quote size={12} strokeWidth={1.5} aria-hidden="true" />
            {isZh ? '复制引用' : 'Copy citation'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FileTypeBadge({ type, size = 30 }: { type: string; size?: number }) {
  const palette: Record<string, string> = {
    PDF: 'var(--color-codex-bad)',
    DOCX: 'var(--color-codex-info)',
    DOC: 'var(--color-codex-info)',
    PPTX: 'var(--color-codex-warn)',
    PPT: 'var(--color-codex-warn)',
    XLSX: 'var(--color-codex-good)',
    XLS: 'var(--color-codex-good)',
    MD: 'var(--color-codex-ink-mute)',
  }
  return (
    <span
      className="codex-mono"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--codex-r-sm, 3px)',
        border: '1px solid var(--color-codex-line)',
        fontSize: 8.5,
        fontWeight: 600,
        color: palette[type] || 'var(--color-codex-ink-mute)',
        background: 'var(--color-codex-bg-elev)',
      }}
    >
      {type}
    </span>
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
        borderRadius: 'var(--codex-r-pill, 999px)',
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

function FacetBlock({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="mb-2 flex items-center gap-1.5">
        <ChevronDown size={11} strokeWidth={1.7} style={{ color: 'var(--color-codex-ink-faint)' }} aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-codex-ink-mute)' }}>{title}</span>
      </div>
      <div>{children}</div>
    </div>
  )
}

function FacetOption({
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
      className="row-hov cx-no-hover flex w-full items-center gap-2"
      style={{
        padding: '5px 8px 5px 22px',
        borderRadius: 'var(--codex-r-sm, 3px)',
        background: active ? 'var(--color-codex-bg-tint)' : 'transparent',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 13,
          height: 13,
          borderRadius: 3,
          border: active ? 'none' : '1.5px solid var(--color-codex-line-strong)',
          background: active ? 'var(--color-codex-accent)' : 'transparent',
          flexShrink: 0,
        }}
      />
      <span className="truncate" style={{ flex: 1, textAlign: 'left', fontSize: 12.5, color: active ? 'var(--color-codex-ink)' : 'var(--color-codex-ink-soft)' }}>
        {label}
      </span>
      <span className="codex-num" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-faint)' }}>{count}</span>
    </button>
  )
}

function FacetReadonly({ count, label }: { count: number; label: string }) {
  return (
    <div className="flex items-center gap-2" style={{ padding: '5px 8px 5px 22px' }}>
      <span style={{ width: 13, height: 13, borderRadius: 3, border: '1.5px solid var(--color-codex-line-strong)', flexShrink: 0 }} />
      <span className="truncate" style={{ flex: 1, fontSize: 12.5, color: 'var(--color-codex-ink-soft)' }}>{label}</span>
      <span className="codex-num" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-faint)' }}>{count}</span>
    </div>
  )
}

function SourceTreeRow({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean
  count: number
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-hov cx-no-hover relative flex w-full items-center gap-2"
      style={{
        padding: '7px 10px',
        borderRadius: 'var(--codex-r-sm, 3px)',
        background: active ? 'var(--color-codex-bg-tint)' : 'transparent',
      }}
    >
      {active ? <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 2, background: 'var(--color-codex-accent)', borderRadius: 99 }} /> : null}
      <span style={{ color: active ? 'var(--color-codex-ink-soft)' : 'var(--color-codex-ink-mute)', flexShrink: 0 }}>{icon}</span>
      <span className="truncate" style={{ flex: 1, textAlign: 'left', fontSize: 13, color: active ? 'var(--color-codex-ink)' : 'var(--color-codex-ink-soft)', fontWeight: active ? 500 : 400 }}>{label}</span>
      <span className="codex-num" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-faint)' }}>{count}</span>
    </button>
  )
}

function SourceStatusRow({
  count,
  isZh,
  labelEn,
  labelZh,
  pulse,
  tone,
}: {
  count: number
  isZh: boolean
  labelEn: string
  labelZh: string
  pulse?: boolean
  tone: CxStatusTone
}) {
  return (
    <div className="row-hov flex items-center gap-2" style={{ padding: '6px 10px', borderRadius: 'var(--codex-r-sm, 3px)' }}>
      <CxStatus tone={tone} pulse={pulse}>{isZh ? labelZh : labelEn}</CxStatus>
      <span className="codex-num" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--color-codex-ink-faint)' }}>{count}</span>
    </div>
  )
}

function TagChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="codex-mono"
      style={{
        fontSize: 10.5,
        color: 'var(--color-codex-ink-mute)',
        padding: '1.5px 7px',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-pill, 999px)',
      }}
    >
      {children}
    </span>
  )
}

function KnowledgeError({ message }: { message: string }) {
  return (
    <div
      style={{
        marginTop: 14,
        padding: '10px 12px',
        border: '1px solid color-mix(in oklab, var(--color-codex-bad) 24%, var(--color-codex-line))',
        borderRadius: 'var(--codex-r-sm, 3px)',
        color: 'var(--color-codex-bad)',
        background: 'color-mix(in oklab, var(--color-codex-bad) 7%, var(--color-codex-bg-elev))',
      }}
    >
      {message}
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

function InlineTableLoading({ isZh }: { isZh: boolean }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-start justify-center"
      style={{
        paddingTop: 28,
        background: 'color-mix(in oklch, var(--color-codex-bg) 50%, transparent)',
        borderRadius: 'var(--codex-r-md, 6px)',
      }}
    >
      <div
        className="inline-flex items-center gap-2"
        style={{
          padding: '8px 12px',
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-sm, 3px)',
          color: 'var(--color-codex-ink-soft)',
          fontSize: 12.5,
          boxShadow: '0 8px 22px color-mix(in oklch, var(--color-codex-ink) 8%, transparent)',
        }}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {isZh ? '正在更新列表' : 'Updating list'}
      </div>
    </div>
  )
}

function KnowledgeLoading({ isZh }: { isZh: boolean }) {
  return (
    <>
      <PageTitle title={isZh ? '知识库' : 'Knowledge'} />
      <main className="theme-codex min-h-full" style={{ background: 'var(--color-codex-bg)', color: 'var(--color-codex-ink)' }}>
        <CxTopProgress />
        <div className="grid min-h-[calc(100vh-56px)] grid-cols-[236px_minmax(0,1fr)]">
          <aside className="border-r" style={{ borderColor: 'var(--color-codex-line)', padding: '22px 14px 22px 28px' }}>
            {Array.from({ length: 8 }).map((_, index) => (
              <CxSkeleton key={index} w="100%" h={index === 1 ? 1 : 30} style={{ marginBottom: 9 }} />
            ))}
          </aside>
          <div style={{ padding: '26px clamp(24px, 4vw, 48px)' }}>
            <CxSkeleton w="100%" h={52} />
            <div className="mt-5 flex gap-2">
              <CxSkeleton w={240} h={36} />
              <CxSkeleton w={74} h={30} />
              <CxSkeleton w={74} h={30} />
              <CxSkeleton w={74} h={30} />
            </div>
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="grid items-center gap-3" style={{ gridTemplateColumns: MANAGE_GRID, padding: '14px 6px', borderTop: '1px solid var(--color-codex-line-soft)' }}>
                <CxSkeleton h={14} />
                <CxSkeleton h={30} />
                <CxSkeleton h={34} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
                <CxSkeleton h={14} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
