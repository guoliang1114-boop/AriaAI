import { useMemo, useState } from 'react'
import type {
  ActivityStep,
  RunActivityTimeline,
  StepStatus,
} from '../../../stores/runActivityReducer'

const DISPLAY_MODE_LABELS: Record<string, string> = {
  contextual: '上下文处理',
  task: '后台任务',
  skill: 'Skill 执行',
  confirmation: '等待确认',
  debug: '运行详情',
}

const FINAL_STATUS_LABELS: Record<string, string> = {
  completed: '已完成',
  waiting_confirmation: '等待确认',
  failed: '执行失败',
  cancelled: '已停止',
}

function stepTone(status: StepStatus): string {
  if (status === 'completed') return 'var(--good)'
  if (status === 'failed') return 'var(--bad)'
  if (status === 'running') return 'var(--accent)'
  return 'var(--ink-faint)'
}

function durationLabel(durationMs?: number): string {
  if (!durationMs || durationMs < 1) return ''
  return durationMs < 1_000
    ? `${Math.round(durationMs)}ms`
    : `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
}

function ActivityStepRow({ step }: { step: ActivityStep }) {
  return (
    <li style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          marginTop: 6,
          borderRadius: 99,
          background: stepTone(step.status),
          boxShadow: step.status === 'running' ? '0 0 0 4px var(--accent-bg)' : undefined,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{step.title}</span>
          {durationLabel(step.duration_ms) && (
            <span className="num" style={{ color: 'var(--ink-faint)', fontSize: 10 }}>
              {durationLabel(step.duration_ms)}
            </span>
          )}
          {step.truncated && <span style={{ color: 'var(--warn)', fontSize: 10 }}>有省略</span>}
        </div>
        {step.items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 3 }}>
            {step.items.map((item, index) => (
              <div
                key={`${item.tool_name}-${index}`}
                style={{ display: 'flex', gap: 6, color: 'var(--ink-mute)', fontSize: 11 }}
              >
                <span style={{ color: stepTone(item.status) }}>·</span>
                <span>{item.tool_name}</span>
                {item.detail && <span style={{ color: 'var(--ink-faint)' }}>— {item.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

export function ProjectChatActivityTimeline({
  timeline,
  isStreaming = false,
}: {
  timeline: RunActivityTimeline
  isStreaming?: boolean
}) {
  const hasVisibleActivity = Boolean(
    timeline.skill
    || timeline.task
    || timeline.confirmation
    || timeline.error
    || timeline.steps.length
    || timeline.artifacts.length
    || timeline.memory_candidates.length,
  )
  const shouldRender = hasVisibleActivity || (
    isStreaming && timeline.display_mode && timeline.display_mode !== 'quiet'
  )
  const [expanded, setExpanded] = useState(
    isStreaming
    || timeline.final_status === 'failed'
    || timeline.final_status === 'waiting_confirmation',
  )

  const completedSteps = useMemo(
    () => timeline.steps.filter((step) => step.status === 'completed').length,
    [timeline.steps],
  )
  const failedArtifactVerifications = timeline.artifacts.filter(
    (artifact) => artifact.verification?.status === 'failed',
  ).length
  const pendingArtifactVerifications = timeline.artifacts.filter(
    (artifact) => ['partial', 'manual_required'].includes(artifact.verification?.status || ''),
  ).length
  if (!shouldRender) return null

  const finalLabel = timeline.final_status
    ? FINAL_STATUS_LABELS[timeline.final_status] || timeline.final_status
    : timeline.status?.message || (isStreaming ? '执行中' : '运行记录')
  const modeLabel = timeline.skill?.name
    ? `Skill · ${timeline.skill.name}`
    : DISPLAY_MODE_LABELS[timeline.display_mode || ''] || 'Aria 运行'
  const summary = timeline.task?.step_title
    || (timeline.steps.length > 0 ? `${completedSteps}/${timeline.steps.length} 个步骤已完成` : finalLabel)
  const tone = timeline.final_status === 'failed'
    ? 'var(--bad)'
    : timeline.final_status === 'waiting_confirmation'
      ? 'var(--warn)'
      : timeline.final_status === 'completed'
        ? 'var(--good)'
        : 'var(--accent)'

  return (
    <section
      aria-label="Aria 运行时间线"
      style={{
        marginBottom: 10,
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-elev)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '8px 11px',
          textAlign: 'left',
          color: 'var(--ink-soft)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: 99,
            background: tone,
            animation: isStreaming ? 'pulse 1.2s ease-in-out infinite' : undefined,
            flexShrink: 0,
          }}
        />
        <span style={{ color: 'var(--ink)', fontWeight: 550, fontSize: 12 }}>{modeLabel}</span>
        <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>{summary}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: tone, fontSize: 10.5 }}>{finalLabel}</span>
        <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>{expanded ? '收起 ▴' : '展开 ▾'}</span>
      </button>

      {expanded && (
        <div
          style={{
            padding: '9px 13px 11px',
            borderTop: '1px solid var(--line-soft)',
            background: 'var(--bg-tint)',
          }}
        >
          {timeline.task && (
            <div style={{ marginBottom: timeline.steps.length ? 10 : 0 }}>
              <div style={{ display: 'flex', gap: 8, color: 'var(--ink-mute)', fontSize: 11 }}>
                <span>{timeline.task.step_title || '后台任务处理中'}</span>
                {timeline.task.current_step != null && timeline.task.total_steps != null && (
                  <span className="num">{timeline.task.current_step}/{timeline.task.total_steps}</span>
                )}
                {timeline.task.progress_pct != null && (
                  <span className="num" style={{ marginLeft: 'auto' }}>{timeline.task.progress_pct}%</span>
                )}
              </div>
              {timeline.task.progress_pct != null && (
                <div style={{ height: 3, marginTop: 6, background: 'var(--line-soft)', borderRadius: 99 }}>
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(100, timeline.task.progress_pct))}%`,
                      height: '100%',
                      background: tone,
                      borderRadius: 99,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {timeline.steps.length > 0 && (
            <ol
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 0,
                margin: 0,
                listStyle: 'none',
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {timeline.steps.map((step) => <ActivityStepRow key={step.index} step={step} />)}
            </ol>
          )}

          {timeline.confirmation && (
            <div style={{ color: 'var(--warn)', fontSize: 11.5 }}>
              等待确认 · {timeline.confirmation.action} · {timeline.confirmation.impact}
            </div>
          )}
          {timeline.error && (
            <div style={{ color: 'var(--bad)', fontSize: 11.5 }}>
              {timeline.error.message}{timeline.error.retryable ? ' · 可以安全重试' : ''}
            </div>
          )}
          {(timeline.artifacts.length > 0 || timeline.memory_candidates.length > 0) && (
            <div style={{ marginTop: 8, color: 'var(--ink-mute)', fontSize: 10.5 }}>
              {timeline.artifacts.length > 0 ? `${timeline.artifacts.length} 个交付物` : ''}
              {failedArtifactVerifications > 0 ? ` · ${failedArtifactVerifications} 个校验失败` : ''}
              {pendingArtifactVerifications > 0 ? ` · ${pendingArtifactVerifications} 个待核验` : ''}
              {timeline.artifacts.length > 0 && timeline.memory_candidates.length > 0 ? ' · ' : ''}
              {timeline.memory_candidates.length > 0
                ? `${timeline.memory_candidates.length} 条记忆候选`
                : ''}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
