import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Paperclip,
  FolderKanban,
  Wrench,
  Search,
  Sparkles,
  Loader2,
  Plus,
  Clock,
  ChevronUp,
  ArrowDown,
  ArrowRight,
  Trash2,
  Send,
  Square,
  Copy,
  Check,
  ChevronLeft,
  PanelLeftOpen,
  X,
  TriangleAlert,
  BookOpen,
  File as FileIcon,
  ChevronDown,
  Info,
  FileText,
  TrendingUp,
  Target,
  Users,
  Mail,
  Zap,
  Download,
} from 'lucide-react'
import { api } from '../../api/client'
import { exportConversationFile } from '../../api/chatExport'
import { getApiBaseUrl } from '../../config/api'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { PageTitle } from '../../components/PageTitle'
import { CxSkeleton, CxStatus, CxTopProgress } from '../../components/codex'
import { downloadArtifact } from '../projects/downloadArtifact'
import type { Conversation, GeneratedArtifact, Message, Project, Skill } from '../../types/api'
import { useAppTimeZone } from '../../hooks/useAppTimeZone'
import { formatDateOnly, formatDatePartsKey, formatTimeOnly, parseAppDateTime } from '../../utils/timezone'

const PAGE_SIZE = 20

// ─── helpers ───────────────────────────────────────────────────────────────

function formatTime(dateStr: string, timeZone?: string) {
  // Backend timestamps are tz-naive UTC ("2026-05-28T13:22:00", no Z); plain
  // ``new Date(...)`` would treat them as browser-local and skew by the local
  // offset. ``parseAppDateTime`` appends Z so the same string parses as UTC,
  // which is what the timezone formatters below expect.
  const d = parseAppDateTime(dateStr)
  const now = new Date()
  const todayKey = formatDatePartsKey(now, timeZone)
  const targetKey = formatDatePartsKey(d, timeZone)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayKey = formatDatePartsKey(yesterday, timeZone)
  if (todayKey === targetKey) return formatTimeOnly(d, { hour: '2-digit', minute: '2-digit' }, timeZone)
  if (yesterdayKey === targetKey) return 'Yesterday'
  return formatDateOnly(d, { year: 'numeric', month: '2-digit', day: '2-digit' }, timeZone)
}

function groupConversations(conversations: Conversation[], t: any, timeZone?: string) {
  const now = new Date()
  const today: Conversation[] = []
  const yesterdayItems: Conversation[] = []
  const thisWeek: Conversation[] = []
  const older: Conversation[] = []
  const todayKey = formatDatePartsKey(now, timeZone)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayKey = formatDatePartsKey(yesterday, timeZone)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 7)
  const weekStartKey = formatDatePartsKey(weekStart, timeZone)

  for (const c of conversations) {
    const itemKey = formatDatePartsKey(c.updated_at, timeZone)
    if (itemKey === todayKey) today.push(c)
    else if (itemKey === yesterdayKey) yesterdayItems.push(c)
    else if (itemKey >= weekStartKey) thisWeek.push(c)
    else older.push(c)
  }

  return [
    ...(today.length ? [{ label: t('chat.today'), items: today }] : []),
    ...(yesterdayItems.length ? [{ label: t('chat.yesterday'), items: yesterdayItems }] : []),
    ...(thisWeek.length ? [{ label: t('chat.thisWeek'), items: thisWeek }] : []),
    ...(older.length ? [{ label: t('chat.earlier'), items: older }] : []),
  ]
}

// Prompt cards shown on the empty state.
// All cards share the same Codex chrome (bg-elev + line, accent-tinted
// icon tile, ink title, ink-mute description), so we no longer carry
// per-card palette fields — only the icon and copy vary.
interface PromptCard {
  icon: React.ElementType
  label: string
  prompt: string
}

type ProgressStatus = 'pending' | 'active' | 'done'

interface ChatProgressStep {
  key: string
  label: string
  description: string
  status: ProgressStatus
  logs: string[]
}

type StageTimingEntry = {
  key: string
  label: string
  durationMs: number
}

const STAGE_TIMING_LABELS: Record<string, string> = {
  conversation_ready_ms: '会话准备',
  user_message_saved_ms: '保存提问',
  context_loaded_ms: '加载上下文',
  history_loaded_ms: '整理历史',
  model_ready_ms: '准备模型',
  prepare_total_ms: '请求前准备',
  model_first_event_ms: '首次响应',
  planning_ms: '生成规划',
  tools_total_ms: '工具执行',
  follow_up_ms: '整理结果',
  save_ms: '保存答复',
  total_stream_ms: '本轮总耗时',
}

function formatDuration(durationMs: number) {
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 0 : 1)}s`
  return `${Math.round(durationMs)}ms`
}

function stageTimingLabel(key: string) {
  if (STAGE_TIMING_LABELS[key]) return STAGE_TIMING_LABELS[key]
  if (key.startsWith('tool:')) return `工具 ${key.slice(5)}`
  return key
}

function mergeStageTimingEntries(entries: StageTimingEntry[], next: StageTimingEntry) {
  const existingIndex = entries.findIndex(item => item.key === next.key)
  if (existingIndex === -1) return [...entries, next]
  return entries.map((item, index) => index === existingIndex ? next : item)
}

function stageTimingEntriesFromMeta(meta: any): StageTimingEntry[] {
  const raw = meta?.stage_timings
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => ({
      key,
      label: stageTimingLabel(key),
      durationMs: Number(value),
    }))
}

const BASE_CHAT_LOADING_STEPS: ChatProgressStep[] = [
  { key: 'prepare', label: '准备请求', description: '提交消息并初始化本轮上下文', status: 'pending', logs: [] },
  { key: 'thinking', label: '理解问题', description: '模型正在分析你的问题并组织答案', status: 'pending', logs: [] },
  { key: 'final', label: '生成答复', description: '正在返回正文内容并整理最终回复', status: 'pending', logs: [] },
  { key: 'saving', label: '保存结果', description: '保存本次回复，方便稍后继续查看', status: 'pending', logs: [] },
]

const BASE_PROGRESS_STEPS: ChatProgressStep[] = [
  { key: 'prepare', label: '准备上下文', description: '整理会话、项目与 Skill 信息', status: 'pending', logs: [] },
  { key: 'thinking', label: '模型规划', description: '分析需求并判断是否需要调用工具', status: 'pending', logs: [] },
  { key: 'tools', label: '执行工具', description: '生成 PPT / 文档 / 表格等交付物', status: 'pending', logs: [] },
  { key: 'final', label: '整理答复', description: '汇总工具结果并形成最终回复', status: 'pending', logs: [] },
  { key: 'saving', label: '保存结果', description: '保存回复与生成的附件', status: 'pending', logs: [] },
]

const STAGE_STEP_INDEX: Record<string, number> = {
  thinking: 1,
  planning: 1,
  tool_planned: 1,
  continuing: 1,
  tools: 2,
  tool_running: 2,
  follow_up: 3,
  finalizing: 3,
  saving: 4,
}

const CHAT_STAGE_STEP_INDEX: Record<string, number> = {
  thinking: 1,
  planning: 1,
  tool_planned: 1,
  continuing: 2,
  tools: 2,
  tool_running: 2,
  follow_up: 2,
  finalizing: 2,
  saving: 3,
}

const SKILL_PROGRESS_STAGES = new Set(['planning', 'tool_planned', 'tools', 'tool_running', 'follow_up'])

function createProgressSteps(): ChatProgressStep[] {
  return BASE_PROGRESS_STEPS.map(step => ({ ...step, logs: [] }))
}

function createChatLoadingSteps(): ChatProgressStep[] {
  return BASE_CHAT_LOADING_STEPS.map(step => ({ ...step, logs: [] }))
}

function formatProgressLog(message: string, timeZone?: string) {
  return `${formatTimeOnly(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }, timeZone)} ${message}`
}

function advanceProgressSteps(
  steps: ChatProgressStep[],
  index: number,
  description?: string,
  log?: string,
): ChatProgressStep[] {
  return steps.map((step, i) => ({
    ...step,
    status: i < index ? 'done' : i === index ? 'active' : step.status,
    description: i === index && description ? description : step.description,
    logs: i === index && log ? [...step.logs, formatProgressLog(log)].slice(-20) : step.logs,
  }))
}

function completeProgressSteps(steps: ChatProgressStep[]): ChatProgressStep[] {
  const source = steps.length ? steps : createProgressSteps()
  return source.map((step, index) => ({
    ...step,
    status: 'done' as const,
    logs: index === source.length - 1
      ? [...step.logs, formatProgressLog('回复已保存，执行完成。')].slice(-20)
      : step.logs,
  }))
}

function completeChatLoadingSteps(steps: ChatProgressStep[]): ChatProgressStep[] {
  const source = steps.length ? steps : createChatLoadingSteps()
  return source.map((step, index) => ({
    ...step,
    status: 'done' as const,
    logs: index === source.length - 1
      ? [...step.logs, formatProgressLog('回复已保存，执行完成。')].slice(-20)
      : step.logs,
  }))
}

function buildProgressFromMetadata(meta: any): ChatProgressStep[] {
  if (Array.isArray(meta?.skill_progress) && meta.skill_progress.length > 0) return meta.skill_progress
  return []
  if (meta?.stage_timings && !meta?.skill_id) return []
  const toolCalls = Array.isArray(meta?.tool_calls) ? meta.tool_calls : []
  const artifacts = Array.isArray(meta?.artifacts) ? meta.artifacts : []
  const hasSkillSignals = toolCalls.length > 0 || artifacts.length > 0 || meta?.skill_id
  if (!hasSkillSignals) return []

  const steps = completeProgressSteps(createProgressSteps())
  steps[0].logs = ['已准备会话、项目与 Skill 上下文。']
  steps[1].logs = ['模型已完成需求理解与执行规划。']
  steps[2].logs = toolCalls.length
    ? toolCalls.map((item: any) => `${item.status === 'completed' ? '完成' : '失败'}: ${item.summary || item.message || item.tool_name || '工具执行'}`)
    : ['本次未调用文件生成工具，模型直接生成正文结果。']
  steps[3].logs = ['已汇总工具结果并形成最终回复。']
  steps[4].logs = ['回复已保存，执行完成。']
  return steps
}

function ChatStatusPill({ message }: { message?: string | null }) {
  return (
    <div
      className="mb-3 inline-flex items-center gap-2"
      style={{
        padding: '6px 12px',
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-sm, 3px)',
        fontSize: 12.5,
        color: 'var(--color-codex-ink-soft)',
      }}
    >
      <Loader2
        className="h-3.5 w-3.5 animate-spin"
        aria-hidden="true"
        style={{ color: 'var(--color-codex-accent)' }}
      />
      <span>{message || '正在与模型建立连接...'}</span>
    </div>
  )
}

function ProgressCard({
  steps,
  title = 'Skill 执行清单',
  completedLabel = '已完成',
}: {
  steps: ChatProgressStep[]
  title?: string
  completedLabel?: string
}) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  if (!steps.length) return null

  const activeIndex = steps.findIndex(step => step.status === 'active')
  const doneCount = steps.filter(step => step.status === 'done').length
  const allLogs = steps
    .flatMap(step => step.logs.map(log => `[${step.label}] ${log}`))
    .join('\n')

  const toggleStep = (key: string) => {
    setExpandedKeys(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key])
  }

  const copyLogs = async () => {
    if (!allLogs) return
    try {
      await navigator.clipboard.writeText(allLogs)
    } catch (err) {
      console.error('Failed to copy skill progress logs:', err)
    }
  }

  const progressPct = Math.max(8, (doneCount / steps.length) * 100)

  return (
    <div
      className="mt-3 mb-3 w-full"
      style={{
        padding: '12px 14px',
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md, 6px)',
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--color-codex-ink)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {title}
          </p>
          <p
            className="font-mono"
            style={{
              margin: '4px 0 0',
              fontSize: 11.5,
              color: 'var(--color-codex-ink-mute)',
            }}
          >
            {doneCount}/{steps.length} {completedLabel}
          </p>
        </div>
        <div
          className="h-1.5 flex-1 overflow-hidden"
          style={{
            maxWidth: 160,
            background: 'var(--color-codex-bg-tint)',
            borderRadius: 'var(--codex-r-pill, 999px)',
          }}
        >
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: 'var(--color-codex-accent)',
              borderRadius: 'var(--codex-r-pill, 999px)',
            }}
          />
        </div>
        <button
          type="button"
          onClick={copyLogs}
          disabled={!allLogs}
          className="inline-flex items-center gap-1 disabled:opacity-40"
          style={{
            padding: '5px 9px',
            background: 'var(--color-codex-bg)',
            color: 'var(--color-codex-ink-soft)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            fontSize: 11.5,
            fontWeight: 500,
          }}
        >
          <Copy className="h-3 w-3" aria-hidden="true" />
          复制日志
        </button>
      </div>
      <div className="space-y-1.5">
        {steps.map((step, index) => {
          const isActive = step.status === 'active'
          const isDone = step.status === 'done'
          const expanded = expandedKeys.includes(step.key)
          const rowBg = isActive
            ? 'var(--color-codex-accent-bg)'
            : isDone
              ? 'var(--color-codex-bg-tint)'
              : 'transparent'
          const rowBorder = isActive
            ? '1px solid color-mix(in oklab, var(--color-codex-accent) 28%, transparent)'
            : '1px solid var(--color-codex-line-soft)'
          return (
            <div
              key={step.key}
              className="transition-colors"
              style={{
                padding: '8px 10px',
                background: rowBg,
                border: rowBorder,
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <button
                type="button"
                onClick={() => toggleStep(step.key)}
                className="flex w-full items-start gap-2.5 text-left"
              >
                <div
                  className="mt-0.5 flex flex-shrink-0 items-center justify-center"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 'var(--codex-r-pill, 999px)',
                    background: isDone
                      ? 'var(--color-codex-accent)'
                      : isActive
                        ? 'var(--color-codex-accent)'
                        : 'var(--color-codex-bg-elev)',
                    color: isDone || isActive
                      ? 'var(--color-codex-bg-elev)'
                      : 'var(--color-codex-ink-faint)',
                    border: isDone || isActive
                      ? 'none'
                      : '1px solid var(--color-codex-line)',
                  }}
                >
                  {isDone ? (
                    <Check className="h-3 w-3" />
                  ) : isActive ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span className="font-mono" style={{ fontSize: 10.5, fontWeight: 600 }}>{index + 1}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: isActive
                          ? 'var(--color-codex-accent-ink)'
                          : isDone
                            ? 'var(--color-codex-ink)'
                            : 'var(--color-codex-ink-soft)',
                      }}
                    >
                      {step.label}
                    </p>
                    {index === activeIndex && (
                      <span
                        style={{
                          padding: '1px 6px',
                          background: 'var(--color-codex-accent-bg)',
                          color: 'var(--color-codex-accent-ink)',
                          borderRadius: 'var(--codex-r-pill, 999px)',
                          fontSize: 10.5,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        进行中
                      </span>
                    )}
                    {step.logs.length > 0 && (
                      <span
                        className="font-mono"
                        style={{
                          padding: '1px 6px',
                          background: 'var(--color-codex-bg-tint)',
                          color: 'var(--color-codex-ink-mute)',
                          borderRadius: 'var(--codex-r-pill, 999px)',
                          fontSize: 10.5,
                        }}
                      >
                        {step.logs.length} 条
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      margin: '3px 0 0',
                      fontSize: 11.5,
                      color: 'var(--color-codex-ink-mute)',
                      lineHeight: 1.55,
                    }}
                  >
                    {step.description}
                  </p>
                </div>
                <ChevronDown
                  className={`mt-1 h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  style={{ color: 'var(--color-codex-ink-faint)' }}
                  aria-hidden="true"
                />
              </button>
              {expanded && (
                <div
                  className="ml-7 mt-2"
                  style={{
                    padding: '8px 10px',
                    background: 'var(--color-codex-bg-tint)',
                    border: '1px solid var(--color-codex-line-soft)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                >
                  {step.logs.length ? (
                    <div className="space-y-1.5">
                      {step.logs.map((log, logIndex) => (
                        <p
                          key={`${step.key}-${logIndex}`}
                          className="font-mono"
                          style={{
                            margin: 0,
                            fontSize: 11.5,
                            lineHeight: 1.6,
                            color: 'var(--color-codex-ink-soft)',
                          }}
                        >
                          {log}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 11.5,
                        color: 'var(--color-codex-ink-mute)',
                      }}
                    >
                      暂无明细日志，等待执行事件返回。
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StreamingAnswerPreview({ content, compact }: { content: string; compact: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!content.trim()) return null

  if (!compact) {
    return (
      <div className="md-root w-full">
        <MarkdownRenderer content={content} />
      </div>
    )
  }

  return (
    <div
      className="mt-3 w-full"
      style={{
        padding: '12px 14px',
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md, 6px)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--color-codex-ink)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            AI 正文
          </p>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 11.5,
              color: 'var(--color-codex-ink-mute)',
              lineHeight: 1.5,
            }}
          >
            执行期间默认隐藏正文，只展示 Skill 清单。已生成约{' '}
            <span className="font-mono">{content.length.toLocaleString()}</span> 字。
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1"
          style={{
            padding: '3px 8px',
            background: 'var(--color-codex-bg-tint)',
            color: 'var(--color-codex-ink-soft)',
            borderRadius: 'var(--codex-r-pill, 999px)',
            fontSize: 11,
          }}
        >
          {expanded ? '收起正文' : '查看正文'}
          <ChevronDown
            className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </span>
      </button>
      {expanded && (
        <div
          className="mt-3"
          style={{
            padding: '10px 12px',
            background: 'var(--color-codex-bg-tint)',
            border: '1px solid var(--color-codex-line-soft)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <div
            className="md-root"
            style={{ fontSize: 13.5, color: 'var(--color-codex-ink-soft)' }}
          >
            <MarkdownRenderer content={content} />
          </div>
        </div>
      )}
    </div>
  )
}

function ChatArtifactCard({ artifact }: { artifact: GeneratedArtifact }) {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      await downloadArtifact({ artifact })
    } catch (err) {
      console.error('Failed to download artifact:', err)
      alert('生成物下载失败，请稍后重试。')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="mt-3 w-full"
      style={{
        padding: '12px 14px',
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md, 6px)',
      }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex flex-shrink-0 items-center justify-center"
          style={{
            width: 32,
            height: 32,
            marginTop: 2,
            background: 'var(--color-codex-accent-bg)',
            color: 'var(--color-codex-accent)',
            borderRadius: 'var(--codex-r-sm, 3px)',
          }}
        >
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="truncate"
            style={{
              margin: 0,
              fontSize: 13.5,
              fontWeight: 500,
              color: 'var(--color-codex-ink)',
            }}
          >
            {artifact.name}
          </p>
          <div
            className="mt-1 flex flex-wrap items-center gap-2"
            style={{ fontSize: 11.5, color: 'var(--color-codex-ink-mute)' }}
          >
            <span
              className="font-mono"
              style={{
                padding: '1px 6px',
                background: 'var(--color-codex-bg-tint)',
                color: 'var(--color-codex-ink-soft)',
                borderRadius: 'var(--codex-r-sm, 3px)',
                letterSpacing: '0.04em',
              }}
            >
              {artifact.file_type.toUpperCase()}
            </span>
            {artifact.description ? <span className="truncate">{artifact.description}</span> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-1 disabled:opacity-50"
          style={{
            padding: '6px 10px',
            background: 'var(--color-codex-bg)',
            color: 'var(--color-codex-ink-soft)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-sm, 3px)',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          下载
        </button>
      </div>
    </div>
  )
}

function artifactFromToolResult(result: any): GeneratedArtifact | null {
  const source = result?.file_path || result?.path ? result : result?.output
  if (!source) return null
  const path = source.file_path || source.path
  const name = source.file_name || source.name
  const fileType = source.file_type
  if (!path || !name || !fileType) return null
  return {
    id: source.id,
    conversation_id: source.conversation_id,
    project_id: source.project_id,
    name,
    file_type: fileType,
    path,
    size_bytes: source.size_bytes,
    description: source.note || source.message || source.description || '',
    created_at: source.created_at,
  }
}

function mergeArtifacts(existing: GeneratedArtifact[], next: GeneratedArtifact | null) {
  if (!next) return existing
  const key = `${next.path}-${next.name}`
  if (existing.some(item => `${item.path}-${item.name}` === key)) return existing
  return [...existing, next]
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function shouldRunSkillForMessage(message: string, skill?: Skill | null) {
  if (!skill) return false
  const text = message.trim().toLowerCase()
  if (!text) return false
  const explicitSkill = /@skill|@ skills|使用\s*skill|调用\s*skill|运行\s*skill|执行\s*skill|用这个能力|用该能力/.test(text)
  return explicitSkill
}

const getPromptCards = (): PromptCard[] => [
  {
    icon: TrendingUp,
    label: '项目进展速报',
    prompt: '帮我总结一下当前所有进行中项目的最新进展和关键风险点',
  },
  {
    icon: Target,
    label: '里程碑检查',
    prompt: '检查一下近期有哪些里程碑即将到期或已经逾期，给出优先级建议',
  },
  {
    icon: FileText,
    label: '起草项目方案',
    prompt: '我需要为客户起草一份项目实施方案，帮我梳理结构和关键内容',
  },
  {
    icon: Mail,
    label: '撰写客户邮件',
    prompt: '帮我写一封向客户汇报本阶段项目进展的邮件，语气专业且简洁',
  },
  {
    icon: Users,
    label: '商务谈判准备',
    prompt: '我们即将和客户进行合同续签谈判，帮我梳理谈判要点和注意事项',
  },
  {
    icon: Zap,
    label: '风险识别分析',
    prompt: '基于项目现状，帮我识别当前最主要的交付风险，并给出应对策略',
  },
]

// ─── CopyButton (for individual messages) ──────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <button
      onClick={handle}
      title="Copy message"
      className="p-1.5 transition-colors"
      style={{
        background: 'var(--color-codex-bg-tint)',
        color: 'var(--color-codex-ink-mute)',
        borderRadius: 'var(--codex-r-sm, 3px)',
      }}
    >
      {copied ? (
        <Check
          className="h-3.5 w-3.5"
          style={{ color: 'var(--color-codex-accent)' }}
        />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export function Chat() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { resolvedTimeZone } = useAppTimeZone()
  const [searchParams] = useSearchParams()
  const conversationId = searchParams.get('conversation')
  const conversationIdFromQuery = conversationId ? parseInt(conversationId, 10) : null
  const skillId = searchParams.get('skill')
  const projectId = searchParams.get('project')
  const prefilledQ = searchParams.get('q')

  const [input, setInput] = useState(prefilledQ || '')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedProject, setSelectedProject] = useState<number | null>(projectId ? parseInt(projectId) : null)
  const [selectedSkill, setSelectedSkill] = useState<number | null>(skillId ? parseInt(skillId) : null)
  const [streamingContent, setStreamingContent] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [showSkillDropdown, setShowSkillDropdown] = useState(false)
  const [skillCategoryFilter, setSkillCategoryFilter] = useState<string>('all')
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [liveStatusText, setLiveStatusText] = useState<string | null>(null)
  const [progressSteps, setProgressSteps] = useState<ChatProgressStep[]>([])
  const [liveStageTimings, setLiveStageTimings] = useState<StageTimingEntry[]>([])
  const [skillRunActive, setSkillRunActive] = useState(false)
  const [streamArtifacts, setStreamArtifacts] = useState<GeneratedArtifact[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(min-width: 768px)').matches
  })
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [isLoadingConversations, setIsLoadingConversations] = useState(true)
  const [showSkillTemplateModal, setShowSkillTemplateModal] = useState(false)
  const [skillTemplateData, setSkillTemplateData] = useState<{
    skill: Skill
    variables: { name: string; value: string }[]
    preview: string
  } | null>(null)
  const processedSkillRef = useRef<number | null>(null)
  // Track streaming state for recovery after navigation
  const streamingConvIdRef = useRef<number | null>(null)
  // Debounce timer for streaming content updates — kept as ref so navigation can cancel it
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks which conversation the user is currently VIEWING (updated on every URL change)
  const currentConvIdRef = useRef<string | null>(conversationId)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const projectDropdownRef = useRef<HTMLDivElement>(null)
  const skillDropdownRef = useRef<HTMLDivElement>(null)
  const streamingContentRef = useRef('')
  const progressStepsRef = useRef<ChatProgressStep[]>([])
  const liveStageTimingsRef = useRef<StageTimingEntry[]>([])
  const isStreamingRef = useRef(false)
  const skillRunActiveRef = useRef(false)
  const skillArmedRef = useRef(!!skillId)
  const scrollHeightBeforeLoadRef = useRef<number>(0)
  const isNearBottomRef = useRef(true)
  const abortControllerRef = useRef<AbortController | null>(null)
  // remember whether the current conversation was brand-new (so we refresh title after first reply)
  const isNewConvRef = useRef(false)
  // Store first message for auto-renaming
  const firstMessageRef = useRef('')
  // track if we just loaded a conversation (to avoid smooth scroll on initial load)
  const justLoadedRef = useRef(false)
  // prevent loadConversation from firing when sendMessage triggers navigate to the new conv
  const skipNextConvLoadRef = useRef(false)

  useEffect(() => {
    progressStepsRef.current = progressSteps
  }, [progressSteps])

  useEffect(() => {
    liveStageTimingsRef.current = liveStageTimings
  }, [liveStageTimings])

  const activateSkillProgress = () => {
    skillRunActiveRef.current = true
    setSkillRunActive(true)
  }

  const resetSkillProgress = () => {
    skillRunActiveRef.current = false
    setSkillRunActive(false)
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { fetchInitialData() }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)')
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setSidebarOpen(event.matches)
    }
    mediaQuery.addEventListener('change', handleViewportChange)
    return () => mediaQuery.removeEventListener('change', handleViewportChange)
  }, [])

  // ── Recover streaming state on mount ───────────────────────────────────────
  useEffect(() => {
    // Check if we have a pending conversation to recover
    const pendingConvId = sessionStorage.getItem('pendingStreamingConvId')
    if (pendingConvId) {
      const convId = parseInt(pendingConvId)
      console.log('[Chat] Recovery - Found pending:', convId, 'current:', conversationId)
      
      // If we're not on this conversation, navigate to it
      // The loading useEffect will handle the refresh
      if (!conversationId || parseInt(conversationId) !== convId) {
        console.log('[Chat] Recovery - Navigating to:', convId)
        navigate(`/chat?conversation=${convId}`, { replace: true })
      }
      // If already on the conversation, loading useEffect will handle the refresh
    }
  }, [])

  // Once conversations list loads, backfill conversation info if not yet set
  useEffect(() => {
    if (conversationId && conversations.length > 0 && !conversation) {
      const found = conversations.find(c => c.id === parseInt(conversationId))
      if (found) setConversation(found)
    }
  }, [conversations])

  // Track if we've already loaded this conversation to prevent double-load in StrictMode
  const loadedConvIdRef = useRef<number | null>(null)
  
  useEffect(() => {
    if (conversationId) {
      if (skipNextConvLoadRef.current) {
        skipNextConvLoadRef.current = false
        return
      }
      const convId = parseInt(conversationId)
      
      // Check if we need to force refresh this conversation
      const pendingId = sessionStorage.getItem('pendingStreamingConvId')
      const needRefresh = pendingId && parseInt(pendingId) === convId
      
      // Prevent loading the same conversation twice (React StrictMode)
      // But always refresh if we're recovering from a navigation
      if (loadedConvIdRef.current === convId && messages.length > 0 && !needRefresh) {
        console.log('[Chat] Already loaded conversation:', convId)
        return
      }
      
      if (needRefresh) {
        console.log('[Chat] Force refreshing conversation:', convId)
        sessionStorage.removeItem('pendingStreamingConvId')
      } else {
        console.log('[Chat] Loading conversation:', convId)
      }
      
      loadedConvIdRef.current = convId
      loadConversation(convId)
    }
  }, [conversationId])

  // close dropdowns on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node))
        setShowProjectDropdown(false)
      if (skillDropdownRef.current && !skillDropdownRef.current.contains(e.target as Node))
        setShowSkillDropdown(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Track previous conversation ID to detect switches
  const prevConversationIdRef = useRef<string | null>(null)
  
  // Handle conversation switch
  useEffect(() => {
    const currentConvId = conversationId
    const prevConvId = prevConversationIdRef.current

    // Always keep currentConvIdRef in sync — used by flushUpdate / done-handler guards
    currentConvIdRef.current = currentConvId

    // If we switched from one conversation to another
    if (prevConvId && prevConvId !== currentConvId) {
      console.log('[Chat] Switched from', prevConvId, 'to', currentConvId)

      // Save the previous conversation ID to force refresh when we come back
      sessionStorage.setItem('pendingStreamingConvId', prevConvId)

      // Cancel pending debounce timer — prevents stale chunks from appearing in the new conversation
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current)
        updateTimerRef.current = null
      }

      // Clear streaming display for the incoming conversation
      setStreamingContent('')
      streamingContentRef.current = ''
      setIsThinking(false)
      setSending(false)
      // Allow sends in the target conversation even if a background stream is still running
      isSendingRef.current = false

      // NOTE: We intentionally do NOT abort the ongoing SSE connection.
      // The backend continues generating and will persist the response to DB.
      // When the user returns to the original conversation, loadConversation()
      // fetches the completed message. flushUpdate / setMessages are guarded
      // by currentConvIdRef so they won't touch the newly loaded conversation.

      isStreamingRef.current = false
      streamingConvIdRef.current = null
    }

    // Update ref
    prevConversationIdRef.current = currentConvId
  }, [conversationId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Abort any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // ── Data fetch ────────────────────────────────────────────────────────────
  const fetchInitialData = async () => {
    try {
      const [convsData, projectsData, skillsData] = await Promise.all([
        api.get<Conversation[]>('/chat/conversations?standalone=true'),
        api.get<Project[]>('/projects'),
        api.get<Skill[]>('/skills'),
      ])
      setConversations(convsData)
      setProjects(projectsData)
      setSkills(skillsData)
    } catch (err) {
      console.error('Failed to fetch initial data:', err)
    } finally {
      setIsLoadingConversations(false)
    }
  }

  const loadConversation = async (id: number, beforeId?: number) => {
    try {
      if (beforeId) {
        setLoadingMore(true)
        const container = messagesContainerRef.current
        if (container) scrollHeightBeforeLoadRef.current = container.scrollHeight
      } else {
        setLoading(true)
        setMessages([])
        setHasMore(false)
        setErrorMsg(null)
      }

      // Set conv info from cached list (list may not be loaded yet on first render)
      if (!beforeId) {
        const cached = conversations.find(c => c.id === id)
        if (cached) setConversation(cached)
      }

      const url = beforeId
        ? `/chat/conversations/${id}/messages?before_id=${beforeId}&limit=${PAGE_SIZE}`
        : `/chat/conversations/${id}/messages?limit=${PAGE_SIZE}`
      const data = await api.get<Message[]>(url)

      if (beforeId) {
        setMessages(prev => [...data, ...prev])
      } else {
        setMessages(data)
        // Mark as just loaded so we can jump to bottom without animation
        justLoadedRef.current = true
      }
      setHasMore(data.length === PAGE_SIZE)
    } catch (err) {
      console.error('Failed to load conversation:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const recoverConversationMessages = async (id: number, attempts = 8) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const data = await api.get<Message[]>(`/chat/conversations/${id}/messages?limit=${PAGE_SIZE}`)
        const recovered = data[data.length - 1]?.role === 'assistant'
        if (recovered && currentConvIdRef.current === String(id)) {
          setMessages(data)
          setHasMore(data.length === PAGE_SIZE)
          setErrorMsg(null)
          setStreamingContent('')
          setStreamArtifacts([])
          streamingContentRef.current = ''
          justLoadedRef.current = true
          return true
        }
      } catch (err) {
        console.error('Failed to recover conversation messages:', err)
      }
      await sleep(900 + attempt * 500)
    }
    return false
  }

  // ── Load more (pagination) ────────────────────────────────────────────────
  const loadMoreMessages = useCallback(async () => {
    if (!conversationId || loadingMore || !hasMore) return
    const oldestId = messages[0]?.id
    if (!oldestId) return
    await loadConversation(parseInt(conversationId), oldestId)
  }, [conversationId, loadingMore, hasMore, messages])

  // ── Scroll events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const distBottom = scrollHeight - scrollTop - clientHeight
      isNearBottomRef.current = distBottom < 120
      setShowScrollBtn(distBottom > 300)
      if (scrollTop < 100 && hasMore && !loadingMore && messages.length > 0) loadMoreMessages()
    }
    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [hasMore, loadingMore, messages.length, loadMoreMessages])

  // restore position after prepend
  useEffect(() => {
    if (loadingMore) return
    const container = messagesContainerRef.current
    if (container && scrollHeightBeforeLoadRef.current > 0) {
      container.scrollTop = container.scrollHeight - scrollHeightBeforeLoadRef.current
      scrollHeightBeforeLoadRef.current = 0
    }
  }, [loadingMore, messages.length])

  // auto-scroll on new messages
  useEffect(() => {
    if (!isStreamingRef.current && isNearBottomRef.current) {
      // If we just loaded a conversation, jump directly without animation
      const behavior: ScrollBehavior = justLoadedRef.current ? 'auto' : 'smooth'
      justLoadedRef.current = false
      // Use setTimeout to ensure DOM has updated before scrolling
      setTimeout(() => scrollToBottom(behavior), 0)
    }
  }, [messages])

  // auto-scroll while streaming
  useEffect(() => {
    if (streamingContent && isNearBottomRef.current) scrollToBottom('auto')
  }, [streamingContent])

  // ── Skill Template Modal ─────────────────────────────────────────────────
  // Auto-open template modal when skill with user_template is selected
  useEffect(() => {
    if (selectedSkill && !showSkillTemplateModal && processedSkillRef.current !== selectedSkill) {
      const skill = skills.find(s => s.id === selectedSkill)
      if (skill?.user_template) {
        // Extract variables from template
        // Format 1: [变量名] or {{变量名}}
        // Format 2: 变量名： or 变量名: (lines ending with colon)
        const template = skill.user_template
        const varRegex = /\[([^\]]+)\]|\{\{([^}]+)\}\}/g
        const matches: string[] = []
        let match
        
        // Check for [variable] or {{variable}} format (skip [ ] checkboxes)
        while ((match = varRegex.exec(template)) !== null) {
          const varName = (match[1] || match[2] || '').trim()
          if (varName && !matches.includes(varName)) {
            matches.push(varName)
          }
        }

        // If no named placeholders found, extract lines that END with a colon as editable fields
        if (matches.length === 0) {
          const lines = template.split('\n')
          lines.forEach((line) => {
            const trimmed = line.trim()
            // Only match lines where colon is at the very end (field label without a value)
            const colonMatch = trimmed.match(/^(?:[-•]\s*)?(.+?)：\s*$/) || trimmed.match(/^(?:[-•]\s*)?(.+?):\s*$/)
            if (colonMatch && colonMatch[1].trim()) {
              const varName = colonMatch[1].trim()
              if (!matches.includes(varName) && varName.length < 50) {
                matches.push(varName)
              }
            }
          })
        }
        
        setSkillTemplateData({
          skill,
          variables: matches.map(name => ({ name, value: '' })),
          preview: template
        })
        setShowSkillTemplateModal(true)
        // Mark this skill as processed to prevent reopening
        processedSkillRef.current = selectedSkill
      }
    }
  }, [selectedSkill, skills, showSkillTemplateModal])

  const handleApplyTemplate = async (filledTemplate: string) => {
    setShowSkillTemplateModal(false)
    setSkillTemplateData(null)
    skillArmedRef.current = true
    // Auto-send with the filled template content
    await sendMessage(filledTemplate)
  }

  const handleCancelTemplate = () => {
    setShowSkillTemplateModal(false)
    setSkillTemplateData(null)
    setSelectedSkill(null)
    skillArmedRef.current = false
    // Mark as processed so it doesn't reopen
    if (selectedSkill) {
      processedSkillRef.current = selectedSkill
    }
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior })
    }
  }

  // ── Conversation actions ──────────────────────────────────────────────────
  const createNewConversation = () => {
    // Don't create conversation upfront — create lazily on first message send.
    // This avoids the flash: empty-state → loading → empty-state.
    setConversation(null)
    setMessages([])
    setStreamingContent('')
    setStreamArtifacts([])
    setSending(false)
    setLoading(false)
    setHasMore(false)
    setErrorMsg(null)
    setProgressSteps([])
    resetSkillProgress()
    setSelectedSkill(null)
    skillArmedRef.current = false
    processedSkillRef.current = null
    navigate('/chat', { replace: true })
  }

  const deleteConversation = (e: React.MouseEvent, convId: number) => {
    e.preventDefault(); e.stopPropagation()
    setDeleteTargetId(convId)
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!deleteTargetId) return
    const targetId = deleteTargetId
    setShowDeleteDialog(false)
    setDeleteTargetId(null)
    // Start exit animation
    setDeletingId(targetId)
    // Wait for animation (300ms), then remove from list and call API
    setTimeout(async () => {
      setDeletingId(null)
      const remaining = conversations.filter(c => c.id !== targetId)
      setConversations(remaining)
      if (conversationId === String(targetId)) {
        const next = remaining[0]
        navigate(next ? `/chat?conversation=${next.id}` : '/chat', { replace: true })
      }
      try {
        await api.delete(`/chat/conversations/${targetId}`)
      } catch (err) {
        console.error('Failed to delete conversation:', err)
      }
    }, 280)
  }

  // ── Input helpers ─────────────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const nativeEvent = e.nativeEvent as KeyboardEvent
      if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) return
      e.preventDefault()
      handleSend()
    }
  }

  const fillSuggestion = (text: string) => {
    setInput(text)
    textareaRef.current?.focus()
  }

  // ── Stop generation ───────────────────────────────────────────────────────
  const handleStop = () => {
    abortControllerRef.current?.abort()
  }

  // ── Send message wrapper ──────────────────────────────────────────────────
  const handleSend = () => sendMessage(input)

  // Prevent duplicate sends
  const isSendingRef = useRef(false)
  
  // ── Send message (internal implementation) ─────────────────────────────────
  const sendMessage = async (msgText: string) => {
    if (!msgText.trim() || sending || isSendingRef.current) return
    const forceSkillForThisMessage = !!selectedSkill && skillArmedRef.current
    const skillForThisMessage = (forceSkillForThisMessage || shouldRunSkillForMessage(msgText, selectedSkillData)) ? selectedSkill : null
    
    isSendingRef.current = true
    setSending(true)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setErrorMsg(null)
    streamingContentRef.current = ''
    setStreamingContent('')
    setStreamArtifacts([])
    setLiveStageTimings([])
    liveStageTimingsRef.current = []
    setLiveStatusText(skillForThisMessage ? '已收到，正在准备 Skill 上下文…' : '已收到，正在连接模型…')
    setIsThinking(true)
    isStreamingRef.current = true
    skillRunActiveRef.current = !!skillForThisMessage
    setSkillRunActive(!!skillForThisMessage)
    setProgressSteps(
      skillForThisMessage
        ? advanceProgressSteps(createProgressSteps(), 0, '正在提交请求并准备上下文...', '开始提交请求，准备会话上下文。')
        : advanceProgressSteps(createChatLoadingSteps(), 0, '正在提交请求并建立本轮对话...', '消息已发出，正在连接模型服务。'),
    )

    const controller = new AbortController()
    abortControllerRef.current = controller
    
    // Will be set when conversation is created/confirmed
    let currentConvIdForCleanup: number | null = null
    let completedNormally = false
    let streamErrorMessage: string | null = null

    try {
      let currentConvId = conversation?.id
      if (!currentConvId) {
        // Auto-generate title from first message
        const cleanContent = msgText.replace(/[#*`[\]]/g, '').trim()
        const title = cleanContent
          ? cleanContent.slice(0, 15) + (cleanContent.length > 15 ? '...' : '')
          : t('chat.newChat', 'New Chat')
        
        const newConv = await api.post<Conversation>('/chat/conversations', {
          project_id: selectedProject, skill_id: skillForThisMessage, title,
        })
        currentConvId = newConv.id
        currentConvIdForCleanup = newConv.id
        streamingConvIdRef.current = newConv.id
        // Save to sessionStorage for recovery if user navigates away
        sessionStorage.setItem('pendingStreamingConvId', String(newConv.id))
        setConversation(newConv)
        setConversations(prev => [newConv, ...prev])
        skipNextConvLoadRef.current = true
        navigate(`/chat?conversation=${newConv.id}`, { replace: true })
        isNewConvRef.current = true
        firstMessageRef.current = msgText
      } else {
        currentConvIdForCleanup = currentConvId
        streamingConvIdRef.current = currentConvId
        sessionStorage.setItem('pendingStreamingConvId', String(currentConvId))
      }

      const userMsg: Message = {
        id: Date.now(),
        conversation_id: currentConvId,
        role: 'user',
        content: msgText,
        metadata_json: '{}',
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, userMsg])
      // Scroll after DOM update
      setTimeout(() => scrollToBottom(), 0)

      const token = localStorage.getItem('authToken')
      const response = await fetch(`${getApiBaseUrl()}/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token || '' },
        body: JSON.stringify({
          conversation_id: currentConvId,
          content: msgText,
          project_id: selectedProject,
          skill_id: skillForThisMessage,
          force_skill: forceSkillForThisMessage,
          rag_doc_ids: [],
          file_ids: [],
        }),
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(`Server error ${response.status}`)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      let assistantContent = ''
      let pendingContent = ''
      updateTimerRef.current = null
      let streamDone = false
      let streamBuffer = ''
      let collectedArtifacts: GeneratedArtifact[] = []
      const decoder = new TextDecoder()

      const flushUpdate = () => {
        // Guard: only update UI if the user is still viewing THIS conversation
        if (currentConvIdRef.current !== String(currentConvId)) return
        if (pendingContent !== assistantContent) {
          pendingContent = assistantContent
          setStreamingContent(assistantContent)
          setIsThinking(false)
        }
      }

      const handleStreamEvent = async (data: any) => {
        if ((data.type === 'text' || data.type === 'chunk') && data.content) {
          assistantContent += data.content
          streamingContentRef.current = assistantContent
          if (!updateTimerRef.current) {
            updateTimerRef.current = setTimeout(() => { flushUpdate(); updateTimerRef.current = null }, 80)
          }
        } else if (data.type === 'status') {
          if (data.message) {
            if (SKILL_PROGRESS_STAGES.has(String(data.stage))) {
              activateSkillProgress()
            }
            if (skillRunActiveRef.current) {
              setToolStatus(data.message)
              const stepIndex = STAGE_STEP_INDEX[data.stage as string]
              if (stepIndex !== undefined) {
                setProgressSteps(prev => advanceProgressSteps(prev.length ? prev : createProgressSteps(), stepIndex, data.message, data.message))
              }
            } else {
              const stepIndex = CHAT_STAGE_STEP_INDEX[data.stage as string]
              if (stepIndex !== undefined) {
                setProgressSteps(prev => advanceProgressSteps(prev.length ? prev : createChatLoadingSteps(), stepIndex, data.message, data.message))
              }
              setLiveStatusText(data.message)
            }
            setIsThinking(true)
          }
        } else if (data.type === 'timing' && data.key && typeof data.duration_ms === 'number') {
          setLiveStageTimings(prev => mergeStageTimingEntries(prev, {
            key: String(data.key),
            label: stageTimingLabel(String(data.key)),
            durationMs: Number(data.duration_ms),
          }))
        } else if (data.type === 'tool_executing') {
          activateSkillProgress()
          setToolStatus(data.tool_name ? `${t('chat.runningTool')}: ${data.tool_name}…` : t('chat.runningTool'))
          const toolMessage = data.message || `正在执行 ${data.tool_name || '工具'}...`
          setProgressSteps(prev => advanceProgressSteps(prev.length ? prev : createProgressSteps(), 2, toolMessage, toolMessage))
        } else if (data.type === 'tool_result') {
          activateSkillProgress()
          setToolStatus(null)
          const result = data.result || {}
          const artifact = artifactFromToolResult(result)
          if (artifact) {
            collectedArtifacts = mergeArtifacts(collectedArtifacts, artifact)
            setStreamArtifacts(prev => mergeArtifacts(prev, artifact))
          }
          const resultMessage = result.file_name
            ? `工具完成，已生成 ${result.file_name}`
            : result.error
              ? `工具执行失败：${result.error}`
              : '工具已完成，正在整理输出...'
          setProgressSteps(prev => advanceProgressSteps(prev.length ? prev : createProgressSteps(), 3, '工具已完成，正在整理输出...', resultMessage))
        } else if (data.type === 'done') {
          streamDone = true
          completedNormally = true
          if (updateTimerRef.current) { clearTimeout(updateTimerRef.current); updateTimerRef.current = null }
          flushUpdate()
          // Message is now persisted in DB (backend saves before sending 'done').
          // Release the SSE connection — no need to keep it open any longer.
          // Safe to abort here even if the user navigated away, because the
          // message is already saved and loadConversation() will fetch it on return.
          if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
          }
          // Clear pending streaming state as it's complete
          sessionStorage.removeItem('pendingStreamingConvId')
          streamingConvIdRef.current = null
          await new Promise(r => setTimeout(r, 50))
          const finalArtifacts = Array.isArray(data.artifacts) && data.artifacts.length
            ? data.artifacts
            : collectedArtifacts
          const finalToolCalls = data.tool_calls || []
          const hasSkillProgress = (
            skillRunActiveRef.current
            || !!skillForThisMessage
            || (Array.isArray(data.skill_progress) && data.skill_progress.length > 0)
          )
          const completedProgressSteps = hasSkillProgress ? completeProgressSteps(progressStepsRef.current) : []
          const assistantMsg: Message = {
            id: Date.now() + 1,
            conversation_id: currentConvId!,
            role: 'assistant',
            content: assistantContent,
            metadata_json: JSON.stringify({
              references: data.references || [],
              tool_calls: finalToolCalls,
              artifacts: finalArtifacts,
              skill_id: skillForThisMessage || undefined,
              skill_progress: hasSkillProgress ? (data.skill_progress || completedProgressSteps) : undefined,
              stage_timings: data.stage_timings || Object.fromEntries(liveStageTimingsRef.current.map(item => [item.key, item.durationMs])),
            }),
            created_at: new Date().toISOString(),
          }
          // Only append to message list if the user is still viewing this conversation.
          // If they navigated away, the backend has persisted the message;
          // loadConversation() will fetch it when they return.
          if (currentConvIdRef.current === String(currentConvId)) {
            setMessages(prev => [...prev, assistantMsg])
          }
          setStreamingContent('')
          setStreamArtifacts([])
          streamingContentRef.current = ''
          isStreamingRef.current = false
          resetSkillProgress()
          setIsThinking(false)
          setToolStatus(null)
          setLiveStatusText(null)
          setProgressSteps(hasSkillProgress ? completedProgressSteps : completeChatLoadingSteps(progressStepsRef.current))
          if (skillForThisMessage) {
            setSelectedSkill(null)
            skillArmedRef.current = false
            processedSkillRef.current = null
          }
          if (!hasSkillProgress) {
            setTimeout(() => setProgressSteps([]), 1200)
          }

          // Refresh conversation list to pick up the auto-generated title.
          // Delay to allow backend background title generation to complete first.
          if (isNewConvRef.current) {
            isNewConvRef.current = false
            const targetConvId = currentConvId
            const targetTitle = firstMessageRef.current
            firstMessageRef.current = ''

            setTimeout(async () => {
              try {
                // First, try to rename the conversation with the first message
                if (targetConvId && targetTitle) {
                  const cleanTitle = targetTitle
                    .replace(/[#*`[\]]/g, '')
                    .trim()
                    .slice(0, 15) + (targetTitle.replace(/[#*`[\]]/g, '').trim().length > 15 ? '...' : '')

                  await api.patch(`/chat/conversations/${targetConvId}`, { title: cleanTitle })

                  // Update current conversation
                  setConversation(prev => prev ? { ...prev, title: cleanTitle } : prev)
                }

                // Then refresh the full list
                const data = await api.get<Conversation[]>('/chat/conversations?standalone=true')
                setConversations(data)
              } catch (err) {
                console.error('Failed to rename conversation:', err)
              }
            }, 500)
          }
        } else if (data.type === 'error') {
          setToolStatus(null)
          if (updateTimerRef.current) { clearTimeout(updateTimerRef.current); updateTimerRef.current = null }
          streamErrorMessage = data.message || data.error || 'AI 生成过程中断，请稍后重试。'
          setErrorMsg(streamErrorMessage)
          setProgressSteps(prev => prev.map(step => step.status === 'active' ? {
            ...step,
            description: streamErrorMessage || 'AI 生成过程中断，请稍后重试。',
            logs: [...step.logs, formatProgressLog(streamErrorMessage || 'AI 生成过程中断，请稍后重试。')].slice(-20),
          } : step))
          isStreamingRef.current = false
          setIsThinking(false)
        }
      }

      const processStreamBuffer = async (force = false) => {
        const events = streamBuffer.split('\n\n')
        streamBuffer = force ? '' : (events.pop() || '')
        const readyEvents = force ? events.filter(Boolean) : events

        for (const event of readyEvents) {
          const line = event
            .split('\n')
            .map((item) => item.trim())
            .find((item) => item.startsWith('data: '))
          if (!line) continue
          try {
            await handleStreamEvent(JSON.parse(line.replace(/^data:\s*/, '')))
          } catch (error) {
            console.error('Failed to parse stream event:', error)
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        streamBuffer += decoder.decode(value, { stream: true })
        await processStreamBuffer()
      }

      streamBuffer += decoder.decode()
      await processStreamBuffer(true)

      // Stream ended but no 'done' event (e.g. aborted)
      if (!streamDone && assistantContent) {
        if (skillRunActiveRef.current && currentConvId) {
          setToolStatus('流式连接已结束，正在同步后台保存的 Skill 结果...')
          const recovered = await recoverConversationMessages(currentConvId, 30)
          if (recovered) {
            setToolStatus(null)
            setProgressSteps(prev => completeProgressSteps(prev))
            resetSkillProgress()
            sessionStorage.removeItem('pendingStreamingConvId')
            streamingConvIdRef.current = null
            completedNormally = true
            return
          }
        }
        if (updateTimerRef.current) { clearTimeout(updateTimerRef.current); updateTimerRef.current = null }
        flushUpdate()
        await new Promise(r => setTimeout(r, 50))
        const partialMsg: Message = {
          id: Date.now() + 1,
          conversation_id: currentConvId!,
          role: 'assistant',
          content: assistantContent + ' _(generation stopped)_',
          metadata_json: '{}',
          created_at: new Date().toISOString(),
        }
        setMessages(prev => [...prev, partialMsg])
        setStreamingContent('')
        streamingContentRef.current = ''
      }

      if (updateTimerRef.current) { clearTimeout(updateTimerRef.current); updateTimerRef.current = null }
      isStreamingRef.current = false
      setIsThinking(false)
    } catch (err: any) {
      if (err?.name === 'AbortError' || completedNormally) {
        // normal stop — already handled above
        // Keep sessionStorage in case user wants to resume
      } else {
        console.error('Send failed:', err)
        if (skillRunActiveRef.current) {
          setToolStatus('流式连接已断开，正在从后台同步已保存结果...')
        }
        const recovered = currentConvIdForCleanup
          ? await recoverConversationMessages(currentConvIdForCleanup, skillRunActiveRef.current ? 30 : 8)
          : false
        if (recovered) {
          setToolStatus(null)
          setLiveStatusText(null)
          setProgressSteps(prev => skillRunActiveRef.current ? completeProgressSteps(prev) : completeChatLoadingSteps(prev))
          if (skillForThisMessage) {
            setSelectedSkill(null)
            skillArmedRef.current = false
            processedSkillRef.current = null
          }
          resetSkillProgress()
          sessionStorage.removeItem('pendingStreamingConvId')
          streamingConvIdRef.current = null
          return
        }
        const partialContent = streamingContentRef.current.trim()
        if (partialContent && currentConvIdForCleanup && currentConvIdRef.current === String(currentConvIdForCleanup)) {
          const partialMsg: Message = {
            id: Date.now() + 1,
            conversation_id: currentConvIdForCleanup,
            role: 'assistant',
            content: `${partialContent}\n\n（连接中断，以上为已收到的部分内容。）`,
            metadata_json: '{}',
            created_at: new Date().toISOString(),
          }
          setMessages(prev => [...prev, partialMsg])
        }
        const rawMessage = typeof err?.message === 'string' ? err.message : ''
        const isGenericNetworkError = !rawMessage || /failed to fetch|network|body stream|load failed/i.test(rawMessage)
        const friendlyMessage = streamErrorMessage
          || (isGenericNetworkError
            ? '连接中断了：Skill 生成内容较长或工具执行耗时较久时，流式连接可能提前断开。我们已尝试从后台同步已保存的回复。'
            : rawMessage)
        setToolStatus(null)
        setLiveStatusText(null)
        setErrorMsg(friendlyMessage)
        setProgressSteps(prev => prev.map(step => step.status === 'active' ? {
          ...step,
          description: '执行中断，请查看错误提示或稍后重试。',
          logs: [...step.logs, formatProgressLog(friendlyMessage)].slice(-20),
        } : step))
        // Clear pending state on actual errors
        sessionStorage.removeItem('pendingStreamingConvId')
        streamingConvIdRef.current = null
      }
      setIsThinking(false)
      isStreamingRef.current = false
      resetSkillProgress()
      setLiveStatusText(null)
      // Clear partial streaming content
      if (streamingContentRef.current) {
        setStreamingContent('')
        streamingContentRef.current = ''
      }
      if (!completedNormally) {
        setTimeout(() => setProgressSteps([]), 8000)
      }
    } finally {
      setSending(false)
      isSendingRef.current = false
      abortControllerRef.current = null
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const selectedProjectData = projects.find(p => p.id === selectedProject)
  const selectedSkillData = skills.find(s => s.id === selectedSkill)
  const activeConversationId =
    conversation?.id ??
    (conversationIdFromQuery !== null && !Number.isNaN(conversationIdFromQuery) ? conversationIdFromQuery : null)
  const activeConversationTitle = conversation?.title || t('chat.newConversation')
  const shouldBootstrapConversation = isLoadingConversations
  const shouldShowLiveProgress = skillRunActive || progressSteps.length > 0
  const liveProgressSteps = shouldShowLiveProgress
    ? (progressSteps.length ? progressSteps : (skillRunActive ? createProgressSteps() : createChatLoadingSteps()))
    : []
  const liveProgressTitle = skillRunActive ? 'Skill 执行清单' : 'Aria 正在处理'

  const filteredConversations = sidebarSearch.trim()
    ? conversations.filter(c =>
        (c.title || '').toLowerCase().includes(sidebarSearch.toLowerCase())
      )
    : conversations
  const conversationGroups = groupConversations(filteredConversations, t, resolvedTimeZone)

  // ── Render ────────────────────────────────────────────────────────────────
  // ``theme-codex`` wraps the page so the sidebar + chrome (refactored in
  // this PR) pick up the Codex tokens. The inner message stream + composer
  // still render in their legacy palette — PR-B / PR-C / PR-D refactor those.
  return (
    <div
      className="theme-codex relative h-full overflow-hidden md:flex"
      style={{ background: 'var(--color-codex-bg)' }}
    >
      <PageTitle title={t('chat.title')} />

      {/* ── Sidebar ── */}
      {sidebarOpen && (
        <>
        <button
          type="button"
          aria-label={t('chat.collapseSidebar')}
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/20 backdrop-blur-[1px] md:hidden"
        />
        <div
          className="group/sidebar fixed inset-y-0 left-0 z-40 flex w-[86vw] max-w-80 flex-col md:relative md:z-auto md:w-[260px] md:max-w-none md:flex-shrink-0"
          style={{
            background: 'var(--color-codex-bg-elev)',
            borderRight: '1px solid var(--color-codex-line)',
          }}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="group/collapse pointer-events-auto absolute -right-3 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center transition-all duration-150 md:pointer-events-none md:opacity-0 md:group-hover/sidebar:pointer-events-auto md:group-hover/sidebar:opacity-100"
            style={{
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 999,
              color: 'var(--color-codex-ink-mute)',
            }}
            title={t('chat.collapseSidebar')}
            aria-label={t('chat.collapseSidebar')}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          {/* Sidebar header — dark-ink new-chat CTA + Codex search input. */}
          <div
            className="flex flex-col gap-2"
            style={{
              padding: '14px 14px 12px',
            }}
          >
            <button
              onClick={createNewConversation}
              className="inline-flex w-full items-center gap-2 transition"
              style={{
                padding: '9px 12px',
                background: 'var(--color-codex-ink)',
                color: 'var(--color-codex-bg-elev)',
                borderRadius: 'var(--codex-r-sm, 3px)',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('chat.newChat')}
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 10.5,
                  opacity: 0.55,
                }}
                className="font-mono"
              >
                ⌘N
              </span>
            </button>
            {/* Search */}
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                aria-hidden="true"
                style={{ color: 'var(--color-codex-ink-faint)' }}
              />
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder={t('chat.searchConversations')}
                className="codex-input w-full transition-colors"
                style={{
                  padding: '7px 28px 7px 32px',
                  fontSize: 12,
                  background: 'var(--color-codex-bg)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                  color: 'var(--color-codex-ink)',
                }}
              />
              {sidebarSearch && (
                <button
                  type="button"
                  onClick={() => setSidebarSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-codex-ink-faint)' }}
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-auto" style={{ padding: '4px 10px 12px' }}>
            {isLoadingConversations ? (
              <div className="pt-1">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 animate-pulse"
                    style={{ padding: '8px 10px' }}
                  >
                    <div
                      className="flex-1 space-y-1.5"
                      style={{ minWidth: 0 }}
                    >
                      <div
                        className="h-3"
                        style={{
                          width: `${55 + (i % 3) * 18}%`,
                          background: 'var(--color-codex-bg-tint)',
                          borderRadius: 2,
                        }}
                      />
                      <div
                        className="h-2 w-12"
                        style={{
                          background: 'var(--color-codex-bg-tint)',
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredConversations.length === 0 && sidebarSearch ? (
              <p
                className="text-center"
                style={{
                  padding: '32px 0',
                  fontSize: 11.5,
                  color: 'var(--color-codex-ink-faint)',
                }}
              >
                {t('chat.noResults')}
              </p>
            ) : (
              <div className="pt-1">
                {/* "New conversation" highlight when no conversation is
                    selected and there's no active search. Renders with the
                    same active-row treatment so the user sees their next
                    action sitting at the top. */}
                {!conversationId && !sidebarSearch && (
                  <div
                    className="relative codex-row-hov"
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                      background: 'var(--color-codex-bg-tint)',
                      marginBottom: 4,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 8,
                        bottom: 8,
                        width: 2,
                        background: 'var(--color-codex-accent)',
                        borderRadius: 99,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--color-codex-ink)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('chat.newConversation')}
                    </div>
                  </div>
                )}

                {conversationGroups.map((group) => (
                  <div key={group.label}>
                    <div
                      style={{
                        padding: '12px 10px 4px',
                        fontSize: 11,
                        color: 'var(--color-codex-ink-faint)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {group.label}
                    </div>
                    {group.items.map((conv) => {
                      const isActive = conversationId === String(conv.id);
                      const isDeleting = deletingId === conv.id;
                      return (
                        <Link
                          key={conv.id}
                          to={`/chat?conversation=${conv.id}`}
                          onClick={() => {
                            if (window.innerWidth < 768) setSidebarOpen(false);
                          }}
                          className={`group relative codex-row-hov block transition-all duration-200 ${
                            isDeleting
                              ? 'opacity-0 scale-95 max-h-0 py-0 mb-0 pointer-events-none overflow-hidden'
                              : ''
                          }`}
                          style={
                            isDeleting
                              ? undefined
                              : {
                                  padding: '8px 10px',
                                  marginBottom: 2,
                                  borderRadius: 'var(--codex-r-sm, 3px)',
                                  background: isActive
                                    ? 'var(--color-codex-bg-tint)'
                                    : 'transparent',
                                }
                          }
                        >
                          {isActive && (
                            <span
                              aria-hidden="true"
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 8,
                                bottom: 8,
                                width: 2,
                                background: 'var(--color-codex-accent)',
                                borderRadius: 99,
                              }}
                            />
                          )}
                          <div
                            className="flex items-start gap-2"
                            style={{ minWidth: 0 }}
                          >
                            <div className="flex-1" style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  color: isActive
                                    ? 'var(--color-codex-ink)'
                                    : 'var(--color-codex-ink-soft)',
                                  fontWeight: isActive ? 500 : 400,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {conv.title || t('chat.newConversation')}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--color-codex-ink-mute)',
                                  marginTop: 2,
                                }}
                              >
                                {formatTime(conv.updated_at)}
                              </div>
                            </div>
                            <button
                              onClick={(e) => deleteConversation(e, conv.id)}
                              className="opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity"
                              style={{
                                padding: 4,
                                color: 'var(--color-codex-ink-faint)',
                                borderRadius: 'var(--codex-r-sm, 3px)',
                              }}
                              aria-label={t('chat.delete') || 'Delete'}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {/* ── Main area ── */}
      <div className="flex h-full min-w-0 flex-1 flex-col">

        {/* Header — title + project/skill meta + actions. */}
        <div
          className="flex-shrink-0"
          style={{
            background: 'var(--color-codex-bg-elev)',
            borderBottom: '1px solid var(--color-codex-line)',
            padding: '14px 24px',
          }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className={`transition ${sidebarOpen ? 'md:hidden' : ''}`}
              style={{
                padding: 6,
                color: 'var(--color-codex-ink-mute)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
              title={t('chat.openSidebar')}
              aria-label={t('chat.openSidebar')}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
            <div className="flex-1 min-w-0">
              <h1
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 500,
                  color: 'var(--color-codex-ink)',
                  letterSpacing: '-0.01em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {conversation?.title || t('chat.newConversation')}
              </h1>
              <div
                className="mt-1 hidden items-center gap-1.5 sm:flex"
                style={{
                  fontSize: 12,
                  color: 'var(--color-codex-ink-mute)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedProjectData ? (
                  <>
                    <span>{t('chat.project')}</span>
                    <span style={{ color: 'var(--color-codex-ink-faint)' }}>·</span>
                    <span style={{ color: 'var(--color-codex-ink-soft)' }}>
                      {selectedProjectData.name}
                    </span>
                  </>
                ) : selectedSkillData ? (
                  <>
                    <span>{t('chat.skill')}</span>
                    <span style={{ color: 'var(--color-codex-ink-faint)' }}>·</span>
                    <span style={{ color: 'var(--color-codex-ink-soft)' }}>
                      {selectedSkillData.name}
                    </span>
                  </>
                ) : (
                  <span>Aria workspace chat</span>
                )}
              </div>
            </div>

            {/* Export dropdown */}
            {activeConversationId && (
              <ExportDropdown
                conversationId={activeConversationId}
                conversationTitle={activeConversationTitle}
              />
            )}
          </div>
        </div>

        {/* Top progress bar — only during the initial app data load
            (conversations + projects + skills). Once those resolve we
            drop the bar so it doesn't compete with the message stream. */}
        {isLoadingConversations && <CxTopProgress />}

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-auto py-4 relative sm:py-8"
          style={{ background: 'var(--color-codex-bg)' }}
        >
          <div className={`mx-auto px-3 sm:px-6 ${sidebarOpen ? 'max-w-4xl' : 'max-w-5xl'}`}>

            {/* Load more */}
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-400 mb-4">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-xs">加载中…</span>
              </div>
            )}
            {!loadingMore && hasMore && messages.length > 0 && (
              <button onClick={loadMoreMessages}
                className="w-full flex items-center justify-center gap-2 py-2 mb-6 text-xs text-gray-400 hover:text-primary transition-colors"
              >
                <ChevronUp className="w-3.5 h-3.5" />
                {t('chat.loadEarlierMessages')}
              </button>
            )}

            {/* Loading skeleton — alternating user / AI bubble shapes
                so the layout feels like a conversation thread before
                the real messages arrive. */}
            {(loading && conversationId && messages.length === 0) || shouldBootstrapConversation ? (
              <div
                aria-busy="true"
                aria-label={t('chat.loading')}
                className="space-y-7 py-6"
              >
                {[
                  { side: 'right', widths: ['68%', '42%'] },
                  { side: 'left', widths: ['85%', '95%', '60%'] },
                  { side: 'right', widths: ['54%'] },
                  { side: 'left', widths: ['90%', '78%', '45%'] },
                  { side: 'right', widths: ['72%', '55%'] },
                ].map((row, i) => {
                  const isRight = row.side === 'right'
                  return (
                    <div
                      key={i}
                      className="flex"
                      style={{ justifyContent: isRight ? 'flex-end' : 'flex-start' }}
                    >
                      <div
                        style={{
                          maxWidth: '78%',
                          padding: isRight ? '10px 14px' : '6px 0',
                          background: isRight
                            ? 'var(--color-codex-bg-tint)'
                            : 'transparent',
                          border: isRight
                            ? '1px solid var(--color-codex-line-soft)'
                            : 'none',
                          borderRadius: 'var(--codex-r-md, 6px)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          minWidth: 120,
                        }}
                      >
                        {row.widths.map((w, j) => (
                          <CxSkeleton key={j} w={w} h={13} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

            ) : messages.length === 0 && !streamingContent && !isThinking && progressSteps.length === 0 ? (
              /* ── Empty state ──
                 Centered hero + 2-column prompt grid per the design HTML
                 the user handed over (`_ _ _.html`, the "对话页空载 ·
                 启发" mock). All cards now share the same Codex chrome:
                 bg-elev shell with a hairline border, a bg-tint icon
                 tile that swaps to accent-bg on hover, and a quiet
                 arrow that only fades in when you mouse the row. */
              <div className="animate-fade-in flex flex-col items-center justify-center py-12 sm:py-16">
                <div
                  aria-hidden="true"
                  className="mb-5 inline-flex items-center justify-center"
                  style={{
                    width: 48,
                    height: 48,
                    background: 'var(--color-codex-accent)',
                    color: 'var(--color-codex-bg-elev)',
                    borderRadius: 'var(--codex-r-md, 10px)',
                  }}
                >
                  <Sparkles className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 24,
                    fontWeight: 500,
                    color: 'var(--color-codex-ink)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  你好，我是 Aria
                </h2>
                <p
                  className="text-center"
                  style={{
                    maxWidth: 460,
                    margin: '10px 0 36px',
                    fontSize: 14,
                    color: 'var(--color-codex-ink-mute)',
                    lineHeight: 1.6,
                  }}
                >
                  你的咨询项目 AI 助手 —— 帮你推进项目、准备材料、分析风险。从下面挑一个开始，或直接输入你的问题。
                </p>
                <div
                  className="grid w-full sm:grid-cols-2"
                  style={{ maxWidth: 720, gap: 10 }}
                >
                  {getPromptCards().map((card) => {
                    const Icon = card.icon
                    return (
                      <button
                        key={card.label}
                        onClick={() => fillSuggestion(card.prompt)}
                        className="cx-prompt-card cx-no-hover group flex items-start text-left transition-colors"
                        style={{
                          gap: 12,
                          padding: '14px 16px',
                          background: 'var(--color-codex-bg-elev)',
                          border: '1px solid var(--color-codex-line)',
                          borderRadius: 'var(--codex-r-md, 6px)',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="cx-prompt-icon inline-flex flex-shrink-0 items-center justify-center"
                          style={{
                            width: 28,
                            height: 28,
                            background: 'var(--color-codex-bg-tint)',
                            color: 'var(--color-codex-accent)',
                            borderRadius: 'var(--codex-r-sm, 3px)',
                          }}
                        >
                          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className="block"
                            style={{
                              fontSize: 13.5,
                              fontWeight: 500,
                              color: 'var(--color-codex-ink)',
                            }}
                          >
                            {card.label}
                          </span>
                          <span
                            className="mt-0.5 block line-clamp-2"
                            style={{
                              fontSize: 12,
                              lineHeight: 1.5,
                              color: 'var(--color-codex-ink-mute)',
                            }}
                          >
                            {card.prompt}
                          </span>
                        </span>
                        <ArrowRight
                          aria-hidden="true"
                          className="cx-prompt-arrow mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                          style={{
                            color: 'var(--color-codex-ink-faint)',
                            opacity: 0,
                            transition: 'opacity 0.15s',
                          }}
                          strokeWidth={1.5}
                        />
                      </button>
                    )
                  })}
                </div>
              </div>

            ) : (
              <div className="space-y-5 sm:space-y-7">
                {messages.map(msg => (
                  <MessageRow key={msg.id} message={msg} />
                ))}

                {/* Streaming / thinking — same Codex avatar treatment as
                    the assistant row in MessageRow, with the ``codex-cursor``
                    helper class appended to the streaming text. */}
                {(isThinking || streamingContent) && (
                  <div className="flex w-full animate-fade-in items-start gap-3.5">
                    <span
                      className="inline-flex flex-shrink-0 items-center justify-center"
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 999,
                        marginTop: 4,
                        background: 'var(--color-codex-accent-bg)',
                        color: 'var(--color-codex-accent)',
                      }}
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div
                      className="flex flex-1 flex-col"
                      style={{ minWidth: 0, paddingTop: 4 }}
                    >
                      <div
                        className="flex items-center gap-1.5"
                        style={{
                          fontSize: 12,
                          color: 'var(--color-codex-ink-mute)',
                          marginBottom: 6,
                        }}
                      >
                        <span
                          style={{
                            color: 'var(--color-codex-accent-ink)',
                            fontWeight: 500,
                          }}
                        >
                          Aria
                        </span>
                        <CxStatus tone="accent" pulse>
                          {t('chat.thinking')}
                        </CxStatus>
                      </div>
                      <div
                        style={{
                          fontSize: 14.5,
                          lineHeight: 1.75,
                          color: 'var(--color-codex-ink)',
                          maxWidth: 720,
                        }}
                      >
                        {streamingContent ? (
                          <>
                            {skillRunActive ? (
                              <ProgressCard steps={liveProgressSteps} title={liveProgressTitle} />
                            ) : (
                              <ChatStatusPill message={liveStatusText} />
                            )}
                            {streamArtifacts.map((artifact) => (
                              <ChatArtifactCard key={`${artifact.id ?? artifact.path}-${artifact.name}`} artifact={artifact} />
                            ))}
                            <StreamingAnswerPreview content={streamingContent} compact={skillRunActive} />
                            {toolStatus && (
                              <div
                                className="mt-3 flex items-center gap-2"
                                style={{
                                  fontSize: 12,
                                  color: 'var(--color-codex-accent)',
                                }}
                              >
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                {toolStatus}
                              </div>
                            )}
                            {/* Blinking cursor — uses the codex-cursor::after
                                helper from codex.css. */}
                            <span className="codex-cursor inline-block align-middle" aria-hidden="true" />
                          </>
                        ) : toolStatus ? (
                          <>
                            {skillRunActive ? (
                              <ProgressCard steps={liveProgressSteps} title={liveProgressTitle} />
                            ) : (
                              <ChatStatusPill message={liveStatusText || toolStatus} />
                            )}
                            <div
                              className="flex items-center gap-2 py-1"
                              style={{ color: 'var(--color-codex-accent)' }}
                            >
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              <span style={{ fontSize: 13 }}>{toolStatus}</span>
                            </div>
                          </>
                        ) : (
                          skillRunActive ? (
                            <ProgressCard steps={liveProgressSteps} title={liveProgressTitle} completedLabel="已就绪" />
                          ) : (
                            <ChatStatusPill message={liveStatusText} />
                          )
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Error banner */}
                {errorMsg && (
                  <div
                    role="alert"
                    className="flex items-start gap-3"
                    style={{
                      padding: '10px 14px',
                      background:
                        'color-mix(in oklch, var(--color-codex-bad) 8%, transparent)',
                      border:
                        '1px solid color-mix(in oklch, var(--color-codex-bad) 30%, transparent)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                      color: 'var(--color-codex-bad)',
                    }}
                  >
                    <TriangleAlert
                      className="h-4 w-4 flex-shrink-0"
                      aria-hidden="true"
                      style={{ marginTop: 2 }}
                    />
                    <p className="flex-1" style={{ margin: 0, fontSize: 13 }}>
                      {errorMsg}
                    </p>
                    <button
                      onClick={() => setErrorMsg(null)}
                      aria-label="Dismiss"
                      style={{ color: 'var(--color-codex-bad)', opacity: 0.7 }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Scroll-to-bottom fab */}
          {showScrollBtn && (
            <button
              onClick={() => scrollToBottom()}
              className="absolute bottom-6 right-6 flex h-8 w-8 items-center justify-center transition-all"
              style={{
                background: 'var(--color-codex-bg-elev)',
                border: '1px solid var(--color-codex-line)',
                color: 'var(--color-codex-ink-soft)',
                borderRadius: 'var(--codex-r-pill, 999px)',
                boxShadow: '0 4px 16px -4px rgba(0,0,0,0.08)',
              }}
              aria-label="Scroll to bottom"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* ── Input area ── */}
        <div
          className="relative flex-shrink-0 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-5"
          style={{
            background: 'var(--color-codex-bg)',
            borderTop: '1px solid var(--color-codex-line)',
          }}
        >
          {/* Gradient fade — blends messages area into footer */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-10 -translate-y-full"
            style={{
              background:
                'linear-gradient(to bottom, transparent, var(--color-codex-bg))',
            }}
          />
          <div className={`mx-auto ${sidebarOpen ? 'max-w-4xl' : 'max-w-5xl'}`}>
            {/* Context pills */}
            <div className="flex items-center gap-1 mb-2 flex-nowrap overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
              <ContextPill
                ref={projectDropdownRef}
                icon={<FolderKanban className="w-3 h-3" />}
                label={selectedProjectData ? selectedProjectData.name : 'Project'}
                active={!!selectedProject}
                open={showProjectDropdown}
                onToggle={() => setShowProjectDropdown(v => !v)}
              >
                {showProjectDropdown && (
                  <DropdownMenu>
                    <DropdownItem onClick={() => { setSelectedProject(null); setShowProjectDropdown(false) }} muted>
                      Clear selection
                    </DropdownItem>
                    {projects.map(p => (
                      <DropdownItem key={p.id} onClick={() => { setSelectedProject(p.id); setShowProjectDropdown(false) }}>
                        {p.name}
                      </DropdownItem>
                    ))}
                  </DropdownMenu>
                )}
              </ContextPill>

              <ContextPill
                ref={skillDropdownRef}
                icon={<Wrench className="w-3 h-3" />}
                label={selectedSkillData ? selectedSkillData.name : '@ Skills'}
                active={!!selectedSkill}
                secondary
                open={showSkillDropdown}
                onToggle={() => setShowSkillDropdown(v => !v)}
              >
                {showSkillDropdown && (
                  <DropdownMenu wide>
                    <DropdownItem onClick={() => { setSelectedSkill(null); skillArmedRef.current = false; setSkillCategoryFilter('all'); setShowSkillDropdown(false) }} muted>
                      {t('skills.clearSelection') || 'Clear selection'}
                    </DropdownItem>
                    {(() => {
                      const categories = ['all', ...Array.from(new Set(skills.map(s => s.category)))]
                      return (
                        <div
                          className="px-3 py-2"
                          style={{ borderBottom: '1px solid var(--color-codex-line-soft)' }}
                        >
                          <div className="flex flex-wrap gap-1">
                            {categories.map(cat => {
                              const isActive = skillCategoryFilter === cat
                              return (
                                <button
                                  key={cat}
                                  onClick={e => { e.stopPropagation(); setSkillCategoryFilter(cat) }}
                                  className="px-2 py-0.5 transition-colors"
                                  style={{
                                    fontSize: 11,
                                    background: isActive
                                      ? 'var(--color-codex-accent)'
                                      : 'var(--color-codex-bg-tint)',
                                    color: isActive
                                      ? 'var(--color-codex-bg-elev)'
                                      : 'var(--color-codex-ink-soft)',
                                    borderRadius: 'var(--codex-r-sm, 3px)',
                                  }}
                                >
                                  {cat === 'all' ? (t('skills.allCategories') || '全部') : cat}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}
                    <div className="max-h-60 overflow-y-auto">
                      {(() => {
                        const filteredSkills = skillCategoryFilter === 'all' ? skills : skills.filter(s => s.category === skillCategoryFilter)
                        if (skillCategoryFilter === 'all') {
                          const grouped = filteredSkills.reduce((acc, s) => {
                            if (!acc[s.category]) acc[s.category] = []
                            acc[s.category].push(s)
                            return acc
                          }, {} as Record<string, Skill[]>)
                          return Object.entries(grouped).map(([category, categorySkills]) => (
                            <div key={category}>
                              <div
                                className="px-4 py-1.5 font-mono"
                                style={{
                                  fontSize: 10.5,
                                  background: 'var(--color-codex-bg-tint)',
                                  color: 'var(--color-codex-ink-mute)',
                                  letterSpacing: '0.06em',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {category}
                              </div>
                              {categorySkills.map(s => (
                                <DropdownItem key={s.id} onClick={() => { setSelectedSkill(s.id); skillArmedRef.current = true; setShowSkillDropdown(false) }}>
                                  <div className="flex flex-col">
                                    <span>{s.name}</span>
                                    {s.estimated_time && (
                                      <span
                                        className="font-mono"
                                        style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)' }}
                                      >
                                        {s.estimated_time}
                                      </span>
                                    )}
                                  </div>
                                </DropdownItem>
                              ))}
                            </div>
                          ))
                        }
                        return filteredSkills.map(s => (
                          <DropdownItem key={s.id} onClick={() => { setSelectedSkill(s.id); skillArmedRef.current = true; setShowSkillDropdown(false) }}>
                            <div className="flex flex-col">
                              <span>{s.name}</span>
                              {s.estimated_time && (
                                <span
                                  className="font-mono"
                                  style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)' }}
                                >
                                  {s.estimated_time}
                                </span>
                              )}
                            </div>
                          </DropdownItem>
                        ))
                      })()}
                    </div>
                  </DropdownMenu>
                )}
              </ContextPill>
            </div>

            {selectedSkillData && <SkillRequirementsPanel skill={selectedSkillData} />}

            {/* Textarea + actions */}
            <div
              className="flex items-end gap-2 px-3 py-2.5 transition-all duration-200 sm:gap-3 sm:px-4 sm:py-3"
              style={{
                background: 'var(--color-codex-bg-elev)',
                border: '1px solid var(--color-codex-line)',
                borderRadius: 'var(--codex-r-md, 6px)',
              }}
            >
              <button
                className="hidden flex-shrink-0 p-1.5 transition-colors sm:block"
                style={{
                  marginBottom: 2,
                  color: 'var(--color-codex-ink-faint)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
                title="Attach"
                aria-label="Attach"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onCompositionStart={() => { isComposingRef.current = true }}
                onCompositionEnd={() => { isComposingRef.current = false }}
                onKeyDown={handleKeyDown}
                placeholder={t('chat.placeholder')}
                disabled={sending}
                rows={1}
                className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-1.5 outline-none leading-relaxed disabled:opacity-50"
                style={{
                  minHeight: 36,
                  maxHeight: 180,
                  fontSize: 14.5,
                  color: 'var(--color-codex-ink)',
                }}
              />
              {sending ? (
                <button
                  onClick={handleStop}
                  title={t('chat.stopGeneration')}
                  className="flex-shrink-0 p-2 transition-colors"
                  style={{
                    marginBottom: 2,
                    background: 'var(--color-codex-bg-tint)',
                    color: 'var(--color-codex-ink-soft)',
                    border: '1px solid var(--color-codex-line)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="flex-shrink-0 p-2 transition-all active:scale-95 disabled:opacity-25"
                  style={{
                    marginBottom: 2,
                    background: 'var(--color-codex-accent)',
                    color: 'var(--color-codex-bg-elev)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                  aria-label="Send"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p
              className="mt-2 hidden text-center sm:block font-mono"
              style={{
                fontSize: 11,
                color: 'var(--color-codex-ink-faint)',
                letterSpacing: '0.04em',
              }}
            >
              {t('chat.shiftEnter')} · {t('chat.enterToSend')}
            </p>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.4)' }}
        >
          <div
            className="w-full max-w-sm p-6"
            style={{
              background: 'var(--color-codex-bg-elev)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-md, 6px)',
              boxShadow: '0 24px 60px -16px rgba(0,0,0,0.32)',
            }}
          >
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--color-codex-ink)',
                margin: '0 0 8px',
              }}
            >
              {t('chat.deleteTitle')}
            </h3>
            <p
              style={{
                fontSize: 13,
                color: 'var(--color-codex-ink-soft)',
                margin: '0 0 24px',
                lineHeight: 1.6,
              }}
            >
              {t('chat.deleteConfirm')} {t('chat.deleteWarning')}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteDialog(false); setDeleteTargetId(null) }}
                className="px-4 py-2 transition-colors"
                style={{
                  fontSize: 13,
                  color: 'var(--color-codex-ink-soft)',
                  background: 'var(--color-codex-bg)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 transition-colors"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  background: 'var(--color-codex-bad)',
                  color: 'var(--color-codex-bg-elev)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skill Template Modal */}
      {showSkillTemplateModal && skillTemplateData && (
        <SkillTemplateModal
          skill={skillTemplateData.skill}
          variables={skillTemplateData.variables}
          onApply={handleApplyTemplate}
          onCancel={handleCancelTemplate}
        />
      )}
    </div>
  )
}

// Helper to extract minutes from estimated_time like "~2 min", "~10 min", "15–20 分钟"
const extractMinutes = (estimatedTime?: string): number => {
  if (!estimatedTime) return 0
  const match = estimatedTime.match(/(\d+)/)
  return match ? parseInt(match[1]) : 0
}

// ─── SkillRequirementsPanel ─────────────────────────────────────────────────
function SkillRequirementsPanel({ skill }: { skill: Skill }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  
  const isQuick = extractMinutes(skill.estimated_time) <= 10
  
  const typeLabel = isQuick
    ? (t('skills.types.quick') || '快速')
    : (t('skills.types.deep') || '深度')

  return (
    <div
      className="mb-3 overflow-hidden"
      style={{
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md, 6px)',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-3 p-3 transition-colors"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Info
            className="h-4 w-4 flex-shrink-0"
            style={{ color: 'var(--color-codex-accent)' }}
          />
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--color-codex-ink)',
              letterSpacing: '0.02em',
            }}
          >
            {t('chat.skillRequirements') || '技能要求'}
          </span>
          <span
            className="truncate"
            style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}
          >
            {skill.name}
          </span>
          <span
            className="font-mono"
            style={{
              padding: '1px 6px',
              fontSize: 10.5,
              background: 'var(--color-codex-bg-tint)',
              color: 'var(--color-codex-ink-soft)',
              borderRadius: 'var(--codex-r-pill, 999px)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {typeLabel}
          </span>
          {skill.estimated_time && (
            <span
              className="flex items-center gap-1 font-mono"
              style={{ fontSize: 10.5, color: 'var(--color-codex-ink-mute)' }}
            >
              <Clock className="h-3 w-3" />
              {skill.estimated_time}
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          style={{ color: 'var(--color-codex-ink-faint)' }}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div
          className="px-3 pb-3"
          style={{ borderTop: '1px solid var(--color-codex-line-soft)' }}
        >
          <div className="space-y-3 pt-3">
            {skill.description && (
              <div>
                <p
                  className="mb-1 font-mono"
                  style={{
                    fontSize: 10.5,
                    color: 'var(--color-codex-ink-mute)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('skills.description') || '描述'}
                </p>
                <p style={{ fontSize: 13, color: 'var(--color-codex-ink)' }}>
                  {skill.description}
                </p>
              </div>
            )}

            {skill.system_prompt && (
              <div>
                <p
                  className="mb-1 font-mono"
                  style={{
                    fontSize: 10.5,
                    color: 'var(--color-codex-ink-mute)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('skills.systemPrompt') || '系统提示词'}
                </p>
                <div
                  style={{
                    padding: '8px 10px',
                    background: 'var(--color-codex-bg-tint)',
                    border: '1px solid var(--color-codex-line-soft)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                >
                  <p
                    className="font-mono line-clamp-4"
                    style={{
                      fontSize: 11.5,
                      color: 'var(--color-codex-ink-soft)',
                      lineHeight: 1.55,
                      margin: 0,
                    }}
                  >
                    {skill.system_prompt}
                  </p>
                </div>
              </div>
            )}

            {skill.user_template && (
              <div>
                <p
                  className="mb-1 font-mono"
                  style={{
                    fontSize: 10.5,
                    color: 'var(--color-codex-ink-mute)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('skills.userTemplate') || '用户模板'}
                </p>
                <div
                  style={{
                    padding: '8px 10px',
                    background: 'var(--color-codex-bg-tint)',
                    border: '1px solid var(--color-codex-line-soft)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                >
                  <p
                    className="font-mono"
                    style={{
                      fontSize: 11.5,
                      color: 'var(--color-codex-ink-soft)',
                      lineHeight: 1.55,
                      margin: 0,
                    }}
                  >
                    {skill.user_template}
                  </p>
                </div>
              </div>
            )}

            <div
              className="flex items-center gap-4 pt-1"
              style={{ fontSize: 11.5 }}
            >
              <div>
                <span style={{ color: 'var(--color-codex-ink-mute)' }}>
                  {t('skills.category') || '类别'}:{' '}
                </span>
                <span
                  style={{ fontWeight: 500, color: 'var(--color-codex-ink)' }}
                >
                  {skill.category}
                </span>
              </div>
              {skill.tools_definition_json && (
                <div>
                  <span style={{ color: 'var(--color-codex-ink-mute)' }}>
                    {t('skills.tools') || '工具'}:{' '}
                  </span>
                  <span
                    className="font-mono"
                    style={{
                      fontWeight: 500,
                      color: 'var(--color-codex-ink)',
                    }}
                  >
                    {(() => {
                      try {
                        const tools = JSON.parse(skill.tools_definition_json)
                        return Array.isArray(tools) ? tools.length + ' tools' : 'enabled'
                      } catch {
                        return 'enabled'
                      }
                    })()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper to escape special regex characters
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ─── SkillTemplateModal ─────────────────────────────────────────────────────
interface SkillTemplateModalProps {
  skill: Skill
  variables: { name: string; value: string }[]
  onApply: (filledTemplate: string) => void | Promise<void>
  onCancel: () => void
}

function SkillTemplateModal({ skill, variables, onApply, onCancel }: SkillTemplateModalProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    variables.forEach(v => { initial[v.name] = v.value })
    return initial
  })

  // Generate preview by replacing variables in template
  const preview = useMemo(() => {
    let result = skill.user_template || ''
    Object.entries(values).forEach(([name, value]) => {
      if (!value) return
      
      // Format 1: [变量名] or {{变量名}}
      const placeholderRegex = new RegExp(`\\[${escapeRegex(name)}\\]|\\{\\{${escapeRegex(name)}\\}\\}`, 'g')
      result = result.replace(placeholderRegex, value)
      
      // Format 2: 变量名： or 变量名: (append value after colon)
      // Match lines like "公司 / 产品：" or "- 客户数量级："
      const lines = result.split('\n')
      const updatedLines = lines.map(line => {
        const trimmed = line.trim()
        // Check if line starts with the variable name followed by colon
        const colonMatch = trimmed.match(/^(?:[-•]\s*)?(.+?)([：:])\s*$/)
        if (colonMatch) {
          const lineVarName = colonMatch[1].trim()
          if (lineVarName === name || lineVarName.includes(name)) {
            // Replace empty line with filled value
            return line + value
          }
        }
        return line
      })
      result = updatedLines.join('\n')
    })
    return result
  }, [values, skill.user_template])

  const handleApply = async () => {
    await onApply(preview)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.4)' }}
    >
      <div
        className="w-full max-w-lg overflow-hidden"
        style={{
          background: 'var(--color-codex-bg-elev)',
          border: '1px solid var(--color-codex-line)',
          borderRadius: 'var(--codex-r-md, 6px)',
          boxShadow: '0 24px 60px -16px rgba(0,0,0,0.32)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 px-6 py-4"
          style={{ borderBottom: '1px solid var(--color-codex-line)' }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center"
              style={{
                background: 'var(--color-codex-accent-bg)',
                color: 'var(--color-codex-accent)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <Wrench className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3
                className="truncate"
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--color-codex-ink)',
                  margin: 0,
                }}
              >
                {skill.name}
              </h3>
              <p
                style={{
                  fontSize: 11.5,
                  color: 'var(--color-codex-ink-mute)',
                  margin: '2px 0 0',
                }}
              >
                {t('chat.fillTemplate') || '填写模板变量'}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 transition-colors"
            style={{
              color: 'var(--color-codex-ink-soft)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-auto px-6 py-4">
          {skill.description && (
            <p
              style={{
                fontSize: 13,
                color: 'var(--color-codex-ink-soft)',
                margin: '0 0 16px',
              }}
            >
              {skill.description}
            </p>
          )}

          {variables.length > 0 ? (
            <div className="mb-4 space-y-3">
              {variables.map((variable, idx) => (
                <div key={variable.name}>
                  <label
                    className="mb-1.5 block font-mono"
                    style={{
                      fontSize: 10.5,
                      color: 'var(--color-codex-ink-mute)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {variable.name}
                  </label>
                  <input
                    type="text"
                    value={values[variable.name] || ''}
                    onChange={(e) => setValues(prev => ({ ...prev, [variable.name]: e.target.value }))}
                    placeholder={`请输入${variable.name}...`}
                    className="w-full px-3 py-2.5 outline-none transition-colors"
                    style={{
                      background: 'var(--color-codex-bg)',
                      border: '1px solid var(--color-codex-line)',
                      borderRadius: 'var(--codex-r-sm, 3px)',
                      fontSize: 13,
                      color: 'var(--color-codex-ink)',
                    }}
                    autoFocus={idx === 0}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div
              className="mb-4 p-3"
              style={{
                background: 'var(--color-codex-bg-tint)',
                border: '1px solid var(--color-codex-line-soft)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <p style={{ fontSize: 13, color: 'var(--color-codex-ink-mute)', margin: 0 }}>
                {t('chat.noVariables') || '此模板没有需要填写的变量'}
              </p>
            </div>
          )}

          {/* Preview */}
          <div>
            <p
              className="mb-2 font-mono"
              style={{
                fontSize: 10.5,
                color: 'var(--color-codex-ink-mute)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {t('chat.preview') || '预览'}
            </p>
            <div
              style={{
                padding: 12,
                background: 'var(--color-codex-bg-tint)',
                border: '1px solid var(--color-codex-line-soft)',
                borderRadius: 'var(--codex-r-sm, 3px)',
              }}
            >
              <p
                className="whitespace-pre-wrap"
                style={{
                  fontSize: 13,
                  color: 'var(--color-codex-ink-soft)',
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {preview}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--color-codex-line)' }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 transition-colors"
            style={{
              fontSize: 13,
              color: 'var(--color-codex-ink-soft)',
              background: 'var(--color-codex-bg)',
              border: '1px solid var(--color-codex-line)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-2 px-4 py-2 transition-colors"
            style={{
              fontSize: 13,
              fontWeight: 500,
              background: 'var(--color-codex-accent)',
              color: 'var(--color-codex-bg-elev)',
              borderRadius: 'var(--codex-r-sm, 3px)',
            }}
          >
            <Send className="h-4 w-4" />
            {t('chat.applyAndSend') || '应用并发送'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Export Dropdown Component ──────────────────────────────────────────────
function ExportDropdown({ conversationId, conversationTitle }: { 
  conversationId: number
  conversationTitle?: string 
}) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])
  
  const handleExport = async (format: 'markdown' | 'pdf') => {
    setIsExporting(true)
    try {
      await exportConversationFile(conversationId, format, conversationTitle || 'conversation')
      setIsOpen(false)
    } catch (err) {
      console.error('Export failed:', err)
      alert(t('chat.exportFailed'))
    } finally {
      setIsExporting(false)
    }
  }
  
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="flex items-center gap-1.5 px-3 py-1.5 transition-colors disabled:opacity-50"
        style={{
          fontSize: 12.5,
          color: 'var(--color-codex-ink-soft)',
          borderRadius: 'var(--codex-r-sm, 3px)',
        }}
        title={t('chat.export')}
      >
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">{t('chat.export')}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {isOpen && (
        <div
          className="animate-fade-in absolute right-0 top-full z-50 mt-1 w-44 py-1"
          style={{
            background: 'var(--color-codex-bg-elev)',
            border: '1px solid var(--color-codex-line)',
            borderRadius: 'var(--codex-r-md, 6px)',
            boxShadow: '0 4px 16px -4px rgba(0,0,0,0.08)',
          }}
        >
          <button
            onClick={() => handleExport('markdown')}
            className="flex w-full items-center gap-2 px-4 py-2 transition-colors"
            style={{ fontSize: 13, color: 'var(--color-codex-ink)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-codex-bg-tint)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <FileText className="h-4 w-4" style={{ color: 'var(--color-codex-ink-faint)' }} />
            {t('chat.exportMarkdown')}
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="flex w-full items-center gap-2 px-4 py-2 transition-colors"
            style={{ fontSize: 13, color: 'var(--color-codex-ink)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-codex-bg-tint)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <FileIcon className="h-4 w-4" style={{ color: 'var(--color-codex-bad)' }} />
            {t('chat.exportPDF')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── MessageRow (Codex thread bubble · sub-B) ───────────────────────────────
//
// Both user and Aria rows render flat-left per the prototype
// (direction-codex-part1.jsx:309). No bubble backgrounds — quiet ink on
// parchment. Avatar style differs: user gets a faint ``bg-tint`` circle with
// "你" / "You" glyph; Aria gets an ``accent-bg`` circle with the sparkle.
//
// The cards inside (ProgressCard, StreamingAnswerPreview, ChatArtifactCard)
// still render in their legacy palette — sub-C will refactor those.
function MessageRow({ message }: { message: Message }) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'

  let references: Array<{ type: string; id: number; title: string }> = []
  let skillProgress: ChatProgressStep[] = []
  let artifacts: GeneratedArtifact[] = []
  let stageTimings: StageTimingEntry[] = []
  try {
    const meta = JSON.parse(message.metadata_json || '{}')
    references = meta.references || []
    artifacts = Array.isArray(meta.artifacts) ? meta.artifacts : []
    skillProgress = buildProgressFromMetadata(meta)
    stageTimings = stageTimingEntriesFromMeta(meta)
  } catch {
    // Ignore invalid metadata payloads from older chat messages.
  }

  return (
    <div className="group flex w-full items-start gap-3.5">
      {/* Avatar — same size for both sides, swatch differs by role. */}
      <span
        className="inline-flex flex-shrink-0 items-center justify-center"
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          marginTop: 4,
          fontSize: 12,
          fontWeight: 500,
          background: isUser
            ? 'var(--color-codex-bg-tint)'
            : 'var(--color-codex-accent-bg)',
          color: isUser
            ? 'var(--color-codex-ink-soft)'
            : 'var(--color-codex-accent)',
        }}
      >
        {isUser ? t('chat.you') : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
      </span>

      {/* Content column. No bubble — just markdown text + meta. */}
      <div className="flex flex-1 flex-col" style={{ minWidth: 0, paddingTop: 4 }}>
        {/* Role + time label */}
        <div
          className="flex flex-wrap items-center gap-1.5"
          style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)', marginBottom: 6 }}
        >
          <span
            style={{
              color: isUser
                ? 'var(--color-codex-ink-soft)'
                : 'var(--color-codex-accent-ink)',
              fontWeight: 500,
            }}
          >
            {isUser ? t('chat.you') : 'Aria'}
          </span>
          <span>·</span>
          <span className="font-mono">{formatTime(message.created_at)}</span>
        </div>

        {/* Body */}
        {isUser ? (
          <p
            className="whitespace-pre-wrap"
            style={{
              margin: 0,
              fontSize: 14.5,
              lineHeight: 1.75,
              color: 'var(--color-codex-ink)',
              maxWidth: 720,
            }}
          >
            {message.content}
          </p>
        ) : (
          <div
            style={{
              fontSize: 14.5,
              lineHeight: 1.75,
              color: 'var(--color-codex-ink)',
              maxWidth: 720,
            }}
          >
            <ProgressCard steps={skillProgress} title="Skill 执行清单" />
            {artifacts.map((artifact) => (
              <ChatArtifactCard
                key={`${artifact.id ?? artifact.path}-${artifact.name}`}
                artifact={artifact}
              />
            ))}
            <StreamingAnswerPreview content={message.content} compact={skillProgress.length > 0} />
          </div>
        )}

        {/* References — codex chip row. */}
        {!isUser && references.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {references.map((ref, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1"
                style={{
                  padding: '2px 8px',
                  fontSize: 11.5,
                  background: 'var(--color-codex-bg-elev)',
                  color: 'var(--color-codex-ink-soft)',
                  border: '1px solid var(--color-codex-line)',
                  borderRadius: 'var(--codex-r-sm, 3px)',
                }}
              >
                {ref.type === 'skill' && <Wrench className="h-3 w-3" aria-hidden="true" />}
                {ref.type === 'doc' && <BookOpen className="h-3 w-3" aria-hidden="true" />}
                {ref.type === 'file' && <FileIcon className="h-3 w-3" aria-hidden="true" />}
                {ref.title}
              </span>
            ))}
          </div>
        )}

        {/* Stage timings — quiet info chips, mono numbers. */}
        {!isUser && stageTimings.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {stageTimings
              .filter((item) =>
                [
                  'prepare_total_ms',
                  'model_first_event_ms',
                  'tools_total_ms',
                  'follow_up_ms',
                  'save_ms',
                  'total_stream_ms',
                ].includes(item.key),
              )
              .slice(0, 6)
              .map((item) => (
                <span
                  key={item.key}
                  className="inline-flex items-center gap-1"
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    background: 'var(--color-codex-bg-tint)',
                    color: 'var(--color-codex-ink-mute)',
                    borderRadius: 'var(--codex-r-sm, 3px)',
                  }}
                >
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {item.label}{' '}
                  <span className="font-mono">{formatDuration(item.durationMs)}</span>
                </span>
              ))}
          </div>
        )}

        {/* Hover-only copy button. Timestamp already lives in the role
            line, so the row stays quiet at rest. */}
        <div
          className="mt-1.5 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: 'var(--color-codex-ink-faint)' }}
        >
          <CopyButton text={message.content} />
        </div>
      </div>
    </div>
  )
}

// ─── Context pill wrapper ────────────────────────────────────────────────────
import { forwardRef } from 'react'

const ContextPill = forwardRef<HTMLDivElement, {
  icon: React.ReactNode
  label: string
  active?: boolean
  secondary?: boolean
  open: boolean
  onToggle: () => void
  children?: React.ReactNode
}>(({ icon, label, active, secondary, open, onToggle, children }, ref) => {
  let background = 'transparent'
  let color = 'var(--color-codex-ink-mute)'
  if (active) {
    if (secondary) {
      background = 'var(--color-codex-bg-tint)'
      color = 'var(--color-codex-ink-soft)'
    } else {
      background = 'var(--color-codex-accent-bg)'
      color = 'var(--color-codex-accent-ink)'
    }
  }
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex max-w-[70vw] items-center gap-1.5 truncate px-2.5 py-1 transition-colors sm:max-w-none"
        style={{
          background,
          color,
          borderRadius: 'var(--codex-r-sm, 3px)',
          fontSize: 11.5,
          letterSpacing: '0.02em',
        }}
      >
        {icon}
        {label}
      </button>
      {children}
    </div>
  )
})
ContextPill.displayName = 'ContextPill'

// ─── Dropdown primitives ─────────────────────────────────────────────────────
function DropdownMenu({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={`absolute bottom-full left-0 z-50 mb-2 max-w-[calc(100vw-1.5rem)] py-1.5 ${
        wide ? 'w-[calc(100vw-1.5rem)] sm:w-80' : 'w-60'
      }`}
      style={{
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md, 6px)',
        boxShadow: '0 4px 16px -4px rgba(0,0,0,0.08)',
      }}
    >
      {children}
    </div>
  )
}

function DropdownItem({ onClick, children, muted }: {
  onClick: () => void
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-2 text-left transition-colors hover:bg-codex-bg-tint"
      style={{
        fontSize: 13,
        color: muted
          ? 'var(--color-codex-ink-mute)'
          : 'var(--color-codex-ink)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-codex-bg-tint)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}
