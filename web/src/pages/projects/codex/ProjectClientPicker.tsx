import { useEffect, useRef, useState } from 'react'

export interface ProjectClientOption {
  id: number
  name: string
}

interface ProjectClientPickerProps {
  value: string
  matched: ProjectClientOption | null
  suggestions: ProjectClientOption[]
  onChange: (value: string) => void
  onPick: (client: ProjectClientOption) => void
}

const INPUT_STYLE = {
  width: '100%',
  padding: '9px 12px',
  fontSize: 13.5,
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-sm)',
  color: 'var(--ink)',
  outline: 'none',
} as const

/** Client picker that only reports a stable id after an explicit selection. */
export function ProjectClientPicker({
  value,
  matched,
  suggestions,
  onChange,
  onPick,
}: ProjectClientPickerProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (matched) {
    return (
      <div
        style={{
          ...INPUT_STYLE,
          border: '1px solid var(--accent)',
          background: 'var(--accent-bg)',
          color: 'var(--accent-ink)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: 'var(--accent)',
              flexShrink: 0,
            }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {matched.name}
            <span
              style={{
                marginLeft: 8,
                color: 'var(--ink-faint)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
              }}
            >
              #{matched.id}
            </span>
          </span>
        </span>
        <button
          type="button"
          onClick={() => onChange('')}
          style={{
            fontSize: 11,
            color: 'var(--accent)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          更换
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="搜索现有客户,或直接填写新客户名称"
        className="codex-input"
        style={INPUT_STYLE}
      />
      {open && suggestions.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            padding: 4,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            boxShadow: '0 10px 28px -10px rgba(0,0,0,0.18)',
            listStyle: 'none',
            zIndex: 5,
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(client)
                  setOpen(false)
                }}
                className="row-hov"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 10px',
                  fontSize: 12.5,
                  color: 'var(--ink)',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 'var(--r-sm)',
                  cursor: 'pointer',
                }}
              >
                <span>{client.name}</span>
                <span
                  style={{
                    marginLeft: 8,
                    color: 'var(--ink-faint)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5,
                  }}
                >
                  #{client.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
