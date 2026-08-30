import type { ProjectRecoveryCenter as RecoveryCenterPayload, ProjectRecoveryCenterItem } from '../../../types/api'
import { CxSkeleton } from '../../../components/codex'
import { formatUpdatedRelative } from './useProjectsApi'

const REASON_LABELS: Record<string, string> = {
  worker_lost: '执行进程失联',
  timeout: '执行超时',
  provider_failure: '模型服务中断',
  user_cancelled: '已由用户停止',
  worker_interrupted: '执行被中断',
  runtime_failure: '运行失败',
}

const STATE_COPY: Record<ProjectRecoveryCenterItem['recovery_state'], { label: string; color: string }> = {
  ready: { label: '待核对', color: 'var(--warn)' },
  continued: { label: '已继续', color: 'var(--good)' },
  projection_missing: { label: '需新开一轮', color: 'var(--ink-mute)' },
}

interface ProjectRecoveryCenterProps {
  data: RecoveryCenterPayload | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onOpen: (item: ProjectRecoveryCenterItem) => void
}

export function ProjectRecoveryCenter({
  data,
  loading,
  error,
  onRefresh,
  onOpen,
}: ProjectRecoveryCenterProps) {
  return (
    <section
      aria-label="项目运行恢复中心"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '12px 12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--ink)', fontSize: 12.5, fontWeight: 600 }}>运行恢复</div>
          <div style={{ marginTop: 2, color: 'var(--ink-faint)', fontSize: 10.5, lineHeight: 1.5 }}>
            找回中断轮次，继续前仍会重新核对项目状态与副作用。
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          style={{
            padding: '4px 7px',
            color: 'var(--ink-mute)',
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            fontSize: 10.5,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      {data && (
        <div
          aria-label="恢复概览"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 5,
          }}
        >
          <RecoveryMetric label="待核对" value={data.summary.ready_count} tone="var(--warn)" />
          <RecoveryMetric label="未应用追问" value={data.summary.unapplied_input_count} tone="var(--accent)" />
          <RecoveryMetric label="已继续" value={data.summary.continued_count} tone="var(--good)" />
        </div>
      )}

      {loading && data == null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 3 }).map((_, index) => (
            <CxSkeleton key={index} w="100%" h={106} radius={8} />
          ))}
        </div>
      )}
      {error && data == null && (
        <div style={{ padding: '14px 4px', color: 'var(--bad)', fontSize: 11.5 }}>{error}</div>
      )}
      {data && data.items.length === 0 && (
        <div
          style={{
            padding: '28px 12px',
            textAlign: 'center',
            color: 'var(--ink-faint)',
            fontSize: 11.5,
            lineHeight: 1.6,
            border: '1px dashed var(--line)',
            borderRadius: 'var(--r-md)',
          }}
        >
          当前没有中断或失败的运行。
        </div>
      )}

      {data?.items.map((item) => {
        const state = STATE_COPY[item.recovery_state]
        return (
          <article
            key={item.run_id}
            style={{
              padding: 10,
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
              <div
                title={item.conversation_title}
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--ink)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {item.conversation_title || '未命名对话'}
              </div>
              <span style={{ color: state.color, fontSize: 10.5, whiteSpace: 'nowrap' }}>{state.label}</span>
            </div>
            <div style={{ marginTop: 6, color: 'var(--ink-mute)', fontSize: 10.5, lineHeight: 1.55 }}>
              {REASON_LABELS[item.reason.category] || '运行未完成'} · {formatUpdatedRelative(item.updated_at)}
            </div>
            <div style={{ marginTop: 2, color: 'var(--ink-faint)', fontSize: 10, lineHeight: 1.5 }}>
              {item.recovery_state === 'ready' && '已保存安全检查点，可打开核对后作为新轮次继续。'}
              {item.recovery_state === 'continued' && `后续运行 ${item.child_run?.status || '已创建'}，不会重复执行原恢复。`}
              {item.recovery_state === 'projection_missing' && '缺少可验证的助手消息，请在会话中重新说明未完成部分。'}
            </div>
            {item.unapplied_input_count > 0 && (
              <div
                style={{
                  display: 'inline-flex',
                  marginTop: 7,
                  padding: '2px 6px',
                  color: 'var(--accent-ink)',
                  background: 'var(--accent-bg)',
                  borderRadius: 99,
                  fontSize: 10,
                }}
              >
                {item.unapplied_input_count} 条运行中追问尚未应用
              </div>
            )}
            <button
              type="button"
              onClick={() => onOpen(item)}
              style={{
                width: '100%',
                marginTop: 8,
                padding: '5px 8px',
                color: item.recovery_state === 'ready' ? 'var(--accent-ink)' : 'var(--ink-soft)',
                background: item.recovery_state === 'ready' ? 'var(--accent-bg)' : 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                fontSize: 10.5,
                cursor: 'pointer',
              }}
            >
              {item.recovery_state === 'ready' ? '打开并核对' : '打开会话'}
            </button>
          </article>
        )
      })}

      {data?.summary.truncated && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 10, textAlign: 'center' }}>
          仅显示最近 {data.summary.returned_count} 条运行记录
        </div>
      )}
      {data && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 9.5, lineHeight: 1.5 }}>
          此视图不读取消息正文、提示词或工作进程凭证。
        </div>
      )}
    </section>
  )
}

function RecoveryMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div style={{ padding: '7px 5px', textAlign: 'center', background: 'var(--bg-tint)', borderRadius: 'var(--r-sm)' }}>
      <div className="num" style={{ color: tone, fontSize: 14, fontWeight: 600 }}>{value}</div>
      <div style={{ marginTop: 1, color: 'var(--ink-faint)', fontSize: 9.5 }}>{label}</div>
    </div>
  )
}
