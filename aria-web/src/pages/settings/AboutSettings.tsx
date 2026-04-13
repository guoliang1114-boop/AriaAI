import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  Info, 
  Package, 
  Heart, 
  Sparkles, 
  Globe, 
  Mail, 
  MessageCircle,
  ExternalLink,
  Loader2,
  CheckCircle,
  Server,
  Database,
  Cpu,
  Calendar,
  Shield,
  FileText,
  ChevronRight,
  Copy,
  Check
} from 'lucide-react'
import { api } from '../../api/client'

interface SystemInfo {
  version: string
  buildDate: string
  environment: string
  apiStatus: 'online' | 'offline'
  apiVersion?: string
  databaseStatus: 'connected' | 'disconnected'
}

interface ChangelogEntry {
  version: string
  date: string
  changes: string[]
}

export function AboutSettings() {
  const { t } = useTranslation()
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
    buildDate: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__.slice(0, 10) : '-',
    environment: 'production',
    apiStatus: 'offline',
    databaseStatus: 'disconnected',
  })
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'changelog' | 'license'>('overview')

  // Changelog data
  const changelog: ChangelogEntry[] = [
    {
      version: '1.0.0',
      date: '2026-04-09',
      changes: [
        'Initial release of AriaAI',
        'AI-powered consulting assistance',
        'Project and knowledge management',
        'Multi-user support with role-based access',
        'Integration with Claude and Moonshot AI',
      ],
    },
    {
      version: '0.9.0',
      date: '2026-03-15',
      changes: [
        'Beta release with core features',
        'Skill system for specialized tasks',
        'Document upload and vector search',
        'Real-time chat interface',
      ],
    },
  ]

  // Tech stack with icons/colors
  const techStack = [
    { name: 'React', category: 'frontend', color: 'bg-blue-500/10 text-blue-600 border-blue-200' },
    { name: 'TypeScript', category: 'frontend', color: 'bg-blue-600/10 text-blue-700 border-blue-300' },
    { name: 'Vite', category: 'frontend', color: 'bg-purple-500/10 text-purple-600 border-purple-200' },
    { name: 'Tailwind CSS', category: 'frontend', color: 'bg-cyan-500/10 text-cyan-600 border-cyan-200' },
    { name: 'FastAPI', category: 'backend', color: 'bg-green-500/10 text-green-600 border-green-200' },
    { name: 'PostgreSQL', category: 'backend', color: 'bg-indigo-500/10 text-indigo-600 border-indigo-200' },
    { name: 'SQLModel', category: 'backend', color: 'bg-orange-500/10 text-orange-600 border-orange-200' },
    { name: 'Claude API', category: 'ai', color: 'bg-amber-500/10 text-amber-600 border-amber-200' },
    { name: 'Moonshot AI', category: 'ai', color: 'bg-violet-500/10 text-violet-600 border-violet-200' },
  ]

  useEffect(() => {
    loadSystemInfo()
  }, [])

  const loadSystemInfo = async () => {
    try {
      setLoading(true)
      
      // Try to get version from backend
      try {
        const health = await api.get('/health')
        setSystemInfo(prev => ({
          ...prev,
          apiStatus: 'online',
          apiVersion: (health as any).version,
          environment: (health as any).environment || 'production',
        }))
      } catch {
        setSystemInfo(prev => ({
          ...prev,
          apiStatus: 'offline',
        }))
      }
    } finally {
      setLoading(false)
    }
  }

  const copyVersionInfo = () => {
    const info = `AriaAI v${systemInfo.version}
Build: ${systemInfo.buildDate}
API: ${systemInfo.apiStatus} ${systemInfo.apiVersion ? `(${systemInfo.apiVersion})` : ''}
Environment: ${systemInfo.environment}`
    navigator.clipboard.writeText(info)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const renderOverview = () => (
    <div className="space-y-6">
      {/* App Header */}
      <div className="flex items-center gap-5 p-6 bg-gradient-to-br from-primary/5 to-tertiary/5 rounded-2xl border border-outline/10">
        <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
          <Sparkles className="w-10 h-10 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-2xl font-bold text-on-surface">AriaAI</h3>
          <p className="text-on-surface-muted">{t('about.tagline') || '智能咨询助手'}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
              v{systemInfo.version}
            </span>
            <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${
              systemInfo.apiStatus === 'online' 
                ? 'bg-success/10 text-success' 
                : 'bg-error/10 text-error'
            }`}>
              {systemInfo.apiStatus === 'online' 
                ? (t('about.systemOnline') || '系统正常') 
                : (t('about.systemOffline') || '离线')}
            </span>
          </div>
        </div>
        <button
          onClick={copyVersionInfo}
          className="p-2 hover:bg-surface-container-high rounded-xl transition-colors"
          title={t('about.copyInfo') || '复制版本信息'}
        >
          {copied ? (
            <Check className="w-5 h-5 text-success" />
          ) : (
            <Copy className="w-5 h-5 text-on-surface-muted" />
          )}
        </button>
      </div>

      {/* Build Info Banner */}
      <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-medium text-primary">
              {t('about.currentVersion') || '当前版本'}
            </p>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {typeof __BUILD_TIME__ !== 'undefined'
                ? `${t('about.packagedAt') || '打包时间'}: ${new Date(__BUILD_TIME__).toLocaleString('zh-CN')}`
                : '-'}
            </p>
          </div>
          <span className="px-3 py-1 text-lg font-bold bg-primary text-white rounded-lg shadow-sm">
            v{systemInfo.version}
          </span>
        </div>
      </div>

      {/* System Status Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-surface-container-low rounded-xl border border-outline/10">
          <div className="flex items-center gap-2 text-on-surface-muted mb-2">
            <Package className="w-4 h-4" />
            <span className="text-sm">{t('about.version') || '版本'}</span>
          </div>
          <p className="text-lg font-semibold text-on-surface">{systemInfo.version}</p>
          <p className="text-xs text-on-surface-muted mt-1">
            {t('about.webVersion') || 'Web 版本'}
          </p>
        </div>
        
        <div className="p-4 bg-surface-container-low rounded-xl border border-outline/10">
          <div className="flex items-center gap-2 text-on-surface-muted mb-2">
            <Server className="w-4 h-4" />
            <span className="text-sm">{t('about.apiVersion') || 'API 版本'}</span>
          </div>
          <p className="text-lg font-semibold text-on-surface">
            {systemInfo.apiVersion || '-'}
          </p>
          <p className="text-xs text-success mt-1 flex items-center gap-1">
            {systemInfo.apiStatus === 'online' && (
              <>
                <CheckCircle className="w-3 h-3" />
                {t('about.connected') || '已连接'}
              </>
            )}
          </p>
        </div>
        
        <div className="p-4 bg-surface-container-low rounded-xl border border-outline/10">
          <div className="flex items-center gap-2 text-on-surface-muted mb-2">
            <Calendar className="w-4 h-4" />
            <span className="text-sm">{t('about.buildDate') || '构建日期'}</span>
          </div>
          <p className="text-lg font-semibold text-on-surface">{systemInfo.buildDate}</p>
          <p className="text-xs text-on-surface-muted mt-1">
            {systemInfo.environment === 'production' 
              ? (t('about.production') || '生产环境') 
              : (t('about.development') || '开发环境')}
          </p>
        </div>
        
        <div className="p-4 bg-surface-container-low rounded-xl border border-outline/10">
          <div className="flex items-center gap-2 text-on-surface-muted mb-2">
            <Shield className="w-4 h-4" />
            <span className="text-sm">{t('about.license') || '许可证'}</span>
          </div>
          <p className="text-lg font-semibold text-on-surface">Proprietary</p>
          <p className="text-xs text-on-surface-muted mt-1">
            {t('about.allRightsReserved') || '保留所有权利'}
          </p>
        </div>
      </div>

      {/* Tech Stack */}
      <div>
        <h4 className="text-sm font-medium text-on-surface-secondary mb-3">
          {t('about.techStack') || '技术栈'}
        </h4>
        <div className="flex flex-wrap gap-2">
          {techStack.map(tech => (
            <span
              key={tech.name}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium border ${tech.color}`}
            >
              {tech.name}
            </span>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3">
        <a
          href="https://github.com/ariaai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-surface-container-low rounded-xl border border-outline/10 hover:border-outline/30 transition-all group"
        >
          <div className="w-10 h-10 bg-surface-container-high rounded-xl flex items-center justify-center group-hover:bg-primary/10 transition-colors">
            <svg className="w-5 h-5 text-on-surface-muted group-hover:text-primary" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-medium text-on-surface text-sm">GitHub</p>
            <p className="text-xs text-on-surface-muted">{t('about.viewSource') || '查看源码'}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-on-surface-muted" />
        </a>
        
        <a
          href="https://ariaai.com/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-surface-container-low rounded-xl border border-outline/10 hover:border-outline/30 transition-all group"
        >
          <div className="w-10 h-10 bg-surface-container-high rounded-xl flex items-center justify-center group-hover:bg-primary/10 transition-colors">
            <FileText className="w-5 h-5 text-on-surface-muted group-hover:text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-on-surface text-sm">{t('about.documentation') || '文档'}</p>
            <p className="text-xs text-on-surface-muted">{t('about.readDocs') || '阅读文档'}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-on-surface-muted" />
        </a>
        
        <a
          href="mailto:support@ariaai.com"
          className="flex items-center gap-3 p-4 bg-surface-container-low rounded-xl border border-outline/10 hover:border-outline/30 transition-all group"
        >
          <div className="w-10 h-10 bg-surface-container-high rounded-xl flex items-center justify-center group-hover:bg-primary/10 transition-colors">
            <Mail className="w-5 h-5 text-on-surface-muted group-hover:text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-on-surface text-sm">{t('about.email') || '邮件'}</p>
            <p className="text-xs text-on-surface-muted">support@ariaai.com</p>
          </div>
          <ExternalLink className="w-4 h-4 text-on-surface-muted" />
        </a>
        
        <a
          href="https://ariaai.com/feedback"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-surface-container-low rounded-xl border border-outline/10 hover:border-outline/30 transition-all group"
        >
          <div className="w-10 h-10 bg-surface-container-high rounded-xl flex items-center justify-center group-hover:bg-primary/10 transition-colors">
            <MessageCircle className="w-5 h-5 text-on-surface-muted group-hover:text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-on-surface text-sm">{t('about.feedback') || '反馈'}</p>
            <p className="text-xs text-on-surface-muted">{t('about.sendFeedback') || '发送反馈'}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-on-surface-muted" />
        </a>
      </div>

      {/* Footer */}
      <div className="pt-6 border-t border-outline/10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-on-surface-muted flex items-center gap-1">
            Made with <Heart className="w-3 h-3 text-error" /> by AriaAI Team
          </p>
          <p className="text-xs text-on-surface-muted">
            © 2026 AriaAI. {t('about.allRightsReserved') || 'All rights reserved.'}
          </p>
        </div>
      </div>
    </div>
  )

  const renderChangelog = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-on-surface">
        {t('about.changelog') || '更新日志'}
      </h3>
      
      <div className="space-y-6">
        {changelog.map((entry, index) => (
          <div 
            key={entry.version} 
            className={`relative pl-6 pb-6 ${index !== changelog.length - 1 ? 'border-l-2 border-outline/20' : ''}`}
          >
            {/* Timeline dot */}
            <div className="absolute left-0 top-0 w-3 h-3 bg-primary rounded-full -translate-x-[7px]" />
            
            <div className="bg-surface-container-low rounded-xl p-4 border border-outline/10">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-2.5 py-1 text-sm font-semibold bg-primary/10 text-primary rounded-lg">
                  v{entry.version}
                </span>
                <span className="text-sm text-on-surface-muted">{entry.date}</span>
                {index === 0 && (
                  <span className="px-2 py-0.5 text-xs bg-success/10 text-success rounded-full">
                    {t('about.latest') || '最新'}
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {entry.changes.map((change, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-on-surface">
                    <ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderLicense = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-on-surface">
        {t('about.license') || '许可证'}
      </h3>
      
      <div className="bg-surface-container-low rounded-xl p-6 border border-outline/10">
        <h4 className="font-medium text-on-surface mb-4">AriaAI License Agreement</h4>
        <div className="space-y-4 text-sm text-on-surface-muted">
          <p>
            Copyright © 2026 AriaAI. All rights reserved.
          </p>
          <p>
            This software is proprietary and confidential. Unauthorized copying, 
            transfer, or distribution of this software, via any medium, is strictly 
            prohibited.
          </p>
          <p>
            THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, 
            EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF 
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
          </p>
        </div>
      </div>

      <div>
        <h4 className="font-medium text-on-surface mb-3">
          {t('about.thirdPartyLicenses') || '第三方许可证'}
        </h4>
        <div className="space-y-2">
          {[
            { name: 'React', license: 'MIT License' },
            { name: 'Tailwind CSS', license: 'MIT License' },
            { name: 'Lucide Icons', license: 'ISC License' },
            { name: 'FastAPI', license: 'MIT License' },
          ].map(item => (
            <div 
              key={item.name}
              className="flex items-center justify-between p-3 bg-surface-container-low rounded-lg border border-outline/10"
            >
              <span className="text-sm font-medium text-on-surface">{item.name}</span>
              <span className="text-xs text-on-surface-muted">{item.license}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

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
          {t('about.title') || '关于 AriaAI'}
        </h2>
        <p className="text-sm text-on-surface-muted">
          {t('about.subtitle') || '版本信息和技术详情'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-container-low rounded-xl">
        {[
          { id: 'overview', label: t('about.overview') || '概览' },
          { id: 'changelog', label: t('about.changelog') || '更新日志' },
          { id: 'license', label: t('about.license') || '许可证' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-surface text-on-surface shadow-sm'
                : 'text-on-surface-muted hover:text-on-surface'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'changelog' && renderChangelog()}
      {activeTab === 'license' && renderLicense()}
    </div>
  )
}
