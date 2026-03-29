import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import type { Skill } from '../../types'

const categories = [
  { key: 'consulting', label: '咨询专家' },
  { key: 'expert', label: '领域专家' },
  { key: 'assistant', label: 'AI助手' },
]

export function SkillForm() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = Boolean(id)

  const [formData, setFormData] = useState({
    name: '',
    category: 'consulting',
    description: '',
    systemPrompt: '',
    userTemplate: '',
    estimatedTime: '',
    toolsDefinitionJson: '',
    isGuidedWorkflow: false,
  })

  const [isLoading, setIsLoading] = useState(isEditing)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'basic' | 'prompts'>('basic')

  useEffect(() => {
    if (isEditing && id) {
      fetchSkill(parseInt(id))
    }
  }, [isEditing, id])

  const fetchSkill = async (skillId: number) => {
    try {
      const skill = await api.get<Skill>(`/skills/${skillId}`)
      setFormData({
        name: skill.name,
        category: skill.category,
        description: skill.description,
        systemPrompt: skill.systemPrompt,
        userTemplate: skill.userTemplate,
        estimatedTime: skill.estimatedTime,
        toolsDefinitionJson: skill.toolsDefinitionJson,
        isGuidedWorkflow: skill.isGuidedWorkflow,
      })
    } catch (error) {
      console.error('Failed to fetch skill:', error)
      alert('加载技能失败')
      navigate('/skills')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    try {
      if (isEditing && id) {
        await api.patch(`/skills/${id}`, formData)
      } else {
        await api.post('/skills', formData)
      }
      navigate('/skills')
    } catch (error) {
      console.error('Failed to save skill:', error)
      alert('保存失败，请重试')
    } finally {
      setIsSaving(false)
    }
  }

  const handleChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--color-accent-200)] border-t-[var(--color-accent-600)] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg-primary)] border-b border-[var(--color-border-default)]">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/skills')}
                className="p-2 hover:bg-[var(--color-bg-tertiary)] rounded-lg transition-colors text-[var(--color-text-secondary)]"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
                {isEditing ? '编辑技能' : '创建技能'}
              </h1>
            </div>
            <button
              onClick={handleSubmit}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-accent-600)] hover:bg-[var(--color-accent-700)] text-white rounded-lg font-medium transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              保存
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-4 mt-4">
            <button
              onClick={() => setActiveTab('basic')}
              className={`pb-2 text-sm font-medium transition-all ${
                activeTab === 'basic'
                  ? 'text-[var(--color-accent-600)] border-b-2 border-[var(--color-accent-600)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              基本信息
            </button>
            <button
              onClick={() => setActiveTab('prompts')}
              className={`pb-2 text-sm font-medium transition-all ${
                activeTab === 'prompts'
                  ? 'text-[var(--color-accent-600)] border-b-2 border-[var(--color-accent-600)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              提示词配置
            </button>
          </div>
        </div>
      </div>

      {/* Form Content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {activeTab === 'basic' ? (
            <div className="space-y-6">
              {/* Name */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  技能名称 *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="例如：薪酬分析专家"
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
                  required
                />
              </div>

              {/* Category */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-3">
                  技能类别 *
                </label>
                <div className="flex flex-wrap gap-2">
                  {categories.map(cat => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => handleChange('category', cat.key)}
                      className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                        formData.category === cat.key
                          ? 'border-[var(--color-accent-500)] bg-[var(--color-accent-50)] text-[var(--color-accent-600)]'
                          : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-default)]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  技能描述 *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="简要描述这个技能的功能和适用场景..."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all resize-none"
                  required
                />
              </div>

              {/* Estimated Time */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  预估时间
                </label>
                <input
                  type="text"
                  value={formData.estimatedTime}
                  onChange={(e) => handleChange('estimatedTime', e.target.value)}
                  placeholder="例如：10-15分钟"
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
                />
              </div>

              {/* Workflow Type */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                      引导式工作流
                    </label>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      启用后，用户需要通过分步骤界面输入必要信息，而非直接对话
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleChange('isGuidedWorkflow', !formData.isGuidedWorkflow)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      formData.isGuidedWorkflow ? 'bg-[var(--color-accent-600)]' : 'bg-[var(--color-bg-tertiary)]'
                    }`}
                  >
                    <span
                      className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        formData.isGuidedWorkflow ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* System Prompt */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  系统提示词 *
                </label>
                <p className="text-xs text-[var(--color-text-muted)] mb-2">
                  定义AI助手的行为模式、专业背景和回答风格。这是最重要的配置项。
                </p>
                <textarea
                  value={formData.systemPrompt}
                  onChange={(e) => handleChange('systemPrompt', e.target.value)}
                  placeholder="你是一个薪酬分析专家，擅长..."
                  rows={12}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all font-mono text-sm"
                  required
                />
              </div>

              {/* User Template */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  用户消息模板
                </label>
                <p className="text-xs text-[var(--color-text-muted)] mb-2">
                  可选。当用户创建新对话时，自动填充的消息模板。支持 {'{variable}'} 占位符。
                </p>
                <textarea
                  value={formData.userTemplate}
                  onChange={(e) => handleChange('userTemplate', e.target.value)}
                  placeholder="我的公司情况如下：{company_size}人..."
                  rows={6}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all font-mono text-sm"
                />
              </div>

              {/* Tools Definition */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  工具定义 (JSON)
                </label>
                <p className="text-xs text-[var(--color-text-muted)] mb-2">
                  可选。定义可用的工具/函数，格式为JSON数组。高级功能，谨慎使用。
                </p>
                <textarea
                  value={formData.toolsDefinitionJson}
                  onChange={(e) => handleChange('toolsDefinitionJson', e.target.value)}
                  placeholder='[{ "name": "get_market_data", ... }]'
                  rows={8}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all font-mono text-sm"
                />
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
