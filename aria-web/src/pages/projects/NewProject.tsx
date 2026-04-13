import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Loader2,
  Building2,
  FileText,
  Briefcase,
  Sparkles,
  Wand2,
  Lightbulb,
  ChevronDown,
  Check,
  Plus,
} from 'lucide-react'
import { api } from '../../api/client'
import { PageTitle } from '../../components/PageTitle'
import type { Project } from '../../types/api'
import { PROJECT_STAGE_CONFIGS, type ProjectStage, toBackendStatus } from '../../types/enums'

interface AISuggestion {
  name: string
  description: string
}

interface ClientRecord {
  id: number
  name: string
  industry: string
}

export function NewProject() {
  const { t, i18n } = useTranslation()
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

  // Client list
  const [clients, setClients] = useState<ClientRecord[]>([])
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [clientSearch, setClientSearch] = useState('')

  // AI state
  const [aiQuery, setAiQuery] = useState('')
  const [isAILoading, setIsAILoading] = useState(false)
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([])
  const [aiError, setAiError] = useState<string | null>(null)

  // Close client dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch client list from /clients API
  useEffect(() => {
    api.get<ClientRecord[]>('/clients')
      .then(res => setClients(Array.isArray(res) ? res : []))
      .catch(() => {})
  }, [])

  const filteredClients = clientSearch.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.industry.toLowerCase().includes(clientSearch.toLowerCase()))
    : clients

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.client.trim()) return
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
    } catch (err) {
      console.error('Failed to create project:', err)
      setError('创建项目失败，请重试')
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
        setAiError('AI 未返回结果，请手动填写')
      } else {
        setFormData(prev => ({ ...prev, name: results[0].name, description: results[0].description }))
        if (results.length > 1) setSuggestions(results.slice(1))
      }
    } catch {
      setAiError('AI 生成失败，请手动填写')
    } finally {
      setIsAILoading(false)
    }
  }

  const currentStage = PROJECT_STAGE_CONFIGS.find(s => s.id === formData.status) || PROJECT_STAGE_CONFIGS[0]

  return (
    <>
      <PageTitle title="新建项目" />
      <div className="min-h-full bg-surface">
        <div className="max-w-2xl mx-auto px-6 py-8">

          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <button
              onClick={() => navigate('/projects')}
              className="p-2 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-muted"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-headline-md text-on-surface font-semibold">新建项目</h1>
              <p className="text-body-sm text-on-surface-muted mt-0.5">填写基本信息，快速创建咨询项目</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">

            {/* AI Section */}
            <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/5 to-purple-500/5 p-5">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-on-surface">AI 智能填写</span>
              </div>
              <p className="text-xs text-on-surface-muted mb-3">描述项目背景，AI 自动生成项目名称和描述</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Lightbulb className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-muted pointer-events-none" />
                  <input
                    type="text"
                    value={aiQuery}
                    onChange={e => setAiQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runAISuggest())}
                    placeholder="例如：帮助太太乐进行 ERP 系统升级..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl border border-outline/15 text-sm text-on-surface placeholder:text-on-surface-muted outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-colors"
                  />
                </div>
                <button
                  type="button"
                  onClick={runAISuggest}
                  disabled={isAILoading || !aiQuery.trim()}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white text-sm rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  {isAILoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  {isAILoading ? '生成中...' : 'AI 填写'}
                </button>
              </div>
              {aiError && <p className="mt-2 text-xs text-amber-600">⚠️ {aiError}</p>}
              {suggestions.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs text-on-surface-muted">其他建议（点击应用）</p>
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setFormData(p => ({ ...p, name: s.name, description: s.description })); setSuggestions([]) }}
                      className="w-full text-left px-3.5 py-2.5 bg-white rounded-xl border border-outline/15 hover:border-primary/30 transition-colors"
                    >
                      <p className="text-sm font-medium text-on-surface">{s.name}</p>
                      <p className="text-xs text-on-surface-muted line-clamp-1 mt-0.5">{s.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-outline/10" />
              <span className="text-xs text-on-surface-muted">基本信息</span>
              <div className="flex-1 h-px bg-outline/10" />
            </div>

            {/* Project Name + Client */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                  项目名称 <span className="text-error">*</span>
                </label>
                <div className="relative">
                  <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-muted pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                    placeholder="例如：ERP 系统升级项目"
                    className="w-full pl-10 pr-4 py-3 bg-surface-container-lowest rounded-xl border border-outline/15 text-sm text-on-surface placeholder:text-on-surface-muted outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-colors"
                  />
                </div>
              </div>

              <div className="relative" ref={clientDropdownRef}>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                  客户名称 <span className="text-error">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => { setShowClientDropdown(v => !v); setClientSearch('') }}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-3 bg-surface-container-lowest rounded-xl border text-sm transition-colors text-left ${
                    showClientDropdown ? 'border-primary/30 ring-2 ring-primary/10' : 'border-outline/15 hover:border-outline/30'
                  }`}
                >
                  <Building2 className="w-4 h-4 text-on-surface-muted flex-shrink-0" />
                  <span className={`flex-1 truncate ${formData.client ? 'text-on-surface' : 'text-on-surface-muted'}`}>
                    {formData.client || '选择客户'}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-on-surface-muted transition-transform flex-shrink-0 ${showClientDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showClientDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-surface-container-lowest rounded-xl border border-outline/15 shadow-lg z-30 overflow-hidden">
                    {/* Search */}
                    <div className="p-2 border-b border-outline/10">
                      <input
                        autoFocus
                        type="text"
                        value={clientSearch}
                        onChange={e => setClientSearch(e.target.value)}
                        placeholder="搜索客户..."
                        className="w-full px-3 py-1.5 text-sm bg-surface-container-low rounded-lg outline-none text-on-surface placeholder:text-on-surface-muted"
                      />
                    </div>
                    <div className="max-h-52 overflow-auto py-1">
                      {filteredClients.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-on-surface-muted text-center">无匹配客户</p>
                      ) : (
                        filteredClients.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setFormData(p => ({ ...p, client: c.name })); setShowClientDropdown(false) }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-container-low ${
                              formData.client === c.name ? 'bg-secondary-container/40 text-primary' : 'text-on-surface'
                            }`}
                          >
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <Building2 className="w-3.5 h-3.5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                              <p className="font-medium truncate">{c.name}</p>
                              {c.industry && <p className="text-xs text-on-surface-muted truncate">{c.industry}</p>}
                            </div>
                            {formData.client === c.name && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1.5">项目描述</label>
              <div className="relative">
                <FileText className="absolute left-3.5 top-3.5 w-4 h-4 text-on-surface-muted pointer-events-none" />
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                  placeholder="简要描述项目背景、目标和范围..."
                  className="w-full pl-10 pr-4 py-3 bg-surface-container-lowest rounded-xl border border-outline/15 text-sm text-on-surface placeholder:text-on-surface-muted outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-colors resize-none"
                />
              </div>
            </div>

            {/* Contract Amount */}
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1.5">合同金额（元）</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-muted font-medium">¥</span>
                <input
                  type="number"
                  min="0"
                  value={formData.contract_amount}
                  onChange={e => setFormData(p => ({ ...p, contract_amount: e.target.value }))}
                  placeholder="0"
                  className="w-full pl-8 pr-4 py-3 bg-surface-container-lowest rounded-xl border border-outline/15 text-sm text-on-surface placeholder:text-on-surface-muted outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-colors"
                />
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-outline/10" />
              <span className="text-xs text-on-surface-muted">项目阶段</span>
              <div className="flex-1 h-px bg-outline/10" />
            </div>

            {/* Stage Selector */}
            <div>
              {/* Current selection preview */}
              <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border mb-4 ${currentStage.bgColor} ${currentStage.borderColor}`}>
                {(() => { const Icon = currentStage.icon; return <Icon className={`w-4 h-4 ${currentStage.color}`} /> })()}
                <span className={`text-sm font-medium ${currentStage.color}`}>{currentStage.labelZh}</span>
                <span className="text-xs text-on-surface-muted ml-1">— {currentStage.description}</span>
              </div>

              {/* Business phase */}
              <p className="text-xs font-medium text-on-surface-muted uppercase tracking-wide mb-2">商机阶段</p>
              <div className="grid grid-cols-5 gap-2 mb-4">
                {PROJECT_STAGE_CONFIGS.filter(s => s.phase === 'business').map(stage => {
                  const Icon = stage.icon
                  const active = formData.status === stage.id
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => setFormData(p => ({ ...p, status: stage.id }))}
                      className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${
                        active
                          ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm ring-2 ring-offset-1 ring-current/30`
                          : 'bg-surface-container-lowest border-outline/15 text-on-surface-muted hover:border-outline/30 hover:bg-surface-container-low'
                      }`}
                    >
                      {active && <Check className="absolute top-1.5 right-1.5 w-3 h-3" />}
                      <Icon className="w-4 h-4" />
                      <span className="text-xs leading-tight font-medium">{stage.labelZh}</span>
                    </button>
                  )
                })}
              </div>

              {/* Delivery phase */}
              <p className="text-xs font-medium text-on-surface-muted uppercase tracking-wide mb-2">交付阶段</p>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {PROJECT_STAGE_CONFIGS.filter(s => s.phase === 'delivery').map(stage => {
                  const Icon = stage.icon
                  const active = formData.status === stage.id
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => setFormData(p => ({ ...p, status: stage.id }))}
                      className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${
                        active
                          ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm ring-2 ring-offset-1 ring-current/30`
                          : 'bg-surface-container-lowest border-outline/15 text-on-surface-muted hover:border-outline/30 hover:bg-surface-container-low'
                      }`}
                    >
                      {active && <Check className="absolute top-1.5 right-1.5 w-3 h-3" />}
                      <Icon className="w-4 h-4" />
                      <span className="text-xs leading-tight font-medium">{stage.labelZh}</span>
                    </button>
                  )
                })}
              </div>

              {/* Archived */}
              {(() => {
                const stage = PROJECT_STAGE_CONFIGS.find(s => s.id === 'archived') || PROJECT_STAGE_CONFIGS[0]
                const Icon = stage.icon
                const active = formData.status === 'archived'
                return (
                  <button
                    type="button"
                    onClick={() => setFormData(p => ({ ...p, status: 'archived' }))}
                    className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${
                      active
                        ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm`
                        : 'bg-surface-container-lowest border-outline/15 text-on-surface-muted hover:border-outline/30'
                    }`}
                  >
                    {active && <Check className="w-3.5 h-3.5" />}
                    <Icon className="w-4 h-4" />
                    <span className="font-medium">{stage.labelZh}</span>
                  </button>
                )
              })()}
            </div>

            {/* Error */}
            {error && (
              <div className="px-4 py-3 rounded-xl bg-error/5 border border-error/20 text-sm text-error">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-outline/10">
              <button
                type="button"
                onClick={() => navigate('/projects')}
                className="px-5 py-2.5 text-sm text-on-surface-muted hover:bg-surface-container-low rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading || !formData.name.trim() || !formData.client.trim()}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-primary text-white text-sm font-medium rounded-xl hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-95 transition-all disabled:opacity-40"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />创建中...</>
                ) : (
                  <><Plus className="w-4 h-4" />创建项目</>
                )}
              </button>
            </div>

          </form>
        </div>
      </div>
    </>
  )
}
