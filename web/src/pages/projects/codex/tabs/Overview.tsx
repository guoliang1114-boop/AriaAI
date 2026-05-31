import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus, type CxTone } from '../CxPrimitives'
import { DEMO_PROJECT } from '../mockData'

interface OverviewProps {
  projectId: string
}

const KEY_FACTS: Array<[string, string]> = [
  ['客户', DEMO_PROJECT.client],
  ['行业', DEMO_PROJECT.industry],
  ['地区', DEMO_PROJECT.region],
  ['合同金额', `${DEMO_PROJECT.amountText} · 预估`],
  ['开始', DEMO_PROJECT.start],
  ['预计签约', DEMO_PROJECT.expectedClose],
  ['负责人', DEMO_PROJECT.owner],
]

const STAKEHOLDERS: Array<{ n: string; r: string; lvl: string; tone: CxTone }> = [
  { n: '王浩', r: 'CTO · 技术拍板', lvl: '决策', tone: 'accent' },
  { n: '张丽', r: 'COO · 业务背书', lvl: '决策', tone: 'accent' },
  { n: '王凯', r: '数字化办公室', lvl: '影响', tone: 'neutral' },
]

const TIMELINE: Array<{ t: string; who: string; what: string; tone: 'accent' | 'good' | 'warn' | 'neutral' }> = [
  { t: '14:18', who: '陈悦', what: '更新了项目记忆 v12 · 调整核心痛点描述', tone: 'accent' },
  { t: '11:02', who: 'Aria', what: '调用 会前简报 Skill · 生成例会卡', tone: 'good' },
  { t: '09:30', who: '林宥', what: '上传 2 份文档 · 客户访谈纪要 V3', tone: 'neutral' },
  { t: '昨天', who: 'Aria', what: '完成项目记忆增量索引 · 新增 7 条片段', tone: 'neutral' },
  { t: '昨天', who: '苏明', what: '添加锚点 · 续保转化率指标待客户确认', tone: 'warn' },
]

const SNAPSHOT_TILES: Array<{ l: string; v: string; icon: string }> = [
  { l: '下一动作', v: 'Q3 第一周提交 POC 报告', icon: 'arrow-right' },
  { l: '关键决策人', v: 'CTO 王浩 · COO 张丽', icon: 'user' },
  { l: '记忆状态', v: '已同步 · v12 · 完整', icon: 'check' },
]

export function CxProjectOverview({ projectId }: OverviewProps) {
  return (
    <CxProjectShell activeTab="overview" projectId={projectId}>
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
        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <CxPanel
            title="AI 项目快照"
            subtitle="基于最近 3 次会议与 2 份文档自动生成 · 14 分钟前"
            action={
              <button
                type="button"
                style={{
                  fontSize: 12,
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CxIcon name="sparkle" size={11} /> 重新生成
              </button>
            }
          >
            <p
              className="ui"
              style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--ink)', lineHeight: 1.75 }}
            >
              {DEMO_PROJECT.oneLiner} 客户内部已有 Q3 数字化目标共识,我方建议先以续保数据闭环作为切入点,同时
              <span style={{ color: 'var(--warn)', borderBottom: '1px dotted var(--warn)' }}>
                注意理赔系统改造涉及核心交易,需谨慎评估
              </span>
              。
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 14,
                paddingTop: 14,
                borderTop: '1px solid var(--line-soft)',
              }}
            >
              {SNAPSHOT_TILES.map((b) => (
                <div key={b.l} style={{ display: 'flex', gap: 10 }}>
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
                    <CxIcon name={b.icon} size={12} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 2 }}>
                      {b.l}
                    </div>
                    <div
                      className="ui"
                      style={{
                        fontSize: 13,
                        color: 'var(--ink)',
                        fontWeight: 500,
                        lineHeight: 1.45,
                      }}
                    >
                      {b.v}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CxPanel>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <CxPanel
              title="项目记忆摘要"
              subtitle="结构化沉淀 · v12"
              action={
                <a style={{ fontSize: 11.5, color: 'var(--accent)' }} href="#">
                  查看完整 →
                </a>
              }
            >
              {(
                [
                  ['客户背景', '深圳总部 · 3 万员工 · 2025 总保费 480 亿'],
                  ['核心痛点', '续保转化下滑 · 数据散落 5 系统'],
                  ['我方方案', '三层框架,先做续保 + 理赔数据闭环'],
                  ['下一步', 'Q3 W1 POC 报告 · W3 提案 V2'],
                ] as Array<[string, string]>
              ).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '75px 1fr',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--line-soft)',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>{k}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>{v}</div>
                </div>
              ))}
            </CxPanel>

            <CxPanel
              title="会前 30 秒卡"
              subtitle="下次例会前自动准备"
              action={
                <a style={{ fontSize: 11.5, color: 'var(--accent)' }} href="#">
                  详细 →
                </a>
              }
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                {(
                  [
                    { l: '建议说', v: '聚焦续保的 Q3 试点目标与 KPI', tone: 'good' },
                    { l: '避开', v: '理赔系统改造的具体范围', tone: 'warn' },
                    { l: '确认', v: '客户能否在 6 月前提供历史数据', tone: 'neutral' },
                  ] as Array<{ l: string; v: string; tone: 'good' | 'warn' | 'neutral' }>
                ).map((b, i) => (
                  <div
                    key={b.l}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '8px 0',
                      borderBottom: i === 2 ? 'none' : '1px solid var(--line-soft)',
                    }}
                  >
                    <span
                      style={{
                        width: 36,
                        color:
                          b.tone === 'good'
                            ? 'var(--good)'
                            : b.tone === 'warn'
                              ? 'var(--warn)'
                              : 'var(--ink-mute)',
                        fontSize: 11.5,
                        fontWeight: 500,
                        paddingTop: 1,
                        flexShrink: 0,
                      }}
                    >
                      {b.l}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
                      {b.v}
                    </span>
                  </div>
                ))}
              </div>
            </CxPanel>
          </div>

          <CxPanel
            title="最近动态"
            subtitle="24 小时内"
            action={
              <a style={{ fontSize: 11.5, color: 'var(--ink-mute)' }} href="#">
                全部 →
              </a>
            }
          >
            <div style={{ position: 'relative', paddingLeft: 14 }}>
              <div
                style={{
                  position: 'absolute',
                  left: 4,
                  top: 4,
                  bottom: 4,
                  width: 1,
                  background: 'var(--line)',
                }}
              />
              {TIMELINE.map((e, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '56px auto 1fr',
                    gap: 12,
                    padding: '9px 0',
                    alignItems: 'flex-start',
                    position: 'relative',
                  }}
                >
                  <span
                    style={{ fontSize: 11.5, color: 'var(--ink-mute)', paddingTop: 1 }}
                  >
                    {e.t}
                  </span>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      background: 'var(--bg-elev)',
                      border: `1.5px solid ${
                        e.tone === 'accent'
                          ? 'var(--accent)'
                          : e.tone === 'good'
                            ? 'var(--good)'
                            : e.tone === 'warn'
                              ? 'var(--warn)'
                              : 'var(--ink-faint)'
                      }`,
                      marginTop: 6,
                      position: 'relative',
                      left: -14,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ marginLeft: -10 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                      <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{e.who}</span> ·{' '}
                      {e.what}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CxPanel>
        </div>

        {/* Right rail */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel
            title="项目档案"
            action={
              <button
                type="button"
                style={{
                  fontSize: 12,
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CxIcon name="edit" size={11} /> 编辑
              </button>
            }
          >
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.85 }}>
              {KEY_FACTS.map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '4px 0',
                  }}
                >
                  <span style={{ color: 'var(--ink-mute)' }}>{k}</span>
                  <span style={{ color: 'var(--ink)', textAlign: 'right', minWidth: 0 }}>{v}</span>
                </div>
              ))}
            </div>
          </CxPanel>

          <CxPanel
            title="关键干系人"
            action={
              <a style={{ fontSize: 11.5, color: 'var(--accent)' }} href="#">
                详细 →
              </a>
            }
          >
            {STAKEHOLDERS.map((p) => (
              <div
                key={p.n}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
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
                  {p.n[0]}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                    {p.n}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{p.r}</div>
                </div>
                <CxStatus tone={p.tone}>{p.lvl}</CxStatus>
              </div>
            ))}
          </CxPanel>

          <CxPanel
            title="项目成员"
            action={
              <a style={{ fontSize: 11.5, color: 'var(--accent)' }} href="#">
                管理
              </a>
            }
          >
            {DEMO_PROJECT.team.map((p) => (
              <div
                key={p.n}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 99,
                    background: 'var(--bg-tint)',
                    color: 'var(--ink-soft)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 500,
                    flexShrink: 0,
                  }}
                >
                  {p.n[0]}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="ui" style={{ fontSize: 13, color: 'var(--ink)' }}>
                    {p.n}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{p.r}</div>
                </div>
              </div>
            ))}
            <button
              type="button"
              style={{
                width: '100%',
                marginTop: 8,
                padding: '7px 10px',
                fontSize: 12,
                color: 'var(--ink-mute)',
                border: '1px dashed var(--line-strong)',
                borderRadius: 'var(--r-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                background: 'transparent',
              }}
            >
              <CxIcon name="plus" size={11} stroke={1.6} /> 添加 / 邀请成员
            </button>
          </CxPanel>

          <CxPanel title="项目管理">
            {(
              [
                { l: '编辑项目信息', d: '名称、客户、金额、周期等', icon: 'edit', tone: 'soft' },
                { l: '归档项目', d: '移入归档,保留全部记忆', icon: 'archive', tone: 'soft' },
                { l: '删除项目', d: '不可恢复,谨慎操作', icon: 'trash', tone: 'bad' },
              ] as Array<{ l: string; d: string; icon: string; tone: 'soft' | 'bad' }>
            ).map((a, i) => (
              <button
                key={a.l}
                type="button"
                className="row-hov"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '9px 8px',
                  borderRadius: 'var(--r-sm)',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                  textAlign: 'left',
                  background: 'transparent',
                }}
              >
                <span
                  style={{
                    color: a.tone === 'bad' ? 'var(--bad)' : 'var(--ink-mute)',
                    display: 'inline-flex',
                    flexShrink: 0,
                  }}
                >
                  <CxIcon name={a.icon} size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="ui"
                    style={{
                      fontSize: 13,
                      color: a.tone === 'bad' ? 'var(--bad)' : 'var(--ink)',
                      fontWeight: 500,
                    }}
                  >
                    {a.l}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>
                    {a.d}
                  </div>
                </div>
                <CxIcon
                  name="chevron-right"
                  size={12}
                  style={{ color: 'var(--ink-faint)', flexShrink: 0 }}
                />
              </button>
            ))}
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  )
}
