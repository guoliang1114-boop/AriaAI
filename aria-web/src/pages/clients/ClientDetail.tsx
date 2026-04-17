import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Brain,
  Building2,
  Edit2,
  ExternalLink,
  FolderKanban,
  Loader2,
  Phone,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { ClientMemoryResponse, ClientMemoryStatusResponse } from '../../types/api'

interface Client {
  id: number
  name: string
  industry: string
  contact: string
  notes: string
  created_at: string
  document_count: number
  project_names: string[]
  client_memory_version?: number
  client_memory_stale?: boolean
  client_memory_updated_at?: string | null
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
  const [memoryStatus, setMemoryStatus] = useState<ClientMemoryStatusResponse | null>(null)
  const [rebuildingMemory, setRebuildingMemory] = useState(false)

  useEffect(() => {
    if (id) {
      void fetchClient()
    }
  }, [id])

  const fetchClient = async () => {
    try {
      setLoading(true)
      const clientData = await api.get<Client>(`/clients/${id}`)
      const memoryData = await api.get<ClientMemoryStatusResponse>(`/clients/${id}/memory/status`)
      const projectsData = await api.get<Project[]>(`/clients/${id}/projects`)
      setClient(clientData)
      setEditForm(clientData)
      setMemoryStatus(memoryData)
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
      const updated = await api.put<Client>(`/clients/${client.id}`, editForm)
      setClient(updated)
      setEditForm(updated)
      setIsEditing(false)
      setMemoryStatus((current) =>
        current
          ? {
              ...current,
              memory_stale: true,
            }
          : current,
      )
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

  const handleRebuildMemory = async () => {
    if (!client) return
    try {
      setRebuildingMemory(true)
      const response = await api.post<ClientMemoryResponse>(`/clients/${client.id}/memory/rebuild`, {}, { timeout: 120000 })
      setMemoryStatus({
        client_id: client.id,
        has_memory: true,
        memory_version: response.memory_version,
        memory_stale: response.memory_stale,
        memory_updated_at: response.memory_updated_at,
      })
    } catch (error) {
      console.error('Failed to rebuild client memory:', error)
    } finally {
      setRebuildingMemory(false)
    }
  }

  if (loading) {
    return (
      <>
        <PageTitle title={isZh ? '客户详情' : 'Client Detail'} />
        <div className="flex min-h-full items-center justify-center bg-gray-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    )
  }

  if (!client) {
    return (
      <>
        <PageTitle title={isZh ? '客户详情' : 'Client Detail'} />
        <div className="flex min-h-full items-center justify-center bg-gray-50">
          <div className="text-center">
            <p className="text-gray-500">{isZh ? '客户不存在' : 'Client not found'}</p>
            <button onClick={() => navigate('/clients')} className="mt-4 text-primary hover:underline">
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
        <div className="border-b border-gray-100 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-6">
            <button
              onClick={() => navigate('/clients')}
              className="mb-4 flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              {isZh ? '返回客户列表' : 'Back to clients'}
            </button>

            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5">
                  <span className="text-2xl font-bold text-primary">{client.name.charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
                  {client.industry && (
                    <span className="mt-1 inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-sm text-gray-600">
                      {client.industry}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Edit2 className="h-4 w-4" />
                  {isEditing ? (isZh ? '取消' : 'Cancel') : (isZh ? '编辑' : 'Edit')}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {isZh ? '删除' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 space-y-6">
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="mb-4 font-semibold text-gray-900">{isZh ? '基本信息' : 'Basic Information'}</h2>

                {isEditing ? (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        {isZh ? '客户名称' : 'Client Name'}
                      </label>
                      <input
                        type="text"
                        value={editForm.name || ''}
                        onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        {isZh ? '行业' : 'Industry'}
                      </label>
                      <input
                        type="text"
                        value={editForm.industry || ''}
                        onChange={(event) => setEditForm({ ...editForm, industry: event.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        {isZh ? '联系人' : 'Contact'}
                      </label>
                      <input
                        type="text"
                        value={editForm.contact || ''}
                        onChange={(event) => setEditForm({ ...editForm, contact: event.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder={isZh ? '姓名、电话、邮箱等' : 'Name, phone, email, etc.'}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">{isZh ? '备注' : 'Notes'}</label>
                      <textarea
                        value={editForm.notes || ''}
                        onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                        rows={4}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                        {isZh ? '取消' : 'Cancel'}
                      </button>
                      <button onClick={handleUpdate} className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90">
                        {isZh ? '保存' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {client.contact && (
                      <div className="flex items-start gap-3">
                        <Phone className="mt-0.5 h-5 w-5 text-gray-400" />
                        <div>
                          <p className="text-sm text-gray-500">{isZh ? '联系人' : 'Contact'}</p>
                          <p className="text-gray-900">{client.contact}</p>
                        </div>
                      </div>
                    )}
                    {client.notes && (
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-5 w-5 items-center justify-center text-gray-400">•</div>
                        <div>
                          <p className="text-sm text-gray-500">{isZh ? '备注' : 'Notes'}</p>
                          <p className="whitespace-pre-wrap text-gray-900">{client.notes}</p>
                        </div>
                      </div>
                    )}
                    {!client.contact && !client.notes && (
                      <p className="text-sm text-gray-400">{isZh ? '暂无详细信息' : 'No detailed information'}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white">
                <div className="flex items-center justify-between border-b border-gray-100 p-5">
                  <h2 className="font-semibold text-gray-900">
                    {isZh ? '关联项目' : 'Related Projects'}
                    <span className="ml-2 text-sm font-normal text-gray-400">({projects.length})</span>
                  </h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {projects.length === 0 ? (
                    <div className="py-8 text-center text-gray-400">
                      <FolderKanban className="mx-auto mb-2 h-10 w-10 opacity-50" />
                      <p className="text-sm">{isZh ? '暂无项目' : 'No projects'}</p>
                    </div>
                  ) : (
                    projects.map((project) => (
                      <div
                        key={project.id}
                        onClick={() => navigate(`/projects/${project.id}`)}
                        className="group flex cursor-pointer items-center justify-between p-4 hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-3">
                          <FolderKanban className="h-5 w-5 text-primary" />
                          <span className="font-medium text-gray-900">{project.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`rounded-full px-2 py-1 text-xs ${
                              project.status === 'active'
                                ? 'bg-emerald-100 text-emerald-700'
                                : project.status === 'lead'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {project.status}
                          </span>
                          <ExternalLink className="h-4 w-4 text-gray-300 group-hover:text-gray-500" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-primary" />
                      <h3 className="font-medium text-gray-900">{isZh ? '客户记忆' : 'Client Memory'}</h3>
                    </div>
                    <p className="mt-2 text-sm text-gray-500">
                      {memoryStatus?.has_memory
                        ? memoryStatus.memory_stale
                          ? isZh
                            ? '已有记忆，建议刷新后再用于客户分析。'
                            : 'Memory exists but should be refreshed before reuse.'
                          : isZh
                            ? '客户记忆已同步，可用于跨项目复用。'
                            : 'Client memory is ready for cross-project reuse.'
                        : isZh
                          ? '当前还没有客户记忆。'
                          : 'No client memory yet.'}
                    </p>
                  </div>
                  <button
                    onClick={handleRebuildMemory}
                    disabled={rebuildingMemory}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {rebuildingMemory ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {isZh ? '更新记忆' : 'Refresh'}
                  </button>
                </div>

                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="text-gray-500">{isZh ? '状态' : 'Status'}</div>
                    <div className="mt-1 font-medium text-gray-900">
                      {memoryStatus?.has_memory
                        ? memoryStatus.memory_stale
                          ? isZh ? '建议更新' : 'Needs refresh'
                          : isZh ? '可直接使用' : 'Ready'
                        : isZh ? '尚未整理' : 'Not prepared'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="text-gray-500">{isZh ? '最近同步' : 'Last sync'}</div>
                    <div className="mt-1 font-medium text-gray-900">
                      {memoryStatus?.memory_updated_at
                        ? new Date(memoryStatus.memory_updated_at).toLocaleString()
                        : isZh ? '暂无' : 'Not yet'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-4 font-medium text-gray-900">{isZh ? '统计' : 'Statistics'}</h3>
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
