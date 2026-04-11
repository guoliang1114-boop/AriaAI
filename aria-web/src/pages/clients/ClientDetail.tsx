import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Building2,
  ArrowLeft,
  Loader2,
  FolderKanban,
  FileText,
  Mail,
  Phone,
  MapPin,
  Edit2,
  Trash2,
  ExternalLink,
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

interface Project {
  id: number
  name: string
  status: string
  contract_amount: number | null
}

export function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState<Client | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Client>>({})

  useEffect(() => {
    if (id) {
      fetchClient()
    }
  }, [id])

  const fetchClient = async () => {
    try {
      setLoading(true)
      const clientData = await api.get<Client>(`/clients/${id}`)
      setClient(clientData)
      setEditForm(clientData)
      
      // Fetch client projects
      const projectsData = await api.get<Project[]>(`/clients/${id}/projects`)
      setProjects(projectsData)
    } catch (error) {
      console.error('Failed to fetch client:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async () => {
    if (!client) return
    try {
      await api.put(`/clients/${client.id}`, editForm)
      setClient({ ...client, ...editForm } as Client)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to update client:', error)
    }
  }

  const handleDelete = async () => {
    if (!client) return
    if (!confirm(isZh ? '确定要删除此客户吗？' : 'Are you sure you want to delete this client?')) return
    
    try {
      await api.delete(`/clients/${client.id}`)
      navigate('/clients')
    } catch (error) {
      console.error('Failed to delete client:', error)
    }
  }

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? '客户详情' : 'Client Detail'} />
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    )
  }

  if (!client) {
    return (
      <>
        <PageTitle title={isZh ? '客户详情' : 'Client Detail'} />
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500">{isZh ? '客户不存在' : 'Client not found'}</p>
            <button
              onClick={() => navigate('/clients')}
              className="mt-4 text-primary hover:underline"
            >
              {isZh ? '返回客户列表' : 'Back to clients'}
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle title={client.name} />
      <div className="min-h-full bg-gradient-to-b from-gray-50 to-white">
        {/* Header */}
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <button
              onClick={() => navigate('/clients')}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              {isZh ? '返回客户列表' : 'Back to clients'}
            </button>

            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <span className="text-2xl font-bold text-primary">
                    {client.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
                  {client.industry && (
                    <span className="inline-flex items-center px-2.5 py-0.5 bg-gray-100 text-gray-600 text-sm rounded-full mt-1">
                      {client.industry}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <Edit2 className="w-4 h-4" />
                  {isEditing ? (isZh ? '取消' : 'Cancel') : (isZh ? '编辑' : 'Edit')}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                  {isZh ? '删除' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="grid grid-cols-3 gap-6">
            {/* Left: Client Info */}
            <div className="col-span-2 space-y-6">
              {/* Basic Info */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="font-semibold text-gray-900 mb-4">
                  {isZh ? '基本信息' : 'Basic Information'}
                </h2>
                
                {isEditing ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {isZh ? '客户名称' : 'Client Name'}
                      </label>
                      <input
                        type="text"
                        value={editForm.name || ''}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {isZh ? '行业' : 'Industry'}
                      </label>
                      <input
                        type="text"
                        value={editForm.industry || ''}
                        onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {isZh ? '联系人' : 'Contact'}
                      </label>
                      <input
                        type="text"
                        value={editForm.contact || ''}
                        onChange={(e) => setEditForm({ ...editForm, contact: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder={isZh ? '姓名、电话、邮箱等' : 'Name, phone, email, etc.'}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {isZh ? '备注' : 'Notes'}
                      </label>
                      <textarea
                        value={editForm.notes || ''}
                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setIsEditing(false)}
                        className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                      >
                        {isZh ? '取消' : 'Cancel'}
                      </button>
                      <button
                        onClick={handleUpdate}
                        className="px-4 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary/90"
                      >
                        {isZh ? '保存' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {client.contact && (
                      <div className="flex items-start gap-3">
                        <Phone className="w-5 h-5 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-sm text-gray-500">{isZh ? '联系人' : 'Contact'}</p>
                          <p className="text-gray-900">{client.contact}</p>
                        </div>
                      </div>
                    )}
                    {client.notes && (
                      <div className="flex items-start gap-3">
                        <div className="w-5 h-5 flex items-center justify-center text-gray-400 mt-0.5">📝</div>
                        <div>
                          <p className="text-sm text-gray-500">{isZh ? '备注' : 'Notes'}</p>
                          <p className="text-gray-900 whitespace-pre-wrap">{client.notes}</p>
                        </div>
                      </div>
                    )}
                    {!client.contact && !client.notes && (
                      <p className="text-gray-400 text-sm">{isZh ? '暂无详细信息' : 'No detailed information'}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Projects */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="flex items-center justify-between p-5 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">
                    {isZh ? '关联项目' : 'Related Projects'}
                    <span className="text-sm font-normal text-gray-400 ml-2">({projects.length})</span>
                  </h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {projects.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <FolderKanban className="w-10 h-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">{isZh ? '暂无项目' : 'No projects'}</p>
                    </div>
                  ) : (
                    projects.map((project) => (
                      <div
                        key={project.id}
                        onClick={() => navigate(`/projects/${project.id}`)}
                        className="flex items-center justify-between p-4 hover:bg-gray-50 cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <FolderKanban className="w-5 h-5 text-primary" />
                          <span className="font-medium text-gray-900">{project.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            project.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                            project.status === 'lead' ? 'bg-amber-100 text-amber-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {project.status}
                          </span>
                          <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-gray-500" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right: Stats */}
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-medium text-gray-900 mb-4">{isZh ? '统计' : 'Statistics'}</h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">{isZh ? '项目数' : 'Projects'}</p>
                    <p className="text-2xl font-bold text-gray-900">{projects.length}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{isZh ? '文档数' : 'Documents'}</p>
                    <p className="text-2xl font-bold text-gray-900">{client.document_count}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{isZh ? '创建时间' : 'Created'}</p>
                    <p className="text-gray-900">{new Date(client.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
