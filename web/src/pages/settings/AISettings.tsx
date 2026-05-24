import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  Check, 
  Loader2, 
  AlertCircle, 
  RefreshCw, 
  Key, 
  Sliders, 
  Bot,
  ChevronDown,
  ChevronUp,
  Zap,
  Sparkles,
  TestTube
} from 'lucide-react'
import { api } from '../../api/client'

interface AIModel {
  id: string
  name: string
  provider: 'anthropic' | 'openai' | 'moonshot' | 'deepseek' | 'bigmodel' | 'mimo' | 'custom'
  description: string
  maxTokens: number
  supportsTools: boolean
  supportsVision: boolean
  icon: string
  fixedParams?: {  // If set, these parameters are fixed for the model
    temperature: number
    topP: number
    presencePenalty: number
    frequencyPenalty: number
  }
}

const models: AIModel[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude',
    provider: 'anthropic',
    description: 'Balanced Claude model for consulting analysis, writing, and project work.',
    maxTokens: 8192,
    supportsTools: true,
    supportsVision: true,
    icon: 'CL',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku',
    provider: 'anthropic',
    description: 'Lightweight Claude model for faster everyday tasks and short interactions.',
    maxTokens: 8192,
    supportsTools: true,
    supportsVision: false,
    icon: 'CH',
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    provider: 'moonshot',
    description: 'Moonshot K2.6 model for long-context coding, agent tool use, and multimodal work.',
    maxTokens: 32768,
    supportsTools: true,
    supportsVision: true,
    fixedParams: { temperature: 1, topP: 0.95, presencePenalty: 0, frequencyPenalty: 0 },
    icon: 'KM',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4',
    provider: 'deepseek',
    description: 'DeepSeek V4 model for reasoning, coding, and agent workflows.',
    maxTokens: 32768,
    supportsTools: true,
    supportsVision: false,
    icon: 'DS',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    description: 'Faster DeepSeek V4 model for daily chat, agent, and coding tasks.',
    maxTokens: 32768,
    supportsTools: true,
    supportsVision: false,
    icon: 'DF',
  },
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    provider: 'bigmodel',
    description: 'GLM-5.1 model for coding, reasoning, and production assistant tasks.',
    maxTokens: 8192,
    supportsTools: true,
    supportsVision: false,
    icon: 'GL',
  },
  {
    id: 'mimo-v2.5-flash',
    name: 'MiMo V2.5 Flash',
    provider: 'mimo',
    description: 'Xiaomi MiMo fast model for lower-latency daily chat, drafting, and lightweight agent tasks.',
    maxTokens: 8192,
    supportsTools: true,
    supportsVision: false,
    icon: 'MI',
  },
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    provider: 'mimo',
    description: 'Xiaomi MiMo reasoning model with large context for long-document and deeper analysis workloads.',
    maxTokens: 32000,
    supportsTools: true,
    supportsVision: false,
    icon: 'MP',
  },
]
const providerNames: Record<string, string> = {
  anthropic: 'Anthropic',
  moonshot: 'Moonshot',
  deepseek: 'DeepSeek',
  bigmodel: 'BigModel',
  mimo: 'Xiaomi MiMo',
}

const providerColors: Record<string, string> = {
  anthropic: 'bg-orange-500/10 text-orange-600 border-orange-200',
  moonshot: 'bg-purple-500/10 text-purple-600 border-purple-200',
  deepseek: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
  bigmodel: 'bg-blue-500/10 text-blue-600 border-blue-200',
  mimo: 'bg-rose-500/10 text-rose-600 border-rose-200',
}

export function AISettings() {
  const { t } = useTranslation()
  
  // Model Selection (default to claude-sonnet-4-6 to match backend default)
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-6')
  
  // API Keys
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    anthropic: '',
    moonshot: '',
    deepseek: '',
    bigmodel: '',
    mimo: '',
  })
  
  // Parameters
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(8192)
  const [topP, setTopP] = useState(1.0)
  const [presencePenalty, setPresencePenalty] = useState(0)
  const [frequencyPenalty, setFrequencyPenalty] = useState(0)
  
  // UI State
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  
  // Status
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({})
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<string | null>('model')
  
  // Test message
  const [testMessage, setTestMessage] = useState('')
  const [isTesting, setIsTesting] = useState(false)

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
      
      // Load model settings (Mac App uses 'selected_model' and 'llm_provider')
      if (settings.selected_model) {
        setSelectedModel(settings.selected_model)
      }
      if (settings.temperature) {
        setTemperature(parseFloat(settings.temperature))
      }
      if (settings.max_tokens) {
        setMaxTokens(parseInt(settings.max_tokens))
      }
      if (settings.top_p) {
        setTopP(parseFloat(settings.top_p))
      }
      if (settings.presence_penalty) {
        setPresencePenalty(parseFloat(settings.presence_penalty))
      }
      if (settings.frequency_penalty) {
        setFrequencyPenalty(parseFloat(settings.frequency_penalty))
      }

      // Check API key status for supported providers
      const providerEndpoints: Record<string, string> = {
        anthropic: '/settings/api-key-status',
        moonshot: '/settings/kimi-api-key-status',
        deepseek: '/settings/deepseek-api-key-status',
        bigmodel: '/settings/bigmodel-api-key-status',
        mimo: '/settings/mimo-api-key-status',
      }
      const newStatus: Record<string, boolean> = {}
      
      for (const [provider, endpoint] of Object.entries(providerEndpoints)) {
        try {
          const result = await api.get<{ configured: boolean }>(endpoint)
          newStatus[provider] = result.configured
          console.log(`[AISettings] ${provider} API key status:`, result.configured)
        } catch (err) {
          console.error(`[AISettings] Failed to get ${provider} API key status:`, err)
          newStatus[provider] = false
        }
      }
      
      setApiKeyStatus(newStatus)
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
    setSuccessMessage('')

    try {
      // Determine provider from selected model
      let provider = 'claude'
      if (selectedModel.startsWith('moonshot-') || selectedModel.startsWith('kimi-')) {
        provider = 'kimi'
      } else if (selectedModel.startsWith('deepseek-')) {
        provider = 'deepseek'
      } else if (selectedModel.startsWith('glm-')) {
        provider = 'bigmodel'
      } else if (selectedModel.startsWith('mimo-') || selectedModel.startsWith('xiaomi/mimo-')) {
        provider = 'mimo'
      }
      
      // Save settings (use same keys as Mac App)
      const settingsToSave = [
        api.put('/settings/selected_model', { value: selectedModel }),
        api.put('/settings/llm_provider', { value: provider }),
        api.put('/settings/ai_model', { value: selectedModel }),  // for backward compatibility
        api.put('/settings/temperature', { value: temperature.toString() }),
        api.put('/settings/max_tokens', { value: maxTokens.toString() }),
        api.put('/settings/top_p', { value: topP.toString() }),
        api.put('/settings/presence_penalty', { value: presencePenalty.toString() }),
        api.put('/settings/frequency_penalty', { value: frequencyPenalty.toString() }),
      ]
      
      // Save API keys if provided
      Object.entries(apiKeys).forEach(([keyProvider, key]) => {
        if (key.trim()) {
          let endpoint: string
          if (keyProvider === 'anthropic') {
            endpoint = '/settings/api-key'
          } else if (keyProvider === 'moonshot') {
            endpoint = '/settings/kimi-api-key'
          } else if (keyProvider === 'deepseek') {
            endpoint = '/settings/deepseek-api-key'
          } else {
            endpoint = `/settings/${keyProvider}-api-key`
          }
          settingsToSave.push(
            api.post(endpoint, { api_key: key.trim() })
          )
        }
      })
      
      await Promise.all(settingsToSave)

      setSaved(true)
      setSuccessMessage(t('settings.saved') || 'Settings saved successfully')
      
      // Clear API key inputs after save
      setApiKeys({
        anthropic: '',
        moonshot: '',
        deepseek: '',
        bigmodel: '',
        mimo: '',
      })
      
      // Refresh status
      await loadSettings()
      
      setTimeout(() => {
        setSaved(false)
        setSuccessMessage('')
      }, 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to save settings')
    } finally {
      setLoading(false)
    }
  }

  const handleTestConnection = async (provider: string) => {
    setTestingProvider(provider)
    setError('')
    setSuccessMessage('')
    
    try {
      // Use the current model's provider or the specific provider being tested
      const result = await api.post('/chat/test-connection', { 
        provider,
        model: selectedModel 
      })
      
      const res = result as { success: boolean; message?: string }
      if (res.success) {
        setSuccessMessage(
          t('settings.ai.testSuccess', { provider: providerNames[provider] }) || 
          `${providerNames[provider]} connection successful`
        )
        setApiKeyStatus(prev => ({ ...prev, [provider]: true }))
      } else {
        setError(res.message || 'Connection test failed')
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Connection test failed')
    } finally {
      setTestingProvider(null)
    }
  }

  const handleTestModel = async () => {
    if (!testMessage.trim()) return
    
    setIsTesting(true)
    setError('')
    
    try {
      // Use fixed params for Moonshot models
      const modelData = models.find(m => m.id === selectedModel)
      const effectiveParams = modelData?.fixedParams || {
        temperature,
        topP,
        presencePenalty,
        frequencyPenalty
      }
      
      const result = await api.post('/chat/test-model', {
        message: testMessage,
        model: selectedModel,
        temperature: effectiveParams.temperature,
        max_tokens: maxTokens,
        top_p: effectiveParams.topP,
        presence_penalty: effectiveParams.presencePenalty,
        frequency_penalty: effectiveParams.frequencyPenalty,
      })
      
      const res = result as { success: boolean; message?: string }
      if (res.success) {
        setSuccessMessage('Model test successful! Response received.')
      } else {
        setError(res.message || 'Model test failed')
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Model test failed')
    } finally {
      setIsTesting(false)
    }
  }

  const selectedModelData = models.find(m => m.id === selectedModel)
  const selectedProvider = selectedModelData?.provider || 'anthropic'

  useEffect(() => {
    if (!selectedModelData) return
    setMaxTokens((current) => Math.min(current, selectedModelData.maxTokens))
  }, [selectedModelData])

  const handleModelSelect = (model: AIModel) => {
    setSelectedModel(model.id)
    setMaxTokens((current) => Math.min(current, model.maxTokens))
  }
  
  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-on-surface mb-1">
          {t('settings.ai.title') || 'AI Model Configuration'}
        </h2>
        <p className="text-sm text-on-surface-muted">
          {t('settings.ai.subtitle') || 'Configure your AI providers and model parameters'}
        </p>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-lg flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      
      {successMessage && (
        <div className="p-3 bg-success/10 border border-success/20 rounded-lg flex items-center gap-2 text-success text-sm">
          <Check className="w-4 h-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}

      {/* Model Selection Section */}
      <div className="border border-outline/20 rounded-xl overflow-hidden">
        <button
          onClick={() => toggleSection('model')}
          className="w-full flex items-center justify-between p-4 bg-surface-container-low/50 hover:bg-surface-container-low transition-colors"
        >
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-primary" />
            <span className="font-medium text-on-surface">
              {t('settings.ai.modelSelection') || 'Model Selection'}
            </span>
          </div>
          {expandedSection === 'model' ? (
            <ChevronUp className="w-4 h-4 text-on-surface-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-on-surface-muted" />
          )}
        </button>
        
        {expandedSection === 'model' && (
          <div className="p-4 space-y-4">
            <div className="grid gap-3">
              {models.map(model => (
                <div
                  key={model.id}
                  onClick={() => handleModelSelect(model)}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    selectedModel === model.id
                      ? 'border-primary bg-primary/5'
                      : 'border-outline/20 hover:border-outline/40'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      selectedModel === model.id ? 'border-primary' : 'border-outline/40'
                    }`}>
                      {selectedModel === model.id && (
                        <div className="w-2.5 h-2.5 bg-primary rounded-full" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-2xl">{model.icon}</span>
                        <span className="font-semibold text-on-surface">{model.name}</span>
                        <span className={`px-2 py-0.5 text-xs rounded-full border ${providerColors[model.provider]}`}>
                          {providerNames[model.provider]}
                        </span>
                        {model.supportsTools && (
                          <span className="px-2 py-0.5 text-xs bg-secondary-container text-on-secondary-container rounded-full">
                            Tools
                          </span>
                        )}
                        {model.supportsVision && (
                          <span className="px-2 py-0.5 text-xs bg-tertiary-container text-on-tertiary-container rounded-full">
                            Vision
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-on-surface-muted mt-1">{model.description}</p>
                      <p className="text-xs text-on-surface-muted mt-1">
                        Max tokens: {model.maxTokens.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            

          </div>
        )}
      </div>

      {/* API Keys Section */}
      <div className="border border-outline/20 rounded-xl overflow-hidden">
        <button
          onClick={() => toggleSection('apikeys')}
          className="w-full flex items-center justify-between p-4 bg-surface-container-low/50 hover:bg-surface-container-low transition-colors"
        >
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-primary" />
            <span className="font-medium text-on-surface">
              {t('settings.ai.apiKeys') || 'API Keys'}
            </span>
          </div>
          {expandedSection === 'apikeys' ? (
            <ChevronUp className="w-4 h-4 text-on-surface-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-on-surface-muted" />
          )}
        </button>
        
        {expandedSection === 'apikeys' && (
          <div className="p-4 space-y-4">
            {/* Refresh Status */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-on-surface-muted">
                API keys are stored securely and encrypted.
              </p>
              <button
                onClick={loadSettings}
                disabled={initialLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
              >
                {initialLoading ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                Refresh Status
              </button>
            </div>
            
            {/* Anthropic */}
            <div className="p-4 bg-surface-container-low rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  Anthropic API Key
                  {apiKeyStatus.anthropic && (
                    <span className="ml-2 text-xs text-success">● Configured</span>
                  )}
                </label>
                <button
                  onClick={() => handleTestConnection('anthropic')}
                  disabled={testingProvider === 'anthropic'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {testingProvider === 'anthropic' ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <TestTube className="w-3 h-3" />
                  )}
                  Test
                </button>
              </div>
              <input
                type="password"
                value={apiKeys.anthropic}
                onChange={(e) => setApiKeys(prev => ({ ...prev, anthropic: e.target.value }))}
                placeholder={apiKeyStatus.anthropic ? 'Configured (enter to update)' : 'sk-ant-api03-...'}
                className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-lg text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:border-primary/40 transition-colors"
              />
            </div>

            {/* Moonshot */}
            <div className="p-4 bg-surface-container-low rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  Moonshot API Key
                  {apiKeyStatus.moonshot && (
                    <span className="ml-2 text-xs text-success">● Configured</span>
                  )}
                </label>
                <button
                  onClick={() => handleTestConnection('moonshot')}
                  disabled={testingProvider === 'moonshot'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {testingProvider === 'moonshot' ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <TestTube className="w-3 h-3" />
                  )}
                  Test
                </button>
              </div>
              <input
                type="password"
                value={apiKeys.moonshot}
                onChange={(e) => setApiKeys(prev => ({ ...prev, moonshot: e.target.value }))}
                placeholder={apiKeyStatus.moonshot ? 'Configured (enter to update)' : '...'}
                className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-lg text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:border-primary/40 transition-colors"
              />
            </div>

            {/* DeepSeek */}
            <div className="p-4 bg-surface-container-low rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  DeepSeek API Key
                  {apiKeyStatus.deepseek && (
                    <span className="ml-2 text-xs text-success">鈼?Configured</span>
                  )}
                </label>
                <button
                  onClick={() => handleTestConnection('deepseek')}
                  disabled={testingProvider === 'deepseek'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {testingProvider === 'deepseek' ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <TestTube className="w-3 h-3" />
                  )}
                  Test
                </button>
              </div>
              <input
                type="password"
                value={apiKeys.deepseek}
                onChange={(e) => setApiKeys(prev => ({ ...prev, deepseek: e.target.value }))}
                placeholder={apiKeyStatus.deepseek ? 'Configured (enter to update)' : 'sk-...'}
                className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-lg text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:border-primary/40 transition-colors"
              />
              <p className="text-xs text-on-surface-muted mt-1.5">
                Get your API key from {' '}
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  platform.deepseek.com
                </a>
              </p>
            </div>

            {/* BigModel */}
            <div className="p-4 bg-surface-container-low rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  BigModel API Key
                  {apiKeyStatus.bigmodel && (
                    <span className="ml-2 text-xs text-success">● Configured</span>
                  )}
                </label>
                <button
                  onClick={() => handleTestConnection('bigmodel')}
                  disabled={testingProvider === 'bigmodel'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {testingProvider === 'bigmodel' ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <TestTube className="w-3 h-3" />
                  )}
                  Test
                </button>
              </div>
              <input
                type="password"
                value={apiKeys.bigmodel}
                onChange={(e) => setApiKeys(prev => ({ ...prev, bigmodel: e.target.value }))}
                placeholder={apiKeyStatus.bigmodel ? 'Configured (enter to update)' : 'Enter BigModel API Key'}
                className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-lg text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:border-primary/40 transition-colors"
              />
              <p className="text-xs text-on-surface-muted mt-1.5">
                Get your API key from {' '}
                <a 
                  href="https://open.bigmodel.cn/usercenter/apikeys" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  open.bigmodel.cn
                </a>
              </p>
            </div>

            {/* Xiaomi MiMo */}
            <div className="p-4 bg-surface-container-low rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  Xiaomi MiMo API Key
                  {apiKeyStatus.mimo && (
                    <span className="ml-2 text-xs text-success">Configured</span>
                  )}
                </label>
                <button
                  onClick={() => handleTestConnection('mimo')}
                  disabled={testingProvider === 'mimo'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  {testingProvider === 'mimo' ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <TestTube className="w-3 h-3" />
                  )}
                  Test
                </button>
              </div>
              <input
                type="password"
                value={apiKeys.mimo}
                onChange={(e) => setApiKeys(prev => ({ ...prev, mimo: e.target.value }))}
                placeholder={apiKeyStatus.mimo ? 'Configured (enter to update)' : 'Enter MiMo API Key'}
                className="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-lg text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:border-primary/40 transition-colors"
              />
              <p className="text-xs text-on-surface-muted mt-1.5">
                Get your API key from{' '}
                <a
                  href="https://platform.xiaomimimo.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  platform.xiaomimimo.com
                </a>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Parameters Section */}
      <div className="border border-outline/20 rounded-xl overflow-hidden">
        <button
          onClick={() => toggleSection('parameters')}
          className="w-full flex items-center justify-between p-4 bg-surface-container-low/50 hover:bg-surface-container-low transition-colors"
        >
          <div className="flex items-center gap-3">
            <Sliders className="w-5 h-5 text-primary" />
            <span className="font-medium text-on-surface">
              {t('settings.ai.parameters') || 'Model Parameters'}
            </span>
          </div>
          {expandedSection === 'parameters' ? (
            <ChevronUp className="w-4 h-4 text-on-surface-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-on-surface-muted" />
          )}
        </button>
        
        {expandedSection === 'parameters' && (
          <div className="p-4 space-y-6">
            {/* Temperature */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  Temperature
                  {selectedModelData?.fixedParams && (
                    <span className="ml-2 text-xs text-warning">(Fixed: {selectedModelData.fixedParams.temperature})</span>
                  )}
                </label>
                <span className="text-sm font-mono text-primary">
                  {selectedModelData?.fixedParams?.temperature ?? temperature}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={selectedModelData?.fixedParams?.temperature ?? temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                disabled={!!selectedModelData?.fixedParams}
                className="w-full accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="flex justify-between text-xs text-on-surface-muted mt-1">
                <span>More precise (0)</span>
                <span>Balanced ({selectedProvider === 'anthropic' ? '0.7' : '1.0'})</span>
                <span>More creative (2)</span>
              </div>
            </div>

            {/* Max Tokens */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  Max Tokens
                </label>
                <span className="text-sm font-mono text-primary">{maxTokens.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min="256"
                max={selectedModelData?.maxTokens || 8192}
                step="256"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-on-surface-muted mt-1">
                <span>256</span>
                <span>{((selectedModelData?.maxTokens || 8192) / 2).toLocaleString()}</span>
                <span>{(selectedModelData?.maxTokens || 8192).toLocaleString()}</span>
              </div>
            </div>

            {/* Top P */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  Top P
                  {selectedModelData?.fixedParams && (
                    <span className="ml-2 text-xs text-warning">(Fixed: {selectedModelData.fixedParams.topP})</span>
                  )}
                </label>
                <span className="text-sm font-mono text-primary">
                  {selectedModelData?.fixedParams?.topP ?? topP}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={selectedModelData?.fixedParams?.topP ?? topP}
                onChange={(e) => setTopP(parseFloat(e.target.value))}
                disabled={!!selectedModelData?.fixedParams}
                className="w-full accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-on-surface-muted mt-1">
                Alternative to temperature. 1.0 means no filtering.
              </p>
            </div>

            {/* Presence Penalty */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  Presence Penalty
                  {selectedModelData?.fixedParams && (
                    <span className="ml-2 text-xs text-warning">(Fixed: {selectedModelData.fixedParams.presencePenalty})</span>
                  )}
                </label>
                <span className="text-sm font-mono text-primary">
                  {selectedModelData?.fixedParams?.presencePenalty ?? presencePenalty}
                </span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.1"
                value={selectedModelData?.fixedParams?.presencePenalty ?? presencePenalty}
                onChange={(e) => setPresencePenalty(parseFloat(e.target.value))}
                disabled={!!selectedModelData?.fixedParams}
                className="w-full accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Frequency Penalty */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-on-surface-secondary">
                  Frequency Penalty
                  {selectedModelData?.fixedParams && (
                    <span className="ml-2 text-xs text-warning">(Fixed: {selectedModelData.fixedParams.frequencyPenalty})</span>
                  )}
                </label>
                <span className="text-sm font-mono text-primary">
                  {selectedModelData?.fixedParams?.frequencyPenalty ?? frequencyPenalty}
                </span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.1"
                value={selectedModelData?.fixedParams?.frequencyPenalty ?? frequencyPenalty}
                onChange={(e) => setFrequencyPenalty(parseFloat(e.target.value))}
                disabled={!!selectedModelData?.fixedParams}
                className="w-full accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        )}
      </div>

      {/* Test Model Section */}
      <div className="border border-outline/20 rounded-xl overflow-hidden">
        <button
          onClick={() => toggleSection('test')}
          className="w-full flex items-center justify-between p-4 bg-surface-container-low/50 hover:bg-surface-container-low transition-colors"
        >
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-primary" />
            <span className="font-medium text-on-surface">
              {t('settings.ai.testModel') || 'Test Model'}
            </span>
          </div>
          {expandedSection === 'test' ? (
            <ChevronUp className="w-4 h-4 text-on-surface-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-on-surface-muted" />
          )}
        </button>
        
        {expandedSection === 'test' && (
          <div className="p-4 space-y-4">
            <p className="text-sm text-on-surface-muted">
              Send a test message to verify your {selectedModelData?.name || 'selected model'} configuration.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Enter a test message..."
                className="flex-1 px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-lg text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:border-primary/40 transition-colors"
                onKeyDown={(e) => e.key === 'Enter' && handleTestModel()}
              />
              <button
                onClick={handleTestModel}
                disabled={isTesting || !testMessage.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg font-medium transition-all disabled:opacity-50 hover:bg-primary/90"
              >
                {isTesting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Test
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between pt-4 border-t border-outline/20">
        <p className="text-sm text-on-surface-muted">
          {saved ? (
            <span className="text-success flex items-center gap-1">
              <Check className="w-4 h-4" />
              {t('settings.saved') || 'Settings saved'}
            </span>
          ) : (
            t('settings.unsavedChanges') || 'Unsaved changes'
          )}
        </p>
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl font-medium transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('settings.saving') || 'Saving...'}
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              {t('settings.save') || 'Save Settings'}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
