import type { ProjectDetail as ProjectDetailType } from '../../../../types/api'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'

interface ChatProps {
  projectId: number
  detail: ProjectDetailType
}

export function CxProjectChat({ projectId, detail }: ChatProps) {
  const { project } = detail
  // The legacy /chat experience lives at its own top-level route. This
  // tab is the entry-point card; live data wiring (conversation list +
  // thread) will be a follow-up.
  return (
    <CxProjectShell activeTab="chat" projectId={projectId} project={project}>
      <div
        style={{
          flex: 1,
          padding: '24px 40px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 0,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            textAlign: 'center',
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: '40px 32px',
          }}
        >
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--r-md)',
              background: 'var(--accent-bg)',
              color: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <CxIcon name="chat" size={20} />
          </span>
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
            项目对话
          </h2>
          <p
            style={{
              margin: '8px 0 20px',
              fontSize: 13,
              color: 'var(--ink-soft)',
              lineHeight: 1.7,
            }}
          >
            围绕「{project.name}」与 Aria 对话,自动沉淀到项目记忆。新版项目内对话视图即将上线;
            目前请前往全局对话页。
          </p>
          <a
            href={`/chat?project=${projectId}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 16px',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--bg-elev)',
              background: 'var(--ink)',
              borderRadius: 'var(--r-sm)',
              textDecoration: 'none',
            }}
          >
            前往对话 <CxIcon name="arrow-right" size={12} />
          </a>
        </div>
      </div>
    </CxProjectShell>
  )
}
