import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/** One quiet entry point for optional receipts. Never wrap approvals or errors. */
export function AnswerDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div style={{ marginTop: 8, flexBasis: open ? '100%' : undefined, minWidth: 0 }}>
    <button type="button" aria-label="查看回答详情" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}
      className="inline-flex items-center gap-1 rounded px-1 py-1 focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ fontSize: 12, color: 'var(--color-codex-ink-mute)' }}>
      <ChevronDown size={13} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      {open ? '收起详情' : '详情'}
    </button>
    <div id={id} hidden={!open}>
      {open && <div role="region" aria-label="回答详情"
        style={{ padding: '8px 12px', marginTop: 4, borderLeft: '2px solid var(--color-codex-line)', overflowWrap: 'anywhere' }}>
        {children}
      </div>}
    </div>
  </div>
}
