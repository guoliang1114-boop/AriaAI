import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, Mail, Lock, Sparkles, AlertCircle } from 'lucide-react'
import { api } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import type { LoginResponse } from '../types/api'

export function Login() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      console.log('[Login] Attempting login with:', email)
      
      const response = await api.post<LoginResponse>('/auth/login', { 
        email: email.toLowerCase().trim(), 
        password 
      })
      
      console.log('[Login] Response received:', response)
      console.log('[Login] Token:', response.token)
      
      if (!response.token) {
        throw new Error('No token received from server')
      }
      
      // Store auth data and update context
      login(response.token, response.user)
      
      navigate('/')
    } catch (err: any) {
      console.error('[Login] Error:', err)
      const message = err.response?.data?.detail || err.message || 'Login failed. Please check your credentials.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageTitle title={t('login.title')} />
      <div className="min-h-screen flex">
      {/* Left Side - Form */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 bg-surface">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-2xl bg-gradient-primary flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <span className="font-manrope text-2xl font-bold text-on-surface">
              Aria AI
            </span>
          </div>

          <h1 className="text-headline-sm text-on-surface mb-3">{t('login.welcomeBack')}</h1>
          <p className="text-body-md text-on-surface-muted mb-8">
            {t('login.subtitle')}
          </p>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-error/5 border border-error/10 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-label-md text-on-surface-variant mb-2">{t('login.email')}</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-muted" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-surface-container-lowest rounded-xl border-none text-on-surface placeholder:text-on-surface-muted outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="name@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-label-md text-on-surface-variant mb-2">{t('login.password')}</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-muted" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3.5 bg-surface-container-lowest rounded-xl border-none text-on-surface placeholder:text-on-surface-muted outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-on-surface-muted hover:text-on-surface transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 rounded border-outline text-primary focus:ring-primary/20" 
                />
                <span className="text-sm text-on-surface-muted">{t('login.rememberMe')}</span>
              </label>
              <a href="#" className="text-sm text-primary hover:text-primary-container font-medium transition-colors">
                {t('login.forgotPassword')}
              </a>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('login.signingIn')}
                </>
              ) : (
                t('login.signIn')
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-on-surface-muted">
            Don&apos;t have an account?{' '}
            <a href="#" className="text-primary hover:text-primary-container font-medium transition-colors">
              Contact your admin
            </a>
          </p>
        </div>
      </div>

      {/* Right Side - Visual */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-gray-900 via-slate-900 to-primary relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/40 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-secondary-container/30 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <span className="inline-block w-fit px-4 py-1.5 text-label-sm text-white/80 bg-white/10 rounded-full mb-6 backdrop-blur-sm">
            CONSULTING ELITE EDITION
          </span>
          <h2 className="text-4xl font-manrope font-bold mb-4 leading-tight">
            {t('login.tagline')}
          </h2>
          <p className="text-lg text-white/70 max-w-md leading-relaxed">
            {t('login.description')}
          </p>

          <div className="mt-10 flex items-center gap-8">
            <div>
              <div className="text-3xl font-manrope font-bold">142+</div>
              <div className="text-sm text-white/50">{t('login.activeSkills')}</div>
            </div>
            <div className="w-px h-12 bg-white/20" />
            <div>
              <div className="text-3xl font-manrope font-bold">50+</div>
              <div className="text-sm text-white/50">{t('login.enterpriseClients')}</div>
            </div>
            <div className="w-px h-12 bg-white/20" />
            <div>
              <div className="text-3xl font-manrope font-bold">99.9%</div>
              <div className="text-sm text-white/50">{t('login.uptime')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
