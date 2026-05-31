import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { CxProjectOverview } from './tabs/Overview'
import { CxProjectChat } from './tabs/Chat'
import { CxProjectBriefing } from './tabs/Briefing'
import { CxProjectMemory } from './tabs/Memory'
import { CxProjectStakeholders } from './tabs/Stakeholders'
import { CxProjectMilestones } from './tabs/Milestones'
import { CxProjectFinance } from './tabs/Finance'
import { CxProjectDocs } from './tabs/Docs'

/**
 * Project-detail tab router. Mounted under /projects/:id/* in
 * App.tsx. Each tab owns its own page chrome (CxProjectShell) so the
 * top tab bar stays consistent across tabs without a shared layout
 * route.
 */
export function CxProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? 'DH-2026-001'

  return (
    <div
      className="theme-codex"
      style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<CxProjectOverview projectId={projectId} />} />
        <Route path="chat" element={<CxProjectChat projectId={projectId} />} />
        <Route path="briefing" element={<CxProjectBriefing projectId={projectId} />} />
        <Route path="memory" element={<CxProjectMemory projectId={projectId} />} />
        <Route path="stakeholders" element={<CxProjectStakeholders projectId={projectId} />} />
        <Route path="milestones" element={<CxProjectMilestones projectId={projectId} />} />
        <Route path="finance" element={<CxProjectFinance projectId={projectId} />} />
        <Route path="docs" element={<CxProjectDocs projectId={projectId} />} />
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Routes>
    </div>
  )
}
