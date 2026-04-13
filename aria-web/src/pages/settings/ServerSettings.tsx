import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  Check, 
  Globe, 
  RefreshCw, 
  AlertTriangle, 
  Server, 
  Shield,
  Clock,
  ChevronRight,
  Loader2,
  Wifi,
  WifiOff,
  ExternalLink
} from 'lucide-react'
import { api } from '../../api/client'
import { getApiConfig, saveApiBaseUrl, type ApiUrlSource } from '../../config/api'

interface ServerInfo {
  version: string
  status: string
  uptime?: string
}

export function ServerSettings() {
  const { t } = useTranslation()
  const [serverUrl, setServerUrl] = useState('')
  const [initialServerUrl, setInitialServerUrl] = useState('')
  const [backendServerUrl, setBackendServerUrl] = useState('')
  const [effectiveUrl, setEffectiveUrl] = useState('')
  const [effectiveSource, setEffectiveSource] = useState<ApiUrlSource>('default')
  const [isChecking, setIsChecking] = useState(false)
  const [status, setStatus] = useState<'idle' | 'online' | 'offline'>('idle')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [error, setError] = useState('')

  const sourceLabels: Record<ApiUrlSource, string> = {
    localStorage: t('settings.server.sourceLocal') || '浏览器本地设置',
    env: t('settings.server.sourceEnv') || '环境变量',
    default: t('settings.server.sourceDefault') || '默认值',
  }

  const hasUnsavedChanges = serverUrl.trim() !== initialServerUrl.trim()

  // Load saved server URL on mount
  useEffect(() => {
    loadServerSettings()
  }, [])

  const loadServerSettings = async () => {
    try {
      setLoading(true)
      setError('')
      const apiConfig = getApiConfig()
      setEffectiveUrl(apiConfig.url)
      setEffectiveSource(apiConfig.source)

      let resolvedUrl = apiConfig.url

      try {
        const settings = await api.get<Record<string, string>>('/settings/')
        if (settings.api_base_url) {
          setBackendServerUrl(settings.api_base_url)
          resolvedUrl = settings.api_base_url
        }
      } catch {
        setBackendServerUrl('')
      }

      setServerUrl(resolvedUrl)
      setInitialServerUrl(resolvedUrl)
      await checkConnection(resolvedUrl)
    } catch (err: any) {
      setError(err.message || 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const checkConnection = async (url?: string) => {
    const checkUrl = url || serverUrl
    if (!checkUrl) return
    
    setIsChecking(true)
    setStatus('idle')
    setError('')
    
    try {
      const response = await fetch(`${checkUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      })
      
      if (response.ok) {
        setStatus('online')
        const data = await response.json().catch(() => null)
        if (data) {
          setServerInfo({
            version: data.version || 'unknown',
            status: data.status || 'healthy',
            uptime: data.uptime,
          })
        }
      } else {
        setStatus('offline')
        setServerInfo(null)
      }
    } catch (err: any) {
      setStatus('offline')
      setServerInfo(null)
    } finally {
      setIsChecking(false)
    }
  }

  const handleCheckConnection = () => checkConnection()

  const handleSave = async () => {
    if (!serverUrl.trim()) {
      setError(t('settings.server.emptyUrl') || '请输入服务器地址')
      return
    }
    
    setLoading(true)
    setError('')
    
    try {
      // Save to backend settings
      await api.put('/settings/api_base_url', { value: serverUrl.trim() })
      
      // Also save to localStorage for immediate effect using unified config
      saveApiBaseUrl(serverUrl.trim())
      
      // Reload to apply new API URL
      window.location.reload()
      
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handlePresetClick = (url: string) => {
    setServerUrl(url)
    checkConnection(url)
  }

  if (loading) {
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
          {t('settings.server.title') || '服务器配置'}
        </h2>
        <p className="text-sm text-on-surface-muted">
          {t('settings.server.subtitle') || '配置 AriaAI 后端服务器连接'}
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-lg flex items-center gap-2 text-error text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Server Status Card */}
      <div className="card">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            status === 'online' 
              ? 'bg-success/10 text-success' 
              : status === 'offline'
                ? 'bg-error/10 text-error'
                : 'bg-surface-container-high text-on-surface-muted'
          }`}>
            {status === 'online' ? (
              <Wifi className="w-6 h-6" />
            ) : status === 'offline' ? (
              <WifiOff className="w-6 h-6" />
            ) : (
              <Server className="w-6 h-6" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-on-surface">
              {status === 'online' 
                ? t('settings.server.connected') || '已连接'
                : status === 'offline'
                  ? t('settings.server.disconnected') || '未连接'
                  : t('settings.server.checking') || '检查中...'}
            </h3>
            <p className="text-sm text-on-surface-muted">
              {serverInfo ? (
                <span className="flex items-center gap-2">
                  <span>v{serverInfo.version}</span>
                  {serverInfo.uptime && (
                    <>
                      <span>•</span>
                      <Clock className="w-3 h-3" />
                      <span>{serverInfo.uptime}</span>
                    </>
                  )}
                </span>
              ) : (
                status === 'offline' 
                  ? (t('settings.server.cannotConnect') || '无法连接到服务器')
                  : (t('settings.server.checkingStatus') || '正在检查服务器状态...')
              )}
            </p>
          </div>
          <button
            onClick={handleCheckConnection}
            disabled={isChecking}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded-xl transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
            {isChecking ? (t('common.checking') || '检查中') : (t('common.refresh') || '刷新')}
          </button>
        </div>
      </div>

      {/* Server URL Configuration */}
      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-primary" />
          <h3 className="font-medium text-on-surface">
            {t('settings.server.address') || '服务器地址'}
          </h3>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl bg-surface-container-low p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-on-surface-muted">{t('settings.server.currentSource') || '当前生效来源'}</span>
              <span className="font-medium text-on-surface">{sourceLabels[effectiveSource]}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-on-surface-muted">{t('settings.server.currentValue') || '当前生效地址'}</span>
              <span className="font-mono text-on-surface text-right break-all">{effectiveUrl}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-on-surface-muted">{t('settings.server.backendValue') || '后端存储值'}</span>
              <span className="font-mono text-on-surface text-right break-all">
                {backendServerUrl || (t('settings.server.notSet') || '未设置')}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://127.0.0.1:8000"
              className="flex-1 px-4 py-2.5 bg-surface-container-lowest border border-outline/20 rounded-xl text-on-surface placeholder:text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
            />
            <button
              onClick={handleCheckConnection}
              disabled={isChecking || !serverUrl}
              className="flex items-center gap-2 px-4 py-2.5 border border-outline/20 rounded-xl hover:bg-surface-container-high transition-all disabled:opacity-50 text-on-surface-secondary"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              {t('settings.server.test') || '测试'}
            </button>
          </div>

          {/* Connection Status */}
          {status !== 'idle' && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
              status === 'online' 
                ? 'bg-success/10 text-success border border-success/20' 
                : 'bg-error/10 text-error border border-error/20'
            }`}>
              {status === 'online' ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>{t('settings.server.connectionSuccess') || '连接成功'}</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  <span>{t('settings.server.connectionFailed') || '连接失败，请检查服务器地址'}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick Presets */}
      <div className="card space-y-4">
        <h3 className="font-medium text-on-surface flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-primary" />
          {t('settings.server.presets') || '快速选择'}
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: t('settings.server.local') || '本地开发', url: 'http://127.0.0.1:8000', icon: '🖥️' },
            { label: t('settings.server.lan') || '局域网', url: 'http://192.168.1.100:8000', icon: '🌐' },
            { label: t('settings.server.production') || '生产环境', url: 'https://aria.d2cgo.co', icon: '☁️' },
          ].map(preset => (
            <button
              key={preset.label}
              onClick={() => handlePresetClick(preset.url)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl transition-all ${
                serverUrl === preset.url
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'border border-outline/20 hover:bg-surface-container-high text-on-surface-secondary'
              }`}
            >
              <span>{preset.icon}</span>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Security Info */}
      <div className="bg-tertiary-container/30 rounded-xl p-4 border border-tertiary/20">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-tertiary flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-on-surface text-sm">
              {t('settings.server.security') || '连接安全'}
            </p>
            <p className="text-sm text-on-surface-muted mt-1">
              {t('settings.server.securityDesc') || 
                '本地开发使用 HTTP，生产环境建议使用 HTTPS 加密连接。所有 API 请求都需要身份验证。'}
            </p>
          </div>
        </div>
      </div>

      {/* Help Link */}
      <a 
        href="https://docs.ariaai.com/server-setup" 
        target="_blank" 
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
      >
        <ExternalLink className="w-4 h-4" />
        {t('settings.server.help') || '如何设置服务器？'}
      </a>

      {/* Save Button */}
      <div className="flex items-center justify-between pt-4 border-t border-outline/20">
        <p className="text-sm text-on-surface-muted">
          {saved ? (
            <span className="text-success flex items-center gap-1">
              <Check className="w-4 h-4" />
              {t('settings.saved') || '已保存'}
            </span>
          ) : hasUnsavedChanges ? (
            t('settings.unsavedChanges') || '有未保存的更改'
          ) : (
            t('settings.allSaved') || '所有更改已保存'
          )}
        </p>
        <button
          onClick={handleSave}
          disabled={loading || !serverUrl}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl font-medium transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('settings.saving') || '保存中...'}
            </>
          ) : saved ? (
            <>
              <Check className="w-4 h-4" />
              {t('settings.saved') || '已保存'}
            </>
          ) : (
            <>
              <Server className="w-4 h-4" />
              {t('settings.server.save') || '保存并应用'}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
