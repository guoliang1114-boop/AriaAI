import { CxIcon } from './CxIcons'
import type { PendingActionBatch } from './usePendingActions'
import type { PendingToolAction } from '../../../types/api'

/** HITAS Action Preview — the confirm/reject card for high-risk tool
 * actions the backend paused. One card per approval batch; confirming
 * executes the batch's frozen tools in sequence on the backend. */

interface ChatActionPreviewProps {
  batches: PendingActionBatch[]
  actingKey: string | null
  onConfirm: (batch: PendingActionBatch) => void
  onReject: (batch: PendingActionBatch) => void
}

function batchKey(batch: PendingActionBatch): string {
  return batch.batchId || `single:${batch.actions[0]?.id}`
}

function actionIcon(action: PendingToolAction): 'trash' | 'edit' | 'wrench' {
  const t = `${action.action_type} ${action.tool_name}`.toLowerCase()
  if (t.includes('delete') || t.includes('trash') || t.includes('remove')) return 'trash'
  if (t.includes('modify') || t.includes('edit') || t.includes('update') || t.includes('write')) return 'edit'
  return 'wrench'
}

function isDestructive(action: PendingToolAction): boolean {
  const t = `${action.risk_level} ${action.action_type} ${action.tool_name}`.toLowerCase()
  return t.includes('high') || t.includes('delete') || t.includes('destructive') || t.includes('trash')
}

export function ChatActionPreview({ batches, actingKey, onConfirm, onReject }: ChatActionPreviewProps) {
  if (batches.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
      {batches.map((batch) => {
        const key = batchKey(batch)
        const busy = actingKey === key
        const acting = actingKey != null
        const danger = batch.actions.some(isDestructive)
        const accent = danger ? 'var(--bad)' : 'var(--accent)'
        const tint = danger ? 'color-mix(in oklch, var(--bad) 8%, transparent)' : 'var(--accent-bg)'
        const multi = batch.actions.length > 1
        return (
          <div
            key={key}
            style={{
              border: `1px solid ${danger ? 'color-mix(in oklch, var(--bad) 35%, transparent)' : 'color-mix(in oklch, var(--accent) 30%, transparent)'}`,
              background: tint,
              borderRadius: 'var(--r-md)',
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 'var(--r-sm)',
                  background: danger ? 'color-mix(in oklch, var(--bad) 16%, transparent)' : 'var(--accent-bg)',
                  color: accent,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <CxIcon name={actionIcon(batch.actions[0])} size={13} />
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                {multi ? `需要确认 ${batch.actions.length} 个操作` : batch.actions[0].title || '需要确认操作'}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 10.5,
                  color: accent,
                  background: danger ? 'color-mix(in oklch, var(--bad) 14%, transparent)' : 'var(--accent-bg)',
                  padding: '2px 7px',
                  borderRadius: 'var(--r-pill)',
                  fontWeight: 500,
                }}
              >
                {danger ? '高风险' : '需确认'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {batch.actions.map((action, i) => (
                <div key={action.id} style={{ display: 'flex', gap: 8 }}>
                  {multi && (
                    <span className="num" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>
                      {i + 1}.
                    </span>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {(multi || !action.title) && (
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>
                        {action.title || action.tool_name}
                      </div>
                    )}
                    {action.description && (
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.6, marginTop: 1 }}>
                        {action.description}
                      </div>
                    )}
                    {action.details?.length > 0 && (
                      <ul
                        style={{
                          margin: '4px 0 0',
                          paddingLeft: 16,
                          fontSize: 11.5,
                          color: 'var(--ink-mute)',
                          lineHeight: 1.6,
                        }}
                      >
                        {action.details.map((d, di) => (
                          <li key={di}>{d}</li>
                        ))}
                      </ul>
                    )}
                    <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 3 }}>
                      <span className="num">{action.tool_name}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => onReject(batch)}
                disabled={acting}
                style={{
                  padding: '6px 14px',
                  fontSize: 12.5,
                  color: 'var(--ink-soft)',
                  background: 'transparent',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                  cursor: acting ? 'not-allowed' : 'pointer',
                  opacity: acting && !busy ? 0.5 : 1,
                }}
              >
                {busy ? '处理中…' : '取消'}
              </button>
              <button
                type="button"
                onClick={() => onConfirm(batch)}
                disabled={acting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: danger ? '#fff' : 'var(--accent-ink)',
                  background: danger ? 'var(--bad)' : 'var(--accent-bg)',
                  border: `1px solid ${danger ? 'var(--bad)' : 'color-mix(in oklch, var(--accent) 30%, transparent)'}`,
                  borderRadius: 'var(--r-sm)',
                  cursor: acting ? 'not-allowed' : 'pointer',
                  opacity: acting && !busy ? 0.5 : 1,
                }}
              >
                <CxIcon name="check" size={13} />
                {busy ? '执行中…' : multi ? '全部确认执行' : '确认执行'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
