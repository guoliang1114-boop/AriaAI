import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus } from '../CxPrimitives'

interface BriefingProps {
  projectId: string
}

const CARDS = [
  {
    title: '建议说什么',
    en: 'Say',
    tone: 'good' as const,
    items: [
      '聚焦续保数据闭环的 Q3 试点目标:从 38% 提到 50% 转化率',
      '提出我方建议的 4+2 组织架构:4 名核心 + 2 名顾问',
      '用最近一次理赔体验访谈数据,说明数据闭环的紧迫性',
    ],
  },
  {
    title: '尽量避开',
    en: 'Avoid',
    tone: 'warn' as const,
    items: [
      '理赔系统改造的具体技术方案(客户内部尚未对齐)',
      '明确报价 — 待方案 V2 评审后再谈',
      '组织变革的人员调整细节',
    ],
  },
  {
    title: '需要确认',
    en: 'Confirm',
    tone: 'neutral' as const,
    items: [
      '客户能否在 6 月前提供过去 12 个月的脱敏续保数据',
      'POC 评估的成功标准与时间节点',
      '组织变革方案是否需要董事会层面背书',
    ],
  },
  {
    title: '历史经验',
    en: 'Lessons',
    tone: 'info' as const,
    items: [
      '同行业类似项目:数据治理通常需要预留 2-3 个月清洗期',
      '鼎和过往合作:CTO 王浩偏好先做小范围验证再扩展',
      '保险行业数字化:监管报告口径需要在方案设计时就考虑',
    ],
  },
]

const TONE_COLOR = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  neutral: 'var(--ink-soft)',
  info: 'var(--info)',
} as const

const STAKEHOLDERS = [
  { n: '王浩', r: 'CTO', note: '决策 · 偏好小范围验证', attend: true },
  { n: '张丽', r: 'COO', note: '决策 · 业务背书', attend: true },
  { n: '王凯', r: '数字化办公室', note: '影响 · 推动', attend: true },
  { n: '李远', r: '财务总监', note: '可能列席', attend: false },
]

const SCHEDULE = [
  { d: '6/03', t: '客户例会', note: '本次准备', hi: true },
  { d: '6/05', t: 'POC 启动评审', note: '里程碑' },
  { d: '6/10', t: '提案 V2 内部对齐', note: '团队' },
  { d: '6/17', t: '客户中期复盘', note: '建议' },
]

const SOURCES = [
  { l: '项目记忆 v12', n: '5 个片段', src: 'sparkle' },
  { l: '续保访谈纪要', n: '2 次访谈', src: 'file' },
  { l: '上次例会纪要', n: '1 篇', src: 'sparkle' },
  { l: '客户记忆', n: '3 个偏好', src: 'user' },
]

export function CxProjectBriefing({ projectId }: BriefingProps) {
  return (
    <CxProjectShell activeTab="briefing" projectId={projectId}>
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
                  下次例会 · 6 月 3 日 周三 14:00 · 与 鼎和保险 数字化办公室
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
                  30 秒会前卡
                </h2>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-soft)' }}>
                  打开就看四件事 — 说什么、避开什么、确认什么、过去的教训
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={{
                    padding: '7px 12px',
                    fontSize: 12.5,
                    color: 'var(--ink-soft)',
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <CxIcon name="sparkle" size={12} /> 生成话术
                </button>
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
                  <CxIcon name="chat" size={12} /> 去对话准备
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {CARDS.map((card) => {
              const c = TONE_COLOR[card.tone]
              return (
                <section
                  key={card.title}
                  style={{
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-md)',
                    padding: '16px 18px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: c }} />
                    <h3
                      className="ui"
                      style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}
                    >
                      {card.title}
                    </h3>
                    <span style={{ fontSize: 11, color: 'var(--ink-faint)', marginLeft: 4 }}>
                      {card.en}
                    </span>
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {card.items.map((item, i) => (
                      <li
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 10,
                          fontSize: 13,
                          color: 'var(--ink)',
                          lineHeight: 1.6,
                        }}
                      >
                        <span
                          className="num"
                          style={{
                            fontSize: 11,
                            color: c,
                            paddingTop: 2,
                            fontWeight: 600,
                          }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>

          <CxPanel
            title="开场话术(AI 生成)"
            subtitle="基于上面四张卡片自动生成 · 可直接复制使用"
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
            <div
              style={{
                fontSize: 13.5,
                color: 'var(--ink)',
                lineHeight: 1.8,
                background: 'var(--bg-tint)',
                padding: '14px 16px',
                borderRadius: 'var(--r-sm)',
              }}
            >
              <p style={{ margin: '0 0 12px' }}>
                “
                <strong style={{ color: 'var(--accent-ink)' }}>王总、张总</strong>,今天我们想花
                30 分钟,跟两位同步一下 Q3 续保数据闭环试点的整体推进思路,顺便确认几个关键节点 ——”
              </p>
              <p style={{ margin: '0 0 12px' }}>
                “<strong>首先</strong>,我们对续保业务做了一轮深度访谈,发现现在转化率 38%
                的痛点主要集中在 30 天关键触达窗口缺数据。我们想先用一个轻量化的数据闭环 POC,把这个窗口的转化率提到 50%……”
              </p>
              <p style={{ margin: 0, color: 'var(--ink-mute)' }}>
                “<strong>接下来想跟两位确认</strong>:6 月之前我们能否拿到过去 12
                个月的脱敏续保数据?以及 POC 评估的成功标准,大家觉得应该看哪些指标?
                <span className="cursor-blink" />”
              </p>
            </div>
          </CxPanel>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel title="关键干系人" subtitle="到场预测">
            {STAKEHOLDERS.map((p) => (
              <div
                key={p.n}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '9px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 99,
                    background: p.attend ? 'var(--accent-bg)' : 'var(--bg-tint)',
                    color: p.attend ? 'var(--accent-ink)' : 'var(--ink-mute)',
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      className="ui"
                      style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}
                    >
                      {p.n}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>· {p.r}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                    {p.note}
                  </div>
                </div>
                {p.attend ? <CxStatus tone="good">到场</CxStatus> : <CxStatus tone="mute">可能</CxStatus>}
              </div>
            ))}
          </CxPanel>

          <CxPanel title="近期节奏">
            {SCHEDULE.map((m) => (
              <div
                key={m.d + m.t}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}
              >
                <span
                  className="num"
                  style={{
                    fontSize: 11.5,
                    color: m.hi ? 'var(--accent)' : 'var(--ink-mute)',
                    paddingTop: 1,
                    minWidth: 32,
                  }}
                >
                  {m.d}
                </span>
                <div style={{ flex: 1 }}>
                  <div
                    className="ui"
                    style={{
                      fontSize: 13,
                      color: 'var(--ink)',
                      fontWeight: m.hi ? 500 : 400,
                    }}
                  >
                    {m.t}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{m.note}</div>
                </div>
                {m.hi && (
                  <CxStatus tone="accent" pulse>
                    下次
                  </CxStatus>
                )}
              </div>
            ))}
          </CxPanel>

          <CxPanel title="资料依据" subtitle="本次卡片来源">
            {SOURCES.map((d, i) => (
              <div
                key={d.l}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 0',
                  borderBottom: i === SOURCES.length - 1 ? 'none' : '1px solid var(--line-soft)',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <CxIcon
                    name={d.src}
                    size={12}
                    style={{ color: 'var(--accent)', flexShrink: 0 }}
                  />
                  <span
                    style={{
                      fontSize: 12.5,
                      color: 'var(--ink)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {d.l}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--ink-mute)', flexShrink: 0 }}>{d.n}</span>
              </div>
            ))}
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  )
}
