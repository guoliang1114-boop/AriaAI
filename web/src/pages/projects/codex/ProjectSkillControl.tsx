import { useEffect, useRef, useState } from 'react'
import type { SkillSummary } from '../../../types/api'
import { CxIcon } from './CxIcons'

export type ProjectSkillSelection =
  | { mode: 'auto' }
  | { mode: 'off' }
  | { mode: 'explicit'; skillId: number; name: string }

interface ProjectSkillControlProps {
  skills: SkillSummary[]
  selection: ProjectSkillSelection
  onChange: (selection: ProjectSkillSelection) => void
  disabled?: boolean
}

export function ProjectSkillControl({
  skills,
  selection,
  onChange,
  disabled = false,
}: ProjectSkillControlProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

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

  const choose = (next: ProjectSkillSelection) => {
    onChange(next)
    setOpen(false)
  }
  const label = selection.mode === 'explicit'
    ? selection.name
    : selection.mode === 'off'
      ? '本轮不用 Skill'
      : 'Skill 自动匹配'

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={`Skill 控制：${label}`}
        aria-haspopup="menu"
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
          color: selection.mode === 'auto' ? 'var(--ink-mute)' : 'var(--accent)',
          background: selection.mode === 'auto' ? 'transparent' : 'var(--accent-bg)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)',
          fontSize: 11.5,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <CxIcon name="wrench" size={12} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <CxIcon name="chevron-down" size={10} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="选择本轮 Skill"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 'calc(100% + 7px)',
            width: 330,
            maxHeight: 360,
            overflow: 'auto',
            padding: 6,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 18px 44px -18px rgba(0,0,0,0.5)',
            zIndex: 60,
          }}
        >
          <SkillControlOption
            label="自动匹配"
            description="由本轮问题决定是否启用专业 Skill。"
            selected={selection.mode === 'auto'}
            onClick={() => choose({ mode: 'auto' })}
          />
          <SkillControlOption
            label="本轮不用 Skill"
            description="按普通项目对话回答，并释放上轮 Skill。"
            selected={selection.mode === 'off'}
            onClick={() => choose({ mode: 'off' })}
          />
          {skills.length > 0 && (
            <div
              style={{
                margin: '6px 8px 4px',
                paddingTop: 7,
                borderTop: '1px solid var(--line-soft)',
                color: 'var(--ink-faint)',
                fontSize: 10.5,
              }}
            >
              明确指定下一轮
            </div>
          )}
          {skills.map((skill) => (
            <SkillControlOption
              key={skill.id}
              label={skill.name}
              description={`${skill.description || skill.category}${skill.package_version ? ` · v${skill.package_version}` : ''}${skill.package_status && skill.package_status !== 'stable' ? ` · ${skill.package_status}` : ''}`}
              selected={selection.mode === 'explicit' && selection.skillId === skill.id}
              onClick={() => choose({ mode: 'explicit', skillId: skill.id, name: skill.name })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SkillControlOption({
  label,
  description,
  selected,
  onClick,
}: {
  label: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      style={{
        width: '100%',
        padding: '8px 9px',
        display: 'grid',
        gridTemplateColumns: '16px minmax(0, 1fr)',
        gap: 7,
        color: 'var(--ink)',
        background: selected ? 'var(--bg-tint)' : 'transparent',
        border: 0,
        borderRadius: 'var(--r-sm)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ color: selected ? 'var(--accent)' : 'transparent', paddingTop: 1 }}>
        <CxIcon name="check" size={12} stroke={1.8} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>{label}</span>
        <span
          style={{
            display: '-webkit-box',
            marginTop: 2,
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            color: 'var(--ink-mute)',
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          {description}
        </span>
      </span>
    </button>
  )
}
