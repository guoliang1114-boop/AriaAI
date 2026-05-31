import { useState, type CSSProperties } from 'react'
import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'

interface DocsProps {
  projectId: string
}

interface DocFile {
  ext: string
  title: string
  size: string
  who: string
  date: string
  source: string
  summary: string
  tags: string[]
}

interface DocFolder {
  id: string
  name: string
  tone: 'neutral' | 'accent' | 'good' | 'warn'
  files: DocFile[]
}

const FOLDERS: DocFolder[] = [
  {
    id: 'interview',
    name: '客户访谈',
    tone: 'neutral',
    files: [
      { ext: 'DOC', title: '鼎和保险 续保业务深度访谈记录', size: '1.2 MB', who: '林宥', date: '2026-05-15', source: '本地上传', summary: '针对续保团队 4 位负责人的深度访谈,识别 12 个关键痛点。', tags: ['访谈', '续保'] },
      { ext: 'DOC', title: '客户访谈纪要 V3', size: '920 KB', who: '林宥', date: '2026-05-26', source: '本地上传', summary: '更新版 — 补充数据治理边界的讨论。', tags: ['访谈'] },
      { ext: 'PDF', title: '决策链补充材料', size: '640 KB', who: '陈悦', date: '2026-05-20', source: '本地上传', summary: 'CTO / COO / 数字化办公室的决策权重梳理。', tags: ['客户'] },
    ],
  },
  {
    id: 'method',
    name: '方案文档',
    tone: 'neutral',
    files: [
      { ext: 'PDF', title: '数据治理 POC 评估方案 v0.3', size: '2.4 MB', who: '苏明', date: '2026-05-22', source: '本地上传', summary: 'POC 评估的范围、指标定义与方法。', tags: ['技术', 'POC'] },
      { ext: 'MD', title: 'AI 售前评估方法论 v2', size: '120 KB', who: '苏明', date: '2026-05-19', source: '知识库', summary: '标准化的售前评估方法论模板。', tags: ['方法论'] },
    ],
  },
  {
    id: 'meeting',
    name: '会议纪要',
    tone: 'neutral',
    files: [
      { ext: 'MD', title: '会前简报 · 6 月 3 日例会', size: '12 KB', who: 'Aria', date: '2026-05-28', source: 'Skill 输出', summary: '为 6/3 例会生成的 30 秒卡 + 话术。', tags: ['简报', '输出'] },
      { ext: 'DOC', title: '申通快运 项目周报合集 Q2', size: '3.1 MB', who: '陈悦', date: '2026-05-08', source: '知识库', summary: 'Q2 周报合集,含里程碑与风险跟踪。', tags: ['周报'] },
    ],
  },
  {
    id: 'deliver',
    name: '交付物',
    tone: 'good',
    files: [
      { ext: 'PDF', title: '数字化转型蓝图 V1', size: '5.2 MB', who: '陈悦', date: '2026-05-25', source: '本地上传', summary: '三层框架的整体蓝图初稿。', tags: ['交付物'] },
    ],
  },
  {
    id: 'finance',
    name: '合同 / 财务',
    tone: 'warn',
    files: [
      { ext: 'PDF', title: '咨询服务合同 DH-2026-001', size: '880 KB', who: '陈悦', date: '2026-04-12', source: '本地上传', summary: '主合同 · ¥280 万 · 里程碑付款。', tags: ['合同'] },
    ],
  },
  {
    id: 'auto',
    name: '自动生成',
    tone: 'accent',
    files: [
      { ext: 'MEM', title: '项目记忆快照 v12', size: '—', who: 'Aria', date: '2026-05-28', source: '自动生成', summary: '由 11 次对话 + 12 份文档汇总的结构化记忆。', tags: ['记忆', '自动'] },
    ],
  },
]

const TOTAL_FILES = FOLDERS.reduce((s, f) => s + f.files.length, 0)

const toneColor = (t: DocFolder['tone']) =>
  t === 'accent'
    ? 'var(--accent)'
    : t === 'good'
      ? 'var(--good)'
      : t === 'warn'
        ? 'var(--warn)'
        : 'var(--ink-mute)'

export function CxProjectDocs({ projectId }: DocsProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    interview: true,
    method: false,
    meeting: false,
    deliver: false,
    finance: false,
    auto: false,
  })
  const [sel, setSel] = useState({ folder: 'interview', file: 0 })

  const toggle = (k: string) => setExpanded((e) => ({ ...e, [k]: !e[k] }))
  const cur = FOLDERS.find((f) => f.id === sel.folder) ?? FOLDERS[0]

  return (
    <CxProjectShell activeTab="docs" projectId={projectId}>
      <div
        style={{
          height: '100%',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          minWidth: 0,
        }}
      >
        {/* LEFT — tree */}
        <aside
          style={{
            borderRight: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '18px 16px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
              项目文件
            </h2>
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
              {FOLDERS.length} 夹 · {TOTAL_FILES} 份
            </span>
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <div
              style={{
                padding: '9px 11px',
                border: '1.5px dashed var(--line-strong)',
                borderRadius: 'var(--r-sm)',
                background: 'color-mix(in oklch, var(--accent) 4%, transparent)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--accent-bg)',
                  color: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <CxIcon name="plus" size={13} stroke={1.6} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="ui" style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>
                  拖入或上传文件
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 1 }}>
                  PDF · DOC · MD · ≤ 50 MB
                </div>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 14px 14px' }}>
            <TreeRow depth={0} icon="folder" iconColor="var(--ink-soft)" label="全部文件" badge={TOTAL_FILES} />
            {FOLDERS.map((f) => (
              <span key={f.id} style={{ display: 'contents' }}>
                <TreeRow
                  depth={1}
                  expandable
                  isOpen={expanded[f.id]}
                  icon="folder"
                  iconColor={toneColor(f.tone)}
                  label={f.name}
                  badge={f.files.length}
                  active={sel.folder === f.id && sel.file === -1}
                  onClick={() => {
                    toggle(f.id)
                    setSel({ folder: f.id, file: 0 })
                  }}
                />
                {expanded[f.id] &&
                  f.files.map((d, i) => (
                    <FileRow
                      key={i}
                      depth={2}
                      ext={d.ext}
                      label={d.title}
                      active={sel.folder === f.id && sel.file === i}
                      onClick={() => setSel({ folder: f.id, file: i })}
                    />
                  ))}
              </span>
            ))}
          </div>
        </aside>

        {/* RIGHT — folder contents */}
        <div style={{ overflow: 'auto', padding: '20px 32px 32px', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 13,
                color: 'var(--ink-mute)',
              }}
            >
              <CxIcon name="folder" size={13} style={{ color: 'var(--ink-faint)' }} />
              <span>全部文件</span>
              <CxIcon name="chevron-right" size={11} style={{ color: 'var(--ink-faint)' }} />
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{cur.name}</span>
              <span className="num" style={{ color: 'var(--ink-faint)', marginLeft: 4 }}>
                {cur.files.length}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  color: 'var(--ink-soft)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                新建文件夹
              </button>
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
                + 上传
              </button>
            </div>
          </div>

          <div>
            {cur.files.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSel({ folder: cur.id, file: i })}
                className="row-hov"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr 100px 90px',
                  padding: '14px 8px',
                  gap: 14,
                  alignItems: 'flex-start',
                  borderBottom: '1px solid var(--line-soft)',
                  borderRadius: 'var(--r-sm)',
                  cursor: 'pointer',
                  background: sel.folder === cur.id && sel.file === i ? 'var(--bg-tint)' : 'transparent',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--ink-mute)',
                    padding: '3px 8px',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                    textAlign: 'center',
                    letterSpacing: '0.04em',
                    justifySelf: 'start',
                  }}
                >
                  {d.ext}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>
                    {d.title}
                  </div>
                  <p
                    style={{
                      margin: '3px 0 6px',
                      fontSize: 12.5,
                      color: 'var(--ink-soft)',
                      lineHeight: 1.55,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as CSSProperties['WebkitBoxOrient'],
                    }}
                  >
                    {d.summary}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 11,
                      color: 'var(--ink-mute)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>{d.who} 上传</span>
                    <span style={{ color: 'var(--ink-faint)' }}>·</span>
                    <span>{d.source}</span>
                    {d.tags.map((t) => (
                      <span key={t} style={{ color: 'var(--accent)' }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="num" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                  {d.size}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{d.date}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </CxProjectShell>
  )
}

interface TreeRowProps {
  depth?: number
  icon?: string
  iconColor?: string
  expandable?: boolean
  isOpen?: boolean
  label: string
  badge?: number
  onClick?: () => void
  active?: boolean
}

function TreeRow({ depth = 0, icon, iconColor, expandable, isOpen, label, badge, onClick, active }: TreeRowProps) {
  return (
    <a
      className="row-hov"
      onClick={onClick}
      role="button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 6px',
        paddingLeft: 6 + depth * 14,
        margin: '0 -6px',
        borderRadius: 'var(--r-sm)',
        cursor: 'pointer',
        background: active ? 'var(--bg-tint)' : 'transparent',
        position: 'relative',
      }}
    >
      {active && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 5,
            bottom: 5,
            width: 2,
            background: 'var(--accent)',
          }}
        />
      )}
      <span
        style={{
          width: 12,
          color: 'var(--ink-faint)',
          fontSize: 9,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {expandable ? (isOpen ? '▾' : '▸') : ''}
      </span>
      {icon && (
        <CxIcon
          name={icon}
          size={12}
          style={{ color: iconColor ?? 'var(--ink-mute)', flexShrink: 0 }}
        />
      )}
      <span
        style={{
          fontSize: 12.5,
          color: active ? 'var(--ink)' : 'var(--ink-soft)',
          fontWeight: active ? 500 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {label}
      </span>
      {badge != null && (
        <span
          className="num"
          style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}
        >
          {badge}
        </span>
      )}
    </a>
  )
}

interface FileRowProps {
  depth: number
  ext: string
  label: string
  active?: boolean
  onClick?: () => void
}

function FileRow({ depth, ext, label, active, onClick }: FileRowProps) {
  const highlight = ext === 'MD' || ext === 'MEM'
  return (
    <a
      className="row-hov"
      onClick={onClick}
      role="button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 6px',
        paddingLeft: 6 + depth * 14 + 12,
        margin: '0 -6px',
        borderRadius: 'var(--r-sm)',
        cursor: 'pointer',
        background: active ? 'var(--accent-bg)' : 'transparent',
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: highlight ? 'var(--accent)' : 'var(--ink-mute)',
          padding: '1px 4px',
          border: `1px solid ${highlight ? 'var(--accent-bg)' : 'var(--line)'}`,
          background: highlight ? 'var(--accent-bg)' : 'transparent',
          borderRadius: 2,
          flexShrink: 0,
          letterSpacing: '0.04em',
          minWidth: 26,
          textAlign: 'center',
        }}
      >
        {ext}
      </span>
      <span
        style={{
          fontSize: 12,
          color: active ? 'var(--ink)' : 'var(--ink-soft)',
          fontWeight: active ? 500 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {label}
      </span>
    </a>
  )
}
