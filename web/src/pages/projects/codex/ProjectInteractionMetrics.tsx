import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectInteractionMetrics } from '../../../types/api'
import { api } from '../../../api/client'
import { CxIcon } from './CxIcons'

const REASON_LABELS: Record<string, string> = {
  inaccurate: '内容不准确',
  missing_context: '缺少项目上下文',
  wrong_skill: 'Skill 选择不当',
  wrong_action: '执行动作不当',
  unclear: '表达不清楚',
  incomplete: '结果不完整',
}

function percent(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

export function ProjectInteractionMetricsPanel({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false)
  const [metrics, setMetrics] = useState<ProjectInteractionMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setMetrics(await api.get<ProjectInteractionMetrics>(
        `/chat/projects/${projectId}/interaction-metrics`,
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : '暂时无法加载质量指标')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [open])

  const negativeReasons = metrics
    ? Object.entries(metrics.negative_reasons)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1])
    : []
  const negativeTotal = negativeReasons.reduce((sum, [, count]) => sum + count, 0)
  const skillRunMetrics = metrics?.skill_runs
  const skillRuns = skillRunMetrics?.items.slice(0, 6) ?? []

  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => {
          const nextOpen = !open
          setOpen(nextOpen)
          if (nextOpen && metrics == null && !loading) void load()
        }}
        aria-label="查看项目交互质量"
        aria-expanded={open}
        title="交互质量"
        style={{
          height: 30,
          padding: '0 9px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: open ? 'var(--accent-ink)' : 'var(--ink-mute)',
          background: open ? 'var(--accent-bg)' : 'transparent',
          border: 'none',
          borderRadius: 'var(--r-sm)',
          cursor: 'pointer',
          fontSize: 11.5,
        }}
      >
        <CxIcon name="trending" size={13} />
        质量
      </button>
      {open && (
        <section
          aria-label="项目交互质量指标"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            width: 410,
            maxWidth: 'calc(100vw - 40px)',
            marginTop: 7,
            padding: 16,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 18px 42px -16px rgba(0,0,0,0.48)',
            zIndex: 60,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>项目交互质量</div>
              <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-faint)' }}>
                最近最多 2,000 条消息的分类反馈汇总
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                padding: '4px 8px',
                color: 'var(--ink-mute)',
                background: 'var(--bg)',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: 10.5,
              }}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>

          {loading && metrics == null && (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
              正在汇总…
            </div>
          )}
          {error && metrics == null && (
            <div style={{ padding: '20px 0 8px', color: 'var(--bad)', fontSize: 12 }}>{error}</div>
          )}
          {metrics && (
            <>
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
                <MetricCard label="反馈覆盖" value={percent(metrics.feedback_coverage)} detail={`${metrics.feedback_count}/${metrics.assistant_turn_count} 轮`} />
                <MetricCard label="有效回答" value={percent(metrics.helpful_rate)} detail={`${metrics.helpful_count}/${metrics.feedback_count} 条`} />
                <MetricCard label="修订成功" value={percent(metrics.revision_success_rate)} detail={`${metrics.revision_feedback_count} 次反馈`} />
                <MetricCard label="配置采纳" value={percent(metrics.turn_setup.adoption_rate)} detail={`${metrics.turn_setup.applied_count}/${metrics.turn_setup.requested_count} 次`} />
              </div>

              <div style={{ marginTop: 14, borderTop: '1px solid var(--line-soft)', paddingTop: 11 }}>
                <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-soft)' }}>需要改善的原因</div>
                {negativeReasons.length === 0 ? (
                  <div style={{ marginTop: 7, fontSize: 11, color: 'var(--ink-faint)' }}>尚无负向分类反馈</div>
                ) : (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {negativeReasons.map(([reason, count]) => (
                      <div key={reason} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 24px', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>{REASON_LABELS[reason] ?? reason}</span>
                        <span style={{ height: 5, background: 'var(--bg-tint)', borderRadius: 99, overflow: 'hidden' }}>
                          <span style={{ display: 'block', width: `${Math.max(8, (count / negativeTotal) * 100)}%`, height: '100%', background: 'var(--warn)', borderRadius: 99 }} />
                        </span>
                        <span className="num" style={{ textAlign: 'right', fontSize: 10.5, color: 'var(--ink-faint)' }}>{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 14, borderTop: '1px solid var(--line-soft)', paddingTop: 11 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-soft)' }}>Skill 版本质量</div>
                  <div style={{ fontSize: 9.5, color: 'var(--ink-faint)' }}>
                    {skillRunMetrics?.versioned_run_count ?? 0}/{skillRunMetrics?.run_count ?? 0} 轮已记录版本
                  </div>
                </div>
                {skillRuns.length === 0 ? (
                  <div style={{ marginTop: 7, fontSize: 11, color: 'var(--ink-faint)' }}>当前样本中尚无 Skill 运行</div>
                ) : (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {skillRuns.map((item) => (
                      <div
                        key={`${item.skill_id ?? item.skill_name}:${item.version ?? 'legacy'}:${item.release_sha256 ?? ''}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) 52px 52px 52px',
                          alignItems: 'center',
                          gap: 7,
                          padding: '7px 8px',
                          background: 'var(--bg-tint)',
                          border: '1px solid var(--line-soft)',
                          borderRadius: 'var(--r-sm)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div title={item.skill_name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5, color: 'var(--ink-soft)' }}>
                            {item.skill_name}
                          </div>
                          <div style={{ marginTop: 2, fontSize: 9, color: 'var(--ink-faint)' }}>
                            {item.version ? `v${item.version}` : '历史版本未记录'}
                            {item.release_status ? ` · ${item.release_status}` : ''}
                            {item.release_sha256 ? ` · ${item.release_sha256.slice(0, 7)}` : ''}
                          </div>
                        </div>
                        <SkillMetric label="运行" value={`${item.run_count}`} />
                        <SkillMetric label="完成" value={percent(item.completion_rate)} />
                        <SkillMetric
                          label="有帮助"
                          value={percent(item.helpful_rate)}
                          warning={item.wrong_skill_count > 0}
                          title={item.wrong_skill_count > 0 ? `${item.wrong_skill_count} 条反馈认为 Skill 不合适` : undefined}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 13, padding: '8px 10px', background: 'var(--bg-tint)', borderRadius: 'var(--r-sm)', fontSize: 10.5, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
                隐私边界：只统计 Run 生命周期、Skill 版本、评分、原因与配置采纳状态；不读取或保存对话正文、自由文本反馈和用户身份。
              </div>
              {error && <div style={{ marginTop: 7, color: 'var(--warn)', fontSize: 10.5 }}>刷新失败，当前展示上次结果。</div>}
            </>
          )}
        </section>
      )}
    </div>
  )
}

function SkillMetric({ label, value, warning = false, title }: { label: string; value: string; warning?: boolean; title?: string }) {
  return (
    <div title={title} style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 8.5, color: 'var(--ink-faint)' }}>{label}</div>
      <div className="num" style={{ marginTop: 2, fontSize: 10.5, color: warning ? 'var(--warn)' : 'var(--ink-soft)' }}>{value}</div>
    </div>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{ padding: '9px 8px', background: 'var(--bg-tint)', border: '1px solid var(--line-soft)', borderRadius: 'var(--r-sm)' }}>
      <div style={{ fontSize: 9.5, color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>{label}</div>
      <div className="num" style={{ marginTop: 3, fontSize: 17, lineHeight: 1.2, color: 'var(--ink)' }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 9, color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>{detail}</div>
    </div>
  )
}
