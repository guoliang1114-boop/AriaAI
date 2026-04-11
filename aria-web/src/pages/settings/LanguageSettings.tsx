import { useState, useEffect } from 'react'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { changeLanguage } from '../../i18n'

const languages = [
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', name: 'English', flag: '🇺🇸' },
]

export function LanguageSettings() {
  const { t, i18n } = useTranslation()
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language || 'zh-CN')
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
        // Apply loaded language immediately
        changeLanguage(settings.language)
      }
    } catch (err: any) {
      // Silent fail - use default or localStorage
      const savedLang = localStorage.getItem('language')
      if (savedLang) {
        setSelectedLanguage(savedLang)
        changeLanguage(savedLang)
      }
    } finally {
      setInitialLoading(false)
    }
  }

  const handleLanguageChange = (langCode: string) => {
    setSelectedLanguage(langCode)
    // Apply language immediately for preview
    changeLanguage(langCode)
  }

  const handleSave = async () => {
    setLoading(true)
    setSaved(false)
    setError('')

    try {
      // Save to backend
      await api.put('/settings/language', { value: selectedLanguage })
      
      // Apply language
      changeLanguage(selectedLanguage)
      
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to save settings')
      // Still apply language locally even if backend fails
      changeLanguage(selectedLanguage)
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
      <h2 className="text-lg font-semibold text-on-surface mb-1">{t('language.title')}</h2>
      <p className="text-sm text-on-surface-muted mb-6">{t('language.description')}</p>

      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg flex items-center gap-2 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="space-y-3">
        {languages.map(lang => (
          <div
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${
              selectedLanguage === lang.code
                ? 'border-primary bg-secondary-container/30'
                : 'border-outline/20 hover:border-outline/50'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{lang.flag}</span>
              <div>
                <span className="font-medium text-on-surface">{lang.name}</span>
                <p className="text-xs text-on-surface-muted">{lang.code}</p>
              </div>
            </div>
            {selectedLanguage === lang.code && (
              <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                <Check className="w-3.5 h-3.5 text-white" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-outline/10">
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl font-medium transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('language.saving')}
            </>
          ) : saved ? (
            <>
              <Check className="w-4 h-4" />
              {t('language.saved')}
            </>
          ) : (
            t('language.save')
          )}
        </button>
      </div>
    </div>
  )
}
