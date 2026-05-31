import type { ProjectDetail as ProjectDetailType } from '../../../../types/api'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel } from '../CxPrimitives'
import { firstGlyph } from '../useProjectsApi'

interface StakeholdersProps {
  projectId: number
  detail: ProjectDetailType
}

export function CxProjectStakeholders({ projectId, detail }: StakeholdersProps) {
  const { project, members } = detail

  return (
    <CxProjectShell activeTab="stakeholders" projectId={projectId} project={project}>
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '24px 40px 32px',
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 20,
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <h2
                className="ui"
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 500,
                  color: 'var(--ink)',
                  letterSpacing: '-0.015em',
                }}
              >
                项目成员 · {members.length} 人
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-mute)' }}>
                客户侧关键干系人将在「客户记忆」中维护后自动汇入此处
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  background: 'var(--ink)',
                  color: 'var(--bg-elev)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                + 邀请成员
              </button>
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              overflow: 'hidden',
            }}
          >
            {members.length === 0 ? (
              <div
                style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  fontSize: 13,
                  color: 'var(--ink-faint)',
                }}
              >
                还没有邀请成员。
              </div>
            ) : (
              members.map((m, i) => (
                <div
                  key={m.id}
                  className="row-hov"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.4fr 1fr 1fr 120px',
                    padding: '14px 16px',
                    gap: 12,
                    alignItems: 'center',
                    borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 99,
                        background: 'var(--accent-bg)',
                        color: 'var(--accent-ink)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      {firstGlyph(m.user.display_name)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                        {m.user.display_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                        ID {m.user_id}
                      </div>
                    </div>
                  </div>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                    {m.role ?? 'member'}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                    加入于 {m.created_at?.slice(0, 10) ?? '—'}
                  </span>
                  <button
                    type="button"
                    style={{
                      fontSize: 11.5,
                      color: 'var(--ink-mute)',
                      justifySelf: 'end',
                    }}
                  >
                    管理
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel title="客户侧干系人" subtitle="客户记忆联动">
            <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
              客户侧干系人将在客户档案的「客户记忆」中维护,
              <a href="/clients" style={{ color: 'var(--accent)' }}>
                前往客户空间补齐 →
              </a>
            </div>
          </CxPanel>

          <CxPanel title="决策结构" subtitle="基于客户记忆">
            <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 0' }}>
              建立客户记忆后,此处将自动列出最终决策、预算审批与推动方。
            </div>
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  )
}
