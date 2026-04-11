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
    </>
  )
}
