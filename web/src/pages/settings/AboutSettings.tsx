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

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  color: 'var(--color-codex-ink-mute)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const cardStyle: React.CSSProperties = {
  padding: 18,
  background: 'var(--color-codex-bg-elev)',
  border: '1px solid var(--color-codex-line)',
  borderRadius: 'var(--codex-r-md, 6px)',
}

export function AboutSettings() {
  const { i18n, t } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.4',
    buildDate: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__.slice(0, 10) : '-',
    environment: 'production',
    apiStatus: 'offline',
  })
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'changelog' | 'license'>('overview')

  const changelog: ChangelogEntry[] = [
    {
      version: '0.0.4',
      date: '2026-08-27',
      summary: isZh ? 'V0.0.4 发布：项目对话、运行治理、记忆连续性与 Skill 质量全面升级。' : 'V0.0.4 release: project chat, run governance, memory continuity, and Skill quality upgrades.',
      changes: isZh
        ? [
            '统一 Product Run Event 活动时间线，实时与刷新后的 Skill、步骤、工具、交付物、错误和确认状态保持一致。',
            '新增正式 ChatRun 生命周期投影与内容安全查询，运行状态、阶段、工具和产出数量可审计。',
            '项目记忆候选加入基线版本冲突守卫，记忆页展示版本历史和差异摘要，重复候选不再制造空版本。',
            '项目对话新增隐私安全的质量指标面板，反馈、修订和配置建议效果可量化。',
            '48 个 Skill 统一版本元数据并加入 CI 质量门禁，首批高优先级专业 Skill 补齐参考资料和示例。',
            'Skill 发布版本、状态和包指纹进入正式运行快照，项目质量面板可按版本查看完成率和用户反馈。',
            'Skill 新增不可变发布历史、项目级稳定灰度、隐私安全健康指标、自动止损以及管理员推广和一键回滚。',
            '长期对话扩大为 96 条预算候选并公开实际保留/摘要数量；每条项目回答可按需查看内容安全诊断并与同会话其他轮次对比。',
            '对话 Mode 统一控制模型、Token、上下文和工具池；Prompt 静态行为层文件化并加入 SHA-256 完整性诊断与启动门禁。',
            '项目问答新增逐项完整性、当前直接证据优先和未核验记忆限定规则；真实模型门禁记录首答质量，并对缺项或引用错误执行有界定向修复。',
            '记忆读取权威报告量化槽位账本覆盖、聚合 JSON 回退和双写差异；部署与生产 E2E 执行无正文全库审计。',
            '已验证备份后的幂等迁移仅将历史缺失数组字段的 null 槽位占位收敛为 []，不覆盖显式空值、内容、异常摘要或版本冲突。',
            '项目/客户记忆详情、项目简报、干系人分析和工作区项目组合已切换为有效槽位优先读取；缺失或损坏只回退单个槽位。',
          ]
        : [
            'Unified Product Run Event activity timeline across live and persisted Skill, step, tool, artifact, error, and confirmation states.',
            'First-class content-free ChatRun lifecycle projection and authorized diagnostics.',
            'Memory candidate version-conflict guards, visible snapshot history and diffs, and no-op duplicate acceptance.',
            'Privacy-safe project interaction quality metrics for feedback, revisions, and turn setup adoption.',
            'Version metadata and CI quality gates for all 48 Skills, with richer references and examples for the first priority set.',
            'Formal Skill release version/status/fingerprint snapshots and project-level outcome metrics by exact release.',
            'Immutable Skill release history, project-sticky canaries, privacy-safe health metrics, automatic stop-loss, and administrator promotion or rollback.',
            'Long conversations now budget up to 96 candidate messages with explicit retention summaries, plus on-demand content-free diagnostics and same-conversation turn comparison.',
            'Chat modes now centrally govern models, token caps, context, and tool pools, with file-backed prompt layers, SHA-256 diagnostics, and fail-closed startup validation.',
            'Project Q&A now enforces per-dimension completeness, current direct-evidence priority, and qualified unresolved memory; the real-provider gate records first-pass quality and applies bounded targeted repair for omissions or citation errors.',
            'A content-free memory read-authority audit now quantifies slot-ledger coverage, aggregate JSON fallback, and dual-write divergence during deploys and production E2E.',
            'After a verified backup, an idempotent migration normalizes only legacy null placeholders for missing array fields to []; explicit nulls, content, invalid digests, and version conflicts remain untouched.',
            'Project/client memory details, briefings, stakeholder analysis, and workspace portfolios now prefer verified slot values with per-slot aggregate fallback.',
          ],
    },
    {
      version: '0.0.3',
      date: '2026-05-28',
      summary: isZh ? 'V0.0.3 发布：Skill 体系治理、Harness 架构与记忆系统升级。' : 'V0.0.3 release: Skill governance, Harness architecture, and memory system upgrade.',
      changes: isZh
        ? [
            'Skill 体系评估与优化路线图：完成 48 个 Skill 全量评估，制定 6 阶段优化计划与质量分级标准。',
            'Skill 编写规范 v1.0：建立强制目录结构、YAML 头部标准、9 章节模板和 Linter 检查项。',
            'Model + Harness 架构设计：引入 AI Run Harness，统一事件协议、状态机和分层职责边界。',
            '记忆系统优化方案：从两层记忆升级为四层记忆体系，引入用户记忆、候选记忆和证据溯源机制。',
            '审计与鉴证、税务与法律服务线加入 Skill 能力分类。',
          ]
        : [
            'Skill system evaluation and optimization roadmap for all 48 skills with a 6-phase plan and quality grading.',
            'Skill writing guideline v1.0 with mandatory directory structure, YAML standards, 9-section template, and linter checks.',
            'Model + Harness architecture design introducing AI Run lifecycle, unified event protocol, and layered responsibilities.',
            'Memory system optimization upgrading from 2-layer to 4-layer memory with user memory, candidate memory, and evidence tracing.',
            'Audit & Assurance and Tax & Legal service lines added to the skill-category allowlist.',
          ],
    },
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
    'React',
    'TypeScript',
    'Vite',
    'Tailwind CSS',
    'FastAPI',
    'PostgreSQL',
    'SQLModel',
    'Claude API',
    'Moonshot AI',
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
    <div className="space-y-5">
      {/* Identity card */}
      <div style={cardStyle}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="flex h-14 w-14 flex-shrink-0 items-center justify-center"
              style={{
                background: 'var(--color-codex-accent-bg)',
                color: 'var(--color-codex-accent)',
                borderRadius: 'var(--codex-r-md, 6px)',
              }}
            >
              <Sparkles className="h-7 w-7" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  style={{
                    margin: 0,
                    fontSize: 22,
                    fontWeight: 500,
                    color: 'var(--color-codex-ink)',
                    letterSpacing: '-0.015em',
                  }}
                >
                  AriaAI
                </h2>
                <span
                  className="font-mono"
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    background: 'var(--color-codex-bg-tint)',
                    color: 'var(--color-codex-ink-soft)',
                    border: '1px solid var(--color-codex-line)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                    letterSpacing: '0.04em',
                  }}
                >
                  V{systemInfo.version}
                </span>
                <span
                  className="font-mono"
                  style={{
                    padding: '2px 8px',
                    fontSize: 10.5,
                    background:
                      systemInfo.apiStatus === 'online'
                        ? 'var(--color-codex-accent-bg)'
                        : 'color-mix(in oklch, var(--color-codex-bad) 12%, transparent)',
                    color:
                      systemInfo.apiStatus === 'online'
                        ? 'var(--color-codex-accent-ink)'
                        : 'var(--color-codex-bad)',
                    borderRadius: 'var(--codex-r-pill, 999px)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {systemInfo.apiStatus === 'online'
                    ? t('about.systemOnline') || (isZh ? '在线' : 'Online')
                    : t('about.systemOffline') || (isZh ? '离线' : 'Offline')}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-codex-ink-soft)' }}>
                {t('about.tagline') || (isZh ? '智能咨询助手' : 'Intelligent Consulting Assistant')}
              </p>
              <p
                style={{
                  margin: 0,
                  maxWidth: 560,
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: 'var(--color-codex-ink-mute)',
                }}
              >
                {isZh
                  ? '当前版本页汇总产品版本、打包时间、API 状态与基础技术栈，方便发布留档与环境核对。'
                  : 'This release page summarizes the product version, build time, API status, and baseline stack for quick release verification.'}
              </p>
            </div>
          </div>
          <button
            onClick={copyVersionInfo}
            className="inline-flex flex-shrink-0 items-center gap-2 self-start px-3 py-2 transition-colors"
            style={{
              fontSize: 12.5,
              background: 'var(--color-codex-bg)',
              color: 'var(--color-codex-ink-soft)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
            title={t('about.copyInfo') || (isZh ? '复制版本信息' : 'Copy version info')}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" style={{ color: 'var(--color-codex-accent)' }} />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? (isZh ? '已复制' : 'Copied') : t('about.copyInfo') || (isZh ? '复制版本信息' : 'Copy info')}
          </button>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            icon: Package,
            label: t('about.version') || (isZh ? '版本' : 'Version'),
            value: `V${systemInfo.version}`,
            sub: t('about.webVersion') || (isZh ? '前端发布版本' : 'Web release'),
          },
          {
            icon: Server,
            label: t('about.apiVersion') || (isZh ? 'API 版本' : 'API Version'),
            value: systemInfo.apiVersion || '-',
            sub:
              systemInfo.apiStatus === 'online'
                ? t('about.connected') || (isZh ? '接口已连接' : 'Connected')
                : isZh
                  ? '接口未连接'
                  : 'Unavailable',
          },
          {
            icon: Calendar,
            label: t('about.buildDate') || (isZh ? '构建日期' : 'Build Date'),
            value: systemInfo.buildDate,
            sub: `${t('about.packagedAt') || (isZh ? '打包时间' : 'Packaged')}: ${packagedAtLabel}`,
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
            style={{
              padding: 16,
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div style={labelStyle}>{item.label}</div>
              <div
                className="flex h-7 w-7 items-center justify-center"
                style={{
                  background: 'var(--color-codex-bg-tint)',
                  color: 'var(--color-codex-ink-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                <item.icon className="h-3.5 w-3.5" />
              </div>
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 18,
                fontWeight: 500,
                color: 'var(--color-codex-ink)',
                letterSpacing: '-0.01em',
              }}
            >
              {item.value}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 11.5,
                lineHeight: 1.55,
                color: 'var(--color-codex-ink-mute)',
              }}
            >
              {item.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Release notes + tech stack */}
      <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
        <div style={cardStyle}>
          <div className="mb-3">
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
              {isZh ? '版本说明' : 'Release Notes'}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
              {isZh ? '当前记录版本的定位与说明。' : 'Purpose and scope of the current recorded release.'}
            </p>
          </div>
          <div
            style={{
              padding: 14,
              background: 'var(--color-codex-bg-tint)',
              border: '1px solid var(--color-codex-line-soft)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <div
              className="flex items-center gap-2"
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--color-codex-accent-ink)',
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isZh ? 'V0.0.4 发布版本' : 'V0.0.4 Release'}
            </div>
            <p
              style={{
                margin: '10px 0 0',
                fontSize: 12.5,
                lineHeight: 1.7,
                color: 'var(--color-codex-ink-soft)',
              }}
            >
              {isZh
                ? '本版本完成项目对话、Skill、运行审计和记忆治理的产品闭环：过程可理解、结果可验证、上下文可追溯、候选冲突可确认，并保持 Aria 原生权限与 Provider 边界。'
                : 'This release closes the product loop across project chat, Skills, run auditing, and memory governance: understandable progress, verifiable results, traceable context, and explicit conflict review within Aria-native authorization and provider boundaries.'}
            </p>
          </div>
        </div>

        <div style={cardStyle}>
          <div className="mb-3">
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
              {t('about.techStack') || (isZh ? '技术栈' : 'Tech Stack')}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
              {isZh ? '当前版本主要依赖的核心技术。' : 'Core technologies behind the current release.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {techStack.map((name) => (
              <span
                key={name}
                className="font-mono"
                style={{
                  padding: '4px 10px',
                  fontSize: 11.5,
                  background: 'var(--color-codex-bg-tint)',
                  color: 'var(--color-codex-ink-soft)',
                  border: '1px solid var(--color-codex-line-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  letterSpacing: '0.02em',
                }}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div style={cardStyle}>
        <div className="mb-3">
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
            {isZh ? '常用链接' : 'Quick Links'}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
            {isZh ? '跳转到仓库、支持与反馈入口。' : 'Jump to repository, support, and feedback destinations.'}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {links.map((link) => (
            <a
              key={link.title}
              href={link.href}
              target={link.href.startsWith('http') ? '_blank' : undefined}
              rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="group flex items-center gap-3 transition-colors"
              style={{
                padding: '12px 14px',
                background: 'var(--color-codex-bg)',
                border: '1px solid var(--color-codex-line-soft)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-codex-bg-tint)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--color-codex-bg)'
              }}
            >
              <div
                className="flex h-8 w-8 items-center justify-center flex-shrink-0"
                style={{
                  background: 'var(--color-codex-bg-tint)',
                  color: 'var(--color-codex-ink-soft)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                <link.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--color-codex-ink)',
                  }}
                >
                  {link.title}
                </div>
                <div
                  className="truncate font-mono"
                  style={{
                    fontSize: 11,
                    color: 'var(--color-codex-ink-mute)',
                  }}
                >
                  {link.subtitle}
                </div>
              </div>
              <ExternalLink
                className="h-3.5 w-3.5"
                style={{ color: 'var(--color-codex-ink-faint)' }}
              />
            </a>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        style={{
          paddingTop: 18,
          borderTop: '1px solid var(--color-codex-line-soft)',
          fontSize: 11.5,
          color: 'var(--color-codex-ink-mute)',
        }}
      >
        <p className="flex items-center gap-1" style={{ margin: 0 }}>
          Made with <Heart className="h-3 w-3" style={{ color: 'var(--color-codex-bad)' }} /> by AriaAI Team
        </p>
        <p style={{ margin: 0 }} className="font-mono">
          © 2026 AriaAI. {t('about.allRightsReserved') || (isZh ? '保留所有权利' : 'All rights reserved')}
        </p>
      </div>
    </div>
  )

  const renderChangelog = () => (
    <div className="space-y-5">
      <div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
          {t('about.changelog') || (isZh ? '更新日志' : 'Changelog')}
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--color-codex-ink-mute)' }}>
          {isZh ? '记录每个正式版本的重要变更。' : 'Track the important changes for each recorded release.'}
        </p>
      </div>

      <div className="space-y-4">
        {changelog.map((entry, index) => (
          <div
            key={entry.version}
            className="relative pl-6"
            style={
              index !== changelog.length - 1
                ? {
                    paddingBottom: 20,
                    borderLeft: '1px solid var(--color-codex-line)',
                    marginLeft: 4,
                  }
                : { marginLeft: 4 }
            }
          >
            <div
              className="absolute"
              style={{
                left: -5,
                top: 6,
                width: 9,
                height: 9,
                borderRadius: 'var(--codex-r-pill, 999px)',
                background: index === 0 ? 'var(--color-codex-accent)' : 'var(--color-codex-ink-faint)',
              }}
            />
            <div style={cardStyle}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className="font-mono"
                  style={{
                    padding: '2px 8px',
                    fontSize: 11.5,
                    fontWeight: 600,
                    background: 'var(--color-codex-bg-tint)',
                    color: 'var(--color-codex-ink)',
                    border: '1px solid var(--color-codex-line)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                    letterSpacing: '0.04em',
                  }}
                >
                  V{entry.version}
                </span>
                <span
                  className="font-mono"
                  style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
                >
                  {entry.date}
                </span>
                {index === 0 ? (
                  <span
                    className="font-mono"
                    style={{
                      padding: '2px 8px',
                      fontSize: 10.5,
                      background: 'var(--color-codex-accent-bg)',
                      color: 'var(--color-codex-accent-ink)',
                      borderRadius: 'var(--codex-r-pill, 999px)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('about.latest') || (isZh ? '最新' : 'Latest')}
                  </span>
                ) : null}
              </div>
              <p
                style={{
                  margin: '0 0 14px',
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--color-codex-ink-soft)',
                }}
              >
                {entry.summary}
              </p>
              <ul className="space-y-2">
                {entry.changes.map((change) => (
                  <li
                    key={change}
                    className="flex items-start gap-2"
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      color: 'var(--color-codex-ink)',
                    }}
                  >
                    <ChevronRight
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                      style={{ color: 'var(--color-codex-accent)' }}
                    />
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
    <div className="space-y-5">
      <div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
          {t('about.license') || (isZh ? '许可说明' : 'License')}
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--color-codex-ink-mute)' }}>
          {isZh ? '当前产品许可与第三方依赖许可概览。' : 'Overview of product licensing and third-party dependencies.'}
        </p>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}>
          {isZh ? 'AriaAI 使用许可' : 'AriaAI License Agreement'}
        </h3>
        <div
          className="space-y-3"
          style={{ fontSize: 12.5, lineHeight: 1.75, color: 'var(--color-codex-ink-mute)' }}
        >
          <p style={{ margin: 0 }}>
            Copyright © 2026 AriaAI. {t('about.allRightsReserved') || (isZh ? '保留所有权利' : 'All rights reserved')}.
          </p>
          <p style={{ margin: 0 }}>
            {isZh
              ? '本软件为专有软件与保密资产。未经授权，不得以任何形式复制、转让或分发。'
              : 'This software is proprietary and confidential. Unauthorized copying, transfer, or distribution is prohibited.'}
          </p>
          <p style={{ margin: 0 }}>
            {isZh
              ? '软件按"现状"提供，不附带任何明示或暗示担保，包括适销性、特定用途适用性及非侵权担保。'
              : 'The software is provided "as is", without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose, and noninfringement.'}
          </p>
        </div>
      </div>

      <div>
        <h3
          style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: 'var(--color-codex-ink)' }}
        >
          {t('about.thirdPartyLicenses') || (isZh ? '第三方许可证' : 'Third-party Licenses')}
        </h3>
        <div className="space-y-2">
          {[
            { name: 'React', license: 'MIT License' },
            { name: 'Tailwind CSS', license: 'MIT License' },
            { name: 'Lucide Icons', license: 'ISC License' },
            { name: 'FastAPI', license: 'MIT License' },
          ].map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between"
              style={{
                padding: '10px 14px',
                background: 'var(--color-codex-bg-elev)',
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-codex-ink)' }}>
                {item.name}
              </span>
              <span
                className="font-mono"
                style={{ fontSize: 11, color: 'var(--color-codex-ink-mute)' }}
              >
                {item.license}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  if (loading) {
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
    <div
      className="theme-codex"
      style={{
        background: 'var(--color-codex-bg)',
        color: 'var(--color-codex-ink)',
        padding: '8px 4px 32px',
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 500,
            color: 'var(--color-codex-ink)',
            letterSpacing: '-0.015em',
          }}
        >
          {headerTitle}
        </h1>
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 13,
            color: 'var(--color-codex-ink-mute)',
            lineHeight: 1.6,
          }}
        >
          {headerSubtitle}
        </p>
      </header>

      <div
        className="mb-5 flex gap-1 p-1"
        style={{
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-sm, 3px)',
        }}
      >
        {[
          { id: 'overview', label: t('about.overview') || (isZh ? '概览' : 'Overview') },
          { id: 'changelog', label: t('about.changelog') || (isZh ? '更新日志' : 'Changelog') },
          { id: 'license', label: t('about.license') || (isZh ? '许可说明' : 'License') },
        ].map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'overview' | 'changelog' | 'license')}
              className="flex-1 px-3 py-2 transition-all"
              style={{
                fontSize: 12.5,
                fontWeight: isActive ? 600 : 500,
                background: isActive ? 'var(--color-codex-bg)' : 'transparent',
                color: isActive ? 'var(--color-codex-ink)' : 'var(--color-codex-ink-mute)',
                borderRadius: 'var(--codex-r-sm, 3px)',
                border: isActive
                  ? '1px solid var(--color-codex-line)'
                  : '1px solid transparent',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'changelog' && renderChangelog()}
      {activeTab === 'license' && renderLicense()}
    </div>
  )
}
