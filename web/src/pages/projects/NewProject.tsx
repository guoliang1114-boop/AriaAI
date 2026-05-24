import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import { type ProjectStage, toBackendStatus } from '../../types/enums'
import { NewProjectAIPanel } from './NewProjectAIPanel'
import { NewProjectBasicsForm } from './NewProjectBasicsForm'
import { NewProjectHeader } from './NewProjectHeader'

interface AISuggestion {
  description: string
  name: string
}

interface ClientRecord {
  id: number
  industry: string
  name: string
}

export function NewProject() {
  const { i18n } = useTranslation()
  const navigate = useNavigate()
  const isZh = i18n.language.startsWith('zh')
  const clientDropdownRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    client: '',
    description: '',
    notes: '',
    status: 'lead_discovery' as ProjectStage,
    contract_amount: '',
  })
  const [clients, setClients] = useState<ClientRecord[]>([])
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [aiQuery, setAiQuery] = useState('')
  const [isAILoading, setIsAILoading] = useState(false)
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([])
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) {
        setShowClientDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    api
      .get<ClientRecord[]>('/clients')
      .then((response) => setClients(Array.isArray(response) ? response : []))
      .catch(() => {})
  }, [])

  const filteredClients = clientSearch.trim()
    ? clients.filter(
        (client) =>
          client.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
          client.industry.toLowerCase().includes(clientSearch.toLowerCase()),
      )
    : clients

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loading || !formData.name.trim() || !formData.client.trim()) return

    setError(null)
    try {
      setLoading(true)
      const result = await api.post<any>('/projects', {
        name: formData.name.trim(),
        client: formData.client.trim(),
        description: formData.description,
        notes: formData.notes,
        status: toBackendStatus(formData.status),
        contract_amount: formData.contract_amount ? parseFloat(formData.contract_amount) : 0,
      })
      const projectId = result?.id ?? result?.project?.id
      if (!projectId) throw new Error('No project id in response')
      navigate(`/projects/${projectId}`)
    } catch (submitError) {
      console.error('Failed to create project:', submitError)
      if (axios.isAxiosError(submitError)) {
        const detail = submitError.response?.data?.detail
        if (
          submitError.response?.status === 409 &&
          detail &&
          typeof detail === 'object' &&
          detail.code === 'duplicate_project' &&
          detail.project_id
        ) {
          setError(isZh ? '该客户下已有同名项目，正在打开已有项目。' : 'A project with this name already exists. Opening it now.')
          navigate(`/projects/${detail.project_id}`)
          return
        }
      }
      setError(isZh ? '创建项目失败，请重试' : 'Failed to create project, please try again')
    } finally {
      setLoading(false)
    }
  }

  const runAISuggest = async () => {
    const query = aiQuery.trim()
    if (!query) return

    setIsAILoading(true)
    setAiError(null)
    setSuggestions([])
    try {
      const results = await api.post<AISuggestion[]>('/projects/ai-suggest', {
        query,
        client_name: formData.client,
        client_industry: '',
      })
      if (!results.length) {
        setAiError(isZh ? 'AI 未返回结果，请手动填写' : 'AI returned no result, please fill manually')
      } else {
        setFormData((prev) => ({
          ...prev,
          name: results[0].name,
          description: results[0].description,
        }))
        if (results.length > 1) setSuggestions(results.slice(1))
      }
    } catch {
      setAiError(isZh ? 'AI 生成失败，请手动填写' : 'AI generation failed, please fill manually')
    } finally {
      setIsAILoading(false)
    }
  }

  return (
    <>
      <PageTitle title={isZh ? '新建项目' : 'New Project'} />
      <div className="min-h-full bg-surface">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <NewProjectHeader isZh={isZh} onBack={() => navigate('/projects')} />

          <form onSubmit={handleSubmit} className="space-y-6">
            <NewProjectAIPanel
              aiError={aiError}
              aiQuery={aiQuery}
              isAILoading={isAILoading}
              onApplySuggestion={(suggestion) => {
                setFormData((prev) => ({
                  ...prev,
                  name: suggestion.name,
                  description: suggestion.description,
                }))
                setSuggestions([])
              }}
              onQueryChange={setAiQuery}
              onRun={runAISuggest}
              suggestions={suggestions}
            />

            <NewProjectBasicsForm
              clientDropdownRef={clientDropdownRef}
              clientSearch={clientSearch}
              error={error}
              filteredClients={filteredClients}
              formData={formData}
              isZh={isZh}
              loading={loading}
              onCancel={() => navigate('/projects')}
              onClientSearchChange={setClientSearch}
              onFieldChange={(field, value) =>
                setFormData((prev) => ({ ...prev, [field]: value }))
              }
              onSelectClient={(clientName) => {
                setFormData((prev) => ({ ...prev, client: clientName }))
                setShowClientDropdown(false)
              }}
              onToggleClientDropdown={() => {
                setShowClientDropdown((prev) => !prev)
                setClientSearch('')
              }}
              showClientDropdown={showClientDropdown}
            />
          </form>
        </div>
      </div>
    </>
  )
}
