import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  File,
  FileText,
  Folder,
  Layers,
  Loader2,
  MoreHorizontal,
  Plus,
  Quote,
  Search,
  Sparkles,
  Tag,
  X,
} from 'lucide-react'

import { api } from '../../api/client'
import { CxConfirmDialog, CxPagination, CxSkeleton, CxStatus, CxTopProgress, type CxStatusTone } from '../../components/codex'
import { PageTitle } from '../../components/PageTitle'
import { useToast } from '../../contexts/ToastContext'
import type { KnowledgeDocument as LegacyKnowledgeDocument, KnowledgeStats } from '../../types/api'
import { formatDateOnly, parseAppDateTime } from '../../utils/timezone'

const DOC_PAGE_SIZE = 10
const MANAGE_GRID = '26px 38px minmax(260px,1fr) 190px 104px 70px 84px 22px'
const MANAGE_TABLE_MIN_WIDTH = 1020

const CATEGORY_ORDER = ['all', 'research', 'interview', 'technical', 'methodology', 'weekly', 'general', 'consulting', 'templates']
const FILE_TYPE_FILTERS = [
  { key: 'all', zh: '全部', en: 'All' },
  { key: 'ppt', zh: 'PPT', en: 'PPT' },
  { key: 'word', zh: 'Word', en: 'Word' },
  { key: 'pdf', zh: 'PDF', en: 'PDF' },
  { key: 'excel', zh: 'Excel', en: 'Excel' },
]
const STATUS_FILTERS = [
  { key: 'all', zh: '全部', en: 'All' },
  { key: 'synced', zh: '可用', en: 'Ready' },
  { key: 'processing', zh: '解析中', en: 'Parsing' },
  { key: 'pending', zh: '排队中', en: 'Queued' },
  { key: 'failed', zh: '失败', en: 'Failed' },
]

type KnowledgeViewMode = 'find' | 'manage'
type KnowledgeApiMode = 'v005' | 'legacy'
type KnowledgeVectorStatus = LegacyKnowledgeDocument['vector_status']

interface KnowledgeViewDocument extends LegacyKnowledgeDocument {
  api_mode?: KnowledgeApiMode
  source_id?: number | null
  source_name?: string
  source_type?: string
  scope_type?: string
  scope_id?: number | null
  metadata?: Record<string, unknown>
  error_message?: string | null
  search_snippet?: string
  search_relevance?: number
  heading_path?: string[]
  document_id?: number
  chunk_count?: number
  latest_job?: KnowledgeJobResponseV005 | null
  legacy_document_id?: number | null
  legacy_document_ids?: number[]
}

interface KnowledgeSourceV005 {
  id: number
  name: string
  source_type: string
  scope_type: string
  scope_id?: number | null
  owner_user_id?: number | null
  sync_mode?: string
  include_patterns?: string
  exclude_patterns?: string
  tags?: string
  status?: string
  created_at?: string
  updated_at?: string
}

interface KnowledgeDocumentV005 {
  id: number
  source_id: number
  title: string
  file_name: string
  file_type: string
  path: string
  metadata_json?: string
  file_size_bytes?: number
  page_count?: number
  slide_count?: number
  token_count?: number
  chunk_count?: number
  scope_type: string
  scope_id?: number | null
  status: string
  error_message?: string | null
  created_at?: string
  updated_at?: string
  job_id?: number | null
  latest_job?: KnowledgeJobResponseV005 | null
  legacy_document_id?: number | null
  legacy_document_ids?: number[]
}

interface KnowledgeSearchChunkV005 {
  id: number
  document_id: number
  document_title: string
  document_path: string
  heading_path?: string[]
  content: string
  scope_type: string
  scope_id?: number | null
  source_id: number
  relevance: number
  metadata?: Record<string, unknown>
}

interface KnowledgeSearchResponseV005 {
  chunks: KnowledgeSearchChunkV005[]
  total_found: number
  query_time_ms?: number
  low_confidence?: boolean
  expanded_terms?: string[]
  scope_used?: Record<string, unknown>
}

interface KnowledgeJobResponseV005 {
  job_id?: number | string
  id?: number | string
  job_type?: string
  status?: string
  attempt?: number
  max_attempts?: number
  failure_code?: string
  retryable?: boolean
  error_message?: string
  next_attempt_at?: string | null
  checkpoint?: {
    phase?: string
    document_phase?: string
    completed_document_count?: number
    current_document_id?: number | null
    current_legacy_document_id?: number | null
    migrated_document_count?: number
    skipped_document_count?: number
    failed_document_count?: number
  }
}

interface LegacyMigrationPreview {
  version: string
  plan_hash: string
  total: number
  ready: number
  migrated: number
  blocked: number
  has_more?: boolean
  active_job?: KnowledgeJobResponseV005 | null
}

interface KnowledgeLoadResult {
  mode: KnowledgeApiMode
  data: KnowledgeDocumentListResponse
  stats: KnowledgeStats
  sources?: KnowledgeSourceV005[]
}

interface KnowledgeCategoryCount {
  category: string
  count: number
}

interface KnowledgeStatusCount {
  status: KnowledgeViewDocument['vector_status']
  count: number
}

interface KnowledgeFileTypeCount {
  file_type: string
  count: number
}

interface KnowledgeDocumentListResponse {
  items: KnowledgeViewDocument[]
  total: number
  limit: number
  offset: number
  categories: KnowledgeCategoryCount[]
  status_counts?: KnowledgeStatusCount[]
  file_type_counts?: KnowledgeFileTypeCount[]
  recent: KnowledgeViewDocument[]
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
    consulting_case: { zh: '咨询案例', en: 'Consulting cases' },
    deliverable_template: { zh: '交付模板', en: 'Deliverable templates' },
    manual_upload: { zh: '手动上传', en: 'Manual upload' },
    markdown_folder: { zh: '文件夹同步', en: 'Folder sync' },
    obsidian_vault: { zh: 'Obsidian', en: 'Obsidian' },
    project_space: { zh: '项目导入', en: 'Project import' },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeArrayResponse<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (isRecord(value) && Array.isArray(value.items)) return value.items as T[]
  if (isRecord(value) && Array.isArray(value.sources)) return value.sources as T[]
  if (isRecord(value) && Array.isArray(value.documents)) return value.documents as T[]
  if (isRecord(value) && Array.isArray(value.templates)) return value.templates as T[]
  return []
}

function parseMetadata(raw?: string | Record<string, unknown> | null): Record<string, unknown> {
  if (!raw) return {}
  if (isRecord(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function firstString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    const found = value.find((item) => typeof item === 'string' && item.trim())
    return typeof found === 'string' ? found.trim() : ''
  }
  return ''
}

function sourceTags(source?: KnowledgeSourceV005) {
  return (source?.tags || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function categoryFromV005(doc: KnowledgeDocumentV005, source?: KnowledgeSourceV005) {
  const metadata = parseMetadata(doc.metadata_json)
  const explicit =
    firstString(metadata.template_key) ||
    firstString(metadata.document_type) ||
    firstString(metadata.service_lines) ||
    firstString(metadata.industries)
  if (explicit) return explicit
  const tags = sourceTags(source)
  return tags[0] || source?.source_type || 'general'
}

function mapV005Status(status: string): KnowledgeVectorStatus {
  const normalized = (status || '').toLowerCase()
  if (normalized === 'indexed') return 'synced'
  if (normalized === 'failed' || normalized === 'failed_extract' || normalized === 'error') return 'failed'
  if (['extracting', 'extracted', 'understanding', 'chunking', 'embedding', 'indexing', 'retrying'].includes(normalized)) {
    return 'processing'
  }
  return 'pending'
}

function mapV005Document(doc: KnowledgeDocumentV005, source?: KnowledgeSourceV005): KnowledgeViewDocument {
  const metadata = parseMetadata(doc.metadata_json)
  const updatedAt = doc.updated_at || doc.created_at || new Date(0).toISOString()
  return {
    id: doc.id,
    api_mode: 'v005',
    name: doc.file_name || doc.title,
    file_type: doc.file_type,
    path: doc.path,
    category: categoryFromV005(doc, source),
    project_id: doc.scope_type === 'project' ? doc.scope_id ?? null : null,
    client_id: doc.scope_type === 'client' ? doc.scope_id ?? null : null,
    size_bytes: doc.file_size_bytes,
    vector_status: mapV005Status(doc.status),
    uploaded_at: updatedAt,
    source_id: doc.source_id,
    source_name: source?.name,
    source_type: source?.source_type,
    scope_type: doc.scope_type,
    scope_id: doc.scope_id ?? null,
    metadata,
    error_message: doc.error_message,
    chunk_count: doc.chunk_count,
    latest_job: doc.latest_job,
    legacy_document_id: doc.legacy_document_id ?? null,
    legacy_document_ids: doc.legacy_document_ids || [],
  }
}

function mapV005SearchChunk(chunk: KnowledgeSearchChunkV005, sources: KnowledgeSourceV005[]): KnowledgeViewDocument {
  const source = sources.find((item) => item.id === chunk.source_id)
  const metadata = chunk.metadata || {}
  const pathParts = chunk.document_path.split(/[\\/]/)
  const fileName = pathParts[pathParts.length - 1] || chunk.document_title
  return {
    id: chunk.id || chunk.document_id,
    api_mode: 'v005',
    document_id: chunk.document_id,
    name: chunk.document_title || fileName,
    file_type: fileName.includes('.') ? fileName.split('.').pop() || 'doc' : 'doc',
    path: chunk.document_path,
    category: firstString(metadata.template_key) || firstString(metadata.document_type) || source?.source_type || 'general',
    project_id: chunk.scope_type === 'project' ? chunk.scope_id ?? null : null,
    client_id: chunk.scope_type === 'client' ? chunk.scope_id ?? null : null,
    vector_status: 'synced',
    uploaded_at: new Date().toISOString(),
    source_id: chunk.source_id,
    source_name: source?.name,
    source_type: source?.source_type,
    scope_type: chunk.scope_type,
    scope_id: chunk.scope_id ?? null,
    metadata,
    search_snippet: chunk.content,
    search_relevance: chunk.relevance,
    heading_path: chunk.heading_path || [],
  }
}

function mapLegacyDocument(doc: LegacyKnowledgeDocument): KnowledgeViewDocument {
  return {
    ...doc,
    // Keep legacy and V0.0.5 primary-key spaces distinct in React state while
    // retaining the real legacy id for API operations.
    id: -Math.abs(doc.id),
    document_id: doc.id,
    api_mode: 'legacy',
  }
}

function filterDocuments(
  documents: KnowledgeViewDocument[],
  {
    category,
    fileType,
    query,
    status,
  }: {
    category: string
    fileType: string
    query: string
    status: string
  },
) {
  const keyword = query.trim().toLowerCase()
  return documents.filter((doc) => {
    if (category !== 'all' && normalizeCategory(doc.category) !== category) return false
    if (fileType !== 'all') {
      const typeValues = fileTypeValues(fileType)
      if (!typeValues.includes((doc.file_type || '').toLowerCase())) return false
    }
    if (status !== 'all' && doc.vector_status !== status) return false
    if (keyword) {
      const haystack = [
        doc.name,
        doc.path,
        doc.category,
        doc.source_name,
        doc.source_type,
        doc.scope_type,
        doc.search_snippet,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })
}

function fileTypeValues(key: string) {
  if (key === 'ppt') return ['ppt', 'pptx']
  if (key === 'word') return ['doc', 'docx']
  if (key === 'excel') return ['xls', 'xlsx']
  return [key]
}

function paginateDocuments(documents: KnowledgeViewDocument[], page: number, pageSize: number) {
  const offset = (page - 1) * pageSize
  return documents.slice(offset, offset + pageSize)
}

function buildCounts(documents: KnowledgeViewDocument[]) {
  const categoryMap = new Map<string, number>()
  const statusMap = new Map<KnowledgeVectorStatus, number>()
  const fileTypeMap = new Map<string, number>()
  documents.forEach((doc) => {
    const category = normalizeCategory(doc.category)
    categoryMap.set(category, (categoryMap.get(category) || 0) + 1)
    statusMap.set(doc.vector_status, (statusMap.get(doc.vector_status) || 0) + 1)
    const normalizedFileType = (doc.file_type || 'other').toLowerCase()
    fileTypeMap.set(normalizedFileType, (fileTypeMap.get(normalizedFileType) || 0) + 1)
  })
  return {
    categories: [...categoryMap.entries()].map(([category, count]) => ({ category, count })),
    status_counts: [...statusMap.entries()].map(([status, count]) => ({ status, count })),
    file_type_counts: [...fileTypeMap.entries()].map(([file_type, count]) => ({ file_type, count })),
  }
}

function fileType(value: string) {
  const type = value?.trim().replace(/^\./, '').toUpperCase()
  return type || 'DOC'
}

function fileTypeFilterCount(counts: KnowledgeFileTypeCount[], key: string) {
  const normalized = counts.reduce<Record<string, number>>((map, item) => {
    map[item.file_type.toLowerCase()] = item.count
    return map
  }, {})
  if (key === 'ppt') return (normalized.ppt || 0) + (normalized.pptx || 0)
  if (key === 'word') return (normalized.doc || 0) + (normalized.docx || 0)
  if (key === 'excel') return (normalized.xls || 0) + (normalized.xlsx || 0)
  if (key === 'pdf') return normalized.pdf || 0
  return Object.values(normalized).reduce((sum, value) => sum + value, 0)
}

function docSizeBytes(doc: KnowledgeViewDocument) {
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

function knowledgeJobProgress(job?: KnowledgeJobResponseV005 | null) {
  const phase = job?.checkpoint?.document_phase || job?.checkpoint?.phase || ''
  return {
    queued: 8,
    extracting: 22,
    extracted: 35,
    understood: 52,
    chunks_ready: 68,
    embedding: 84,
    indexed: 96,
    syncing: 48,
  }[phase]
}

function statusMeta(status: KnowledgeViewDocument['vector_status'], isZh: boolean, job?: KnowledgeJobResponseV005 | null): { label: string; tone: CxStatusTone; pulse?: boolean; progress?: number } {
  if (status === 'synced') return { label: isZh ? '可用' : 'Ready', tone: 'good' }
  if (status === 'failed') return { label: isZh ? '失败' : 'Failed', tone: 'bad' }
  if (status === 'processing') return { label: isZh ? '解析中' : 'Parsing', tone: 'accent', pulse: true, progress: knowledgeJobProgress(job) || 48 }
  return { label: isZh ? '排队中' : 'Queued', tone: 'warn', pulse: true }
}

function sourceLabel(doc: KnowledgeViewDocument, isZh: boolean) {
  if (doc.source_name) return doc.source_name
  if (doc.project_id) return isZh ? `项目 · #${doc.project_id}` : `Project · #${doc.project_id}`
  if (doc.client_id) return isZh ? `客户 · #${doc.client_id}` : `Client · #${doc.client_id}`
  if (doc.scope_type === 'workspace') return isZh ? '公司共享' : 'Workspace'
  return categoryLabel(normalizeCategory(doc.category), isZh)
}

function resultScore(doc: KnowledgeViewDocument, index: number) {
  if (typeof doc.search_relevance === 'number') return Math.max(0, Math.min(1, doc.search_relevance))
  if (doc.vector_status === 'failed') return 0.62
  if (doc.vector_status === 'processing' || doc.vector_status === 'pending') return 0.7
  return Math.max(0.72, 0.94 - index * 0.04)
}

function scoreColor(score: number) {
  if (score >= 0.85) return 'var(--color-codex-good)'
  if (score >= 0.7) return 'var(--color-codex-accent)'
  return 'var(--color-codex-warn)'
}

function isHttpStatus(error: unknown, status: number) {
  return isRecord(error) && isRecord(error.response) && error.response.status === status
}

function isActiveKnowledgeJob(job?: KnowledgeJobResponseV005 | null) {
  return ['queued', 'running', 'retrying'].includes((job?.status || '').toLowerCase())
}

async function fetchLegacyMigrationPreview(): Promise<LegacyMigrationPreview | null> {
  try {
    const response = await api.get<LegacyMigrationPreview>('/knowledge/migrations/legacy/preview')
    return response && typeof response.plan_hash === 'string' ? response : null
  } catch (error) {
    if (isHttpStatus(error, 403) || isHttpStatus(error, 404)) return null
    throw error
  }
}

async function fetchKnowledgeLegacy({
  category,
  fileType,
  page,
  pageSize,
  query,
  status,
}: {
  category: string
  fileType: string
  page: number
  pageSize: number
  query: string
  status: string
}): Promise<KnowledgeLoadResult> {
  const [docsData, statsData] = await Promise.all([
    api.get<KnowledgeDocumentListResponse>('/knowledge/documents/list', {
      params: {
        search: query.trim(),
        category,
        file_type: fileType,
        status,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
    }),
    api.get<KnowledgeStats>('/knowledge/stats'),
  ])
  return {
    mode: 'legacy',
    data: {
      ...docsData,
      indexed_count: docsData.indexed_count ?? statsData.total_vectors,
    },
    stats: statsData,
  }
}

async function fetchKnowledgeV005({
  category,
  fileType,
  page,
  pageSize,
  query,
  status,
  viewMode,
}: {
  category: string
  fileType: string
  page: number
  pageSize: number
  query: string
  status: string
  viewMode: KnowledgeViewMode
}): Promise<KnowledgeLoadResult> {
  const rawSources = await api.get<unknown>('/knowledge/sources')
  const sources = normalizeArrayResponse<KnowledgeSourceV005>(rawSources)
  const [sourceDocuments, rawLegacyDocuments] = await Promise.all([
    Promise.all(
      sources.map(async (source) => {
        const rawDocuments = await api.get<unknown>(`/knowledge/sources/${source.id}/documents`)
        return normalizeArrayResponse<KnowledgeDocumentV005>(rawDocuments)
          .filter((doc) => doc.status !== 'deleted')
          .map((doc) => mapV005Document(doc, source))
      }),
    ),
    api.get<unknown>('/knowledge/documents').catch(() => []),
  ])
  const v005Documents = sourceDocuments.flat()
  const migratedLegacyIds = new Set(
    v005Documents
      .flatMap((document) => [
        ...(document.legacy_document_ids || []),
        document.legacy_document_id,
      ])
      .filter((documentId): documentId is number => typeof documentId === 'number'),
  )
  const legacyDocuments = normalizeArrayResponse<LegacyKnowledgeDocument>(rawLegacyDocuments)
    .filter((document) => !migratedLegacyIds.has(document.id))
    .map(mapLegacyDocument)
  const allDocuments = [...v005Documents, ...legacyDocuments]
  const queryText = query.trim()
  let visibleDocuments = filterDocuments(allDocuments, {
    category,
    fileType,
    query: viewMode === 'find' && queryText ? '' : query,
    status,
  })

  if (viewMode === 'find' && queryText) {
    const searchData = await api.post<KnowledgeSearchResponseV005>('/knowledge/search', {
      query: queryText,
      scope_types: ['workspace', 'project', 'client'],
      top_k: Math.max(page * pageSize, pageSize),
    })
    const semanticDocuments = searchData.chunks.map((chunk) => mapV005SearchChunk(chunk, sources))
    const matchingLegacyDocuments = filterDocuments(legacyDocuments, {
      category,
      fileType,
      query: queryText,
      status,
    })
    visibleDocuments = [...semanticDocuments, ...matchingLegacyDocuments]
    if (category !== 'all' || fileType !== 'all' || status !== 'all') {
      visibleDocuments = filterDocuments(visibleDocuments, {
        category,
        fileType,
        query: '',
        status,
      })
    }
  }

  const counts = buildCounts(allDocuments)
  const totalSize = allDocuments.reduce((sum, doc) => sum + (docSizeBytes(doc) || 0), 0)
  return {
    mode: 'v005',
    sources,
    stats: {
      document_count: allDocuments.length,
      total_vectors: allDocuments.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0),
    },
    data: {
      items: paginateDocuments(visibleDocuments, page, pageSize),
      total: visibleDocuments.length,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      categories: counts.categories,
      status_counts: counts.status_counts,
      file_type_counts: counts.file_type_counts,
      recent: [...allDocuments].sort((a, b) => parseAppDateTime(b.uploaded_at).getTime() - parseAppDateTime(a.uploaded_at).getTime()).slice(0, 5),
      indexed_count: allDocuments.filter((doc) => doc.vector_status === 'synced').length,
      total_size: totalSize,
    },
  }
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
  const [documents, setDocuments] = useState<KnowledgeViewDocument[]>([])
  const [apiMode, setApiMode] = useState<KnowledgeApiMode>('v005')
  const [sources, setSources] = useState<KnowledgeSourceV005[]>([])
  const [documentTotal, setDocumentTotal] = useState(0)
  const [categoryCounts, setCategoryCounts] = useState<KnowledgeCategoryCount[]>([])
  const [statusCounts, setStatusCounts] = useState<KnowledgeStatusCount[]>([])
  const [fileTypeCounts, setFileTypeCounts] = useState<KnowledgeFileTypeCount[]>([])
  const [recentDocuments, setRecentDocuments] = useState<KnowledgeViewDocument[]>([])
  const [indexedCount, setIndexedCount] = useState(0)
  const [totalSize, setTotalSize] = useState(0)
  const [stats, setStats] = useState<KnowledgeStats>({ document_count: 0, total_vectors: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedFileType, setSelectedFileType] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const uploadCategory = 'general'
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [documentPage, setDocumentPage] = useState(1)
  const [documentPageSize, setDocumentPageSize] = useState(DOC_PAGE_SIZE)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reindexingId, setReindexingId] = useState<number | null>(null)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<number[]>([])
  const [legacyMigration, setLegacyMigration] = useState<LegacyMigrationPreview | null>(null)
  const [startingMigration, setStartingMigration] = useState(false)
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
      let result: KnowledgeLoadResult
      try {
        result = await fetchKnowledgeV005({
          category: selectedCategory,
          fileType: selectedFileType,
          page: documentPage,
          pageSize: documentPageSize,
          query: searchQuery,
          status: selectedStatus,
          viewMode,
        })
      } catch (v005Error) {
        if (!isHttpStatus(v005Error, 404) && !isHttpStatus(v005Error, 405)) throw v005Error
        result = await fetchKnowledgeLegacy({
          category: selectedCategory,
          fileType: selectedFileType,
          page: documentPage,
          pageSize: documentPageSize,
          query: searchQuery,
          status: selectedStatus,
        })
      }
      const docsData = result.data
      setDocuments(docsData.items)
      setApiMode(result.mode)
      setSources(result.sources || [])
      setDocumentTotal(docsData.total)
      setCategoryCounts(docsData.categories)
      setStatusCounts(docsData.status_counts || [])
      setFileTypeCounts(docsData.file_type_counts || [])
      setRecentDocuments(docsData.recent)
      setIndexedCount(docsData.indexed_count)
      setTotalSize(docsData.total_size)
      setStats(result.stats)
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
  }, [documentPage, documentPageSize, searchQuery, selectedCategory, selectedFileType, selectedStatus, viewMode])

  useEffect(() => {
    setDocumentPage(1)
  }, [searchQuery, selectedCategory, selectedFileType, selectedStatus])

  const refreshLegacyMigration = async () => {
    try {
      setLegacyMigration(await fetchLegacyMigrationPreview())
    } catch (migrationError) {
      console.warn('Failed to load legacy knowledge migration preview:', migrationError)
    }
  }

  useEffect(() => {
    if (viewMode !== 'manage') return
    void refreshLegacyMigration()
  }, [viewMode])

  useEffect(() => {
    if (!isActiveKnowledgeJob(legacyMigration?.active_job)) return undefined
    const timer = window.setInterval(() => {
      void refreshLegacyMigration()
      void fetchData({ silent: true })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [legacyMigration?.active_job?.job_id, legacyMigration?.active_job?.status])

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
  const statusCountMap = useMemo(() => {
    if (statusCounts.length) {
      return statusCounts.reduce<Record<string, number>>((counts, item) => {
        counts[item.status] = item.count
        return counts
      }, {})
    }
    return documents.reduce<Record<string, number>>((counts, doc) => {
      counts[doc.vector_status] = (counts[doc.vector_status] || 0) + 1
      return counts
    }, {})
  }, [documents, statusCounts])
  const processingCount = (statusCountMap.processing || 0) + (statusCountMap.pending || 0)
  const failedCount = statusCountMap.failed || 0
  const selectedDocumentCount = selectedDocumentIds.length
  const fetchDataRef = useRef(fetchData)
  fetchDataRef.current = fetchData

  useEffect(() => {
    if (!hasLoaded || apiMode !== 'v005' || processingCount === 0) return undefined
    const timer = window.setInterval(() => {
      void fetchDataRef.current({ silent: true })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [apiMode, hasLoaded, processingCount])

  useEffect(() => {
    setSelectedDocumentIds((ids) => ids.filter((id) => documents.some((doc) => doc.id === id)))
  }, [documents])

  const ensureManualUploadSource = async () => {
    const existing = sources.find((source) => source.source_type === 'manual_upload' && source.scope_type === 'workspace')
    if (existing?.id) return existing.id
    const source = await api.post<KnowledgeSourceV005>('/knowledge/sources', {
      name: isZh ? '公司共享知识库' : 'Company shared knowledge',
      source_type: 'manual_upload',
      scope_type: 'workspace',
      tags: 'general,manual',
    })
    setSources((current) => [...current, source])
    return source.id
  }

  const syncKnowledgeSources = async () => {
    if (apiMode !== 'v005') {
      await fetchData({ silent: true })
      return
    }
    const syncableSources = sources.filter((source) => ['markdown_folder', 'obsidian_vault', 'git_repo'].includes(source.source_type))
    if (!syncableSources.length) {
      await fetchData({ silent: true })
      return
    }
    setRefreshing(true)
    try {
      await Promise.all(syncableSources.map((source) => api.post<KnowledgeJobResponseV005>(`/knowledge/sources/${source.id}/sync`)))
      toast.success({ title: isZh ? '已开始同步' : 'Sync started', description: isZh ? '文件夹来源会在后台扫描并更新索引。' : 'Folder sources will be scanned and indexed in the background.' })
      await fetchData({ silent: true })
    } catch (err) {
      console.error('Failed to sync knowledge sources:', err)
      toast.error({ title: isZh ? '同步失败' : 'Sync failed' })
    } finally {
      setRefreshing(false)
    }
  }

  const startLegacyMigration = async () => {
    if (!legacyMigration || legacyMigration.ready <= 0 || startingMigration) return
    setStartingMigration(true)
    try {
      const job = await api.post<KnowledgeJobResponseV005>('/knowledge/migrations/legacy', {
        plan_hash: legacyMigration.plan_hash,
        batch_size: Math.min(100, legacyMigration.ready),
      })
      setLegacyMigration((current) => (current ? { ...current, active_job: job } : current))
      toast.success({
        title: isZh ? '历史知识升级已开始' : 'Legacy knowledge migration started',
        description: isZh ? '旧记录和原始文件会继续保留。' : 'Legacy records and original files remain intact.',
      })
      await refreshLegacyMigration()
      await fetchData({ silent: true })
    } catch (migrationError) {
      console.error('Failed to start legacy knowledge migration:', migrationError)
      toast.error({ title: isZh ? '历史知识升级启动失败' : 'Could not start legacy migration' })
      await refreshLegacyMigration()
    } finally {
      setStartingMigration(false)
    }
  }

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', uploadCategory)

      if (apiMode === 'v005') {
        try {
          const sourceId = await ensureManualUploadSource()
          await api.post<KnowledgeDocumentV005 | KnowledgeJobResponseV005>(`/knowledge/sources/${sourceId}/documents`, formData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          })
        } catch (v005Error) {
          if (!isHttpStatus(v005Error, 404) && !isHttpStatus(v005Error, 405)) throw v005Error
          await api.post('/knowledge/documents', formData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          })
          setApiMode('legacy')
        }
      } else {
        await api.post('/knowledge/documents', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        })
      }
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
      const pendingDocument = documents.find((doc) => doc.id === pendingDeleteId)
      if (pendingDocument?.api_mode === 'v005' && pendingDocument.source_id) {
        await api.delete(`/knowledge/sources/${pendingDocument.source_id}/documents/${pendingDocument.document_id || pendingDocument.id}`)
      } else {
        await api.delete(`/knowledge/documents/${pendingDocument?.document_id || pendingDeleteId}`)
      }
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

  const reindexDocument = async (doc: KnowledgeViewDocument) => {
    setReindexingId(doc.id)
    try {
      if (doc.api_mode === 'v005' && doc.source_id) {
        const jobId = doc.latest_job?.job_id || doc.latest_job?.id
        if (jobId && doc.latest_job?.status === 'failed' && doc.latest_job.retryable) {
          await api.post<KnowledgeJobResponseV005>(`/knowledge/jobs/${jobId}/retry`)
        } else {
          await api.post<KnowledgeJobResponseV005>(`/knowledge/sources/${doc.source_id}/documents/${doc.document_id || doc.id}/reindex`)
        }
      } else {
        await api.post(`/knowledge/documents/${doc.document_id || doc.id}/reindex`)
      }
      toast.success({ title: isZh ? '已重新排队' : 'Reindex queued', description: isZh ? '系统会重新解析并索引这份文件。' : 'Aria will parse and index this file again.' })
      await fetchData({ silent: true })
    } catch (err) {
      console.error('Failed to reindex document:', err)
      toast.error({ title: isZh ? '重新处理失败' : 'Reindex failed' })
    } finally {
      setReindexingId(null)
    }
  }

  const copyCitation = async (doc: KnowledgeViewDocument) => {
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

        {viewMode === 'manage' && legacyMigration ? (
          <LegacyMigrationBanner
            isZh={isZh}
            migration={legacyMigration}
            onStart={() => void startLegacyMigration()}
            starting={startingMigration}
          />
        ) : null}

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
            fileTypeCounts={fileTypeCounts}
            isZh={isZh}
            latestDoc={latestDoc}
            onCategoryChange={(category) => {
              setSelectedCategory(category)
              setDocumentPage(1)
            }}
            onClear={() => {
              setSearchQuery('')
              setSelectedCategory('all')
              setSelectedFileType('all')
              setSelectedStatus('all')
              setDocumentPage(1)
            }}
            onCopyCitation={(doc) => void copyCitation(doc)}
            onPageChange={setDocumentPage}
            onPageSizeChange={(nextPageSize) => {
              setDocumentPageSize(nextPageSize)
              setDocumentPage(1)
            }}
            onReindex={(doc) => void reindexDocument(doc)}
            onUpload={() => fileInputRef.current?.click()}
            reindexingId={reindexingId}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
            selectedFileType={selectedFileType}
            setSearchQuery={(value) => {
              setSearchQuery(value)
              setDocumentPage(1)
            }}
            setSelectedFileType={(value) => {
              setSelectedFileType(value)
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
            fileTypeCounts={fileTypeCounts}
            indexedCount={indexedCount}
            isZh={isZh}
            onCategoryChange={(category) => {
              setSelectedCategory(category)
              setDocumentPage(1)
            }}
            onClear={() => {
              setSearchQuery('')
              setSelectedCategory('all')
              setSelectedFileType('all')
              setSelectedStatus('all')
              setDocumentPage(1)
            }}
            onDelete={(doc) => setPendingDeleteId(doc.id)}
            onPageChange={setDocumentPage}
            onPageSizeChange={(nextPageSize) => {
              setDocumentPageSize(nextPageSize)
              setDocumentPage(1)
            }}
            onRefresh={() => void syncKnowledgeSources()}
            onReindex={(doc) => void reindexDocument(doc)}
            onClearSelection={() => setSelectedDocumentIds([])}
            onToggleSelection={(docId) => {
              setSelectedDocumentIds((ids) => (
                ids.includes(docId) ? ids.filter((id) => id !== docId) : [...ids, docId]
              ))
            }}
            onUpload={() => fileInputRef.current?.click()}
            processingCount={processingCount}
            refreshing={refreshing}
            reindexingId={reindexingId}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
            selectedDocumentCount={selectedDocumentCount}
            selectedDocumentIds={selectedDocumentIds}
            selectedFileType={selectedFileType}
            selectedStatus={selectedStatus}
            setSearchQuery={(value) => {
              setSearchQuery(value)
              setDocumentPage(1)
            }}
            setSelectedFileType={(value) => {
              setSelectedFileType(value)
              setDocumentPage(1)
            }}
            setSelectedStatus={(value) => {
              setSelectedStatus(value)
              setDocumentPage(1)
            }}
            uploading={uploading}
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

function LegacyMigrationBanner({
  isZh,
  migration,
  onStart,
  starting,
}: {
  isZh: boolean
  migration: LegacyMigrationPreview
  onStart: () => void
  starting: boolean
}) {
  const active = isActiveKnowledgeJob(migration.active_job)
  const migratedInJob = migration.active_job?.checkpoint?.migrated_document_count || 0
  const blockedInJob = migration.active_job?.checkpoint?.failed_document_count || 0
  const complete = migration.total > 0 && migration.ready === 0 && migration.blocked === 0

  return (
    <section
      className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
      style={{
        borderColor: 'var(--color-codex-line)',
        background: 'var(--color-codex-surface)',
      }}
      aria-label={isZh ? '历史知识升级' : 'Legacy knowledge migration'}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg"
          style={{ background: 'var(--color-codex-accent-soft)', color: 'var(--color-codex-accent)' }}
        >
          {active ? <Loader2 size={15} className="animate-spin" /> : <Layers size={15} />}
        </div>
        <div className="min-w-0">
          <div className="font-medium" style={{ color: 'var(--color-codex-ink)' }}>
            {isZh ? '历史知识升级' : 'Legacy knowledge migration'}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: 'var(--color-codex-ink-muted)' }}>
            {active
              ? (isZh
                ? `正在升级，已完成 ${migratedInJob} 份，需处理 ${blockedInJob} 份。`
                : `Migration running: ${migratedInJob} completed, ${blockedInJob} need attention.`)
              : complete
                ? (isZh ? `历史文档已全部进入新知识体系，共 ${migration.migrated} 份。` : `All ${migration.migrated} legacy documents are on the source-scoped model.`)
                : (isZh
                  ? `${migration.ready} 份可升级，${migration.migrated} 份已完成，${migration.blocked} 份需先处理。旧记录和原文件不会删除。`
                  : `${migration.ready} ready, ${migration.migrated} migrated, ${migration.blocked} need attention. Legacy records and files are preserved.`)}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: 'var(--color-codex-accent)', color: 'white' }}
        disabled={active || starting || migration.ready <= 0}
        onClick={onStart}
      >
        {active || starting ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
        {active
          ? (isZh ? '升级中' : 'Migrating')
          : (isZh ? `升级下一批（${Math.min(100, migration.ready)}）` : `Migrate next batch (${Math.min(100, migration.ready)})`)}
      </button>
    </section>
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
  fileTypeCounts,
  isZh,
  latestDoc,
  onCategoryChange,
  onClear,
  onCopyCitation,
  onPageChange,
  onPageSizeChange,
  onReindex,
  onUpload,
  reindexingId,
  searchQuery,
  selectedCategory,
  selectedFileType,
  setSearchQuery,
  setSelectedFileType,
  totalSize,
}: {
  allDocumentCount: number
  categories: string[]
  categoryCounts: KnowledgeCategoryCount[]
  currentDocumentPage: number
  documentListLoading: boolean
  documents: KnowledgeViewDocument[]
  documentPageSize: number
  documentTotal: number
  error: string | null
  fileTypeCounts: KnowledgeFileTypeCount[]
  isZh: boolean
  latestDoc?: KnowledgeViewDocument
  onCategoryChange: (category: string) => void
  onClear: () => void
  onCopyCitation: (doc: KnowledgeViewDocument) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onReindex: (doc: KnowledgeViewDocument) => void
  onUpload: () => void
  reindexingId: number | null
  searchQuery: string
  selectedCategory: string
  selectedFileType: string
  setSearchQuery: (value: string) => void
  setSelectedFileType: (value: string) => void
  totalSize: number
}) {
  const hasSearch = Boolean(searchQuery.trim()) || selectedCategory !== 'all' || selectedFileType !== 'all'
  const topCategories = categoryCounts.slice(0, 5)
  const projectIds = Array.from(new Set(documents.map((doc) => doc.project_id).filter(Boolean))).slice(0, 4)
  const queryLabel = searchQuery.trim()

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
        <FacetBlock title={isZh ? '类型' : 'Type'}>
          {FILE_TYPE_FILTERS.filter((item) => item.key !== 'all').map((item) => (
            <FacetOption
              key={item.key}
              active={selectedFileType === item.key}
              count={fileTypeFilterCount(fileTypeCounts, item.key)}
              label={isZh ? item.zh : item.en}
              onClick={() => setSelectedFileType(selectedFileType === item.key ? 'all' : item.key)}
            />
          ))}
        </FacetBlock>
        <FacetBlock title={isZh ? '行业' : 'Industry'}>
          {categories.filter((category) => category !== 'all').slice(0, 5).map((category) => (
            <FacetOption
              key={category}
              active={selectedCategory === category}
              count={categoryCounts.find((item) => normalizeCategory(item.category) === category)?.count || 0}
              label={categoryLabel(category, isZh)}
              onClick={() => onCategoryChange(selectedCategory === category ? 'all' : category)}
            />
          ))}
        </FacetBlock>
        <FacetBlock title={isZh ? '所属项目' : 'Project'}>
          {projectIds.length ? projectIds.map((projectId) => (
            <FacetReadonly key={projectId} label={isZh ? `项目 · #${projectId}` : `Project · #${projectId}`} count={documents.filter((doc) => doc.project_id === projectId).length} />
          )) : (
            <FacetReadonly label={isZh ? '暂无项目来源' : 'No project source'} count={0} />
          )}
        </FacetBlock>
        <FacetBlock title={isZh ? '标签' : 'Tags'}>
          {topCategories.length ? topCategories.map((item) => (
            <FacetReadonly key={item.category} label={categoryLabel(normalizeCategory(item.category), isZh)} count={item.count} />
          )) : (
            <FacetReadonly label={isZh ? '暂无标签' : 'No tags'} count={0} />
          )}
        </FacetBlock>
        <FacetBlock title={isZh ? '时间范围' : 'Time range'}>
          <FacetReadonly label={isZh ? '最近更新' : 'Recently updated'} count={latestDoc ? 1 : 0} />
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
            <ActiveFilterChip label={selectedCategory !== 'all' ? categoryLabel(selectedCategory, isZh) : categoryLabel('all', isZh)} />
            {selectedFileType !== 'all' ? <ActiveFilterChip label={(isZh ? FILE_TYPE_FILTERS.find((item) => item.key === selectedFileType)?.zh : FILE_TYPE_FILTERS.find((item) => item.key === selectedFileType)?.en) || selectedFileType.toUpperCase()} /> : null}
            <button type="button" className="cx-no-hover inline-flex items-center gap-1.5" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
              {isZh ? '按相关度' : 'By relevance'}
              <ChevronDown size={11} strokeWidth={1.6} aria-hidden="true" />
            </button>
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
              {isZh ? '让 Aria 综合下面这些资料，直接回答你的问题' : 'Ask Aria to synthesize these sources and answer directly'}
            </span>
            <button type="button" className="cx-no-hover inline-flex items-center gap-1.5" style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 500, background: 'var(--color-codex-accent)', color: 'var(--color-codex-bg-elev)', borderRadius: 'var(--codex-r-sm, 3px)' }}>
              {isZh ? '在对话中提问' : 'Ask in chat'}
              <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
            </button>
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
                    query={queryLabel}
                    onCopyCitation={() => onCopyCitation(doc)}
                    onReindex={() => onReindex(doc)}
                    reindexing={reindexingId === doc.id}
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
  fileTypeCounts,
  indexedCount,
  isZh,
  onCategoryChange,
  onClear,
  onDelete,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onReindex,
  onClearSelection,
  onToggleSelection,
  onUpload,
  processingCount,
  refreshing,
  reindexingId,
  searchQuery,
  selectedCategory,
  selectedDocumentCount,
  selectedDocumentIds,
  selectedFileType,
  selectedStatus,
  setSearchQuery,
  setSelectedFileType,
  setSelectedStatus,
  uploading,
}: {
  allDocumentCount: number
  categories: string[]
  categoryCounts: KnowledgeCategoryCount[]
  currentDocumentPage: number
  documentListLoading: boolean
  documents: KnowledgeViewDocument[]
  documentPageSize: number
  documentTotal: number
  error: string | null
  failedCount: number
  fileTypeCounts: KnowledgeFileTypeCount[]
  indexedCount: number
  isZh: boolean
  onCategoryChange: (category: string) => void
  onClear: () => void
  onDelete: (doc: KnowledgeViewDocument) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onRefresh: () => void
  onReindex: (doc: KnowledgeViewDocument) => void
  onClearSelection: () => void
  onToggleSelection: (docId: number) => void
  onUpload: () => void
  processingCount: number
  refreshing: boolean
  reindexingId: number | null
  searchQuery: string
  selectedCategory: string
  selectedDocumentCount: number
  selectedDocumentIds: number[]
  selectedFileType: string
  selectedStatus: string
  setSearchQuery: (value: string) => void
  setSelectedFileType: (value: string) => void
  setSelectedStatus: (value: string) => void
  uploading: boolean
}) {
  const hasSearch = Boolean(searchQuery.trim()) || selectedCategory !== 'all' || selectedFileType !== 'all' || selectedStatus !== 'all'
  const projectCount = documents.filter((doc) => doc.project_id).length

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
          {isZh ? '按来源' : 'By source'}
        </div>
        <SourceTreeRow
          count={allDocumentCount}
          icon={<Plus size={13} strokeWidth={1.5} />}
          label={isZh ? '手动上传' : 'Manual upload'}
          onClick={() => onCategoryChange('all')}
        />
        <SourceTreeRow
          count={categoryCounts.reduce((sum, item) => sum + item.count, 0)}
          expandable
          open
          icon={<Folder size={13} strokeWidth={1.5} />}
          label={isZh ? '文件夹同步' : 'Folder sync'}
          onClick={() => onCategoryChange('all')}
        />
        {categories.filter((category) => category !== 'all').slice(0, 4).map((category) => (
          <SourceTreeRow
            key={category}
            active={selectedCategory === category}
            count={categoryCounts.find((item) => normalizeCategory(item.category) === category)?.count || 0}
            indent={1}
            label={categoryLabel(category, isZh)}
            onClick={() => onCategoryChange(category)}
          />
        ))}
        <SourceTreeRow
          count={projectCount}
          expandable
          open
          icon={<Layers size={13} strokeWidth={1.5} />}
          label={isZh ? '项目导入' : 'Project import'}
          onClick={() => onCategoryChange('all')}
        />

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
              <button type="button" onClick={onRefresh} disabled={refreshing} className="cx-no-hover inline-flex items-center gap-1.5" style={ghostButtonStyle}>
                <Folder size={14} strokeWidth={1.5} aria-hidden="true" />
                {refreshing ? (isZh ? '同步中' : 'Syncing') : isZh ? '同步文件夹' : 'Sync folder'}
              </button>
              <button type="button" className="cx-no-hover inline-flex items-center gap-1.5" style={ghostButtonStyle}>
                <Layers size={14} strokeWidth={1.5} aria-hidden="true" />
                {isZh ? '从项目导入' : 'Import projects'}
              </button>
              <button type="button" onClick={onUpload} disabled={uploading} className="cx-primary-action cx-no-hover">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus size={14} strokeWidth={1.7} aria-hidden="true" />}
                {isZh ? '上传文件' : 'Upload file'}
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
              {FILE_TYPE_FILTERS.map((item) => (
                <FilterPill
                  key={item.key}
                  active={selectedFileType === item.key}
                  count={fileTypeFilterCount(fileTypeCounts, item.key)}
                  label={isZh ? item.zh : item.en}
                  onClick={() => setSelectedFileType(item.key)}
                />
              ))}
            </div>
            <label
              className="inline-flex items-center gap-1.5"
              style={{
                padding: '6px 11px',
                fontSize: 12.5,
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-sm, 3px)',
                color: 'var(--color-codex-ink-soft)',
                background: 'var(--color-codex-bg-elev)',
              }}
            >
              <span style={{ color: 'var(--color-codex-ink-faint)' }}>{isZh ? '状态' : 'Status'}</span>
              <select
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
                className="codex-input bg-transparent outline-none"
                style={{ color: 'var(--color-codex-ink)', fontSize: 12.5 }}
              >
                {STATUS_FILTERS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {isZh ? item.zh : item.en}
                  </option>
                ))}
              </select>
            </label>
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

        {selectedDocumentCount > 0 ? (
          <div
            style={{
              margin: '0 clamp(24px, 4vw, 48px)',
              padding: '10px 16px',
              background: 'var(--color-codex-ink)',
              borderRadius: '0 0 var(--codex-r-sm, 3px) var(--codex-r-sm, 3px)',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--color-codex-bg-elev)', fontWeight: 500, whiteSpace: 'nowrap' }}>
              {isZh ? `已选 ${selectedDocumentCount} 项` : `${selectedDocumentCount} selected`}
            </span>
            <div className="flex flex-wrap gap-1">
              <BatchActionButton icon={<Layers size={12} strokeWidth={1.5} />} label={isZh ? '重新索引' : 'Reindex'} />
              <BatchActionButton icon={<Folder size={12} strokeWidth={1.5} />} label={isZh ? '移动到…' : 'Move to...'} />
              <BatchActionButton icon={<Tag size={12} strokeWidth={1.5} />} label={isZh ? '加标签' : 'Tag'} />
              <BatchActionButton icon={<File size={12} strokeWidth={1.5} />} label={isZh ? '下载' : 'Download'} />
              <BatchActionButton danger label={isZh ? '删除' : 'Delete'} />
            </div>
            <button type="button" onClick={onClearSelection} className="cx-no-hover ml-auto" style={{ fontSize: 12, color: 'color-mix(in oklab, var(--color-codex-bg-elev) 55%, transparent)' }}>
              {isZh ? '取消选择' : 'Clear'}
            </button>
          </div>
        ) : null}

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
                      selected={selectedDocumentIds.includes(doc.id)}
                      onDelete={() => onDelete(doc)}
                      onReindex={() => onReindex(doc)}
                      onToggleSelection={() => onToggleSelection(doc.id)}
                      reindexing={reindexingId === doc.id}
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
  selected,
  onDelete,
  onReindex,
  onToggleSelection,
  reindexing,
}: {
  doc: KnowledgeViewDocument
  isZh: boolean
  selected: boolean
  onDelete: () => void
  onReindex: () => void
  onToggleSelection: () => void
  reindexing: boolean
}) {
  const status = statusMeta(doc.vector_status, isZh, doc.latest_job)
  const type = fileType(doc.file_type)
  const source = sourceLabel(doc, isZh)

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
          background: selected ? 'var(--color-codex-bg-tint)' : 'transparent',
        }}
      >
        <button
          type="button"
          onClick={onToggleSelection}
          aria-label={isZh ? `选择 ${doc.name}` : `Select ${doc.name}`}
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            border: selected ? 'none' : '1.5px solid var(--color-codex-line-strong)',
            background: selected ? 'var(--color-codex-accent)' : 'transparent',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <Check size={10} strokeWidth={2.4} style={{ color: 'var(--color-codex-bg-elev)' }} aria-hidden="true" /> : null}
        </button>
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
          <MoreHorizontal size={15} strokeWidth={1.5} aria-hidden="true" />
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
            {doc.latest_job?.error_message || doc.error_message || (isZh ? '当前文件未生成可检索内容。' : 'This file has no searchable content yet.')}
            {doc.latest_job?.attempt ? (
              <span className="codex-mono" style={{ marginLeft: 8, color: 'var(--color-codex-ink-faint)' }}>
                {isZh ? `尝试 ${doc.latest_job.attempt}/${doc.latest_job.max_attempts || '—'}` : `attempt ${doc.latest_job.attempt}/${doc.latest_job.max_attempts || '—'}`}
                {doc.latest_job.failure_code ? ` · ${doc.latest_job.failure_code}` : ''}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={onReindex}
            disabled={reindexing}
            className="cx-no-hover ml-auto inline-flex items-center gap-1.5"
            style={{
              padding: '5px 9px',
              borderRadius: 'var(--codex-r-sm, 3px)',
              color: 'var(--color-codex-accent)',
              fontSize: 11.5,
              fontWeight: 500,
            }}
          >
            {reindexing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {isZh ? '重新处理' : 'Retry'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function SearchResultRow({
  doc,
  index,
  isZh,
  query,
  onCopyCitation,
  onReindex,
  reindexing,
}: {
  doc: KnowledgeViewDocument
  index: number
  isZh: boolean
  query: string
  onCopyCitation: () => void
  onReindex: () => void
  reindexing: boolean
}) {
  const status = statusMeta(doc.vector_status, isZh, doc.latest_job)
  const score = resultScore(doc, index)
  const tone = scoreColor(score)
  const description =
    doc.search_snippet ||
    (doc.vector_status === 'synced'
      ? isZh
        ? '这份文件已进入知识库，可在对话、项目上下文和 Skill 工作流中作为引用资料。'
        : 'This file is indexed and can be reused in conversations, project context, and Skills.'
      : doc.vector_status === 'failed'
        ? isZh
          ? '无法索引：当前文件未生成可检索内容。可以重新处理；如果仍失败，请检查文件是否包含可提取文字。'
          : 'Index failed: this file has no searchable content yet. Retry indexing, or check whether the file contains extractable text.'
        : doc.vector_status === 'processing'
          ? isZh
            ? '文件正在解析和索引，完成后会出现在可引用知识中。'
            : 'This file is being parsed and indexed before it becomes citable.'
          : isZh
            ? '文件已排队，等待后台解析和索引。'
            : 'This file is queued for background parsing and indexing.')

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
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span className="codex-num" style={{ fontSize: 11, fontWeight: 600, color: tone }}>{score.toFixed(2)}</span>
            <span style={{ width: 34, height: 3, background: 'var(--color-codex-bg-sunken)', borderRadius: 99 }}>
              <span style={{ display: 'block', width: `${score * 100}%`, height: '100%', background: tone, borderRadius: 99 }} />
            </span>
          </span>
          <CxStatus tone={status.tone} pulse={status.pulse}>{status.label}</CxStatus>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2" style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
          <span>{sourceLabel(doc, isZh)}</span>
          <span style={{ color: 'var(--color-codex-ink-faint)' }}>·</span>
          <TagChip>{fileType(doc.file_type)}</TagChip>
          {doc.heading_path?.length ? (
            <span className="codex-mono" style={{ color: 'var(--color-codex-ink-faint)' }}>
              {doc.heading_path.join(' / ')}
            </span>
          ) : null}
          <span className="codex-mono" style={{ color: 'var(--color-codex-ink-faint)' }}>{isZh ? '正文' : 'Body'}</span>
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
          <span>{description}</span>
          {doc.vector_status === 'synced' && query ? (
            <>
              {' '}
              <span style={{ background: 'var(--color-codex-accent-bg)', color: 'var(--color-codex-accent-ink)', borderRadius: 2, padding: '0 2px', fontWeight: 500 }}>{query}</span>
            </>
          ) : null}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4" style={{ paddingLeft: 13 }}>
          <button type="button" className="cx-no-hover inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-codex-ink)', fontWeight: 500 }}>
            <File size={12} strokeWidth={1.5} aria-hidden="true" />
            {isZh ? '打开原文' : 'Open source'}
          </button>
          {doc.vector_status === 'synced' ? (
            <button type="button" onClick={onCopyCitation} className="cx-no-hover inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
              <Quote size={12} strokeWidth={1.5} aria-hidden="true" />
              {isZh ? '复制引用' : 'Copy citation'}
            </button>
          ) : null}
          {doc.vector_status === 'failed' ? (
            <button
              type="button"
              onClick={onReindex}
              disabled={reindexing}
              className="cx-no-hover inline-flex items-center gap-1.5"
              style={{ fontSize: 12, color: 'var(--color-codex-accent)', fontWeight: 500 }}
            >
              {reindexing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {isZh ? '重新处理' : 'Retry indexing'}
            </button>
          ) : null}
          <button type="button" className="cx-no-hover inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-codex-accent)' }}>
            <Sparkles size={12} strokeWidth={1.5} aria-hidden="true" />
            {isZh ? '在对话中追问' : 'Ask follow-up'}
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

function BatchActionButton({ danger, icon, label }: { danger?: boolean; icon?: ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="cx-no-hover inline-flex items-center gap-1.5"
      style={{
        padding: '5px 11px',
        fontSize: 12,
        color: danger ? 'color-mix(in oklab, var(--color-codex-bad) 72%, var(--color-codex-bg-elev))' : 'color-mix(in oklab, var(--color-codex-bg-elev) 85%, transparent)',
        borderRadius: 'var(--codex-r-sm, 3px)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function ActiveFilterChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        padding: '3px 9px',
        borderRadius: 'var(--codex-r-pill, 999px)',
        background: 'var(--color-codex-bg-tint)',
        color: 'var(--color-codex-ink-soft)',
        fontSize: 11.5,
      }}
    >
      {label}
      <Plus size={10} strokeWidth={2} style={{ transform: 'rotate(45deg)', color: 'var(--color-codex-ink-faint)' }} aria-hidden="true" />
    </span>
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
  expandable,
  indent = 0,
  icon,
  label,
  onClick,
  open,
}: {
  active?: boolean
  count: number
  expandable?: boolean
  indent?: number
  icon?: ReactNode
  label: string
  onClick: () => void
  open?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-hov cx-no-hover relative flex w-full items-center gap-2"
      style={{
        padding: '7px 10px',
        paddingLeft: 10 + indent * 18,
        borderRadius: 'var(--codex-r-sm, 3px)',
        background: active ? 'var(--color-codex-bg-tint)' : 'transparent',
      }}
    >
      {active ? <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 2, background: 'var(--color-codex-accent)', borderRadius: 99 }} /> : null}
      {expandable ? <ChevronDown size={11} strokeWidth={1.6} style={{ color: 'var(--color-codex-ink-faint)', transform: open ? 'none' : 'rotate(-90deg)' }} aria-hidden="true" /> : null}
      {icon ? <span style={{ color: active ? 'var(--color-codex-ink-soft)' : 'var(--color-codex-ink-mute)', flexShrink: 0 }}>{icon}</span> : null}
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
