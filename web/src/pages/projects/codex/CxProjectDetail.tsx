import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useProjectDetail } from './useProjectsApi'
import { CxProjectOverview } from './tabs/Overview'
import { CxProjectChat } from './tabs/Chat'
import { CxProjectBriefing } from './tabs/Briefing'
import { CxProjectMemory } from './tabs/Memory'
import { CxProjectStakeholders } from './tabs/Stakeholders'
import { CxProjectMilestones } from './tabs/Milestones'
import { CxProjectFinance } from './tabs/Finance'
import { CxProjectDocs } from './tabs/Docs'

/**
 * Project-detail tab router. Fetches the aggregated /projects/:id/detail
 * once and threads it into every tab so switching tabs is a render, not
 * a re-fetch.
 */
export function CxProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const projectIdNum = id ? Number(id) : NaN
  const { data: detail, loading, error } = useProjectDetail(
    Number.isNaN(projectIdNum) ? null : projectIdNum,
  )

  if (loading) {
    return (
      <div
        className="theme-codex"
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          color: 'var(--ink-mute)',
          fontSize: 13,
        }}
      >
        正在加载项目…
      </div>
    )
  }
  if (error || !detail) {
    return (
      <div
        className="theme-codex"
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          color: 'var(--bad)',
          fontSize: 13,
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span>{error || '项目不存在'}</span>
        <a href="/projects" style={{ fontSize: 12, color: 'var(--accent)' }}>
          ← 返回项目空间
        </a>
      </div>
    )
  }

  const tabProps = { projectId: detail.project.id, detail }

  return (
    <div
      className="theme-codex"
      style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<CxProjectOverview {...tabProps} />} />
        <Route path="chat" element={<CxProjectChat {...tabProps} />} />
        <Route path="briefing" element={<CxProjectBriefing {...tabProps} />} />
        <Route path="memory" element={<CxProjectMemory {...tabProps} />} />
        <Route path="stakeholders" element={<CxProjectStakeholders {...tabProps} />} />
        <Route path="milestones" element={<CxProjectMilestones {...tabProps} />} />
        <Route path="finance" element={<CxProjectFinance {...tabProps} />} />
        <Route path="docs" element={<CxProjectDocs {...tabProps} />} />
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Routes>
    </div>
  )
}
