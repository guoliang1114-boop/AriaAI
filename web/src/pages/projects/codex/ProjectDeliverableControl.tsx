import { useEffect, useRef, useState } from 'react'
import { api } from '../../../api/client'
import type {
  SkillDeliverableCatalog,
  SkillDeliverableCatalogItem,
  SkillDeliverableSelectionInput,
} from '../../../types/api'
import { CxIcon } from './CxIcons'

export interface ProjectDeliverableSelection {
  skillId: number
  input: SkillDeliverableSelectionInput
  item: SkillDeliverableCatalogItem
}

interface ProjectDeliverableControlProps {
  projectId: number
  skillId: number
  skillName: string
  selection: ProjectDeliverableSelection | null
  onChange: (selection: ProjectDeliverableSelection | null) => void
  disabled?: boolean
}

interface CatalogState {
  skillId: number
  catalog: SkillDeliverableCatalog | null
  error: string
}

export function ProjectDeliverableControl({
  projectId,
  skillId,
  skillName,
  selection,
  onChange,
  disabled = false,
}: ProjectDeliverableControlProps) {
  const [open, setOpen] = useState(false)
  const [catalogState, setCatalogState] = useState<CatalogState>({
    skillId: 0,
    catalog: null,
    error: '',
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const catalog = catalogState.skillId === skillId ? catalogState.catalog : null
  const error = catalogState.skillId === skillId ? catalogState.error : ''
  const loading = catalogState.skillId !== skillId

  useEffect(() => {
    let active = true
    void api.get<SkillDeliverableCatalog>(`/skills/${skillId}/deliverables`, {
      params: { project_id: projectId },
    })
      .then((nextCatalog) => {
        if (active) setCatalogState({ skillId, catalog: nextCatalog, error: '' })
      })
      .catch((err) => {
        if (active) {
          setCatalogState({
            skillId,
            catalog: null,
            error: err instanceof Error ? err.message : '交付物目录加载失败',
          })
        }
      })
    return () => {
      active = false
    }
  }, [projectId, skillId])

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

  const choose = (item: SkillDeliverableCatalogItem | null) => {
    if (!item || !catalog) {
      onChange(null)
    } else {
      onChange({
        skillId,
        input: {
          deliverable_id: item.deliverable_id,
          catalog_sha256: catalog.catalog_sha256,
          contract_sha256: item.contract_sha256,
        },
        item,
      })
    }
    setOpen(false)
  }

  const label = selection?.skillId === skillId
    ? selection.item.name
    : loading
      ? '加载交付物…'
      : '选择交付物'

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={`交付物控制：${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || loading || Boolean(error) || !catalog?.items.length}
        title={error || `从 ${skillName} 的固定发布目录中选择本轮交付物`}
        onClick={() => setOpen((current) => !current)}
        style={{
          height: 28,
          maxWidth: 240,
          padding: '0 9px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: selection ? 'var(--accent)' : error ? 'var(--warn)' : 'var(--ink-mute)',
          background: selection ? 'var(--accent-bg)' : 'transparent',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)',
          fontSize: 11.5,
          cursor: disabled || loading || error ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <CxIcon name="file" size={12} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {error ? '目录不可用' : label}
        </span>
        {!error && <CxIcon name="chevron-down" size={10} />}
      </button>

      {open && catalog && (
        <div
          role="menu"
          aria-label={`选择 ${skillName} 本轮交付物`}
          style={{
            position: 'absolute',
            left: 0,
            bottom: 'calc(100% + 7px)',
            width: 390,
            maxHeight: 410,
            overflow: 'auto',
            padding: 6,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 18px 44px -18px rgba(0,0,0,0.5)',
            zIndex: 61,
          }}
        >
          <DeliverableOption
            label="由 Skill 自动决定"
            description="不固定具体资产，由本轮问题和 Skill 指令决定输出。"
            selected={selection == null}
            onClick={() => choose(null)}
          />
          {catalog.items.map((item) => (
            <DeliverableOption
              key={item.deliverable_id}
              label={item.name}
              description={`${item.when_to_use} · ${item.format_label}`}
              selected={selection?.item.deliverable_id === item.deliverable_id}
              onClick={() => choose(item)}
            />
          ))}
          <div style={{ margin: '6px 9px 2px', color: 'var(--ink-faint)', fontSize: 10 }}>
            目录绑定 Skill 发布 {catalog.skill_release_sha256.slice(0, 8) || '未记录'}；保存和业务验收仍需单独确认。
          </div>
        </div>
      )}
    </div>
  )
}

function DeliverableOption({
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
