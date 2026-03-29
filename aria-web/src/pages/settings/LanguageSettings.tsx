import { useState, useEffect } from 'react'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { api } from '../../api/client'

const languages = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', name: 'English', flag: '🇺🇸' },
  { code: 'ja-JP', name: '日本語', flag: '🇯🇵' },
]

export function LanguageSettings() {
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setInitialLoading(true)
      setError('')
      
      const settings = await api.get<Record<string, string>>('/settings/')
      
      if (settings.language) {
        setSelectedLanguage(settings.language)
      }
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
      await api.put('/settings/language', { value: selectedLanguage })
      
      setSaved(true)
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
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">语言设置</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">选择你的首选语言</p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="space-y-3">
        {languages.map(lang => (
          <div
            key={lang.code}
            onClick={() => setSelectedLanguage(lang.code)}
            className={`flex items-center justify-between p-4 rounded-lg border-2 cursor-pointer transition-all ${
              selectedLanguage === lang.code
                ? 'border-[var(--color-accent-500)] bg-[var(--color-accent-50)]'
                : 'border-[var(--color-border-default)] hover:border-[var(--color-border-default)]'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{lang.flag}</span>
              <div>
                <span className="font-medium text-[var(--color-text-primary)]">{lang.name}</span>
                <p className="text-xs text-[var(--color-text-muted)]">{lang.code}</p>
              </div>
            </div>
            {selectedLanguage === lang.code && (
              <div className="w-6 h-6 bg-[var(--color-accent-600)] rounded-full flex items-center justify-center">
                <Check className="w-3.5 h-3.5 text-white" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-[var(--color-border-default)]">
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
  )
}
