import type { TurnRevisionInput, TurnSetupSuggestion } from '../../../types/api'
import { CxIcon } from './CxIcons'

const REVISION_FIELD_LABELS = {
  content: '正文',
  goal: '目标',
  constraints: '约束',
  skill: 'Skill',
  references: '项目引用',
} as const

export function ProjectTurnSetupControl({
  suggestion,
  loading,
  canRequest,
  disabled,
  onRequest,
  onApply,
  onDismiss,
  onSkillSelect,
}: {
  suggestion: TurnSetupSuggestion | null
  loading: boolean
  canRequest: boolean
  disabled?: boolean
  onRequest: () => void
  onApply: () => void
  onDismiss: () => void
  onSkillSelect: (skillId: number, name: string) => void
}) {
  const skillLabel = suggestion?.skill.state === 'recommended'
    ? suggestion.skill.skill_name
    : suggestion?.skill.state === 'ambiguous'
      ? 'Skill 待选择'
      : suggestion?.skill.state === 'selected'
        ? suggestion.skill.skill_name
        : suggestion?.skill.state === 'off'
          ? '本轮不用 Skill'
          : 'Skill 自动匹配'
  const hasAction = Boolean(
    suggestion?.template
    || (suggestion?.skill.state === 'recommended' && suggestion.skill.skill_id),
  )

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="获取本轮 Brief 与 Skill 配置建议"
        disabled={disabled || !canRequest || loading}
        onClick={onRequest}
        style={{
          height: 28,
          padding: '0 9px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: suggestion ? 'var(--accent)' : 'var(--ink-mute)',
          background: suggestion ? 'var(--accent-bg)' : 'transparent',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)',
          fontSize: 11.5,
          opacity: disabled || !canRequest ? 0.55 : 1,
        }}
      >
        <CxIcon name="sparkle" size={12} />
        {loading ? '分析配置…' : suggestion ? '配置建议' : '建议配置'}
      </button>

      {suggestion && (
        <div
          role="dialog"
          aria-label="本轮配置建议"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 'calc(100% + 7px)',
            width: 340,
            maxWidth: 'min(340px, calc(100vw - 32px))',
            padding: 12,
            color: 'var(--ink-soft)',
            background: 'var(--bg-elev)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 18px 44px -18px rgba(0,0,0,0.5)',
            fontSize: 11,
            lineHeight: 1.5,
            zIndex: 80,
          }}
        >
          <div style={{ color: 'var(--ink)', fontSize: 12.5, fontWeight: 600 }}>
            发送前配置建议
          </div>
          <div style={{ marginTop: 7 }}>
            <span style={{ color: 'var(--ink-faint)' }}>Brief · </span>
            {suggestion.template?.label || '保持自定义'}
          </div>
          {suggestion.template && (
            <div style={{ color: 'var(--ink-mute)' }}>{suggestion.template.reason}</div>
          )}
          <div style={{ marginTop: 6 }}>
            <span style={{ color: 'var(--ink-faint)' }}>Skill · </span>
            {skillLabel}
          </div>
          <div style={{ color: 'var(--ink-mute)' }}>{suggestion.skill.reason}</div>
          {suggestion.skill.candidates.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
              {suggestion.skill.candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  aria-label={`选择建议 Skill ${candidate.name}`}
                  onClick={() => onSkillSelect(candidate.id, candidate.name)}
                  style={{
                    padding: '3px 7px',
                    color: 'var(--accent-ink)',
                    background: 'var(--accent-bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                    fontSize: 10.5,
                  }}
                >
                  {candidate.name} · {candidate.score}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 10 }}>
            <button type="button" onClick={onDismiss} style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
              关闭
            </button>
            {hasAction && (
              <button
                type="button"
                onClick={onApply}
                style={{
                  padding: '4px 10px',
                  color: 'var(--bg-elev)',
                  background: 'var(--accent)',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 11,
                }}
              >
                应用建议
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectTurnRevisionPreview({
  revision,
  onCancel,
}: {
  revision: TurnRevisionInput
  onCancel: () => void
}) {
  return (
    <div
      aria-label="历史契约修订预览"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 5,
        marginTop: 7,
        padding: '6px 8px',
        color: 'var(--ink-soft)',
        background: 'color-mix(in oklch, var(--accent-bg) 55%, var(--bg-tint))',
        borderLeft: '2px solid var(--accent)',
        borderRadius: '0 var(--r-sm) var(--r-sm) 0',
        fontSize: 10.5,
      }}
    >
      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>修订草稿</span>
      <span>来源 · {revision.source_role === 'user' ? '历史请求' : '历史执行契约'}</span>
      {revision.changed_fields.length > 0 ? (
        <span>已调整 · {revision.changed_fields.map((field) => REVISION_FIELD_LABELS[field]).join(' / ')}</span>
      ) : (
        <span>配置未变化，将按原契约重试</span>
      )}
      <button
        type="button"
        aria-label="取消历史契约修订"
        onClick={onCancel}
        style={{ marginLeft: 'auto', color: 'var(--ink-mute)', fontSize: 10.5 }}
      >
        取消修订
      </button>
    </div>
  )
}

export const PROJECT_TURN_REVISION_FIELD_LABELS = REVISION_FIELD_LABELS
