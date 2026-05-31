import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus } from '../CxPrimitives'

interface MilestonesProps {
  projectId: string
}

const MILESTONES = [
  { d: '04/12', t: '项目立项', s: 'done', owner: '陈悦', note: '客户对齐项目目标与边界' },
  { d: '04/26', t: '需求调研完成', s: 'done', owner: '林宥', note: '完成 8 次客户访谈' },
  { d: '05/15', t: '方案 V1 提交', s: 'done', owner: '陈悦', note: '客户初步反馈积极' },
  { d: '06/03', t: '客户例会 · 进展同步', s: 'next', owner: '陈悦', note: '本次准备会前简报' },
  { d: '06/30', t: 'POC 评估报告', s: 'in-progress', owner: '苏明', note: '数据治理 POC 阶段性结论' },
  { d: '07/14', t: '方案 V2 提交', s: 'planned', owner: '陈悦', note: '纳入 POC 反馈后修订' },
  { d: '07/28', t: '客户决策评审', s: 'planned', owner: '—', note: 'CTO + COO 双签' },
  { d: '08/31', t: '正式签约', s: 'planned', owner: '—', note: '目标日期' },
] as const

const TODOS = [
  { t: '整理鼎和保险周三例会准备材料', who: '陈悦', due: '今天 17:00', pri: 'high' as const },
  { t: '准备 POC 评估指标定义文档', who: '苏明', due: '明天', pri: 'high' as const },
  { t: '回复 CTO 关于灰度计划的问题', who: '陈悦', due: '今天', pri: 'med' as const },
  { t: '联系客户法务确认脱敏方案', who: '林宥', due: '本周', pri: 'med' as const },
  { t: '更新方案 V2 的组织变革章节', who: '陈悦', due: '下周二', pri: 'low' as const },
]

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--good)',
  'in-progress': 'var(--accent)',
  next: 'var(--accent)',
  planned: 'var(--line-strong)',
}

export function CxProjectMilestones({ projectId }: MilestonesProps) {
  return (
    <CxProjectShell activeTab="milestones" projectId={projectId}>
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '24px 40px 32px',
          display: 'grid',
          gridTemplateColumns: '1fr 300px',
          gap: 24,
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
                里程碑 · 3 / 8 完成
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-mute)' }}>
                预计签约 2026-08-31 · 进度符合预期
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
                导出甘特
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
                + 添加里程碑
              </button>
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '18px 20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <div>
                <span
                  className="num"
                  style={{ fontSize: 22, color: 'var(--ink)', fontWeight: 500 }}
                >
                  37%
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)', marginLeft: 8 }}>
                  整体进度
                </span>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                4/12 → 8/31 · 共 141 天 · 已过 52 天
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: 'var(--bg-sunken)',
                borderRadius: 99,
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <div style={{ width: '37%', background: 'var(--accent)' }} />
              <div style={{ width: '8%', background: 'var(--accent-bg)' }} />
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '20px 24px',
            }}
          >
            <div style={{ position: 'relative', paddingLeft: 22 }}>
              <div
                style={{
                  position: 'absolute',
                  left: 6,
                  top: 8,
                  bottom: 8,
                  width: 1,
                  background: 'var(--line)',
                }}
              />
              {MILESTONES.map((m, i) => {
                const c = STATUS_COLOR[m.s]
                return (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '60px 1fr auto',
                      gap: 18,
                      padding: '11px 0',
                      borderBottom:
                        i === MILESTONES.length - 1 ? 'none' : '1px solid var(--line-soft)',
                      alignItems: 'center',
                      position: 'relative',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: -22,
                        top: 17,
                        width: 13,
                        height: 13,
                        borderRadius: 99,
                        background:
                          m.s === 'done' || m.s === 'in-progress' ? c : 'var(--bg-elev)',
                        border: `1.5px solid ${c}`,
                        boxShadow:
                          m.s === 'next'
                            ? `0 0 0 4px color-mix(in oklch, ${c} 20%, transparent)`
                            : 'none',
                      }}
                    />
                    <span
                      className="num"
                      style={{
                        fontSize: 12.5,
                        color:
                          m.s === 'next' || m.s === 'in-progress'
                            ? 'var(--accent)'
                            : 'var(--ink-mute)',
                        fontWeight: 500,
                      }}
                    >
                      {m.d}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="ui"
                        style={{
                          fontSize: 14,
                          color: 'var(--ink)',
                          fontWeight:
                            m.s === 'done' || m.s === 'next' || m.s === 'in-progress' ? 500 : 400,
                        }}
                      >
                        {m.t}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                        负责人 {m.owner} · {m.note}
                      </div>
                    </div>
                    {m.s === 'done' && <CxStatus tone="good">已完成</CxStatus>}
                    {m.s === 'in-progress' && (
                      <CxStatus tone="accent" pulse>
                        进行中
                      </CxStatus>
                    )}
                    {m.s === 'next' && <CxStatus tone="accent">下一个</CxStatus>}
                    {m.s === 'planned' && <CxStatus tone="mute">计划</CxStatus>}
                  </div>
                )
              })}
            </div>
          </div>

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
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h3
                  className="ui"
                  style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}
                >
                  本周待办 · 5
                </h3>
                <CxStatus tone="warn">2 项高优</CxStatus>
                <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                  · 由项目对话自动抽取
                </span>
              </div>
            </div>
            {TODOS.map((t, i) => {
              const dueColor =
                t.due === '今天' || t.due.startsWith('今天')
                  ? 'var(--warn)'
                  : t.due === '明天'
                    ? 'var(--accent)'
                    : 'var(--ink-mute)'
              return (
                <div
                  key={i}
                  className="row-hov"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '20px 1fr 80px 80px',
                    gap: 12,
                    padding: '10px 8px',
                    margin: '0 -8px',
                    borderRadius: 'var(--r-sm)',
                    alignItems: 'center',
                    borderBottom: i === TODOS.length - 1 ? 'none' : '1px solid var(--line-soft)',
                  }}
                >
                  <span
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 3,
                      border: `1.5px solid ${
                        t.pri === 'high' ? 'var(--accent)' : 'var(--line-strong)'
                      }`,
                      flexShrink: 0,
                    }}
                  />
                  <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
                    {t.t}
                  </div>
                  <span style={{ fontSize: 11.5, color: dueColor }}>{t.due}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 99,
                        background: 'var(--accent-bg)',
                        color: 'var(--accent-ink)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                      }}
                    >
                      {t.who[0]}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>{t.who}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel title="风险预警">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  padding: '10px 12px',
                  background: 'color-mix(in oklch, var(--warn) 8%, transparent)',
                  border: '1px solid color-mix(in oklch, var(--warn) 25%, transparent)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--warn)', fontWeight: 500, marginBottom: 3 }}>
                  ○ POC 报告可能延期
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                  客户脱敏数据尚未到位,影响 6/30 节点
                </div>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  background: 'color-mix(in oklch, var(--bad) 8%, transparent)',
                  border: '1px solid color-mix(in oklch, var(--bad) 25%, transparent)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--bad)', fontWeight: 500, marginBottom: 3 }}>
                  ● 决策评审排期紧
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                  7/28 评审 · 需提前 2 周对齐 CFO
                </div>
              </div>
            </div>
          </CxPanel>

          <CxPanel title="速度指标">
            <div style={{ fontSize: 12.5, lineHeight: 1.85 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>计划周期</span>
                <span className="num">141 天</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>已用</span>
                <span className="num">52 天 (37%)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>平均里程碑间隔</span>
                <span className="num">17 天</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-mute)' }}>预测交付偏差</span>
                <span className="num" style={{ color: 'var(--warn)' }}>
                  +3 天
                </span>
              </div>
            </div>
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  )
}
