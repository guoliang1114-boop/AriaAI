import { useState, useEffect } from 'react'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { api } from '../../api/client'

interface AIModel {
  id: string
  name: string
  provider: 'anthropic' | 'moonshot'
  description: string
  maxTokens: number
}

const models: AIModel[] = [
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    description: 'Anthropic最强大的模型，适合复杂任务',
    maxTokens: 8192,
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'anthropic',
    description: '快速响应，适合简单任务',
    maxTokens: 4096,
  },
  {
    id: 'kimi-k2',
    name: 'Kimi K2',
    provider: 'moonshot',
    description: 'Moonshot旗舰模型，支持长文本',
    maxTokens: 8192,
  },
]

export function AISettings() {
  const [selectedModel, setSelectedModel] = useState('claude-3-5-sonnet')
  const [apiKey, setApiKey] = useState('')
  const [kimiApiKey, setKimiApiKey] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState<{ anthropic?: boolean; kimi?: boolean }>({})

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setInitialLoading(true)
      setError('')
      
      // Load all settings
      const settings = await api.get<Record<string, string>>('/settings/')
      
      if (settings.ai_model) {
        setSelectedModel(settings.ai_model)
      }
      if (settings.temperature) {
        setTemperature(parseFloat(settings.temperature))
      }

      // Check API key status
      const [anthropicStatus, kimiStatus] = await Promise.all([
        api.get<{ configured: boolean }>('/settings/api-key-status').catch(() => ({ configured: false })),
        api.get<{ configured: boolean }>('/settings/kimi-api-key-status').catch(() => ({ configured: false })),
      ])
      
      setApiKeyStatus({
        anthropic: anthropicStatus.configured,
        kimi: kimiStatus.configured,
      })
    } catch (err: any) {
      setError(err.message || 'Failed to load settings')
    } finally {
      setInitialLoading(false)
    }
  }

  const handleSave = async () => {
    setLoading(true)
    setSaved(false)
    setError('')

    try {
      // Save settings to backend
      await Promise.all([
        api.put('/settings/ai_model', { value: selectedModel }),
        api.put('/settings/temperature', { value: temperature.toString() }),
        // Save API keys if provided
        apiKey ? api.post('/settings/api-key', { api_key: apiKey }) : Promise.resolve(),
        kimiApiKey ? api.post('/settings/kimi-api-key', { api_key: kimiApiKey }) : Promise.resolve(),
      ])

      setSaved(true)
      setApiKey('') // Clear input after save
      setKimiApiKey('')
      
      // Refresh status
      await loadSettings()
      
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to save settings')
    } finally {
      setLoading(false)
    }
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">AI模型配置</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">选择和管理你的AI模型提供商</p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Model Selection */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-3">
            选择模型
          </label>
          <div className="space-y-3">
            {models.map(model => (
              <div
                key={model.id}
                onClick={() => setSelectedModel(model.id)}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedModel === model.id
                    ? 'border-[var(--color-accent-500)] bg-[var(--color-accent-50)]'
                    : 'border-[var(--color-border-default)] hover:border-[var(--color-border-default)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    selectedModel === model.id ? 'border-[var(--color-accent-500)]' : 'border-[var(--color-border-default)]'
                  }`}>
                    {selectedModel === model.id && (
                      <div className="w-2.5 h-2.5 bg-[var(--color-accent-500)] rounded-full" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--color-text-primary)]">{model.name}</span>
                      <span className="px-2 py-0.5 text-xs bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] rounded-full">
                        {model.provider === 'anthropic' ? 'Anthropic' : 'Moonshot'}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">{model.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Anthropic API Key */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
            Anthropic API密钥
            {apiKeyStatus.anthropic && (
              <span className="ml-2 text-xs text-green-600">● 已配置</span>
            )}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyStatus.anthropic ? '已配置（输入新密钥覆盖）' : '输入你的 Anthropic API 密钥'}
            className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
          />
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            你的API密钥将被安全加密存储
          </p>
        </div>

        {/* Kimi API Key */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
            Kimi (Moonshot) API密钥
            {apiKeyStatus.kimi && (
              <span className="ml-2 text-xs text-green-600">● 已配置</span>
            )}
          </label>
          <input
            type="password"
            value={kimiApiKey}
            onChange={(e) => setKimiApiKey(e.target.value)}
            placeholder={apiKeyStatus.kimi ? '已配置（输入新密钥覆盖）' : '输入你的 Kimi API 密钥'}
            className="w-full px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
          />
        </div>

        {/* Temperature */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
            温度 (Temperature): {temperature}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full accent-[var(--color-accent-600)]"
          />
          <div className="flex justify-between text-xs text-[var(--color-text-muted)] mt-1">
            <span>更精确</span>
            <span>更有创意</span>
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-4 border-t border-[var(--color-border-default)]">
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-accent-600)] hover:bg-[var(--color-accent-700)] disabled:opacity-50 text-white rounded-lg font-medium transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                保存中...
              </>
            ) : saved ? (
              <>
                <Check className="w-4 h-4" />
                已保存
              </>
            ) : (
              '保存设置'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
