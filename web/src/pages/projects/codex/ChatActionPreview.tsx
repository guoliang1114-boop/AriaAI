import { CxIcon } from './CxIcons'
import type { PendingActionBatch } from './usePendingActions'
import type { PendingToolAction } from '../../../types/api'

/** HITAS Action Preview — the confirm/reject card for high-risk tool
 * actions the backend paused ("Human-in-the-loop tool approval"). One
 * card per approval batch; confirming runs the batch's frozen tools in
 * sequence on the backend, which writes a result message.
 *
 * Visual language follows the reference design: a warm "等待确认" header
 * with the tool name tag, a title + description body, a key/value preview
 * box built from the action's ``details``, and an approve/reject footer. */

interface ChatActionPreviewProps {
  batches: PendingActionBatch[]
  actingKey: string | null
  onConfirm: (batch: PendingActionBatch) => void
  onReject: (batch: PendingActionBatch) => void
}

function batchKey(batch: PendingActionBatch): string {
  return batch.batchId || `single:${batch.actions[0]?.id}`
}

/** Backend ``details`` are mostly "键：值" strings — split so they render
 * in the key/value preview grid; fall back to a full-width row. */
function splitDetail(detail: string): { k: string; v: string } | { full: string } {
  const m = /^(.+?)[：:]\s*(.+)$/.exec(detail.trim())
  if (m && m[1].length <= 10) return { k: m[1], v: m[2] }
  return { full: detail }
}

const WARN_TINT = 'color-mix(in oklch, var(--warn) 14%, var(--bg-elev))'

export function ChatActionPreview({ batches, actingKey, onConfirm, onReject }: ChatActionPreviewProps) {
  if (batches.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
      {batches.map((batch) => {
        const key = batchKey(batch)
        const busy = actingKey === key
        const acting = actingKey != null
        const multi = batch.actions.length > 1
        const tag = multi ? `共 ${batch.actions.length} 项` : batch.actions[0]?.tool_name
        return (
          <div
            key={key}
            style={{
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--r-md)',
              background: 'var(--bg-elev)',
              maxWidth: 580,
              overflow: 'hidden',
              boxShadow: '0 1px 2px oklch(0.4 0.02 75 / 0.04)',
            }}
          >
            {/* header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '9px 16px',
                background: WARN_TINT,
                borderBottom: '1px solid var(--line)',
                fontSize: 12,
                color: 'var(--warn)',
                fontWeight: 500,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: 'currentColor',
                  flexShrink: 0,
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              />
              等待确认 · 执行前需要你批准
              <span
                className="num"
                style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-faint)', fontWeight: 400 }}
              >
                {tag}
              </span>
            </div>

            {/* body */}
            <div style={{ padding: '15px 16px 4px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {batch.actions.map((action, i) => (
                <ActionBody key={action.id} action={action} index={multi ? i + 1 : undefined} />
              ))}
            </div>

            {/* footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '13px 16px',
                marginTop: 14,
                borderTop: '1px solid var(--line-soft)',
              }}
            >
              <button
                type="button"
                onClick={() => onConfirm(batch)}
                disabled={acting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 15px',
                  background: 'var(--accent)',
                  color: 'var(--bg-elev)',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: acting ? 'not-allowed' : 'pointer',
                  opacity: acting && !busy ? 0.5 : 1,
                }}
              >
                <CxIcon name="check" size={13} stroke={2} />
                {busy ? '执行中…' : multi ? '全部确认执行' : '确认执行'}
              </button>
              <button
                type="button"
                onClick={() => onReject(batch)}
                disabled={acting}
                style={{
                  padding: '7px 12px',
                  fontSize: 13,
                  color: 'var(--ink-mute)',
                  background: 'transparent',
                  border: 'none',
                  cursor: acting ? 'not-allowed' : 'pointer',
                  opacity: acting ? 0.5 : 1,
                }}
              >
                拒绝
              </button>
              <span
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11.5,
                  color: 'var(--ink-faint)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                确认后将立即执行此操作
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ActionBody({ action, index }: { action: PendingToolAction; index?: number }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
        {index != null && <span className="num" style={{ color: 'var(--ink-mute)', marginRight: 6 }}>{index}.</span>}
        {action.title || action.tool_name}
      </div>
      {action.description && (
        <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.7, marginTop: 6 }}>
          {action.description}
        </div>
      )}
      {(action.details?.length ?? 0) > 0 && (
        <div
          style={{
            marginTop: 14,
            border: '1px solid var(--line-soft)',
            borderRadius: 'var(--r-sm)',
            background: 'var(--bg-sunken)',
            padding: '12px 14px',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            rowGap: 9,
            columnGap: 20,
            fontSize: 13,
            alignItems: 'baseline',
          }}
        >
          {action.details.map((detail, di) => {
            const parsed = splitDetail(detail)
            if ('full' in parsed) {
              return (
                <div key={di} style={{ gridColumn: '1 / -1', color: 'var(--ink)', lineHeight: 1.5 }}>
                  {parsed.full}
                </div>
              )
            }
            return (
              <div key={di} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--ink-mute)', fontSize: 12 }}>{parsed.k}</span>
                <span style={{ color: 'var(--ink)', lineHeight: 1.5 }}>{parsed.v}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
