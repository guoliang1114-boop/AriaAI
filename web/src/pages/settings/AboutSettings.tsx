import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Calendar,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Heart,
  Loader2,
  Mail,
  MessageCircle,
  Package,
  Server,
  Shield,
  Sparkles,
} from 'lucide-react'
import { api } from '../../api/client'
import { formatDateTime } from '../../utils/timezone'

interface SystemInfo {
  version: string
  buildDate: string
  environment: string
  apiStatus: 'online' | 'offline'
  apiVersion?: string
}

interface ChangelogEntry {
  version: string
  date: string
  summary: string
  changes: string[]
}

export function AboutSettings() {
  const { i18n, t } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.2',
    buildDate: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__.slice(0, 10) : '-',
    environment: 'production',
    apiStatus: 'offline',
  })
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'changelog' | 'license'>('overview')

  const changelog: ChangelogEntry[] = [
    {
      version: '0.0.2',
      date: '2026-04-23',
      summary: isZh ? 'V0.0.2 发布：Skill、项目记忆、客户干系人与 PPT 交付体验升级。' : 'V0.0.2 release: Skill, project memory, client stakeholder, and PPT delivery improvements.',
      changes: isZh
        ? [
            '数字化战略 Skill 强制使用 digital-strategy 模板生成 PPT，并复制模板原型页以保留品牌视觉元素。',
            'Skill 执行清单优化为可查看步骤日志，长任务流式中断后会尝试从后台同步已保存结果。',
            '能力页新增“顾问基础能力”服务线，并重分问题定义、摘要交付、质量审查和复盘沉淀二级分类。',
            '项目/客户记忆、结构化客户干系人和任务中心持续增强，为下一阶段迭代打好基线。',
          ]
        : [
            'Digital Strategy Skill now enforces the digital-strategy PPT template and clones prototype slides to preserve branded visuals.',
            'Skill progress now shows step logs and attempts backend recovery when long-running streams disconnect.',
            'Skills now include a Consulting Foundations service line with refined second-level categories.',
            'Project/client memory, structured client stakeholders, and operations visibility were strengthened as the next iteration baseline.',
          ],
    },
    {
      version: '0.0.1',
      date: '2026-04-19',
      summary: isZh ? '首个正式记录版本，统一产品版本显示。' : 'First recorded release baseline with unified version display.',
      changes: isZh
        ? [
            '将 Web 版本统一记录为 V0.0.1。',
            '让 About 页面直接展示当前打包版本与发布时间。',
            '为后端 health 接口补充 API version 返回值。',
            '建立后续版本迭代可继续追加的更新记录起点。',
          ]
        : [
            'Recorded the web release baseline as V0.0.1.',
            'Aligned the About page with the packaged app version and build time.',
            'Added API version reporting through the backend health endpoint.',
            'Established the starting point for future release notes.',
          ],
    },
  ]

  const techStack = [
    { name: 'React', color: 'bg-sky-100 text-sky-700 border-sky-200' },
    { name: 'TypeScript', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    { name: 'Vite', color: 'bg-violet-100 text-violet-700 border-violet-200' },
    { name: 'Tailwind CSS', color: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
    { name: 'FastAPI', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    { name: 'PostgreSQL', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    { name: 'SQLModel', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    { name: 'Claude API', color: 'bg-orange-100 text-orange-700 border-orange-200' },
    { name: 'Moonshot AI', color: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' },
  ]

  const links = [
    {
      title: 'GitHub',
      subtitle: isZh ? '查看代码仓库与版本历史' : 'View the repository and release history',
      href: 'https://github.com/guoliang1114-boop/AriaAI',
      icon: FileText,
    },
    {
      title: isZh ? '文档' : 'Documentation',
      subtitle: isZh ? '查看产品说明与部署资料' : 'Read product and deployment docs',
      href: 'https://aria.d2cgo.co/settings/about',
      icon: ExternalLink,
    },
    {
      title: isZh ? '邮件支持' : 'Email Support',
      subtitle: 'support@ariaai.com',
      href: 'mailto:support@ariaai.com',
      icon: Mail,
    },
    {
      title: isZh ? '反馈建议' : 'Feedback',
      subtitle: isZh ? '提交问题与体验建议' : 'Share bugs and product feedback',
      href: 'https://ariaai.com/feedback',
      icon: MessageCircle,
    },
  ]

  useEffect(() => {
    void loadSystemInfo()
  }, [])

  const loadSystemInfo = async () => {
    try {
      setLoading(true)
      try {
        const health = await api.get<{ version?: string; environment?: string }>('/health')
        setSystemInfo((prev) => ({
          ...prev,
          apiStatus: 'online',
          apiVersion: health.version,
          environment: health.environment || 'production',
        }))
      } catch {
        setSystemInfo((prev) => ({
          ...prev,
          apiStatus: 'offline',
        }))
      }
    } finally {
      setLoading(false)
    }
  }

  const copyVersionInfo = () => {
    const info = [
      `AriaAI v${systemInfo.version}`,
      `${isZh ? '构建日期' : 'Build date'}: ${systemInfo.buildDate}`,
      `${isZh ? 'API 状态' : 'API status'}: ${systemInfo.apiStatus}${systemInfo.apiVersion ? ` (${systemInfo.apiVersion})` : ''}`,
      `${isZh ? '环境' : 'Environment'}: ${systemInfo.environment}`,
    ].join('\n')
    navigator.clipboard.writeText(info)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const packagedAtLabel =
    typeof __BUILD_TIME__ !== 'undefined'
      ? formatDateTime(__BUILD_TIME__, isZh ? 'zh-CN' : 'en-US')
      : '-'

  const headerTitle = t('about.title') || (isZh ? '关于 AriaAI' : 'About AriaAI')
  const headerSubtitle =
    t('about.subtitle') || (isZh ? '版本信息与技术说明' : 'Version info and technical details')

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[28px] border border-sky-100 bg-[linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(239,246,255,0.96)_38%,_rgba(236,253,245,0.92)_100%)] p-6 shadow-[0_24px_70px_-42px_rgba(59,130,246,0.28)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-500 shadow-lg shadow-sky-500/20">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-semibold text-slate-950">AriaAI</h3>
                <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-100">
                  V{systemInfo.version}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    systemInfo.apiStatus === 'online'
                      ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-rose-100 text-rose-700 ring-1 ring-rose-200'
                  }`}
                >
                  {systemInfo.apiStatus === 'online'
                    ? t('about.systemOnline') || (isZh ? '系统在线' : 'Online')
                    : t('about.systemOffline') || (isZh ? '系统离线' : 'Offline')}
                </span>
              </div>
              <p className="text-sm text-slate-600">
                {t('about.tagline') || (isZh ? '智能咨询助手' : 'Intelligent Consulting Assistant')}
              </p>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                {isZh
                  ? '当前版本页汇总产品版本、打包时间、API 状态与基础技术栈，方便发布留档与环境核对。'
                  : 'This release page summarizes the product version, build time, API status, and baseline stack for quick release verification.'}
              </p>
            </div>
          </div>
          <button
            onClick={copyVersionInfo}
            className="inline-flex items-center gap-2 self-start rounded-2xl border border-white/80 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white"
            title={t('about.copyInfo') || (isZh ? '复制版本信息' : 'Copy version info')}
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? (isZh ? '已复制' : 'Copied') : t('about.copyInfo') || (isZh ? '复制版本信息' : 'Copy version info')}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            icon: Package,
            label: t('about.version') || (isZh ? '版本' : 'Version'),
            value: `V${systemInfo.version}`,
            sub: t('about.webVersion') || (isZh ? '前端发布版本' : 'Web release version'),
          },
          {
            icon: Server,
            label: t('about.apiVersion') || (isZh ? 'API 版本' : 'API Version'),
            value: systemInfo.apiVersion || '-',
            sub: systemInfo.apiStatus === 'online'
              ? t('about.connected') || (isZh ? '接口已连接' : 'Connected')
              : (isZh ? '接口未连接' : 'Unavailable'),
          },
          {
            icon: Calendar,
            label: t('about.buildDate') || (isZh ? '构建日期' : 'Build Date'),
            value: systemInfo.buildDate,
            sub: `${t('about.packagedAt') || (isZh ? '打包时间' : 'Packaged at')}: ${packagedAtLabel}`,
          },
          {
            icon: Shield,
            label: t('about.environment') || (isZh ? '环境' : 'Environment'),
            value: systemInfo.environment,
            sub:
              systemInfo.environment === 'production'
                ? t('about.production') || (isZh ? '生产环境' : 'Production')
                : t('about.development') || (isZh ? '开发环境' : 'Development'),
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-3xl border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_40px_-32px_rgba(59,130,246,0.2)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm text-slate-500">{item.label}</div>
              <div className="rounded-xl bg-sky-50 p-2 text-sky-600">
                <item.icon className="h-4 w-4" />
              </div>
            </div>
            <div className="text-xl font-semibold text-slate-950">{item.value}</div>
            <div className="mt-2 text-sm leading-6 text-slate-600">{item.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[28px] border border-outline/10 bg-surface p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-on-surface">
              {isZh ? '版本说明' : 'Release Notes'}
            </h3>
            <p className="mt-1 text-sm text-on-surface-muted">
              {isZh ? '当前记录版本的定位与说明。' : 'Purpose and scope of the current recorded release.'}
            </p>
          </div>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-700">
              <Sparkles className="h-4 w-4" />
              {isZh ? 'V0.0.2 发布版本' : 'V0.0.2 Release'}
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              {isZh
                ? '本版本将 Skill 执行、数字化战略 PPT 生成、能力分类、项目/客户记忆和客户干系人体验整理为一个可发布基线，作为下一阶段迭代的稳定起点。'
                : 'This release consolidates Skill execution, Digital Strategy PPT generation, capability taxonomy, project/client memory, and client stakeholder workflows into a stable baseline for the next iteration.'}
            </p>
          </div>
        </div>

        <div className="rounded-[28px] border border-outline/10 bg-surface p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-on-surface">
              {t('about.techStack') || (isZh ? '技术栈' : 'Tech Stack')}
            </h3>
            <p className="mt-1 text-sm text-on-surface-muted">
              {isZh ? '当前版本主要依赖的核心技术。' : 'Core technologies behind the current release.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {techStack.map((tech) => (
              <span key={tech.name} className={`rounded-xl border px-3 py-1.5 text-sm font-medium ${tech.color}`}>
                {tech.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-outline/10 bg-surface p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-on-surface">
            {isZh ? '常用链接' : 'Quick Links'}
          </h3>
          <p className="mt-1 text-sm text-on-surface-muted">
            {isZh ? '跳转到仓库、支持与反馈入口。' : 'Jump to repository, support, and feedback destinations.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {links.map((link) => (
            <a
              key={link.title}
              href={link.href}
              target={link.href.startsWith('http') ? '_blank' : undefined}
              rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="group flex items-center gap-3 rounded-2xl border border-outline/10 bg-surface-container-low px-4 py-4 transition hover:border-outline/30 hover:bg-surface-container-lowest"
            >
              <div className="rounded-xl bg-surface-container-high p-2.5 text-on-surface-muted transition group-hover:bg-sky-50 group-hover:text-sky-600">
                <link.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-on-surface">{link.title}</div>
                <div className="truncate text-xs text-on-surface-muted">{link.subtitle}</div>
              </div>
              <ExternalLink className="h-4 w-4 text-on-surface-muted" />
            </a>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-outline/10 pt-6 text-xs text-on-surface-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1">
          Made with <Heart className="h-3 w-3 text-error" /> by AriaAI Team
        </p>
        <p>© 2026 AriaAI. {t('about.allRightsReserved') || (isZh ? '保留所有权利' : 'All rights reserved')}</p>
      </div>
    </div>
  )

  const renderChangelog = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-on-surface">
          {t('about.changelog') || (isZh ? '更新日志' : 'Changelog')}
        </h3>
        <p className="mt-1 text-sm text-on-surface-muted">
          {isZh ? '记录每个正式版本的重要变更。' : 'Track the important changes for each recorded release.'}
        </p>
      </div>

      <div className="space-y-6">
        {changelog.map((entry, index) => (
          <div
            key={entry.version}
            className={`relative pl-6 ${index !== changelog.length - 1 ? 'border-l-2 border-outline/20 pb-6' : ''}`}
          >
            <div className="absolute left-0 top-1 h-3 w-3 -translate-x-[7px] rounded-full bg-primary" />
            <div className="rounded-2xl border border-outline/10 bg-surface p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">
                  V{entry.version}
                </span>
                <span className="text-sm text-on-surface-muted">{entry.date}</span>
                {index === 0 ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                    {t('about.latest') || (isZh ? '最新' : 'Latest')}
                  </span>
                ) : null}
              </div>
              <p className="mb-4 text-sm leading-6 text-slate-700">{entry.summary}</p>
              <ul className="space-y-2">
                {entry.changes.map((change) => (
                  <li key={change} className="flex items-start gap-2 text-sm text-on-surface">
                    <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
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
      <div>
        <h3 className="text-lg font-semibold text-on-surface">
          {t('about.license') || (isZh ? '许可说明' : 'License')}
        </h3>
        <p className="mt-1 text-sm text-on-surface-muted">
          {isZh ? '当前产品许可与第三方依赖许可概览。' : 'Overview of product licensing and third-party dependencies.'}
        </p>
      </div>

      <div className="rounded-2xl border border-outline/10 bg-surface p-6 shadow-sm">
        <h4 className="mb-4 font-medium text-on-surface">
          {isZh ? 'AriaAI 使用许可' : 'AriaAI License Agreement'}
        </h4>
        <div className="space-y-4 text-sm leading-7 text-on-surface-muted">
          <p>Copyright © 2026 AriaAI. {t('about.allRightsReserved') || (isZh ? '保留所有权利' : 'All rights reserved')}.</p>
          <p>
            {isZh
              ? '本软件为专有软件与保密资产。未经授权，不得以任何形式复制、转让或分发。'
              : 'This software is proprietary and confidential. Unauthorized copying, transfer, or distribution is prohibited.'}
          </p>
          <p>
            {isZh
              ? '软件按“现状”提供，不附带任何明示或暗示担保，包括适销性、特定用途适用性及非侵权担保。'
              : 'The software is provided "as is", without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose, and noninfringement.'}
          </p>
        </div>
      </div>

      <div>
        <h4 className="mb-3 font-medium text-on-surface">
          {t('about.thirdPartyLicenses') || (isZh ? '第三方许可证' : 'Third-party Licenses')}
        </h4>
        <div className="space-y-2">
          {[
            { name: 'React', license: 'MIT License' },
            { name: 'Tailwind CSS', license: 'MIT License' },
            { name: 'Lucide Icons', license: 'ISC License' },
            { name: 'FastAPI', license: 'MIT License' },
          ].map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between rounded-xl border border-outline/10 bg-surface-container-low px-4 py-3"
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
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold text-on-surface">{headerTitle}</h2>
        <p className="text-sm text-on-surface-muted">{headerSubtitle}</p>
      </div>

      <div className="flex gap-1 rounded-xl bg-surface-container-low p-1">
        {[
          { id: 'overview', label: t('about.overview') || (isZh ? '概览' : 'Overview') },
          { id: 'changelog', label: t('about.changelog') || (isZh ? '更新日志' : 'Changelog') },
          { id: 'license', label: t('about.license') || (isZh ? '许可说明' : 'License') },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'overview' | 'changelog' | 'license')}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-surface text-on-surface shadow-sm'
                : 'text-on-surface-muted hover:text-on-surface'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'changelog' && renderChangelog()}
      {activeTab === 'license' && renderLicense()}
    </div>
  )
}
