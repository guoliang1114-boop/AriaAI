import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus, type CxTone } from '../CxPrimitives'
import { CxIcon } from '../CxIcons'

interface StakeholdersProps {
  projectId: string
}

interface Stakeholder {
  n: string
  r: string
  lvl: '决策' | '影响' | '执行'
  rel: '支持' | '推动' | '中立' | '积极'
  concerns: string
  last: string
  influence: number
}

const STAKEHOLDERS: Stakeholder[] = [
  { n: '王浩', r: 'CTO', lvl: '决策', rel: '支持', concerns: '技术方案的可控性 · 偏好先小范围验证', last: '2026-05-22 例会', influence: 90 },
  { n: '张丽', r: 'COO', lvl: '决策', rel: '支持', concerns: '业务 KPI 兑现 · 担心组织变革节奏过快', last: '2026-05-22 例会', influence: 70 },
  { n: '王凯', r: '数字化办公室', lvl: '影响', rel: '推动', concerns: '需要明确执行清单 · 是协调方而非决策方', last: '2026-05-26 邮件', influence: 55 },
  { n: '李远', r: 'CFO', lvl: '影响', rel: '中立', concerns: '项目预算与 ROI · 可能列席关键节点', last: '未直接接触', influence: 40 },
  { n: '张博', r: '续保业务负责人', lvl: '执行', rel: '积极', concerns: '续保转化率指标 · 急需数据闭环工具', last: '2026-05-15 访谈', influence: 30 },
  { n: '刘洁', r: '数据治理团队', lvl: '执行', rel: '中立', concerns: '数据脱敏与权限合规 · 评估工作量', last: '2026-05-08 评估', influence: 25 },
]

const RHYTHM = [
  { who: 'CTO 王浩', w: '技术细节先邮件 · 关键节点面对面', tone: 'accent' as const },
  { who: 'COO 张丽', w: '数字优先 · 一页纸结论', tone: 'accent' as const },
  { who: '王凯', w: '执行清单 + 双周对齐', tone: 'neutral' as const },
]

function lvlTone(lvl: Stakeholder['lvl']): CxTone {
  if (lvl === '决策') return 'accent'
  if (lvl === '影响') return 'neutral'
  return 'mute'
}

function relColor(rel: Stakeholder['rel']) {
  if (rel === '支持' || rel === '积极') return 'var(--good)'
  if (rel === '中立') return 'var(--ink-mute)'
  return 'var(--warn)'
}

const GRID = '1.4fr 0.7fr 0.6fr 0.7fr 1.4fr 0.8fr 14px'

export function CxProjectStakeholders({ projectId }: StakeholdersProps) {
  return (
    <CxProjectShell activeTab="stakeholders" projectId={projectId}>
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
                关键干系人 · 6 人
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-mute)' }}>
                2 决策 · 2 影响 · 2 执行 · 与客户档案自动联动
              </p>
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
                从客户记忆同步
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
                + 添加
              </button>
            </div>
          </div>

          {/* Influence map */}
          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '16px 20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <h3
                className="ui"
                style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}
              >
                影响力地图
              </h3>
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                横轴:影响力 · 圆点大小:支持度
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                height: 80,
                borderBottom: '1px solid var(--line-soft)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '50%',
                  height: 1,
                  background: 'var(--line-soft)',
                }}
              />
              {STAKEHOLDERS.map((s) => {
                const support =
                  s.rel === '支持' ? 80 : s.rel === '积极' ? 78 : s.rel === '推动' ? 60 : 50
                const size = s.rel === '支持' ? 22 : s.rel === '积极' ? 18 : 16
                const positive = s.rel === '支持' || s.rel === '积极'
                return (
                  <div
                    key={s.n}
                    style={{
                      position: 'absolute',
                      left: `${s.influence}%`,
                      bottom: `${support}%`,
                      transform: 'translate(-50%, 50%)',
                    }}
                  >
                    <span
                      style={{
                        width: size,
                        height: size,
                        borderRadius: 99,
                        background: positive ? 'var(--accent-bg)' : 'var(--bg-tint)',
                        color: positive ? 'var(--accent-ink)' : 'var(--ink-soft)',
                        border: `1.5px solid ${positive ? 'var(--accent)' : 'var(--line-strong)'}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 500,
                      }}
                    >
                      {s.n[0]}
                    </span>
                  </div>
                )
              })}
              <div
                style={{
                  position: 'absolute',
                  bottom: -16,
                  left: 0,
                  fontSize: 10,
                  color: 'var(--ink-faint)',
                }}
              >
                低影响
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: -16,
                  right: 0,
                  fontSize: 10,
                  color: 'var(--ink-faint)',
                }}
              >
                高影响
              </div>
            </div>
          </div>

          {/* Table */}
          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: GRID,
                padding: '12px 16px',
                fontSize: 11,
                color: 'var(--ink-faint)',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <span>姓名 · 角色</span>
              <span>层级</span>
              <span>关系</span>
              <span>影响</span>
              <span>关注点</span>
              <span>最近接触</span>
              <span />
            </div>
            {STAKEHOLDERS.map((s, i) => (
              <button
                key={s.n}
                type="button"
                className="row-hov"
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID,
                  padding: '14px 16px',
                  gap: 12,
                  alignItems: 'center',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                  background: 'transparent',
                  width: '100%',
                  textAlign: 'left',
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
                    {s.n[0]}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                      {s.n}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{s.r}</div>
                  </div>
                </div>
                <CxStatus tone={lvlTone(s.lvl)}>{s.lvl}</CxStatus>
                <span style={{ fontSize: 12, color: relColor(s.rel) }}>{s.rel}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 3,
                      background: 'var(--bg-sunken)',
                      borderRadius: 99,
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${s.influence}%`,
                        background: 'var(--accent)',
                        borderRadius: 99,
                      }}
                    />
                  </div>
                  <span className="num" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                    {s.influence}
                  </span>
                </div>
                <div
                  className="ui"
                  style={{
                    fontSize: 12.5,
                    color: 'var(--ink-soft)',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                  }}
                >
                  {s.concerns}
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>{s.last}</span>
                <CxIcon name="arrow-right" size={12} style={{ color: 'var(--ink-faint)' }} />
              </button>
            ))}
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel title="客户决策结构">
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              <div
                style={{
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--line-soft)',
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>最终决策</div>
                <div className="ui" style={{ color: 'var(--ink)', fontWeight: 500, marginTop: 2 }}>
                  CTO 王浩 + COO 张丽 双签
                </div>
              </div>
              <div
                style={{
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--line-soft)',
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>预算审批</div>
                <div className="ui" style={{ color: 'var(--ink)', marginTop: 2 }}>
                  CFO 李远 · ¥300 万以上需董事会
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>执行推动</div>
                <div className="ui" style={{ color: 'var(--ink)', marginTop: 2 }}>
                  数字化办公室 王凯
                </div>
              </div>
            </div>
          </CxPanel>

          <CxPanel title="沟通节奏建议">
            {RHYTHM.map((s) => (
              <div
                key={s.who}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    marginTop: 7,
                    borderRadius: 99,
                    background: s.tone === 'accent' ? 'var(--accent)' : 'var(--ink-faint)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div className="ui" style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 500 }}>
                    {s.who}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                    {s.w}
                  </div>
                </div>
              </div>
            ))}
          </CxPanel>

          <CxPanel title="AI 提示" subtitle="基于干系人画像">
            <div
              style={{
                background: 'var(--accent-bg)',
                padding: '10px 12px',
                borderRadius: 'var(--r-sm)',
                fontSize: 12.5,
                color: 'var(--accent-ink)',
                lineHeight: 1.6,
              }}
            >
              <CxIcon
                name="sparkle"
                size={11}
                style={{ marginRight: 4, verticalAlign: -1 }}
              />
              CFO 李远尚未直接接触,但可能影响预算 — 建议下次例会前安排一次单独沟通。
            </div>
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  )
}
