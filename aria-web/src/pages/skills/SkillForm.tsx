import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import type { Skill } from '../../types'

const getCategories = (t: any) => [
  { key: 'consulting', label: t('skills.form.categories.consulting') },
  { key: 'expert', label: t('skills.form.categories.expert') },
  { key: 'assistant', label: t('skills.form.categories.assistant') },
]

export function SkillForm() {
  const { t } = useTranslation()
  const categories = getCategories(t)
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
      alert(t('skills.form.loadError'))
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
      alert(t('skills.form.saveError'))
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
                {isEditing ? t('skills.form.editTitle') : t('skills.form.createTitle')}
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
              {t('skills.form.save')}
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
              {t('skills.form.basicTab')}
            </button>
            <button
              onClick={() => setActiveTab('prompts')}
              className={`pb-2 text-sm font-medium transition-all ${
                activeTab === 'prompts'
                  ? 'text-[var(--color-accent-600)] border-b-2 border-[var(--color-accent-600)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {t('skills.form.promptsTab')}
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
                  {t('skills.form.name')} *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder={t('skills.form.namePlaceholder')}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
                  required
                />
              </div>

              {/* Category */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-3">
                  {t('skills.form.category')} *
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
                  {t('skills.form.description')} *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder={t('skills.form.descriptionPlaceholder')}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all resize-none"
                  required
                />
              </div>

              {/* Estimated Time */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  {t('skills.form.estimatedTime')}
                </label>
                <input
                  type="text"
                  value={formData.estimatedTime}
                  onChange={(e) => handleChange('estimatedTime', e.target.value)}
                  placeholder={t('skills.form.estimatedTimePlaceholder')}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
                />
              </div>

              {/* Workflow Type */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
                      {t('skills.form.guidedWorkflow')}
                    </label>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      {t('skills.form.guidedWorkflowHelp')}
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
                  {t('skills.form.prompt')} *
                </label>
                <p className="text-xs text-[var(--color-text-muted)] mb-2">
                  {t('skills.form.promptHelp')}
                </p>
                <textarea
                  value={formData.systemPrompt}
                  onChange={(e) => handleChange('systemPrompt', e.target.value)}
                  placeholder={t('skills.form.promptPlaceholder')}
                  rows={12}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all font-mono text-sm"
                  required
                />
              </div>

              {/* User Template */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  {t('skills.form.userTemplate')}
                </label>
                <p className="text-xs text-[var(--color-text-muted)] mb-2">
                  {t('skills.form.userTemplateHelp')}
                </p>
                <textarea
                  value={formData.userTemplate}
                  onChange={(e) => handleChange('userTemplate', e.target.value)}
                  placeholder={t('skills.form.userTemplatePlaceholder')}
                  rows={6}
                  className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all font-mono text-sm"
                />
              </div>

              {/* Tools Definition */}
              <div className="bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border-default)] p-6">
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  {t('skills.form.tools')}
                </label>
                <p className="text-xs text-[var(--color-text-muted)] mb-2">
                  {t('skills.form.toolsHelp')}
                </p>
                <textarea
                  value={formData.toolsDefinitionJson}
                  onChange={(e) => handleChange('toolsDefinitionJson', e.target.value)}
                  placeholder={t('skills.form.toolsPlaceholder')}
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
