import { useEffect, useState } from 'react'
import { api } from '../../../api/client'
import type {
  ArtifactAcceptanceProjection,
  ArtifactKnowledgeArchive,
  KnowledgeSourceSummary,
} from '../../../types/api'
import { CxIcon } from './CxIcons'

interface Props {
  artifactId: number
  contentSha256: string
}

interface LoadState {
  artifactId: number
  sources: KnowledgeSourceSummary[]
  archives: ArtifactKnowledgeArchive[]
  acceptance: ArtifactAcceptanceProjection | null
  error: string
}

export function ArtifactKnowledgeArchiveControl({ artifactId, contentSha256 }: Props) {
  const [open, setOpen] = useState(false)
  const [loadState, setLoadState] = useState<LoadState | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const current = loadState?.artifactId === artifactId ? loadState : null
  const loading = open && current == null
  const writableSources = (current?.sources ?? []).filter(
    (source) => source.status === 'active' && source.can_write === true,
  )

  useEffect(() => {
    if (!open || current != null) return
    let cancelled = false
    void Promise.all([
      api.get<KnowledgeSourceSummary[]>('/knowledge/sources'),
      api.get<ArtifactKnowledgeArchive[]>(
        `/artifacts/${artifactId}/knowledge-archives`,
      ),
      api.get<ArtifactAcceptanceProjection>(
        `/artifacts/${artifactId}/acceptance`,
      ),
    ])
      .then(([sources, archives, acceptance]) => {
        if (cancelled) return
        setLoadState({ artifactId, sources, archives, acceptance, error: '' })
      })
      .catch((error) => {
        if (cancelled) return
        setLoadState({
          artifactId,
          sources: [],
          archives: [],
          acceptance: null,
          error: error instanceof Error ? error.message : '知识归档信息加载失败',
        })
      })
    return () => {
      cancelled = true
    }
  }, [artifactId, current, open])

  const archive = async () => {
    const selectedSourceId = Number(sourceId)
    if (
      submitting
      || !Number.isInteger(selectedSourceId)
      || selectedSourceId < 1
      || !confirmed
      || !current?.acceptance?.final_delivery_allowed
    ) return
    setSubmitting(true)
    setActionError('')
    try {
      const result = await api.post<ArtifactKnowledgeArchive>(
        `/artifacts/${artifactId}/archive-to-knowledge`,
        {
          source_id: selectedSourceId,
          confirm_archive: true,
          expected_content_sha256: contentSha256,
        },
      )
      setLoadState((previous) => previous?.artifactId === artifactId
        ? {
          ...previous,
          archives: [
            result,
            ...previous.archives.filter(
              (item) => item.archive_id !== result.archive_id,
            ),
          ],
        }
        : previous)
      setSourceId('')
      setConfirmed(false)
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '归档到知识库失败',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--line-soft)',
        background: 'var(--bg-elev)',
        fontSize: 10.5,
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: 0,
          color: 'var(--ink-mute)',
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <CxIcon name="archive" size={12} />
        <span style={{ flex: 1 }}>归档到知识库</span>
        <span style={{ color: 'var(--ink-faint)' }}>{open ? '收起 ▴' : '选择 Source ▾'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8, color: 'var(--ink-mute)' }}>
          {loading ? (
            <div>正在读取可写 Knowledge Source…</div>
          ) : current?.error ? (
            <div role="alert" style={{ color: 'var(--bad)' }}>{current.error}</div>
          ) : (
            <>
              <div style={{ lineHeight: 1.5 }}>
                仅在你明确选择后登记并单独索引；不会写项目/客户记忆，也不会外发。
              </div>
              {!current?.acceptance?.final_delivery_allowed && (
                <div style={{ marginTop: 6, color: 'var(--warn)' }}>
                  最终交付门禁就绪后才能归档。
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                <select
                  aria-label="目标 Knowledge Source"
                  value={sourceId}
                  disabled={submitting || !current?.acceptance?.final_delivery_allowed}
                  onChange={(event) => {
                    setSourceId(event.target.value)
                    setConfirmed(false)
                  }}
                  style={{
                    minWidth: 0,
                    flex: 1,
                    padding: '5px 7px',
                    color: 'var(--ink)',
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                    font: 'inherit',
                  }}
                >
                  <option value="">选择已有 Source</option>
                  {writableSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} · {source.scope_type}
                    </option>
                  ))}
                </select>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--ink-mute)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={submitting || !sourceId}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  确认写入
                </label>
                <button
                  type="button"
                  onClick={() => void archive()}
                  disabled={
                    submitting
                    || !sourceId
                    || !confirmed
                    || !current?.acceptance?.final_delivery_allowed
                  }
                  style={{
                    padding: '5px 9px',
                    color: 'var(--accent)',
                    background: 'transparent',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                    cursor: submitting ? 'wait' : 'pointer',
                  }}
                >
                  {submitting ? '归档中…' : '确认归档'}
                </button>
              </div>
              {writableSources.length === 0 && (
                <div style={{ marginTop: 6, color: 'var(--warn)' }}>
                  暂无可写的活动 Source，请先在知识库创建或申请权限。
                </div>
              )}
              {actionError && (
                <div role="alert" style={{ marginTop: 6, color: 'var(--bad)' }}>
                  {actionError}
                </div>
              )}
              {(current?.archives.length ?? 0) > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 16 }}>
                  {current?.archives.slice(0, 5).map((item) => (
                    <li key={item.archive_id}>
                      {item.source_name} · {item.document_status}
                      {item.job_status ? ` · ${item.job_status}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
