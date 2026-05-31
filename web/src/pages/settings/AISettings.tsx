import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Key,
  Layers,
  Loader2,
  Sparkles,
  Zap,
} from 'lucide-react'

import { api } from '../../api/client'
import { CxStatus } from '../../components/codex'

type ProviderKey = 'anthropic' | 'deepseek' | 'moonshot' | 'bigmodel' | 'openai' | 'mimo'

interface ModelOption {
  id: string
  label: string
  provider: ProviderKey
  maxTokens: number
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
  subtitle: string
  initials: string
  statusEndpoint: string
  saveEndpoint: string
  placeholder: string
  defaultModel: string
  link?: { href: string; label: string }
  defaultWarning?: boolean
}

const MODEL_OPTIONS: ModelOption[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.5', provider: 'anthropic', maxTokens: 8192 },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku', provider: 'anthropic', maxTokens: 8192 },
  {
    id: 'kimi-k2.6',
    label: 'Kimi K2.6',
    provider: 'moonshot',
    maxTokens: 32768,
    fixedParams: { temperature: 1, topP: 0.95, presencePenalty: 0, frequencyPenalty: 0 },
  },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4', provider: 'deepseek', maxTokens: 32768 },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek', maxTokens: 32768 },
  { id: 'glm-5.1', label: 'GLM-5.1', provider: 'bigmodel', maxTokens: 8192 },
  { id: 'mimo-v2.5-flash', label: 'MiMo V2.5 Flash', provider: 'mimo', maxTokens: 8192 },
  { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro', provider: 'mimo', maxTokens: 32000 },
]

const PROVIDERS: ProviderConfig[] = [
  {
    provider: 'anthropic',
    name: 'Anthropic',
    subtitle: 'Claude Sonnet · Haiku',
    initials: 'A',
    statusEndpoint: '/settings/api-key-status',
    saveEndpoint: '/settings/api-key',
    placeholder: '粘贴 Anthropic API Key',
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    provider: 'deepseek',
    name: 'DeepSeek 深度求索',
    subtitle: 'DeepSeek V4 · V4 Flash',
    initials: 'DS',
    statusEndpoint: '/settings/deepseek-api-key-status',
    saveEndpoint: '/settings/deepseek-api-key',
    placeholder: '粘贴 DeepSeek API Key',
    defaultModel: 'deepseek-v4-pro',
    link: { href: 'https://platform.deepseek.com/api_keys', label: 'DeepSeek 控制台' },
  },
  {
    provider: 'moonshot',
    name: 'Moonshot 月之暗面',
    subtitle: 'Kimi K2.6 · 长上下文',
    initials: 'KM',
    statusEndpoint: '/settings/kimi-api-key-status',
    saveEndpoint: '/settings/kimi-api-key',
    placeholder: '粘贴 Moonshot API Key',
    defaultModel: 'kimi-k2.6',
  },
  {
    provider: 'bigmodel',
    name: '智谱 GLM',
    subtitle: 'GLM-5.1',
    initials: 'GL',
    statusEndpoint: '/settings/bigmodel-api-key-status',
    saveEndpoint: '/settings/bigmodel-api-key',
    placeholder: '粘贴智谱 GLM API Key',
    defaultModel: 'glm-5.1',
    link: { href: 'https://open.bigmodel.cn/usercenter/apikeys', label: '智谱控制台' },
    defaultWarning: true,
  },
  {
    provider: 'openai',
    name: 'OpenAI',
    subtitle: 'GPT-5 · GPT-5 mini',
    initials: 'O',
    statusEndpoint: '/settings/openai-api-key-status',
    saveEndpoint: '/settings/openai-api-key',
    placeholder: '粘贴 OpenAI API Key',
    defaultModel: 'claude-sonnet-4-6',
    link: { href: 'https://platform.openai.com/api-keys', label: 'OpenAI 控制台' },
  },
  {
    provider: 'mimo',
    name: '小米 MiMo',
    subtitle: 'MiMo V2.5 Flash',
    initials: 'MI',
    statusEndpoint: '/settings/mimo-api-key-status',
    saveEndpoint: '/settings/mimo-api-key',
    placeholder: '粘贴小米 MiMo API Key',
    defaultModel: 'mimo-v2.5-flash',
    link: { href: 'https://platform.xiaomimimo.com', label: 'MiMo 控制台' },
  },
]

const PROVIDER_TO_SETTING: Partial<Record<ProviderKey, string>> = {
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

const GHOST_BUTTON_STYLE: CSSProperties = {
  padding: '8px 12px',
  fontSize: 12.5,
  color: 'var(--color-codex-ink-soft)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  background: 'var(--color-codex-bg-elev)',
}

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  padding: '10px 18px',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--color-codex-bg-elev)',
  background: 'var(--color-codex-ink)',
  borderRadius: 'var(--codex-r-sm, 3px)',
}

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  height: 38,
  padding: '0 12px',
  fontSize: 13,
  color: 'var(--color-codex-ink)',
  background: 'var(--color-codex-bg)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
  outline: 'none',
}

const SELECT_STYLE: CSSProperties = {
  minWidth: 176,
  height: 38,
  padding: '0 34px 0 14px',
  fontSize: 13,
  color: 'var(--color-codex-ink)',
  background: 'var(--color-codex-bg-elev)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-sm, 3px)',
}

function getModelLabel(modelId: string): string {
  return MODEL_OPTIONS.find((model) => model.id === modelId)?.label || modelId
}

function getModel(modelId: string): ModelOption {
  return MODEL_OPTIONS.find((model) => model.id === modelId) || MODEL_OPTIONS[0]
}

function getProviderForModel(modelId: string): ProviderKey {
  return getModel(modelId).provider
}

function formatRelativeTime(timestamp: number | null, isZh: boolean): string {
  if (!timestamp) return isZh ? '暂无记录' : 'No recent test'
  const elapsedMs = Date.now() - timestamp
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60000))
  if (elapsedMinutes < 1) return isZh ? '刚刚' : 'just now'
  if (elapsedMinutes < 60) {
    return isZh ? `${elapsedMinutes} 分钟前` : `${elapsedMinutes} min ago`
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return isZh ? `${elapsedHours} 小时前` : `${elapsedHours} hr ago`
  }
  const elapsedDays = Math.floor(elapsedHours / 24)
  return isZh ? `${elapsedDays} 天前` : `${elapsedDays} days ago`
}

function getStatusCopy(
  provider: ProviderConfig,
  configured: boolean,
  pending: boolean,
  isZh: boolean,
): { tone: 'good' | 'warn' | 'accent' | 'mute'; label: string } {
  if (pending) return { tone: 'accent', label: isZh ? '待保存' : 'Pending' }
  if (configured) return { tone: 'good', label: isZh ? '已连接' : 'Connected' }
  if (provider.defaultWarning) return { tone: 'warn', label: isZh ? '额度异常' : 'Quota issue' }
  return { tone: 'accent', label: isZh ? '配置 Key' : 'Configure key' }
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 8,
        fontSize: 12.5,
        fontWeight: 500,
        color: 'var(--color-codex-ink-soft)',
      }}
    >
      {children}
    </div>
  )
}

function SectionHeader({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--color-codex-ink-mute)',
        }}
      >
        {title}
      </h2>
      {hint ? (
        <span style={{ fontSize: 12, color: 'var(--color-codex-ink-faint)' }}>{hint}</span>
      ) : null}
    </div>
  )
}

function StrategyIcon({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center"
      style={{
        background: 'var(--color-codex-bg-tint)',
        color: 'var(--color-codex-accent)',
        borderRadius: 'var(--codex-r-sm, 3px)',
      }}
    >
      {children}
    </span>
  )
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className="inline-flex items-center"
      style={{
        width: 36,
        height: 20,
        padding: 2,
        borderRadius: 999,
        background: on ? 'var(--color-codex-accent)' : 'var(--color-codex-line-strong)',
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 999,
          background: 'var(--color-codex-bg-elev)',
          transform: on ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 0.15s ease',
        }}
      />
    </span>
  )
}

function ProviderStatus({
  status,
  needsKey,
}: {
  status: { tone: 'good' | 'warn' | 'accent' | 'mute'; label: string }
  needsKey: boolean
}) {
  if (needsKey) {
    return (
      <span
        className="inline-flex items-center gap-1 font-mono"
        style={{ color: 'var(--color-codex-accent-ink)', fontSize: 11.5, fontWeight: 500 }}
      >
        <span style={{ fontSize: 13 }}>+</span>
        {status.label}
      </span>
    )
  }
  return <CxStatus tone={status.tone}>{status.label}</CxStatus>
}

export function AISettings() {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')

  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-6')
  const [strategyModels, setStrategyModels] = useState({
    default: 'claude-sonnet-4-6',
    fast: 'deepseek-v4-flash',
    document: 'kimi-k2.6',
    lowCost: 'deepseek-v4-pro',
  })
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(8192)
  const [topP, setTopP] = useState(1.0)
  const [providerKeys, setProviderKeys] = useState<Record<ProviderKey, string>>({
    anthropic: '',
    deepseek: '',
    moonshot: '',
    bigmodel: '',
    openai: '',
    mimo: '',
  })
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<ProviderKey, boolean>>({
    anthropic: false,
    deepseek: false,
    moonshot: false,
    bigmodel: false,
    openai: false,
    mimo: false,
  })
  const [expandedProvider, setExpandedProvider] = useState<ProviderKey | null>(null)
  const [smartRouting, setSmartRouting] = useState(true)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [testingProvider, setTestingProvider] = useState<ProviderKey | null>(null)
  const [lastSuccessfulTestAt, setLastSuccessfulTestAt] = useState<number | null>(null)
  const [testMessage, setTestMessage] = useState('')
  const [isTestingModel, setIsTestingModel] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const connectedCount = useMemo(
    () => Object.values(apiKeyStatus).filter(Boolean).length,
    [apiKeyStatus],
  )
  const selectedModelData = getModel(selectedModel)
  const selectedProvider = getProviderForModel(selectedModel)
  const selectedProviderName = PROVIDERS.find((provider) => provider.provider === selectedProvider)?.name || selectedProvider
  const lastSuccessfulTestCopy = formatRelativeTime(lastSuccessfulTestAt, isZh)

  const clearTransient = () => {
    setSaved(false)
    setSuccessMessage('')
    setError('')
  }

  const markDirty = () => {
    setDirty(true)
    clearTransient()
  }

  const loadSettings = async () => {
    try {
      setInitialLoading(true)
      setError('')
      const settings = await api.get<Record<string, string>>('/settings/')
      const nextModel = settings.selected_model || 'claude-sonnet-4-6'
      setSelectedModel(nextModel)
      setStrategyModels((current) => ({ ...current, default: nextModel }))
      setTemperature(Number(settings.temperature || 0.7))
      setMaxTokens(Number(settings.max_tokens || 8192))
      setTopP(Number(settings.top_p || 1))

      const statuses = await Promise.all(
        PROVIDERS.map(async (provider) => {
          try {
            const result = await api.get<{ configured?: boolean }>(provider.statusEndpoint)
            return [provider.provider, !!result.configured] as const
          } catch (err) {
            console.error(`[AISettings] failed to load ${provider.provider} key status`, err)
            return [provider.provider, false] as const
          }
        }),
      )
      setApiKeyStatus(Object.fromEntries(statuses) as Record<ProviderKey, boolean>)
      setDirty(false)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || (isZh ? '加载 AI 设置失败' : 'Failed to load AI settings'))
    } finally {
      setInitialLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateProviderKey = (provider: ProviderKey, value: string) => {
    setProviderKeys((current) => ({ ...current, [provider]: value }))
    clearTransient()
  }

  const saveProviderKey = async (provider: ProviderKey): Promise<boolean> => {
    const config = PROVIDERS.find((item) => item.provider === provider)
    const apiKey = providerKeys[provider].trim()
    if (!config || !apiKey) return false

    await api.post(config.saveEndpoint, { api_key: apiKey })
    setProviderKeys((current) => ({ ...current, [provider]: '' }))
    setApiKeyStatus((current) => ({ ...current, [provider]: true }))
    return true
  }

  const testProvider = async (provider: ProviderKey) => {
    setTestingProvider(provider)
    setError('')
    setSuccessMessage('')
    try {
      await saveProviderKey(provider)
      if (provider === 'openai') {
        setSuccessMessage(
          isZh
            ? 'OpenAI API Key 已保存；后端连接测试尚未启用 OpenAI provider。'
            : 'OpenAI API key saved. Backend connection testing is not enabled for OpenAI yet.',
        )
        return
      }

      const config = PROVIDERS.find((item) => item.provider === provider)
      const result = await api.post<{ success: boolean; message?: string }>('/chat/test-connection', {
        provider,
        model: provider === selectedProvider ? selectedModel : config?.defaultModel,
      })
      if (result.success) {
        setApiKeyStatus((current) => ({ ...current, [provider]: true }))
        setLastSuccessfulTestAt(Date.now())
        setSuccessMessage(
          isZh
            ? `${config?.name || provider} 连接成功`
            : `${config?.name || provider} connection successful`,
        )
      } else {
        setError(result.message || (isZh ? '连接测试失败' : 'Connection test failed'))
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || (isZh ? '连接测试失败' : 'Connection test failed'))
    } finally {
      setTestingProvider(null)
    }
  }

  const saveSettings = async () => {
    setLoading(true)
    setError('')
    setSuccessMessage('')
    try {
      const model = getModel(selectedModel)
      const fixed = model.fixedParams
      const provider = PROVIDER_TO_SETTING[model.provider] || 'claude'
      const saveCalls = [
        api.put('/settings/selected_model', { value: selectedModel }),
        api.put('/settings/llm_provider', { value: provider }),
        api.put('/settings/ai_model', { value: selectedModel }),
        api.put('/settings/temperature', { value: String(fixed?.temperature ?? temperature) }),
        api.put('/settings/max_tokens', { value: String(Math.min(maxTokens, model.maxTokens)) }),
        api.put('/settings/top_p', { value: String(fixed?.topP ?? topP) }),
        api.put('/settings/presence_penalty', { value: String(fixed?.presencePenalty ?? 0) }),
        api.put('/settings/frequency_penalty', { value: String(fixed?.frequencyPenalty ?? 0) }),
      ]

      PROVIDERS.forEach((providerConfig) => {
        const apiKey = providerKeys[providerConfig.provider].trim()
        if (apiKey) {
          saveCalls.push(api.post(providerConfig.saveEndpoint, { api_key: apiKey }))
        }
      })

      await Promise.all(saveCalls)
      setProviderKeys({ anthropic: '', deepseek: '', moonshot: '', bigmodel: '', openai: '', mimo: '' })
      await loadSettings()
      setDirty(false)
      setSaved(true)
      setSuccessMessage(isZh ? 'AI 设置已保存' : 'AI settings saved')
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || (isZh ? '保存设置失败' : 'Failed to save settings'))
    } finally {
      setLoading(false)
    }
  }

  const handleTestModel = async () => {
    if (!testMessage.trim()) return

    setIsTestingModel(true)
    setError('')
    setSuccessMessage('')

    try {
      const fixedParams = selectedModelData.fixedParams
      const result = await api.post<{ success: boolean; message?: string; response?: string }>('/chat/test-model', {
        message: testMessage,
        model: selectedModel,
        temperature: fixedParams?.temperature ?? temperature,
        max_tokens: Math.min(maxTokens, selectedModelData.maxTokens),
      })

      if (result.success) {
        setLastSuccessfulTestAt(Date.now())
        setSuccessMessage(
          result.response
            ? isZh
              ? `模型测试成功：${result.response}`
              : `Model test succeeded: ${result.response}`
            : isZh
              ? '模型测试成功'
              : 'Model test successful',
        )
      } else {
        setError(result.message || (isZh ? '模型测试失败' : 'Model test failed'))
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || (isZh ? '模型测试失败' : 'Model test failed'))
    } finally {
      setIsTestingModel(false)
    }
  }

  const updateStrategy = (key: keyof typeof strategyModels, modelId: string) => {
    setStrategyModels((current) => ({ ...current, [key]: modelId }))
    if (key === 'default') {
      setSelectedModel(modelId)
    }
    markDirty()
  }

  if (initialLoading) {
    return (
      <div className="theme-codex flex items-center justify-center py-12" style={{ background: 'var(--color-codex-bg)' }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--color-codex-accent)' }} />
      </div>
    )
  }

  return (
    <div className="theme-codex" style={PAGE_STYLE}>
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 500,
              color: 'var(--color-codex-ink)',
              letterSpacing: '-0.02em',
            }}
          >
            {isZh ? 'AI 模型' : 'AI Model'}
          </h1>
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 13.5,
              lineHeight: 1.6,
              color: 'var(--color-codex-ink-mute)',
              maxWidth: 700,
            }}
          >
            {isZh
              ? '接入你的 AI 服务, Aria 会按任务自动选用合适的模型。无需逐个调参,默认策略即可可靠运行。'
              : 'Connect your AI services. Aria can pick suitable models by task, and the default strategy is ready to run.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void loadSettings()}
            style={{
              padding: '9px 10px',
              fontSize: 13,
              color: 'var(--color-codex-ink-mute)',
            }}
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={loading}
            className="inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
            style={PRIMARY_BUTTON_STYLE}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('settings.save') || (isZh ? '保存设置' : 'Save Settings')}
          </button>
        </div>
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

      {successMessage || dirty || saved ? (
        <div
          className="mb-4 flex items-center gap-2"
          style={{
            fontSize: 12.5,
            color: successMessage || saved ? 'var(--color-codex-accent-ink)' : 'var(--color-codex-warn)',
          }}
        >
          {successMessage || saved ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {successMessage || (dirty ? (isZh ? '有未保存的更改' : 'Unsaved changes') : t('settings.saved') || (isZh ? '已保存' : 'Saved'))}
        </div>
      ) : null}

      <section
        className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
        style={{
          padding: '20px 22px',
          background: 'var(--color-codex-accent-bg)',
          border: '1px solid color-mix(in oklch, var(--color-codex-accent) 34%, transparent)',
          borderRadius: 'var(--codex-r-md, 6px)',
        }}
      >
        <div className="flex min-w-0 items-start gap-4">
          <span
            className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center"
            style={{
              background: 'var(--color-codex-bg-elev)',
              color: 'var(--color-codex-accent)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
                {isZh ? '主模型' : 'Primary model'} · {getModelLabel(selectedModel)}
              </span>
              <CxStatus tone={apiKeyStatus[selectedProvider] ? 'good' : 'warn'}>
                {apiKeyStatus[selectedProvider] ? (isZh ? '已连接' : 'Connected') : isZh ? '需配置 Key' : 'Key required'}
              </CxStatus>
            </div>
            <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--color-codex-ink-soft)' }}>
              {isZh
                ? `${connectedCount} 个服务已接入 · 智能调度 ${smartRouting ? '已开启' : '已关闭'} · ${
                    lastSuccessfulTestAt ? `最近测试成功 ${lastSuccessfulTestCopy}` : '尚未测试'
                  }`
                : `${connectedCount} providers connected · Smart routing ${smartRouting ? 'on' : 'off'} · ${
                    lastSuccessfulTestAt ? `Last test succeeded ${lastSuccessfulTestCopy}` : 'Not tested yet'
                  }`}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void testProvider(selectedProvider)}
          disabled={testingProvider === selectedProvider}
          className="inline-flex flex-shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          style={GHOST_BUTTON_STYLE}
        >
          {testingProvider === selectedProvider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {isZh ? '重新测试' : 'Retest'}
        </button>
      </section>

      <section className="mb-8">
        <SectionHeader
          title={isZh ? '服务连接' : 'Service connections'}
          hint={isZh ? '填入 API Key 即自动测试一次' : 'Enter an API key to test once'}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          {PROVIDERS.map((provider) => {
            const expanded = expandedProvider === provider.provider
            const pending = providerKeys[provider.provider].trim().length > 0
            const status = getStatusCopy(provider, apiKeyStatus[provider.provider], pending, isZh)
            const needsKey = !pending && !apiKeyStatus[provider.provider] && !provider.defaultWarning
            return (
              <div
                key={provider.provider}
                style={{
                  ...CARD_STYLE,
                  borderColor: expanded
                    ? 'color-mix(in oklch, var(--color-codex-accent) 48%, transparent)'
                    : 'var(--color-codex-line)',
                  overflow: 'hidden',
                }}
                className={expanded ? 'lg:col-span-2' : undefined}
              >
                <button
                  type="button"
                  onClick={() => setExpandedProvider(expanded ? null : provider.provider)}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left"
                  style={{ background: 'transparent' }}
                >
                  <span
                    className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center font-mono"
                    style={{
                      background: provider.provider === 'openai' || provider.provider === 'mimo'
                        ? 'var(--color-codex-bg-tint)'
                        : 'var(--color-codex-ink)',
                      color: provider.provider === 'openai' || provider.provider === 'mimo'
                        ? 'var(--color-codex-ink-faint)'
                        : 'var(--color-codex-bg-elev)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    {provider.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
                      {provider.name}
                    </span>
                    <span className="mt-1 block truncate" style={{ fontSize: 12.5, color: 'var(--color-codex-ink-mute)' }}>
                      {provider.subtitle}
                    </span>
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-2">
                    <ProviderStatus status={status} needsKey={needsKey} />
                    <ChevronDown
                      className="h-3.5 w-3.5 transition-transform"
                      style={{
                        color: 'var(--color-codex-ink-faint)',
                        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </span>
                </button>

                {expanded ? (
                  <div
                    style={{
                      padding: '18px 20px 16px',
                      background: 'var(--color-codex-bg)',
                      borderTop: '1px solid var(--color-codex-line-soft)',
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <FieldLabel>API Key</FieldLabel>
                      {provider.link ? (
                        <a
                          href={provider.link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:underline"
                          style={{ fontSize: 12, color: 'var(--color-codex-ink-faint)' }}
                        >
                          {isZh ? `从 ${provider.link.label} 获取` : `Get from ${provider.link.label}`}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 md:flex-row">
                      <input
                        type="password"
                        value={providerKeys[provider.provider]}
                        onChange={(event) => updateProviderKey(provider.provider, event.target.value)}
                        placeholder={apiKeyStatus[provider.provider] ? (isZh ? '已配置，输入新 Key 可更新' : 'Configured. Enter a new key to update') : provider.placeholder}
                        style={{ ...INPUT_STYLE, flex: 1 }}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => void testProvider(provider.provider)}
                        disabled={testingProvider === provider.provider}
                        className="inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                        style={PRIMARY_BUTTON_STYLE}
                      >
                        {testingProvider === provider.provider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Key className="h-3.5 w-3.5" />}
                        {isZh ? '保存并测试' : 'Save & test'}
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span style={{ fontSize: 12, color: 'var(--color-codex-ink-faint)' }}>
                        {apiKeyStatus[provider.provider] ? (isZh ? '已完成测试' : 'Tested') : isZh ? '尚未测试' : 'Not tested yet'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void testProvider(provider.provider)}
                        className="inline-flex items-center gap-1"
                        style={{ fontSize: 12, color: 'var(--color-codex-ink-faint)' }}
                      >
                        <Zap className="h-3 w-3" />
                        {isZh ? '手动测试' : 'Manual test'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <section className="mb-8">
        <SectionHeader
          title={isZh ? '模型策略' : 'Model strategy'}
          hint={isZh ? 'Aria 已为每类任务推荐默认模型, 可随时调整' : 'Aria recommends defaults for each task type; adjust anytime'}
        />
        <div style={CARD_STYLE}>
          <div
            className="flex items-center justify-between gap-4 px-5 py-4"
            style={{
              background: smartRouting ? 'var(--color-codex-accent-bg)' : 'var(--color-codex-bg-elev)',
              borderBottom: '1px solid var(--color-codex-line-soft)',
            }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <StrategyIcon><Sparkles className="h-4 w-4" /></StrategyIcon>
              <div className="min-w-0">
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
                  {isZh ? '智能调度' : 'Smart routing'}
                </div>
                <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--color-codex-ink-mute)' }}>
                  {isZh
                    ? '开启后,Aria 会根据任务类型自动选用下方对应模型;关闭则全程使用默认协作模型。'
                    : 'When enabled, Aria chooses the model by task type. When off, it uses the default collaboration model.'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSmartRouting((current) => !current)
                markDirty()
              }}
              aria-pressed={smartRouting}
            >
              <Toggle on={smartRouting} />
            </button>
          </div>

          <StrategyRow
            icon={<Sparkles className="h-4 w-4" />}
            title={isZh ? '默认协作模型' : 'Default collaboration model'}
            description={isZh ? '日常对话、分析与项目工作' : 'Daily chat, analysis, and project work'}
            value={strategyModels.default}
            onChange={(value) => updateStrategy('default', value)}
            recommendedLabel={isZh ? 'Aria 推荐' : 'Aria recommended'}
          />
          <StrategyRow
            icon={<Zap className="h-4 w-4" />}
            title={isZh ? '快速响应模型' : 'Fast response model'}
            description={isZh ? '短交互、补全与轻量草拟' : 'Short interactions, completion, and light drafting'}
            value={strategyModels.fast}
            onChange={(value) => updateStrategy('fast', value)}
            recommendedLabel={isZh ? 'Aria 推荐' : 'Aria recommended'}
          />
          <StrategyRow
            icon={<FileText className="h-4 w-4" />}
            title={isZh ? '长上下文 / 文档模型' : 'Long-context / document model'}
            description={isZh ? '大文档、知识库与跨会话总结' : 'Large documents, knowledge base, and cross-session summaries'}
            value={strategyModels.document}
            onChange={(value) => updateStrategy('document', value)}
            recommendedLabel={isZh ? 'Aria 推荐' : 'Aria recommended'}
          />
          <StrategyRow
            icon={<Layers className="h-4 w-4" />}
            title={isZh ? '低成本模型' : 'Low-cost model'}
            description={isZh ? '批量处理、预热与低风险任务' : 'Batch work, warmups, and lower-risk tasks'}
            value={strategyModels.lowCost}
            onChange={(value) => updateStrategy('lowCost', value)}
            recommendedLabel={isZh ? 'Aria 推荐' : 'Aria recommended'}
            last
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title={isZh ? '测试模型' : 'Test model'}
          hint={isZh ? '发送一条真实请求验证当前调用链' : 'Send one real request to verify the current call path'}
        />
        <div style={{ ...CARD_STYLE, padding: 20 }}>
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
              disabled={isTestingModel || !testMessage.trim()}
              className="inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
              style={PRIMARY_BUTTON_STYLE}
            >
              {isTestingModel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {isZh ? '发送测试' : 'Run test'}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2" style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
            <Zap className="h-3.5 w-3.5" />
            <span>
              {isZh
                ? `当前测试模型：${getModelLabel(selectedModel)} · ${selectedProviderName}`
                : `Testing: ${getModelLabel(selectedModel)} · ${selectedProviderName}`}
            </span>
            <span
              className="font-mono"
              style={{
                padding: '2px 7px',
                borderRadius: 'var(--codex-r-pill, 999px)',
                background: 'var(--color-codex-bg-tint)',
                color: 'var(--color-codex-ink-soft)',
                fontSize: 11,
              }}
            >
              {selectedModel}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}

function StrategyRow({
  icon,
  title,
  description,
  value,
  onChange,
  recommendedLabel,
  last = false,
}: {
  icon: ReactNode
  title: string
  description: string
  value: string
  onChange: (value: string) => void
  recommendedLabel: string
  last?: boolean
}) {
  return (
    <div
      className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between"
      style={{ borderBottom: last ? 'none' : '1px solid var(--color-codex-line-soft)' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <StrategyIcon>{icon}</StrategyIcon>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
              {title}
            </span>
            <span
              style={{
                padding: '2px 7px',
                fontSize: 10.5,
                color: 'var(--color-codex-accent-ink)',
                background: 'var(--color-codex-accent-bg)',
                borderRadius: 'var(--codex-r-pill, 999px)',
              }}
            >
              {recommendedLabel}
            </span>
          </div>
          <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--color-codex-ink-mute)' }}>
            {description}
          </div>
        </div>
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={SELECT_STYLE}
      >
        {MODEL_OPTIONS.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
    </div>
  )
}
