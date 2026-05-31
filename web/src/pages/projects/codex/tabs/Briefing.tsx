import type { ProjectDetail as ProjectDetailType } from '../../../../types/api'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel } from '../CxPrimitives'
import { formatUpdatedRelative } from '../useProjectsApi'

interface BriefingProps {
  projectId: number
  detail: ProjectDetailType
}

export function CxProjectBriefing({ projectId, detail }: BriefingProps) {
  const { project } = detail
  return (
    <CxProjectShell activeTab="briefing" projectId={projectId} project={project}>
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
          <div
            style={{
              background: 'linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '20px 24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 6 }}>
                  会前简报 · 自动生成 30 秒会前卡
                </div>
                <h2
                  className="ui"
                  style={{
                    margin: 0,
                    fontSize: 22,
                    fontWeight: 500,
                    color: 'var(--ink)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  尚未生成本次简报
                </h2>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-soft)' }}>
                  基于项目记忆 + 客户记忆 + 最近会议纪要,自动产出四张卡片(说什么、避开什么、确认什么、历史经验)与开场话术。
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={{
                    padding: '7px 12px',
                    fontSize: 12.5,
                    background: 'var(--ink)',
                    color: 'var(--bg-elev)',
                    borderRadius: 'var(--r-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <CxIcon name="sparkle" size={12} /> 生成简报
                </button>
              </div>
            </div>
          </div>

          <CxPanel title="为什么这里没有内容?" subtitle="生成条件">
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 13,
                color: 'var(--ink-soft)',
                lineHeight: 1.85,
              }}
            >
              <li>
                项目记忆需有至少 1 个槽位 — 当前
                {project.memory_version != null
                  ? ` 版本 v${project.memory_version}(${
                      project.memory_stale ? '需刷新' : '已同步'
                    })`
                  : ' 尚未建立'}
              </li>
              <li>需关联客户记忆,以引入决策链 / 偏好</li>
              <li>建议先在「项目对话」中讨论几轮,系统会自动抽取要点</li>
            </ul>
          </CxPanel>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel title="资料依据" subtitle="生成时将引用">
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--ink-soft)',
                lineHeight: 1.85,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>项目记忆</span>
                <span className="num">
                  {project.memory_version != null ? `v${project.memory_version}` : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>记忆刷新</span>
                <span className="num">{formatUpdatedRelative(project.memory_updated_at)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>项目文档</span>
                <span className="num">{detail.files.filter((f) => !f.deleted_at).length} 份</span>
              </div>
            </div>
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  )
}
