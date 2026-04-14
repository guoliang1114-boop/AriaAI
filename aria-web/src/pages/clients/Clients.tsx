import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Building2,
  Plus,
  Search,
  Loader2,
  FolderKanban,
  FileText,
  ChevronRight,
  X,
  Sparkles,
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'

interface Client {
  id: number
  name: string
  industry: string
  contact: string
  notes: string
  created_at: string
  document_count: number
  project_names: string[]
}

export function Clients() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', industry: '', contact: '', notes: '' })

  const [aiQuery, setAiQuery] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<Array<{ name: string; industry: string; contact: string; notes: string }>>([])
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    fetchClients()
  }, [])

  const fetchClients = async () => {
    try {
      setLoading(true)
      const data = await api.get<Client[]>('/clients')
      setClients(data)
    } catch (error) {
      console.error('Failed to fetch clients:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAiSuggest = async () => {
    const query = aiQuery.trim()
    if (!query) return
    setAiLoading(true)
    setAiError(null)
    setAiSuggestions([])
    try {
      const results = await api.post<Array<{ name: string; industry: string; contact: string; notes: string }>>('/clients/ai-suggest', { query })
      setAiSuggestions(results)
      if (results.length === 0) {
        setAiError(isZh ? 'AI 未返回结果' : 'AI returned no results')
      }
    } catch (err: any) {
      console.error('AI suggest failed:', err)
      setAiError(err?.response?.data?.detail || (isZh ? 'AI 建议生成失败' : 'AI suggestion failed'))
    } finally {
      setAiLoading(false)
    }
  }

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.industry.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.notes.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const sortedClients = [...filteredClients].sort((a, b) => 
    b.project_names.length - a.project_names.length
  )

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? '客户' : 'Clients'} />
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={isZh ? '客户' : 'Clients'} />
      <div className="min-h-full bg-gradient-to-b from-gray-50 to-white">
        {/* Header */}
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                      {isZh ? '客户管理' : 'Client Management'}
                    </h1>
                  </div>
                </div>
                <p className="text-sm text-gray-500">
                  {isZh ? '管理客户信息，查看关联项目和文档' : 'Manage client information and view related projects'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isZh ? '搜索客户...' : 'Search clients...'}
                    className="pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all"
                  />
                </div>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  {isZh ? '新建客户' : 'New Client'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500 mb-1">{isZh ? '总客户数' : 'Total Clients'}</p>
              <p className="text-3xl font-bold text-gray-900">{clients.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500 mb-1">{isZh ? '活跃客户' : 'Active Clients'}</p>
              <p className="text-3xl font-bold text-primary">
                {clients.filter(c => c.project_names.length > 0).length}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500 mb-1">{isZh ? '总项目数' : 'Total Projects'}</p>
              <p className="text-3xl font-bold text-emerald-600">
                {clients.reduce((sum, c) => sum + c.project_names.length, 0)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500 mb-1">{isZh ? '总文档数' : 'Total Documents'}</p>
              <p className="text-3xl font-bold text-blue-600">
                {clients.reduce((sum, c) => sum + c.document_count, 0)}
              </p>
            </div>
          </div>

          {/* Client List */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">
                {isZh ? '客户列表' : 'Client List'} 
                <span className="text-sm font-normal text-gray-400 ml-2">({sortedClients.length})</span>
              </h2>
            </div>
            
            <div className="divide-y divide-gray-100">
              {sortedClients.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{isZh ? '暂无客户' : 'No clients yet'}</p>
                </div>
              ) : (
                sortedClients.map((client) => (
                  <div 
                    key={client.id}
                    className="flex items-center gap-5 p-5 hover:bg-gray-50 transition-colors cursor-pointer group"
                    onClick={() => navigate(`/clients/${client.id}`)}
                  >
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0">
                      <span className="text-lg font-bold text-primary">
                        {client.name.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-semibold text-gray-900">{client.name}</h3>
                        {client.industry && (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                            {client.industry}
                          </span>
                        )}
                      </div>
                      {client.notes && (
                        <p className="text-sm text-gray-500 truncate">{client.notes}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-6 text-sm">
                      {client.project_names.length > 0 && (
                        <div className="flex items-center gap-1.5 text-gray-600">
                          <FolderKanban className="w-4 h-4 text-primary" />
                          <span>{client.project_names.length} {isZh ? '项目' : 'projects'}</span>
                        </div>
                      )}
                      {client.document_count > 0 && (
                        <div className="flex items-center gap-1.5 text-gray-600">
                          <FileText className="w-4 h-4 text-blue-500" />
                          <span>{client.document_count} {isZh ? '文档' : 'docs'}</span>
                        </div>
                      )}
                    </div>

                    <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create Client Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{isZh ? '新建客户' : 'New Client'}</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* AI Assist */}
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                <label className="block text-xs font-medium text-gray-500">
                  {isZh ? 'AI 智能填充' : 'AI Auto-fill'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={aiQuery}
                    onChange={(e) => setAiQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAiSuggest())}
                    placeholder={isZh ? '输入公司名或描述...' : 'Enter company name or description...'}
                    className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={handleAiSuggest}
                    disabled={aiLoading || !aiQuery.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isZh ? '生成' : 'Generate'}
                  </button>
                </div>
                {aiError && <p className="text-xs text-red-500">{aiError}</p>}
                {aiSuggestions.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs text-gray-400">{isZh ? '点击建议自动填充' : 'Click a suggestion to auto-fill'}</p>
                    {aiSuggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setForm({
                            name: s.name,
                            industry: s.industry,
                            contact: s.contact,
                            notes: s.notes,
                          })
                          setAiSuggestions([])
                        }}
                        className="w-full text-left px-3 py-2 bg-white border border-gray-200 rounded-lg hover:border-primary/40 hover:shadow-sm transition-all"
                      >
                        <p className="text-sm font-medium text-gray-900">{s.name}</p>
                        <p className="text-xs text-gray-500 truncate">{s.industry}{s.notes ? ` · ${s.notes}` : ''}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? '客户名称' : 'Client Name'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={isZh ? '请输入客户名称' : 'Enter client name'}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? '行业' : 'Industry'}
                </label>
                <input
                  type="text"
                  value={form.industry}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}
                  placeholder={isZh ? '例如：互联网、制造业' : 'e.g. Internet, Manufacturing'}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? '联系人' : 'Contact'}
                </label>
                <input
                  type="text"
                  value={form.contact}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  placeholder={isZh ? '例如：张三 / 13800138000' : 'e.g. John Doe'}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? '备注' : 'Notes'}
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder={isZh ? '补充信息...' : 'Additional notes...'}
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {isZh ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={async () => {
                  if (!form.name.trim()) {
                    alert(isZh ? '客户名称不能为空' : 'Client name is required')
                    return
                  }
                  setCreating(true)
                  try {
                    await api.post('/clients', {
                      name: form.name.trim(),
                      industry: form.industry.trim(),
                      contact: form.contact.trim(),
                      notes: form.notes.trim(),
                    })
                    setForm({ name: '', industry: '', contact: '', notes: '' })
                    setShowCreateModal(false)
                    fetchClients()
                  } catch (err) {
                    console.error('Failed to create client:', err)
                    alert(isZh ? '创建失败，请重试' : 'Failed to create client')
                  } finally {
                    setCreating(false)
                  }
                }}
                disabled={creating}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                {isZh ? '确认创建' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
