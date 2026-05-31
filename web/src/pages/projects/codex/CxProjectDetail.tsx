import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { CxSkeleton } from '../../../components/codex'
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
    return <DetailSkeleton />
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
          background: 'var(--color-codex-bg)',
          color: 'var(--color-codex-bad)',
          fontSize: 13,
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span>{error || '项目不存在'}</span>
        <a href="/projects" style={{ fontSize: 12, color: 'var(--color-codex-accent)' }}>
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

/** Detail skeleton — mirrors the real CxProjectShell layout: 56px top
 * bar + 1fr / 320px grid for overview. Keeps the user oriented before
 * the fetch completes so the screen doesn't appear blank. */
function DetailSkeleton() {
  return (
    <div
      className="theme-codex"
      aria-busy="true"
      aria-label="加载项目中"
      style={{
        height: '100%',
        background: 'var(--color-codex-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: '0 28px',
          borderBottom: '1px solid var(--color-codex-line)',
          display: 'flex',
          alignItems: 'center',
          height: 56,
          gap: 14,
          flexShrink: 0,
        }}
      >
        <CxSkeleton w={36} h={14} />
        <span style={{ width: 1, height: 22, background: 'var(--color-codex-line)' }} />
        <CxSkeleton w={26} h={26} radius={6} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <CxSkeleton w={220} h={11} />
          <CxSkeleton w={140} h={9} />
        </div>
        <div style={{ display: 'flex', gap: 18, marginLeft: 28 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <CxSkeleton key={i} w={48} h={11} />
          ))}
        </div>
      </header>
      <div
        style={{
          flex: 1,
          padding: '24px 40px 32px',
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 20,
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SkeletonPanel lines={4} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <SkeletonPanel lines={4} />
            <SkeletonPanel lines={4} />
          </div>
          <SkeletonPanel lines={5} />
        </div>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SkeletonPanel lines={6} />
          <SkeletonPanel lines={3} />
        </aside>
      </div>
    </div>
  )
}

function SkeletonPanel({ lines }: { lines: number }) {
  return (
    <section
      style={{
        background: 'var(--color-codex-bg-elev)',
        border: '1px solid var(--color-codex-line)',
        borderRadius: 'var(--codex-r-md)',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <CxSkeleton w={140} h={12} />
      <CxSkeleton w={80} h={9} />
      <div style={{ height: 6 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <CxSkeleton key={i} w={`${65 + ((i * 11) % 30)}%`} h={11} />
      ))}
    </section>
  )
}
