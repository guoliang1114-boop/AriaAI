import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  BookOpen, 
  Upload, 
  Search, 
  Trash2, 
  FileText, 
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Database,
  Filter,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { KnowledgeDocument, KnowledgeStats } from '../../types/api'
import type { VectorStatus } from '../../types/enums'
import { formatDateOnly } from '../../utils/timezone'

const fileTypeIcons: Record<string, string> = {
  pdf: 'bg-red-50 text-red-500',
  docx: 'bg-blue-50 text-blue-500',
  doc: 'bg-blue-50 text-blue-500',
  txt: 'bg-gray-50 text-gray-500',
  md: 'bg-gray-50 text-gray-500',
  csv: 'bg-green-50 text-green-500',
  xlsx: 'bg-green-50 text-green-500',
  xls: 'bg-green-50 text-green-500',
  pptx: 'bg-orange-50 text-orange-500',
  ppt: 'bg-orange-50 text-orange-500',
}

const getStatusConfig = (t: (key: string) => string): Record<VectorStatus, { icon: LucideIcon; color: string; bg: string; label: string }> => ({
  pending: { icon: Clock, color: 'text-warning', bg: 'bg-warning/10', label: t('knowledge.processing') },
  processing: { icon: Clock, color: 'text-warning', bg: 'bg-warning/10', label: t('knowledge.processing') },
  synced: { icon: CheckCircle2, color: 'text-active', bg: 'bg-active/10', label: t('knowledge.indexed') },
  failed: { icon: AlertCircle, color: 'text-error', bg: 'bg-error/10', label: t('knowledge.failed') },
})

export function Knowledge() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [stats, setStats] = useState<KnowledgeStats>({ document_count: 0, total_vectors: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [uploadCategory, setUploadCategory] = useState<string>('general')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [docsData, statsData] = await Promise.all([
        api.get<KnowledgeDocument[]>('/knowledge/documents'),
        api.get<KnowledgeStats>('/knowledge/stats')
      ])
      setDocuments(docsData)
      setStats(statsData)
    } catch (error) {
      console.error('Failed to fetch knowledge data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setUploading(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', uploadCategory)

      await api.post('/knowledge/documents', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      
      await fetchData()
    } catch (error) {
      console.error('Failed to upload file:', error)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDelete = async (docId: number) => {
    if (!confirm('Are you sure you want to delete this document?')) return

    try {
      await api.delete(`/knowledge/documents/${docId}`)
      await fetchData()
    } catch (error) {
      console.error('Failed to delete document:', error)
    }
  }

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'all' || doc.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const categories = ['all', ...Array.from(new Set(documents.map(d => d.category).filter(Boolean)))]

  if (loading) {
    return (
      <>
        <PageTitle title={t('knowledge.title')} />
        <div className="min-h-full bg-surface flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={t('knowledge.title')} />
      <div className="min-h-full bg-surface">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-headline-md text-on-surface mb-2">{t('knowledge.title')}</h1>
            <p className="text-body-md text-on-surface-muted">
              {t('knowledge.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Category selector for upload */}
            <div className="flex items-center gap-1 bg-surface-container-low rounded-xl p-1">
              {(['general', 'consulting', 'research', 'templates'] as const).map(cat => (
                <button
                  key={cat}
                  onClick={() => setUploadCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    uploadCategory === cat
                      ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                      : 'text-on-surface-muted hover:text-on-surface'
                  }`}
                >
                  {t(`knowledge.${cat}`)}
                </button>
              ))}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn-primary flex items-center gap-2"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {t('knowledge.upload')}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileUpload}
            accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.xls,.pptx,.ppt"
            className="hidden"
          />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="card bg-gradient-primary text-white">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-2xl font-manrope font-semibold">{stats.document_count}</p>
                <p className="text-sm text-white/70">{t('knowledge.totalDocuments')}</p>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-secondary-container flex items-center justify-center">
                <Database className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-manrope font-semibold text-on-surface">{stats.total_vectors}</p>
                <p className="text-sm text-on-surface-muted">{t('knowledge.vectorEmbeddings')}</p>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-active/10 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-active" />
              </div>
              <div>
                <p className="text-2xl font-manrope font-semibold text-on-surface">
                  {documents.filter(d => d.vector_status === 'synced').length}
                </p>
                <p className="text-sm text-on-surface-muted">{t('knowledge.indexed')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-muted" />
            <input
              type="text"
              placeholder={t('knowledge.searchDocuments')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-surface-container-lowest rounded-xl border-none text-on-surface placeholder:text-on-surface-muted outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex items-center gap-2 bg-surface-container-low rounded-xl p-1">
            <Filter className="w-4 h-4 text-on-surface-muted ml-3" />
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  selectedCategory === cat
                    ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                    : 'text-on-surface-muted hover:text-on-surface'
                }`}
              >
                {cat === 'all' ? t('knowledge.all') : t(`knowledge.${cat}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Documents List */}
        {filteredDocuments.length === 0 ? (
          <div className="card text-center py-16">
            <BookOpen className="w-12 h-12 text-on-surface-muted mx-auto mb-4" />
            <h3 className="text-headline-sm text-on-surface mb-2">{t('knowledge.noDocuments')}</h3>
            <p className="text-body-md text-on-surface-muted mb-6">
              {searchQuery ? 'Try adjusting your search query.' : t('knowledge.noDocumentsDesc')}
            </p>
            {!searchQuery && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-primary"
              >
                {t('knowledge.uploadDocument')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDocuments.map((doc) => {
              const status = getStatusConfig(t)[doc.vector_status]
              const StatusIcon = status.icon
              const iconStyle = fileTypeIcons[doc.file_type.toLowerCase()] || 'bg-gray-50 text-gray-500'
              
              return (
                <div key={doc.id} className="card card-interactive flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${iconStyle} flex items-center justify-center flex-shrink-0`}>
                    <FileText className="w-6 h-6" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h4 className="text-label-lg text-on-surface truncate">{doc.name}</h4>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-on-surface-muted">{doc.file_type}</span>
                      <span className="text-xs text-on-surface-muted">
                        {formatDateOnly(doc.uploaded_at)}
                      </span>
                      {doc.size != null && (
                        <span className="text-xs text-on-surface-muted">
                          {doc.size < 1024 * 1024
                            ? `${Math.round(doc.size / 1024)} KB`
                            : `${(doc.size / 1024 / 1024).toFixed(1)} MB`}
                        </span>
                      )}
                      {doc.category && (
                        <span className="px-2 py-0.5 rounded-md bg-surface-container-low text-xs text-on-surface-muted">
                          {doc.category}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${status.bg} ${status.color}`}>
                    <StatusIcon className="w-4 h-4" />
                    <span className="text-xs font-medium">{status.label}</span>
                  </div>

                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="p-2 rounded-xl hover:bg-error/10 hover:text-error transition-colors text-on-surface-muted"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-outline/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-on-surface-muted">
              <span className="font-manrope font-semibold text-on-surface">Aria AI Consulting Elite</span>
              <span>© 2026 Aria AI Consulting Elite</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-on-surface-muted">
              <a href="#" className="hover:text-on-surface transition-colors">Resources</a>
              <a href="#" className="hover:text-on-surface transition-colors">Legal</a>
              <a href="#" className="hover:text-on-surface transition-colors">Support</a>
              <a href="#" className="hover:text-on-surface transition-colors">Language</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  </>
  )
}
