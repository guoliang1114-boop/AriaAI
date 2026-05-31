import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  Key,
  Loader2,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
  TestTube,
  Zap,
} from 'lucide-react'

import { api } from '../../api/client'
import { CxStatus } from '../../components/codex'

type ProviderKey = 'anthropic' | 'moonshot' | 'deepseek' | 'bigmodel' | 'mimo'

interface AIModel {
  id: string
  name: string
  provider: ProviderKey
  description: { zh: string; en: string }
  maxTokens: number
  supportsTools: boolean
  supportsVision: boolean
  icon: string
  useCase: { zh: string; en: string }
  fixedParams?: {
    temperature: number
    topP: number
    presencePenalty: number
    frequencyPenalty: number
  }
}

interface ProviderConfig {
  provider: ProviderKey
  name: string
  label: string
  description: { zh: string; en: string }
  statusEndpoint: string
  saveEndpoint: string
  placeholder: string
  link?: { href: string; label: string }
}

const models: AIModel[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude',
    provider: 'anthropic',
    description: {
      zh: '适合咨询分析、项目总结、客户沟通和稳定交付。',
      en: 'Balanced for consulting analysis, project summaries, client communication, and reliable delivery.',
    },
    maxTokens: 8192,
    supportsTools: true,
    supportsVision: true,
    icon: 'CL',
    useCase: { zh: '默认协作', en: 'Default' },
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku',
    provider: 'anthropic',
    description: {
      zh: '轻量快速，适合短对话、改写和低延迟日常任务。',
      en: 'Fast and lightweight for short chats, rewriting, and low-latency daily work.',
    },
    maxTokens: 8192,
    supportsTools: true,
    supportsVision: false,
    icon: 'CH',
    useCase: { zh: '快速响应', en: 'Fast' },
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    provider: 'moonshot',
    description: {
      zh: '长上下文与工具调用能力更强，适合大文档和复杂 Skill。',
      en: 'Stronger long-context and tool-use fit for large documents and complex Skills.',
    },
    maxTokens: 32768,
    supportsTools: true,
    supportsVision: true,
    fixedParams: { temperature: 1, topP: 0.95, presencePenalty: 0, frequencyPenalty: 0 },
    icon: 'KM',
    useCase: { zh: '长上下文', en: 'Long context' },
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4',
    provider: 'deepseek',
    description: {
      zh: '适合推理、代码和需要更强结构化输出的 agent 工作。',
      en: 'Useful for reasoning, coding, and agent work that needs structured output.',
    },
    maxTokens: 32768,
    supportsTools: true,
    supportsVision: false,
    icon: 'DS',
    useCase: { zh: '推理 / 代码', en: 'Reasoning' },
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    description: {
      zh: '更快的日常模型，适合普通对话、起草和轻量任务。',
      en: 'Faster daily model for chat, drafting, and lightweight tasks.',
    },
    maxTokens: 32768,
    supportsTools: true,
    supportsVision: false,
    icon: 'DF',
    useCase: { zh: '低延迟', en: 'Low latency' },
  },
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    provider: 'bigmodel',
    description: {
      zh: '国内模型备选，适合通用问答、推理和生产助手场景。',
      en: 'Domestic-model option for general Q&A, reasoning, and production assistant work.',
    },
    maxTokens: 8192,
    supportsTools: true,
    supportsVision: false,
    icon: 'GL',
    useCase: { zh: '国内备选', en: 'Backup' },
  },
  {
    id: 'mimo-v2.5-flash',
    name: 'MiMo V2.5 Flash',
    provider: 'mimo',
    description: {
      zh: '低延迟日常聊天、起草和轻量 agent 任务。',
      en: 'Low-latency chat, drafting, and lightweight agent tasks.',
    },
    maxTokens: 8192,
    supportsTools: true,
    supportsVision: false,
    icon: 'MI',
    useCase: { zh: '轻量任务', en: 'Lightweight' },
  },
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    provider: 'mimo',
    description: {
      zh: '更大的上下文与推理空间，适合长材料和深度分析。',
      en: 'Larger context and reasoning room for long materials and deeper analysis.',
    },
    maxTokens: 32000,
    supportsTools: true,
    supportsVision: false,
    icon: 'MP',
    useCase: { zh: '深度分析', en: 'Deep work' },
  },
]

const PROVIDERS: ProviderConfig[] = [
  {
    provider: 'anthropic',
    name: 'Anthropic',
    label: 'Claude',
    description: {
      zh: '默认咨询协作与项目交付模型。',
      en: 'Default consulting collaboration and delivery models.',
    },
    statusEndpoint: '/settings/api-key-status',
    saveEndpoint: '/settings/api-key',
    placeholder: 'sk-ant-api03-...',
  },
  {
    provider: 'moonshot',
    name: 'Moonshot',
    label: 'Kimi',
    description: {
      zh: '长上下文、文档理解和复杂 Skill 备选。',
      en: 'Long context, document understanding, and complex Skill fallback.',
    },
    statusEndpoint: '/settings/kimi-api-key-status',
    saveEndpoint: '/settings/kimi-api-key',
    placeholder: 'sk-...',
  },
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    label: 'DeepSeek',
    description: {
      zh: '推理、代码与结构化 agent 任务。',
      en: 'Reasoning, coding, and structured agent tasks.',
    },
    statusEndpoint: '/settings/deepseek-api-key-status',
    saveEndpoint: '/settings/deepseek-api-key',
    placeholder: 'sk-...',
    link: { href: 'https://platform.deepseek.com/api_keys', label: 'platform.deepseek.com' },
  },
  {
    provider: 'bigmodel',
    name: 'BigModel',
    label: 'GLM',
    description: {
      zh: '国内通用模型能力与备用通道。',
      en: 'Domestic general model capability and backup channel.',
    },
    statusEndpoint: '/settings/bigmodel-api-key-status',
    saveEndpoint: '/settings/bigmodel-api-key',
    placeholder: 'Enter BigModel API Key',
    link: { href: 'https://open.bigmodel.cn/usercenter/apikeys', label: 'open.bigmodel.cn' },
  },
  {
    provider: 'mimo',
    name: 'Xiaomi MiMo',
    label: 'MiMo',
    description: {
      zh: '轻量、快速和成本友好的备用能力。',
      en: 'Lightweight, fast, and cost-friendly backup capability.',
    },
    statusEndpoint: '/settings/mimo-api-key-status',
    saveEndpoint: '/settings/mimo-api-key',
    placeholder: 'Enter MiMo API Key',
    link: { href: 'https://platform.xiaomimimo.com', label: 'platform.xiaomimimo.com' },
  },
]

const PROVIDER_NAME: Record<ProviderKey, string> = PROVIDERS.reduce(
  (acc, item) => ({ ...acc, [item.provider]: item.name }),
  {} as Record<ProviderKey, string>,
)

const PROVIDER_TO_SETTING: Record<ProviderKey, string> = {
  anthropic: 'claude',
  moonshot: 'kimi',
  deepseek: 'deepseek',
  bigmodel: 'bigmodel',
  mimo: 'mimo',
}

const PAGE_STYLE: CSSProperties = {
  background: 'var(--color-codex-bg)',
  color: 'var(--color-codex-ink)',
  padding: '8px 4px 32px',
}

const CARD_STYLE: CSSProperties = {
  background: 'var(--color-codex-bg-elev)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-md, 6px)',
}

const PANEL_STYLE: CSSProperties = {
  ...CARD_STYLE,
  padding: 18,
}

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  background: 'var(--color-codex-bg)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  color: 'var(--color-codex-ink)',
  outline: 'none',
}

const LABEL_STYLE: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 500,
  color: 'var(--color-codex-ink-soft)',
}

const SMALL_BUTTON_STYLE: CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  background: 'var(--color-codex-bg)',
  color: 'var(--color-codex-ink-soft)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
}

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--color-codex-ink)',
  color: 'var(--color-codex-bg-elev)',
  borderRadius: 'var(--codex-r-sm, 3px)',
}

const TAG_STYLE: CSSProperties = {
  padding: '2px 8px',
  fontSize: 10.5,
  background: 'var(--color-codex-bg-tint)',
  color: 'var(--color-codex-ink-soft)',
  borderRadius: 'var(--codex-r-pill, 999px)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

function getProviderForModel(modelId: string): ProviderKey {
  const model = models.find((item) => item.id === modelId)
  if (model) return model.provider
  if (modelId.startsWith('kimi-') || modelId.startsWith('moonshot-')) return 'moonshot'
  if (modelId.startsWith('deepseek-')) return 'deepseek'
  if (modelId.startsWith('glm-')) return 'bigmodel'
  if (modelId.startsWith('mimo-') || modelId.startsWith('xiaomi/mimo-')) return 'mimo'
  return 'anthropic'
}

function getDefaultModelForProvider(provider: ProviderKey): string {
  return models.find((model) => model.provider === provider)?.id ?? 'claude-sonnet-4-6'
}

function normalizeNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div
      className="grid gap-3 py-4 md:grid-cols-[180px_minmax(0,1fr)]"
      style={{ borderTop: '1px solid var(--color-codex-line-soft)' }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-codex-ink)' }}>
          {label}
        </div>
        {hint ? (
          <div
            style={{
              marginTop: 4,
              fontSize: 11.5,
              lineHeight: 1.5,
              color: 'var(--color-codex-ink-mute)',
            }}
          >
            {hint}
          </div>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  )
}

function SectionTitle({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
          {title}
        </h2>
        {description ? (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 12.5,
              color: 'var(--color-codex-ink-mute)',
              lineHeight: 1.55,
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </div>
  )
}

export function AISettings() {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-6')
  const [apiKeys, setApiKeys] = useState<Record<ProviderKey, string>>({
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

  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<ProviderKey, boolean>>({
    anthropic: false,
    moonshot: false,
    deepseek: false,
    bigmodel: false,
    mimo: false,
  })
  const [testingProvider, setTestingProvider] = useState<ProviderKey | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const [isTesting, setIsTesting] = useState(false)

  const selectedModelData = useMemo(
    () => models.find((model) => model.id === selectedModel) ?? models[0],
    [selectedModel],
  )
  const selectedProvider = getProviderForModel(selectedModel)
  const selectedProviderConfig = PROVIDERS.find((provider) => provider.provider === selectedProvider)
  const selectedProviderConnected = !!apiKeyStatus[selectedProvider]
  const connectedProviders = PROVIDERS.filter((provider) => apiKeyStatus[provider.provider]).length
  const unsavedKeyCount = Object.values(apiKeys).filter((key) => key.trim()).length

  const loadSettings = async (showLoader = true) => {
    try {
      if (showLoader) setInitialLoading(true)
      setError('')

      const settings = await api.get<Record<string, string>>('/settings/')
      if (settings.selected_model) setSelectedModel(settings.selected_model)
      setTemperature(normalizeNumber(settings.temperature, 0.7))
      setMaxTokens(Math.round(normalizeNumber(settings.max_tokens, 8192)))
      setTopP(normalizeNumber(settings.top_p, 1.0))
      setPresencePenalty(normalizeNumber(settings.presence_penalty, 0))
      setFrequencyPenalty(normalizeNumber(settings.frequency_penalty, 0))

      const statuses = await Promise.all(
        PROVIDERS.map(async (provider) => {
          try {
            const result = await api.get<{ configured: boolean }>(provider.statusEndpoint)
            return [provider.provider, !!result.configured] as const
          } catch (err) {
            console.error(`[AISettings] Failed to get ${provider.provider} API key status:`, err)
            return [provider.provider, false] as const
          }
        }),
      )

      setApiKeyStatus(Object.fromEntries(statuses) as Record<ProviderKey, boolean>)
      setDirty(false)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || (isZh ? '加载设置失败' : 'Failed to load settings'))
    } finally {
      if (showLoader) setInitialLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setMaxTokens((current) => Math.min(current, selectedModelData.maxTokens))
  }, [selectedModelData.maxTokens])

  const markDirty = () => {
    setDirty(true)
    setSaved(false)
    setSuccessMessage('')
  }

  const handleModelSelect = (model: AIModel) => {
    setSelectedModel(model.id)
    setMaxTokens((current) => Math.min(current, model.maxTokens))
    markDirty()
  }

  const setProviderKey = (provider: ProviderKey, value: string) => {
    setApiKeys((current) => ({ ...current, [provider]: value }))
    setSaved(false)
    setSuccessMessage('')
  }

  const saveApiKeyIfNeeded = async (provider: ProviderKey) => {
    const key = apiKeys[provider]?.trim()
    if (!key) return false
    const config = PROVIDERS.find((item) => item.provider === provider)
    if (!config) return false
    await api.post(config.saveEndpoint, { api_key: key })
    setApiKeys((current) => ({ ...current, [provider]: '' }))
    setApiKeyStatus((current) => ({ ...current, [provider]: true }))
    return true
  }

  const handleTestConnection = async (provider: ProviderKey) => {
    setTestingProvider(provider)
    setError('')
    setSuccessMessage('')

    try {
      await saveApiKeyIfNeeded(provider)
      const model = selectedProvider === provider ? selectedModel : getDefaultModelForProvider(provider)
      const result = await api.post('/chat/test-connection', { provider, model })
      const res = result as { success: boolean; message?: string }

      if (res.success) {
        setApiKeyStatus((current) => ({ ...current, [provider]: true }))
        setSuccessMessage(
          isZh
            ? `${PROVIDER_NAME[provider]} 已连接`
            : `${PROVIDER_NAME[provider]} connection successful`,
        )
      } else {
        setError(res.message || (isZh ? '连接测试失败' : 'Connection test failed'))
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || (isZh ? '连接测试失败' : 'Connection test failed'))
    } finally {
      setTestingProvider(null)
    }
  }

  const handleSave = async () => {
    setLoading(true)
    setError('')
    setSuccessMessage('')

    try {
      const fixedParams = selectedModelData.fixedParams
      const effectiveTemperature = fixedParams?.temperature ?? temperature
      const effectiveTopP = fixedParams?.topP ?? topP
      const effectivePresencePenalty = fixedParams?.presencePenalty ?? presencePenalty
      const effectiveFrequencyPenalty = fixedParams?.frequencyPenalty ?? frequencyPenalty

      const settingsToSave = [
        api.put('/settings/selected_model', { value: selectedModel }),
        api.put('/settings/llm_provider', { value: PROVIDER_TO_SETTING[selectedProvider] }),
        api.put('/settings/ai_model', { value: selectedModel }),
        api.put('/settings/temperature', { value: effectiveTemperature.toString() }),
        api.put('/settings/max_tokens', { value: maxTokens.toString() }),
        api.put('/settings/top_p', { value: effectiveTopP.toString() }),
        api.put('/settings/presence_penalty', { value: effectivePresencePenalty.toString() }),
        api.put('/settings/frequency_penalty', { value: effectiveFrequencyPenalty.toString() }),
      ]

      PROVIDERS.forEach((provider) => {
        const key = apiKeys[provider.provider]?.trim()
        if (key) settingsToSave.push(api.post(provider.saveEndpoint, { api_key: key }))
      })

      await Promise.all(settingsToSave)
      setApiKeys({ anthropic: '', moonshot: '', deepseek: '', bigmodel: '', mimo: '' })
      await loadSettings(false)
      setDirty(false)
      setSaved(true)
      setSuccessMessage(isZh ? 'AI 配置已保存' : 'AI settings saved')
      setTimeout(() => {
        setSaved(false)
        setSuccessMessage('')
      }, 2600)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || (isZh ? '保存设置失败' : 'Failed to save settings'))
    } finally {
      setLoading(false)
    }
  }

  const handleTestModel = async () => {
    if (!testMessage.trim()) return

    setIsTesting(true)
    setError('')
    setSuccessMessage('')

    try {
      const fixedParams = selectedModelData.fixedParams
      const result = await api.post('/chat/test-model', {
        message: testMessage,
        model: selectedModel,
        temperature: fixedParams?.temperature ?? temperature,
        max_tokens: maxTokens,
      })

      const res = result as { success: boolean; message?: string; response?: string }
      if (res.success) {
        setSuccessMessage(
          res.response
            ? isZh
              ? `模型测试成功：${res.response}`
              : `Model test succeeded: ${res.response}`
            : isZh
              ? '模型测试成功'
              : 'Model test successful',
        )
      } else {
        setError(res.message || (isZh ? '模型测试失败' : 'Model test failed'))
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || (isZh ? '模型测试失败' : 'Model test failed'))
    } finally {
      setIsTesting(false)
    }
  }

  const renderParamSlider = (
    label: string,
    value: number,
    fixed: number | undefined,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
    hint?: string,
  ) => {
    const displayValue = fixed ?? value
    const disabled = fixed !== undefined
    return (
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label style={LABEL_STYLE}>
            {label}
            {disabled ? (
              <span className="ml-2 font-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-warn)' }}>
                {isZh ? `固定 ${fixed}` : `Fixed ${fixed}`}
              </span>
            ) : null}
          </label>
          <span className="font-mono" style={{ fontSize: 12, color: 'var(--color-codex-accent-ink)' }}>
            {displayValue}
          </span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          onChange={(event) => {
            onChange(Number(event.target.value))
            markDirty()
          }}
          disabled={disabled}
          className="w-full disabled:cursor-not-allowed disabled:opacity-50"
          style={{ accentColor: 'var(--color-codex-accent)' }}
        />
        {hint ? (
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
            {hint}
          </p>
        ) : null}
      </div>
    )
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

  return (
    <div className="theme-codex" style={PAGE_STYLE}>
      <header
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
        style={{ marginBottom: 20 }}
      >
        <div className="min-w-0">
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 500,
              color: 'var(--color-codex-ink)',
              letterSpacing: '-0.015em',
            }}
          >
            {isZh ? 'AI 模型' : 'AI Model'}
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 13,
              color: 'var(--color-codex-ink-mute)',
              lineHeight: 1.6,
              maxWidth: 680,
            }}
          >
            {isZh
              ? '先连接可用模型服务，再选择默认协作模型。高级参数默认收起，日常只需要确认服务已连接即可。'
              : 'Connect available model providers, then choose the default collaboration model. Advanced parameters stay tucked away for daily use.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={loading}
          className="inline-flex flex-shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          style={PRIMARY_BUTTON_STYLE}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {loading ? t('settings.saving') || (isZh ? '保存中...' : 'Saving...') : t('settings.save') || (isZh ? '保存设置' : 'Save Settings')}
        </button>
      </header>

      {error ? (
        <div
          className="mb-4 flex items-start gap-2"
          style={{
            padding: '10px 14px',
            fontSize: 13,
            background: 'color-mix(in oklch, var(--color-codex-bad) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-bad)',
          }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {successMessage ? (
        <div
          className="mb-4 flex items-start gap-2"
          style={{
            padding: '10px 14px',
            fontSize: 13,
            background: 'var(--color-codex-accent-bg)',
            border: '1px solid color-mix(in oklch, var(--color-codex-accent) 30%, transparent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            color: 'var(--color-codex-accent-ink)',
          }}
        >
          <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <section
        className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]"
        style={PANEL_STYLE}
      >
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <CxStatus tone={selectedProviderConnected ? 'good' : 'warn'} pulse={selectedProviderConnected}>
              {selectedProviderConnected ? (isZh ? '服务已连接' : 'Connected') : isZh ? '需要配置密钥' : 'Key required'}
            </CxStatus>
            {dirty || unsavedKeyCount > 0 ? (
              <CxStatus tone="warn">{isZh ? '有未保存修改' : 'Unsaved changes'}</CxStatus>
            ) : saved ? (
              <CxStatus tone="good">{t('settings.saved') || (isZh ? '已保存' : 'Saved')}</CxStatus>
            ) : null}
          </div>
          <div
            className="flex flex-col gap-4 md:flex-row md:items-end"
            style={{ borderTop: '1px solid var(--color-codex-line-soft)', paddingTop: 16 }}
          >
            <div className="min-w-0 flex-1">
              <div className="font-mono" style={{ fontSize: 11, color: 'var(--color-codex-ink-faint)' }}>
                {isZh ? '当前主模型' : 'Current primary model'}
              </div>
              <div
                className="mt-1 truncate"
                style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-codex-ink)' }}
              >
                {selectedModelData.name}
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--color-codex-ink-mute)' }}>
                {selectedProviderConfig?.name ?? PROVIDER_NAME[selectedProvider]} · {selectedModelData.useCase[isZh ? 'zh' : 'en']}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 md:w-[360px]">
              {[
                { label: isZh ? '服务商' : 'Provider', value: connectedProviders },
                { label: isZh ? '模型' : 'Models', value: models.length },
                { label: isZh ? '上限' : 'Max', value: `${Math.round(selectedModelData.maxTokens / 1000)}k` },
              ].map((item) => (
                <div key={item.label} style={{ paddingLeft: 14, borderLeft: '1px solid var(--color-codex-line-soft)' }}>
                  <div className="font-mono" style={{ fontSize: 20, color: 'var(--color-codex-ink)' }}>
                    {item.value}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: 14,
            background: 'var(--color-codex-bg)',
            border: '1px solid var(--color-codex-line-soft)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <div className="mb-3 flex items-center gap-2" style={{ fontSize: 13, fontWeight: 600 }}>
            <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--color-codex-accent)' }} />
            {isZh ? '推荐使用方式' : 'Recommended flow'}
          </div>
          <div className="space-y-2">
            {[
              isZh ? '先连接服务商密钥，测试通过后再选默认模型。' : 'Connect provider keys first, then pick the default model.',
              isZh ? '日常参数保持推荐值，只在调试时展开高级参数。' : 'Keep recommended parameters for daily use; expand advanced settings only when tuning.',
              isZh ? '测试模型用于验证真实调用链，不替代业务对话。' : 'Model testing verifies the real call path; it does not replace business chat.',
            ].map((line, index) => (
              <div key={line} className="flex gap-2" style={{ fontSize: 12.5, color: 'var(--color-codex-ink-soft)', lineHeight: 1.55 }}>
                <span className="font-mono" style={{ color: 'var(--color-codex-accent-ink)' }}>
                  {index + 1}
                </span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <SectionTitle
          title={isZh ? '1. 连接模型服务' : '1. Connect providers'}
          description={
            isZh
              ? '只需要配置你实际使用的服务商。测试连接时会使用已保存密钥；如果输入了新密钥，会先保存再测试。'
              : 'Configure only the providers you use. Testing uses saved keys; a newly entered key is saved before testing.'
          }
          action={
            <button
              type="button"
              onClick={() => void loadSettings(false)}
              className="inline-flex items-center gap-1.5"
              style={SMALL_BUTTON_STYLE}
            >
              <RefreshCw className="h-3 w-3" />
              {isZh ? '刷新状态' : 'Refresh status'}
            </button>
          }
        />

        <div className="grid gap-3 xl:grid-cols-2">
          {PROVIDERS.map((provider) => {
            const configured = apiKeyStatus[provider.provider]
            const pendingKey = apiKeys[provider.provider]?.trim().length > 0
            const isActiveProvider = selectedProvider === provider.provider
            const isTestingProvider = testingProvider === provider.provider
            return (
              <div
                key={provider.provider}
                style={{
                  ...CARD_STYLE,
                  padding: 16,
                  borderColor: isActiveProvider
                    ? 'color-mix(in oklch, var(--color-codex-accent) 38%, transparent)'
                    : 'var(--color-codex-line)',
                  background: isActiveProvider ? 'var(--color-codex-accent-bg)' : 'var(--color-codex-bg-elev)',
                }}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                    <span
                      className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center font-mono"
                      style={{
                        background: isActiveProvider ? 'var(--color-codex-bg-elev)' : 'var(--color-codex-bg-tint)',
                        color: 'var(--color-codex-ink)',
                        borderRadius: 'var(--codex-r-sm, 3px)',
                        fontSize: 11.5,
                        fontWeight: 600,
                      }}
                    >
                      {provider.label.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
                        {provider.name}
                      </div>
                      <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.5, color: 'var(--color-codex-ink-mute)' }}>
                        {provider.description[isZh ? 'zh' : 'en']}
                      </div>
                    </div>
                  </div>
                  <CxStatus tone={pendingKey ? 'warn' : configured ? 'good' : 'mute'}>
                    {pendingKey
                      ? isZh ? '待保存' : 'Pending'
                      : configured
                        ? isZh ? '已连接' : 'Connected'
                        : isZh ? '未配置' : 'Not set'}
                  </CxStatus>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    value={apiKeys[provider.provider]}
                    onChange={(event) => setProviderKey(provider.provider, event.target.value)}
                    placeholder={configured ? (isZh ? '已配置，输入新密钥可更新' : 'Configured. Enter a new key to update') : provider.placeholder}
                    style={{ ...INPUT_STYLE, flex: 1 }}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => void handleTestConnection(provider.provider)}
                    disabled={isTestingProvider}
                    className="inline-flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                    style={SMALL_BUTTON_STYLE}
                  >
                    {isTestingProvider ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
                    {isZh ? '测试' : 'Test'}
                  </button>
                </div>

                {provider.link ? (
                  <a
                    href={provider.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block hover:underline"
                    style={{ fontSize: 11.5, color: 'var(--color-codex-accent-ink)' }}
                  >
                    {isZh ? '获取 API Key：' : 'Get API key: '}
                    {provider.link.label}
                  </a>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <SectionTitle
          title={isZh ? '2. 默认模型' : '2. Default model'}
          description={
            isZh
              ? '选择 Aria 默认使用的协作模型。未来可以继续演进为按任务自动路由。'
              : 'Choose the default collaboration model. This can evolve into task-based routing later.'
          }
        />

        <div className="grid gap-3 lg:grid-cols-2">
          {models.map((model) => {
            const active = selectedModel === model.id
            const providerConnected = apiKeyStatus[model.provider]
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => handleModelSelect(model)}
                className="text-left transition-colors"
                style={{
                  padding: 16,
                  background: active ? 'var(--color-codex-accent-bg)' : 'var(--color-codex-bg-elev)',
                  border: active
                    ? '1px solid color-mix(in oklch, var(--color-codex-accent) 42%, transparent)'
                    : '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-md, 6px)',
                }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center font-mono"
                    style={{
                      background: active ? 'var(--color-codex-accent)' : 'var(--color-codex-bg-tint)',
                      color: active ? 'var(--color-codex-bg-elev)' : 'var(--color-codex-ink-soft)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    {model.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
                        {model.name}
                      </span>
                      <span style={TAG_STYLE}>{PROVIDER_NAME[model.provider]}</span>
                      <span style={{ ...TAG_STYLE, background: 'var(--color-codex-accent-bg)', color: 'var(--color-codex-accent-ink)' }}>
                        {model.useCase[isZh ? 'zh' : 'en']}
                      </span>
                      {active ? <CxStatus tone="accent">{isZh ? '在用' : 'Active'}</CxStatus> : null}
                    </div>
                    <p style={{ margin: '7px 0 0', fontSize: 12.5, lineHeight: 1.55, color: 'var(--color-codex-ink-mute)' }}>
                      {model.description[isZh ? 'zh' : 'en']}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span style={TAG_STYLE}>
                        {isZh ? '上下文 ' : 'Context '}
                        {model.maxTokens.toLocaleString()}
                      </span>
                      {model.supportsTools ? <span style={TAG_STYLE}>Tools</span> : null}
                      {model.supportsVision ? <span style={TAG_STYLE}>Vision</span> : null}
                      <CxStatus tone={providerConnected ? 'good' : 'warn'}>
                        {providerConnected ? (isZh ? '密钥可用' : 'Key ready') : isZh ? '需密钥' : 'Needs key'}
                      </CxStatus>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <button
          type="button"
          onClick={() => setShowAdvanced((current) => !current)}
          className="flex w-full items-center justify-between transition-colors"
          style={{
            ...CARD_STYLE,
            padding: 16,
            background: showAdvanced ? 'var(--color-codex-bg-tint)' : 'var(--color-codex-bg-elev)',
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-8 w-8 items-center justify-center"
              style={{
                background: 'var(--color-codex-accent-bg)',
                color: 'var(--color-codex-accent)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <Sliders className="h-4 w-4" />
            </span>
            <div className="text-left">
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
                {isZh ? '3. 高级参数' : '3. Advanced parameters'}
              </div>
              <div style={{ marginTop: 3, fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
                {isZh ? '默认使用推荐参数，只有调试模型行为时需要展开。' : 'Recommended defaults are used unless you need to tune model behavior.'}
              </div>
            </div>
          </div>
          <ChevronDown
            className="h-4 w-4 transition-transform"
            style={{
              color: 'var(--color-codex-ink-soft)',
              transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </button>

        {showAdvanced ? (
          <div style={{ ...CARD_STYLE, marginTop: 8, padding: '0 18px' }}>
            <FieldRow
              label="Temperature"
              hint={isZh ? '0 更稳定，2 更发散。部分模型会使用固定推荐值。' : '0 is deterministic, 2 is creative. Some models use fixed recommended values.'}
            >
              {renderParamSlider('Temperature', temperature, selectedModelData.fixedParams?.temperature, 0, 2, 0.1, setTemperature)}
            </FieldRow>
            <FieldRow label="Max Tokens" hint={isZh ? '单次响应上限。会受当前模型能力限制。' : 'Per-response output cap, limited by the selected model.'}>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label style={LABEL_STYLE}>Max Tokens</label>
                  <span className="font-mono" style={{ fontSize: 12, color: 'var(--color-codex-accent-ink)' }}>
                    {maxTokens.toLocaleString()}
                  </span>
                </div>
                <input
                  type="range"
                  min={256}
                  max={selectedModelData.maxTokens}
                  step={256}
                  value={Math.min(maxTokens, selectedModelData.maxTokens)}
                  onChange={(event) => {
                    setMaxTokens(Number(event.target.value))
                    markDirty()
                  }}
                  className="w-full"
                  style={{ accentColor: 'var(--color-codex-accent)' }}
                />
                <div className="mt-1 flex justify-between font-mono" style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)' }}>
                  <span>256</span>
                  <span>{Math.round(selectedModelData.maxTokens / 2).toLocaleString()}</span>
                  <span>{selectedModelData.maxTokens.toLocaleString()}</span>
                </div>
              </div>
            </FieldRow>
            <FieldRow label="Top P" hint={isZh ? '采样概率阈值；通常保持 1.0。' : 'Sampling threshold; usually leave at 1.0.'}>
              {renderParamSlider('Top P', topP, selectedModelData.fixedParams?.topP, 0, 1, 0.1, setTopP)}
            </FieldRow>
            <FieldRow label="Presence Penalty">
              {renderParamSlider('Presence Penalty', presencePenalty, selectedModelData.fixedParams?.presencePenalty, -2, 2, 0.1, setPresencePenalty)}
            </FieldRow>
            <FieldRow label="Frequency Penalty">
              {renderParamSlider('Frequency Penalty', frequencyPenalty, selectedModelData.fixedParams?.frequencyPenalty, -2, 2, 0.1, setFrequencyPenalty)}
            </FieldRow>

            <FieldRow
              label={isZh ? '降级策略' : 'Fallback policy'}
              hint={isZh ? '当前为系统内置策略，暂不单独配置。' : 'Currently system-managed and not individually configurable.'}
            >
              <div className="grid gap-2 md:grid-cols-3">
                {[
                  isZh ? '主模型失败时提示切换备用服务' : 'Prompt fallback when primary model fails',
                  isZh ? '限流时减少重试风暴' : 'Reduce retry storms during rate limits',
                  isZh ? '测试失败时保留当前配置' : 'Keep existing config when tests fail',
                ].map((line) => (
                  <div
                    key={line}
                    style={{
                      padding: '10px 12px',
                      background: 'var(--color-codex-bg)',
                      border: '1px solid var(--color-codex-line-soft)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                      fontSize: 12,
                      color: 'var(--color-codex-ink-soft)',
                      lineHeight: 1.5,
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </FieldRow>
          </div>
        ) : null}
      </section>

      <section style={PANEL_STYLE}>
        <SectionTitle
          title={isZh ? '4. 测试模型' : '4. Test model'}
          description={
            isZh
              ? `使用 ${selectedModelData.name} 发送一条真实测试请求，确认密钥、模型和参数都可用。`
              : `Send a real test request with ${selectedModelData.name} to verify key, model, and parameters.`
          }
        />
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            value={testMessage}
            onChange={(event) => setTestMessage(event.target.value)}
            placeholder={isZh ? '输入一条测试消息...' : 'Enter a test message...'}
            style={{ ...INPUT_STYLE, flex: 1 }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleTestModel()
            }}
          />
          <button
            type="button"
            onClick={() => void handleTestModel()}
            disabled={isTesting || !testMessage.trim()}
            className="inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              background: 'var(--color-codex-accent)',
              color: 'var(--color-codex-bg-elev)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {isZh ? '发送测试' : 'Run test'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2" style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
          <Bot className="h-3.5 w-3.5" />
          <span>
            {isZh
              ? `当前测试模型：${selectedModelData.name} · ${PROVIDER_NAME[selectedProvider]}`
              : `Testing: ${selectedModelData.name} · ${PROVIDER_NAME[selectedProvider]}`}
          </span>
          <span style={TAG_STYLE}>{selectedModel}</span>
        </div>
      </section>
    </div>
  )
}
