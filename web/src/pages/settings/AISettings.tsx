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
  TestTube,
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
  fixedParams?: {
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

// Shared Codex style tokens (avoid repeating them inline 30+ times).
const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13.5,
  background: 'var(--color-codex-bg)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  color: 'var(--color-codex-ink)',
  outline: 'none',
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 500,
  color: 'var(--color-codex-ink-soft)',
}

const SECTION_BOX_STYLE: React.CSSProperties = {
  background: 'var(--color-codex-bg-elev)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-md, 6px)',
  overflow: 'hidden',
}

const SECTION_HEADER_STYLE: React.CSSProperties = {
  background: 'var(--color-codex-bg-tint)',
  borderBottom: '1px solid var(--color-codex-line-soft)',
}

const SECTION_BODY_STYLE: React.CSSProperties = {
  padding: 16,
}

const CHIP_STYLE: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 10.5,
  background: 'var(--color-codex-bg-tint)',
  color: 'var(--color-codex-ink-soft)',
  borderRadius: 'var(--codex-r-pill, 999px)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const ACCENT_CHIP_STYLE: React.CSSProperties = {
  ...CHIP_STYLE,
  background: 'var(--color-codex-accent-bg)',
  color: 'var(--color-codex-accent-ink)',
}

type ProviderKey = 'anthropic' | 'moonshot' | 'deepseek' | 'bigmodel' | 'mimo'

interface ApiKeyRowConfig {
  provider: ProviderKey
  label: string
  placeholder: (configured: boolean) => string
  link?: { href: string; label: string }
}

const API_KEY_ROWS: ApiKeyRowConfig[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic API Key',
    placeholder: (c) => (c ? 'Configured (enter to update)' : 'sk-ant-api03-...'),
  },
  {
    provider: 'moonshot',
    label: 'Moonshot API Key',
    placeholder: (c) => (c ? 'Configured (enter to update)' : '...'),
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek API Key',
    placeholder: (c) => (c ? 'Configured (enter to update)' : 'sk-...'),
    link: { href: 'https://platform.deepseek.com/api_keys', label: 'platform.deepseek.com' },
  },
  {
    provider: 'bigmodel',
    label: 'BigModel API Key',
    placeholder: (c) => (c ? 'Configured (enter to update)' : 'Enter BigModel API Key'),
    link: { href: 'https://open.bigmodel.cn/usercenter/apikeys', label: 'open.bigmodel.cn' },
  },
  {
    provider: 'mimo',
    label: 'Xiaomi MiMo API Key',
    placeholder: (c) => (c ? 'Configured (enter to update)' : 'Enter MiMo API Key'),
    link: { href: 'https://platform.xiaomimimo.com', label: 'platform.xiaomimimo.com' },
  },
]

export function AISettings() {
  const { t } = useTranslation()

  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-6')

  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    anthropic: '',
    moonshot: '',
    deepseek: '',
    bigmodel: '',
    mimo: '',
  })

  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(8192)
  const [topP, setTopP] = useState(1.0)
  const [presencePenalty, setPresencePenalty] = useState(0)
  const [frequencyPenalty, setFrequencyPenalty] = useState(0)

  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({})
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<string | null>('model')

  const [testMessage, setTestMessage] = useState('')
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setInitialLoading(true)
      setError('')

      const settings = await api.get<Record<string, string>>('/settings/')

      if (settings.selected_model) setSelectedModel(settings.selected_model)
      if (settings.temperature) setTemperature(parseFloat(settings.temperature))
      if (settings.max_tokens) setMaxTokens(parseInt(settings.max_tokens))
      if (settings.top_p) setTopP(parseFloat(settings.top_p))
      if (settings.presence_penalty) setPresencePenalty(parseFloat(settings.presence_penalty))
      if (settings.frequency_penalty) setFrequencyPenalty(parseFloat(settings.frequency_penalty))

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

      const settingsToSave = [
        api.put('/settings/selected_model', { value: selectedModel }),
        api.put('/settings/llm_provider', { value: provider }),
        api.put('/settings/ai_model', { value: selectedModel }),
        api.put('/settings/temperature', { value: temperature.toString() }),
        api.put('/settings/max_tokens', { value: maxTokens.toString() }),
        api.put('/settings/top_p', { value: topP.toString() }),
        api.put('/settings/presence_penalty', { value: presencePenalty.toString() }),
        api.put('/settings/frequency_penalty', { value: frequencyPenalty.toString() }),
      ]

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
          settingsToSave.push(api.post(endpoint, { api_key: key.trim() }))
        }
      })

      await Promise.all(settingsToSave)

      setSaved(true)
      setSuccessMessage(t('settings.saved') || 'Settings saved successfully')

      setApiKeys({
        anthropic: '',
        moonshot: '',
        deepseek: '',
        bigmodel: '',
        mimo: '',
      })

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
      const result = await api.post('/chat/test-connection', {
        provider,
        model: selectedModel,
      })

      const res = result as { success: boolean; message?: string }
      if (res.success) {
        setSuccessMessage(
          t('settings.ai.testSuccess', { provider: providerNames[provider] }) ||
            `${providerNames[provider]} connection successful`,
        )
        setApiKeyStatus((prev) => ({ ...prev, [provider]: true }))
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
      const modelData = models.find((m) => m.id === selectedModel)
      const effectiveParams = modelData?.fixedParams || {
        temperature,
        topP,
        presencePenalty,
        frequencyPenalty,
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

  const selectedModelData = models.find((m) => m.id === selectedModel)
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
      <div
        className="theme-codex flex items-center justify-center py-12"
        style={{ background: 'var(--color-codex-bg)' }}
      >
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--color-codex-accent)' }} />
      </div>
    )
  }

  const renderSectionHeader = (
    sectionKey: string,
    Icon: typeof Bot,
    label: string,
  ) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="flex w-full items-center justify-between p-4 transition-colors"
      style={SECTION_HEADER_STYLE}
    >
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4" style={{ color: 'var(--color-codex-accent)' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
          {label}
        </span>
      </div>
      {expandedSection === sectionKey ? (
        <ChevronUp className="h-4 w-4" style={{ color: 'var(--color-codex-ink-soft)' }} />
      ) : (
        <ChevronDown className="h-4 w-4" style={{ color: 'var(--color-codex-ink-soft)' }} />
      )}
    </button>
  )

  const renderParamSlider = (
    label: string,
    value: number,
    fixed: number | undefined,
    min: number,
    max: number,
    step: number,
    onChange: (n: number) => void,
    extra?: React.ReactNode,
  ) => {
    const displayValue = fixed ?? value
    const disabled = fixed !== undefined
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label style={LABEL_STYLE}>
            {label}
            {disabled && (
              <span
                className="ml-2 font-mono"
                style={{ fontSize: 10.5, color: 'var(--color-codex-warn)' }}
              >
                (Fixed: {fixed})
              </span>
            )}
          </label>
          <span
            className="font-mono"
            style={{
              fontSize: 12,
              color: 'var(--color-codex-accent-ink)',
            }}
          >
            {displayValue}
          </span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={disabled}
          className="w-full disabled:cursor-not-allowed disabled:opacity-50"
          style={{ accentColor: 'var(--color-codex-accent)' }}
        />
        {extra}
      </div>
    )
  }

  return (
    <div
      className="theme-codex"
      style={{
        background: 'var(--color-codex-bg)',
        color: 'var(--color-codex-ink)',
        padding: '8px 4px 32px',
      }}
    >
      <header style={{ marginBottom: 20 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 500,
            color: 'var(--color-codex-ink)',
            letterSpacing: '-0.015em',
          }}
        >
          {t('settings.ai.title') || 'AI Model Configuration'}
        </h1>
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 13,
            color: 'var(--color-codex-ink-mute)',
            lineHeight: 1.6,
          }}
        >
          {t('settings.ai.subtitle') || 'Configure your AI providers and model parameters'}
        </p>
      </header>

      {error && (
        <div
          className="mb-4 flex items-center gap-2"
          style={{
            padding: '10px 14px',
            fontSize: 13,
            background: 'color-mix(in oklch, var(--color-codex-bad) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-bad)',
          }}
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {successMessage && (
        <div
          className="mb-4 flex items-center gap-2"
          style={{
            padding: '10px 14px',
            fontSize: 13,
            background: 'var(--color-codex-accent-bg)',
            border: '1px solid color-mix(in oklch, var(--color-codex-accent) 30%, transparent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-accent-ink)',
          }}
        >
          <Check className="h-4 w-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}

      {/* Model Selection */}
      <div className="mb-4" style={SECTION_BOX_STYLE}>
        {renderSectionHeader('model', Bot, t('settings.ai.modelSelection') || 'Model Selection')}
        {expandedSection === 'model' && (
          <div style={SECTION_BODY_STYLE}>
            <div className="grid gap-2">
              {models.map((model) => {
                const isSelected = selectedModel === model.id
                return (
                  <div
                    key={model.id}
                    onClick={() => handleModelSelect(model)}
                    className="cursor-pointer transition-all"
                    style={{
                      padding: 14,
                      background: isSelected
                        ? 'var(--color-codex-accent-bg)'
                        : 'var(--color-codex-bg)',
                      border: isSelected
                        ? '1px solid color-mix(in oklch, var(--color-codex-accent) 40%, transparent)'
                        : '1px solid var(--color-codex-line-soft)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center"
                        style={{
                          background: isSelected
                            ? 'var(--color-codex-accent)'
                            : 'var(--color-codex-bg-elev)',
                          border: isSelected
                            ? '1px solid var(--color-codex-accent)'
                            : '1px solid var(--color-codex-line)',
                          borderRadius: 'var(--codex-r-pill, 999px)',
                        }}
                      >
                        {isSelected && (
                          <div
                            style={{
                              width: 6,
                              height: 6,
                              background: 'var(--color-codex-bg-elev)',
                              borderRadius: 'var(--codex-r-pill, 999px)',
                            }}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="font-mono"
                            style={{
                              padding: '2px 6px',
                              fontSize: 10.5,
                              fontWeight: 600,
                              background: 'var(--color-codex-bg-tint)',
                              color: 'var(--color-codex-ink-soft)',
                              borderRadius: 'var(--codex-r-sm, 3px)',
                              letterSpacing: '0.04em',
                            }}
                          >
                            {model.icon}
                          </span>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: 'var(--color-codex-ink)',
                            }}
                          >
                            {model.name}
                          </span>
                          <span style={CHIP_STYLE}>{providerNames[model.provider]}</span>
                          {model.supportsTools && <span style={ACCENT_CHIP_STYLE}>Tools</span>}
                          {model.supportsVision && <span style={ACCENT_CHIP_STYLE}>Vision</span>}
                        </div>
                        <p
                          style={{
                            margin: '6px 0 0',
                            fontSize: 12,
                            lineHeight: 1.55,
                            color: 'var(--color-codex-ink-mute)',
                          }}
                        >
                          {model.description}
                        </p>
                        <p
                          className="font-mono"
                          style={{
                            margin: '4px 0 0',
                            fontSize: 11,
                            color: 'var(--color-codex-ink-mute)',
                          }}
                        >
                          max tokens: {model.maxTokens.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* API Keys */}
      <div className="mb-4" style={SECTION_BOX_STYLE}>
        {renderSectionHeader('apikeys', Key, t('settings.ai.apiKeys') || 'API Keys')}
        {expandedSection === 'apikeys' && (
          <div style={SECTION_BODY_STYLE}>
            <div className="mb-3 flex items-center justify-between">
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: 'var(--color-codex-ink-mute)',
                }}
              >
                API keys are stored securely and encrypted.
              </p>
              <button
                onClick={loadSettings}
                disabled={initialLoading}
                className="flex items-center gap-1.5 disabled:opacity-50"
                style={{
                  padding: '5px 10px',
                  fontSize: 11.5,
                  background: 'var(--color-codex-bg)',
                  color: 'var(--color-codex-ink-soft)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                {initialLoading ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Refresh Status
              </button>
            </div>

            <div className="space-y-3">
              {API_KEY_ROWS.map((row) => {
                const configured = apiKeyStatus[row.provider]
                const isTesting = testingProvider === row.provider
                return (
                  <div
                    key={row.provider}
                    style={{
                      padding: 14,
                      background: 'var(--color-codex-bg)',
                      border: '1px solid var(--color-codex-line-soft)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <label style={LABEL_STYLE}>
                        {row.label}
                        {configured && (
                          <span
                            className="ml-2 font-mono"
                            style={{ fontSize: 10.5, color: 'var(--color-codex-accent-ink)' }}
                          >
                            ● Configured
                          </span>
                        )}
                      </label>
                      <button
                        onClick={() => handleTestConnection(row.provider)}
                        disabled={isTesting}
                        className="flex items-center gap-1.5 disabled:opacity-50"
                        style={{
                          padding: '5px 10px',
                          fontSize: 11.5,
                          background: 'var(--color-codex-bg-elev)',
                          color: 'var(--color-codex-ink-soft)',
                          border: '1px solid var(--color-codex-line)',
                          borderRadius: 'var(--codex-r-sm, 3px)',
                        }}
                      >
                        {isTesting ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <TestTube className="h-3 w-3" />
                        )}
                        Test
                      </button>
                    </div>
                    <input
                      type="password"
                      value={apiKeys[row.provider]}
                      onChange={(e) =>
                        setApiKeys((prev) => ({ ...prev, [row.provider]: e.target.value }))
                      }
                      placeholder={row.placeholder(configured)}
                      style={INPUT_STYLE}
                    />
                    {row.link && (
                      <p
                        style={{
                          margin: '6px 0 0',
                          fontSize: 11,
                          color: 'var(--color-codex-ink-mute)',
                        }}
                      >
                        Get your API key from{' '}
                        <a
                          href={row.link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          style={{ color: 'var(--color-codex-accent-ink)' }}
                        >
                          {row.link.label}
                        </a>
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Parameters */}
      <div className="mb-4" style={SECTION_BOX_STYLE}>
        {renderSectionHeader('parameters', Sliders, t('settings.ai.parameters') || 'Model Parameters')}
        {expandedSection === 'parameters' && (
          <div style={{ ...SECTION_BODY_STYLE, display: 'flex', flexDirection: 'column', gap: 24 }}>
            {renderParamSlider(
              'Temperature',
              temperature,
              selectedModelData?.fixedParams?.temperature,
              0,
              2,
              0.1,
              setTemperature,
              <div
                className="mt-1 flex justify-between font-mono"
                style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)' }}
              >
                <span>Precise (0)</span>
                <span>Balanced ({selectedProvider === 'anthropic' ? '0.7' : '1.0'})</span>
                <span>Creative (2)</span>
              </div>,
            )}

            {/* Max Tokens — own slider (no fixedParams) */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label style={LABEL_STYLE}>Max Tokens</label>
                <span
                  className="font-mono"
                  style={{ fontSize: 12, color: 'var(--color-codex-accent-ink)' }}
                >
                  {maxTokens.toLocaleString()}
                </span>
              </div>
              <input
                type="range"
                min={256}
                max={selectedModelData?.maxTokens || 8192}
                step={256}
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                className="w-full"
                style={{ accentColor: 'var(--color-codex-accent)' }}
              />
              <div
                className="mt-1 flex justify-between font-mono"
                style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)' }}
              >
                <span>256</span>
                <span>{((selectedModelData?.maxTokens || 8192) / 2).toLocaleString()}</span>
                <span>{(selectedModelData?.maxTokens || 8192).toLocaleString()}</span>
              </div>
            </div>

            {renderParamSlider(
              'Top P',
              topP,
              selectedModelData?.fixedParams?.topP,
              0,
              1,
              0.1,
              setTopP,
              <p
                style={{
                  margin: '6px 0 0',
                  fontSize: 11,
                  color: 'var(--color-codex-ink-mute)',
                }}
              >
                Alternative to temperature. 1.0 means no filtering.
              </p>,
            )}

            {renderParamSlider(
              'Presence Penalty',
              presencePenalty,
              selectedModelData?.fixedParams?.presencePenalty,
              -2,
              2,
              0.1,
              setPresencePenalty,
            )}

            {renderParamSlider(
              'Frequency Penalty',
              frequencyPenalty,
              selectedModelData?.fixedParams?.frequencyPenalty,
              -2,
              2,
              0.1,
              setFrequencyPenalty,
            )}
          </div>
        )}
      </div>

      {/* Test Model */}
      <div className="mb-4" style={SECTION_BOX_STYLE}>
        {renderSectionHeader('test', Zap, t('settings.ai.testModel') || 'Test Model')}
        {expandedSection === 'test' && (
          <div style={SECTION_BODY_STYLE}>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 12.5,
                color: 'var(--color-codex-ink-mute)',
              }}
            >
              Send a test message to verify your {selectedModelData?.name || 'selected model'} configuration.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Enter a test message..."
                style={{ ...INPUT_STYLE, flex: 1 }}
                onKeyDown={(e) => e.key === 'Enter' && handleTestModel()}
              />
              <button
                onClick={handleTestModel}
                disabled={isTesting || !testMessage.trim()}
                className="flex items-center gap-2 disabled:opacity-50"
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  background: 'var(--color-codex-accent)',
                  color: 'var(--color-codex-bg-elev)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                {isTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Test
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Save bar */}
      <div
        className="flex items-center justify-between"
        style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: '1px solid var(--color-codex-line)',
        }}
      >
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-codex-ink-mute)' }}>
          {saved ? (
            <span
              className="flex items-center gap-1"
              style={{ color: 'var(--color-codex-accent-ink)' }}
            >
              <Check className="h-4 w-4" />
              {t('settings.saved') || 'Settings saved'}
            </span>
          ) : (
            t('settings.unsavedChanges') || 'Unsaved changes'
          )}
        </p>
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex items-center gap-2 disabled:opacity-50"
          style={{
            padding: '10px 20px',
            fontSize: 13,
            fontWeight: 500,
            background: 'var(--color-codex-accent)',
            color: 'var(--color-codex-bg-elev)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('settings.saving') || 'Saving...'}
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              {t('settings.save') || 'Save Settings'}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
