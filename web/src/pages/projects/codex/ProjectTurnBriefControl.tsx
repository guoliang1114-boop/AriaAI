import { useEffect, useRef, useState } from 'react'
import { CxIcon } from './CxIcons'
import {
  EMPTY_PROJECT_TURN_BRIEF,
  PROJECT_TURN_BRIEF_TEMPLATES,
  applyProjectTurnBriefTemplate,
  normalizeTurnBriefConstraints,
  normalizeTurnBriefGoal,
  type ProjectTurnBriefHistoryItem,
  type ProjectTurnBriefDraft,
} from './turnBrief'

const QUICK_CONSTRAINTS = [
  '只分析，不修改项目内容',
  '先给结论，再展开',
  '使用正式专业语气',
  '输出为 Markdown',
]

interface ProjectTurnBriefControlProps {
  draft: ProjectTurnBriefDraft
  onChange: (draft: ProjectTurnBriefDraft) => void
  referenceCount: number
  recentBriefs?: ProjectTurnBriefHistoryItem[]
  disabled?: boolean
}

export function ProjectTurnBriefControl({
  draft,
  onChange,
  referenceCount,
  recentBriefs = [],
  disabled = false,
}: ProjectTurnBriefControlProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const constraintCount = normalizeTurnBriefConstraints(draft.constraintsText).length
  const hasBrief = Boolean(normalizeTurnBriefGoal(draft.goal) || constraintCount)

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const addQuickConstraint = (constraint: string) => {
    const current = normalizeTurnBriefConstraints(draft.constraintsText)
    if (!current.includes(constraint)) current.push(constraint)
    onChange({ ...draft, constraintsText: current.slice(0, 8).join('\n') })
  }

  const summary = [
    hasBrief ? `${constraintCount} 项约束` : '设定目标与约束',
    referenceCount ? `${referenceCount} 个引用` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={`本轮 Brief：${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        style={{
          height: 28,
          maxWidth: 220,
          padding: '0 9px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: hasBrief ? 'var(--accent)' : 'var(--ink-mute)',
          background: hasBrief ? 'var(--accent-bg)' : 'transparent',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)',
          fontSize: 11.5,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <CxIcon name="target" size={12} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hasBrief ? `Brief · ${constraintCount} 约束` : '本轮 Brief'}
        </span>
        {referenceCount > 0 && <span>· {referenceCount} 引用</span>}
        <CxIcon name="chevron-down" size={10} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="编辑本轮 Brief"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 'calc(100% + 7px)',
            width: 380,
            maxWidth: 'min(380px, calc(100vw - 32px))',
            maxHeight: 'min(620px, calc(100vh - 120px))',
            overflowY: 'auto',
            padding: 14,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 18px 44px -18px rgba(0,0,0,0.5)',
            zIndex: 70,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>本轮执行简报</div>
          <div style={{ marginTop: 3, fontSize: 10.5, color: 'var(--ink-faint)' }}>
            可选；目标仅用于本轮。明确约束进入对话记忆，并可在后续覆盖。
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-mute)' }}>常用模板</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 6,
              marginTop: 6,
            }}
          >
            {PROJECT_TURN_BRIEF_TEMPLATES.map((template) => {
              const current = normalizeTurnBriefConstraints(draft.constraintsText)
              const applied = template.constraints.every((item) => current.includes(item))
              return (
                <button
                  key={template.id}
                  type="button"
                  aria-label={`应用 Brief 模板 ${template.label}`}
                  onClick={() => onChange(applyProjectTurnBriefTemplate(draft, template))}
                  style={{
                    padding: '7px 8px',
                    textAlign: 'left',
                    color: applied ? 'var(--accent)' : 'var(--ink-soft)',
                    background: applied ? 'var(--accent-bg)' : 'var(--bg-tint)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                  }}
                >
                  <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500 }}>
                    {applied ? '✓ ' : ''}{template.label}
                  </span>
                  <span style={{ display: 'block', marginTop: 2, color: 'var(--ink-faint)', fontSize: 9.5, lineHeight: 1.4 }}>
                    {template.description}
                  </span>
                </button>
              )
            })}
          </div>
          {recentBriefs.length > 0 && (
            <>
              <div style={{ marginTop: 11, fontSize: 11, color: 'var(--ink-mute)' }}>最近使用</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                {recentBriefs.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-label={`使用最近 Brief ${item.label}`}
                    title={item.label}
                    onClick={() => onChange(item.draft)}
                    style={{
                      maxWidth: 170,
                      padding: '4px 7px',
                      overflow: 'hidden',
                      color: 'var(--ink-soft)',
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-sm)',
                      fontSize: 10.5,
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ↺ {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <label style={{ display: 'block', marginTop: 12, fontSize: 11, color: 'var(--ink-mute)' }}>
            本轮目标
            <input
              aria-label="本轮目标"
              value={draft.goal}
              maxLength={240}
              onChange={(event) => onChange({ ...draft, goal: event.target.value })}
              placeholder="例如：识别当前方案的三项关键风险"
              style={{
                width: '100%',
                marginTop: 5,
                padding: '7px 9px',
                color: 'var(--ink)',
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </label>
          <label style={{ display: 'block', marginTop: 10, fontSize: 11, color: 'var(--ink-mute)' }}>
            明确约束（每行一项，最多 8 项）
            <textarea
              aria-label="本轮明确约束"
              value={draft.constraintsText}
              onChange={(event) => onChange({ ...draft, constraintsText: event.target.value })}
              placeholder={'例如：只分析，不修改项目内容\n控制在 500 字以内'}
              rows={3}
              style={{
                width: '100%',
                marginTop: 5,
                padding: '7px 9px',
                color: 'var(--ink)',
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                fontSize: 12,
                lineHeight: 1.5,
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
            {QUICK_CONSTRAINTS.map((constraint) => (
              <button
                key={constraint}
                type="button"
                onClick={() => addQuickConstraint(constraint)}
                style={{
                  padding: '3px 7px',
                  color: 'var(--ink-soft)',
                  background: 'var(--bg-tint)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 10.5,
                }}
              >
                + {constraint}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <button
              type="button"
              onClick={() => onChange(EMPTY_PROJECT_TURN_BRIEF)}
              disabled={!hasBrief}
              style={{ color: 'var(--ink-mute)', fontSize: 11, opacity: hasBrief ? 1 : 0.5 }}
            >
              清空
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '4px 12px',
                color: 'var(--bg-elev)',
                background: 'var(--accent)',
                borderRadius: 'var(--r-sm)',
                fontSize: 11.5,
              }}
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
