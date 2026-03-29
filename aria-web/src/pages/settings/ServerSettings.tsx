import { useState } from 'react'
import { Check, Globe, RefreshCw, AlertTriangle } from 'lucide-react'

export function ServerSettings() {
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:8000')
  const [isChecking, setIsChecking] = useState(false)
  const [status, setStatus] = useState<'idle' | 'online' | 'offline'>('idle')
  const [saved, setSaved] = useState(false)

  const handleCheckConnection = async () => {
    setIsChecking(true)
    try {
      const response = await fetch(`${serverUrl}/health`)
      setStatus(response.ok ? 'online' : 'offline')
    } catch {
      setStatus('offline')
    } finally {
      setIsChecking(false)
    }
  }

  const handleSave = () => {
    localStorage.setItem('serverUrl', serverUrl)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">服务器配置</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">配置AriaAI后端服务器连接</p>

      <div className="space-y-6">
        {/* Server URL */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
            服务器地址
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://127.0.0.1:8000"
              className="flex-1 px-4 py-2.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/20 focus:border-[var(--color-accent-500)] transition-all"
            />
            <button
              onClick={handleCheckConnection}
              disabled={isChecking}
              className="flex items-center gap-2 px-4 py-2.5 border border-[var(--color-border-default)] rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-all disabled:opacity-50 text-[var(--color-text-secondary)]"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              测试连接
            </button>
          </div>

          {status !== 'idle' && (
            <div className={`flex items-center gap-2 mt-2 text-sm ${
              status === 'online' ? 'text-[var(--color-success-600)]' : 'text-[var(--color-error-600)]'
            }`}>
              {status === 'online' ? (
                <>
                  <Check className="w-4 h-4" />
                  连接成功
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  连接失败
                </>
              )}
            </div>
          )}
        </div>

        {/* Presets */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
            快速选择
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { label: '本地开发', url: 'http://127.0.0.1:8000' },
              { label: '局域网', url: 'http://192.168.1.100:8000' },
              { label: '生产环境', url: 'https://aria.d2cgo.co' },
            ].map(preset => (
              <button
                key={preset.label}
                onClick={() => setServerUrl(preset.url)}
                className="px-4 py-2 text-sm border border-[var(--color-border-default)] rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-all text-[var(--color-text-secondary)]"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="bg-[var(--color-accent-50)] rounded-lg p-4 text-sm text-[var(--color-text-secondary)] border border-[var(--color-accent-100)]">
          <div className="flex items-start gap-2">
            <Globe className="w-4 h-4 mt-0.5 text-[var(--color-accent-600)]" />
            <div>
              <p className="font-medium text-[var(--color-text-primary)]">连接说明</p>
              <p className="mt-1">
                请确保后端服务已启动，并且可以从当前设备访问。
                默认端口为8000，生产环境使用HTTPS连接。
              </p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-4 border-t border-[var(--color-border-default)]">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-accent-600)] hover:bg-[var(--color-accent-700)] text-white rounded-lg font-medium transition-all"
          >
            {saved ? (
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
