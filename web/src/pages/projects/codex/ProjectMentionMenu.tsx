import { CxIcon } from './CxIcons'
import {
  PROJECT_MENTION_KIND_LABEL,
  type ProjectMentionKind,
  type ProjectMentionOption,
} from './projectMentions'

const KIND_ICON: Record<ProjectMentionKind, string> = {
  skill: 'wrench',
  file: 'file',
  stakeholder: 'user',
  milestone: 'target',
}

export function ProjectMentionMenu({
  id,
  options,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: {
  id: string
  options: ProjectMentionOption[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onSelect: (option: ProjectMentionOption) => void
}) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label="选择 Skill 或项目对象"
      style={{
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: 'calc(100% + 8px)',
        maxHeight: 330,
        overflowY: 'auto',
        padding: 6,
        background: 'var(--bg-elev)',
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--r-md)',
        boxShadow: '0 20px 48px -20px rgba(0,0,0,0.5)',
        zIndex: 70,
      }}
    >
      {options.length === 0 ? (
        <div style={{ padding: '12px 10px', color: 'var(--ink-mute)', fontSize: 12 }}>
          没有匹配的 Skill 或项目对象
        </div>
      ) : (
        options.map((option, index) => {
          const active = index === activeIndex
          return (
            <button
              id={`${id}-option-${index}`}
              key={`${option.kind}:${option.id}`}
              type="button"
              role="option"
              aria-selected={active}
              onMouseEnter={() => onActiveIndexChange(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(option)
              }}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '24px minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: 8,
                padding: '8px 9px',
                color: 'var(--ink)',
                background: active ? 'var(--bg-tint)' : 'transparent',
                border: 0,
                borderRadius: 'var(--r-sm)',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: active ? 'var(--accent)' : 'var(--ink-mute)',
                  background: active ? 'var(--accent-bg)' : 'var(--bg-soft)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                <CxIcon name={KIND_ICON[option.kind]} size={12} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12.5,
                    fontWeight: 500,
                  }}
                >
                  {option.label}
                </span>
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--ink-mute)',
                    fontSize: 10.5,
                  }}
                >
                  {option.description}
                </span>
              </span>
              <span style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>
                {PROJECT_MENTION_KIND_LABEL[option.kind]}
              </span>
            </button>
          )
        })
      )}
      <div
        style={{
          margin: '5px 8px 1px',
          paddingTop: 6,
          color: 'var(--ink-faint)',
          borderTop: '1px solid var(--line-soft)',
          fontSize: 10.5,
        }}
      >
        ↑↓ 选择 · Enter 确认 · Esc 关闭
      </div>
    </div>
  )
}
