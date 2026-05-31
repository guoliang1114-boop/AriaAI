import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus } from '../CxPrimitives'

interface MemoryProps {
  projectId: string
}

const ANCHOR_GROUPS = [
  {
    title: '风险锚点',
    tone: 'bad' as const,
    items: ['理赔系统改造涉及核心交易', '数据治理委员会未成立', '脱敏方案需法务评审'],
  },
  {
    title: '待确认问题',
    tone: 'warn' as const,
    items: ['6 月前能否提供脱敏续保数据?', 'POC 评估的成功标准?'],
  },
  {
    title: '干系人提示',
    tone: 'info' as const,
    items: ['王浩偏好先做小范围验证'],
  },
]

const SLOTS = [
  {
    title: '客户背景 · Client Background',
    icon: 'building',
    body: '鼎和保险股份有限公司,深圳总部,3 万员工。主要业务覆盖财产险、车险、责任险三大类。2025 年总保费收入 480 亿,在区域市场排名前 5。已有完整核心系统,但分布在 5 个独立架构中。',
    sources: ['2026-05-22 战略对齐会', '2026-05-15 续保业务访谈'],
  },
  {
    title: '核心痛点 · Pain Points',
    icon: 'target',
    body: '续保转化下滑 — 当前 38%,行业平均 52%。理赔体验差 — NPS 评分 4.2(满分 10)。数据散落 — 客户、保单、理赔、收付分别在 5 个独立核心系统中,业务方查询需在多个系统跳转,日均报表准备时间约 4 小时。',
    sources: ['2026-05-15 续保访谈', '2026-05-08 数据治理评估'],
  },
  {
    title: '我方方案 · Our Proposal',
    icon: 'sparkle',
    body: '三层框架:业务层(续保 + 理赔数据闭环)、技术层(轻量中台 + AI 推理层)、组织层(4 + 2 转型办公室)。先做续保数据闭环 POC,Q3 W1 交付评估报告。',
    sources: ['项目记忆 v10', '方案 V1'],
  },
  {
    title: '决策链 · Decision Chain',
    icon: 'user',
    body: '技术拍板 — CTO 王浩(影响 90%);业务背书 — COO 张丽(影响 70%);推动执行 — 数字化办公室 王凯;财务审批 — CFO 李远(可能列席)。',
    sources: ['客户记忆 · 决策结构', '2026-05-22 会议'],
  },
  {
    title: '下一步 · Next Steps',
    icon: 'arrow-right',
    body: 'Q3 W1(6/30 前)交付 POC 评估报告;Q3 W3(7/14 前)提交方案 V2 修订版;Q3 W6 启动数据治理实施(条件:客户提供过去 12 个月脱敏数据)。',
    sources: ['项目里程碑'],
  },
]

const VERSIONS = [
  { v: 'v12', w: '陈悦', d: '2h ago', c: '调整核心痛点表述', curr: true },
  { v: 'v11', w: 'Aria', d: 'y’day', c: '新增 7 条记忆片段' },
  { v: 'v10', w: '陈悦', d: '3 days', c: '整理决策链' },
]

const SUGGESTIONS = [
  { t: '更新「核心痛点」', note: '续保访谈 V3 已上传 · 应纳入', action: '应用' },
  { t: '补充「竞品对比」', note: '槽位空缺 · 建议从行业资料生成', action: '生成' },
  { t: '刷新「下一步」', note: '里程碑已变更', action: '应用' },
]

export function CxProjectMemory({ projectId }: MemoryProps) {
  return (
    <CxProjectShell activeTab="memory" projectId={projectId}>
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
          {/* Memory header strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div>
                <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                  项目记忆 v12
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                  陈悦 在 2 小时前更新 · 由 11 次对话 + 12 份文档汇总
                </div>
              </div>
              <CxStatus tone="good">已同步</CxStatus>
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
                历史版本
              </button>
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
                对比 v11
              </button>
              <button
                type="button"
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  color: 'var(--bg-elev)',
                  background: 'var(--accent)',
                  borderRadius: 'var(--r-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <CxIcon name="sparkle" size={11} /> 重新汇总
              </button>
            </div>
          </div>

          {/* Anchors */}
          <div
            style={{
              background: 'linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--accent)', fontSize: 13 }}>★</span>
                <h3
                  className="ui"
                  style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}
                >
                  固定锚点 · 6 项
                </h3>
                <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                  会优先参与 AI 总结、风险判断与会前简报
                </span>
              </div>
              <button type="button" style={{ fontSize: 11.5, color: 'var(--accent)' }}>
                + 添加
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              {ANCHOR_GROUPS.map((g) => {
                const c =
                  g.tone === 'bad'
                    ? 'var(--bad)'
                    : g.tone === 'warn'
                      ? 'var(--warn)'
                      : 'var(--info)'
                return (
                  <div key={g.title}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 99, background: c }} />
                      <span
                        style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontWeight: 500 }}
                      >
                        {g.title}
                      </span>
                      <span
                        className="num"
                        style={{
                          fontSize: 10.5,
                          color: c,
                          fontWeight: 500,
                          marginLeft: 'auto',
                        }}
                      >
                        {g.items.length}
                      </span>
                    </div>
                    {g.items.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 7,
                          padding: '4px 0',
                          alignItems: 'flex-start',
                        }}
                      >
                        <span
                          style={{
                            width: 3,
                            height: 3,
                            marginTop: 7,
                            borderRadius: 99,
                            background: c,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.55 }}>
                          {t}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Section divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--ink-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              结构化记忆
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--line-soft)' }} />
          </div>

          {SLOTS.map((s) => (
            <section
              key={s.title}
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
                  marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 'var(--r-sm)',
                      background: 'var(--accent-bg)',
                      color: 'var(--accent)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CxIcon name={s.icon} size={13} />
                  </span>
                  <h3
                    className="ui"
                    style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}
                  >
                    {s.title}
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    style={{ fontSize: 11.5, color: 'var(--ink-mute)', padding: '4px 8px' }}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    style={{ fontSize: 11.5, color: 'var(--accent)', padding: '4px 8px' }}
                  >
                    固定 ★
                  </button>
                </div>
              </div>
              <p
                style={{
                  margin: '0 0 10px',
                  fontSize: 13.5,
                  color: 'var(--ink)',
                  lineHeight: 1.75,
                }}
              >
                {s.body}
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  paddingTop: 10,
                  borderTop: '1px solid var(--line-soft)',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>依据:</span>
                {s.sources.map((src) => (
                  <span
                    key={src}
                    style={{
                      fontSize: 11.5,
                      color: 'var(--accent)',
                      padding: '1px 6px',
                      background: 'var(--accent-bg)',
                      borderRadius: 'var(--r-sm)',
                    }}
                  >
                    {src}
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CxPanel title="记忆健康度">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4 }}>完整度</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                  <span
                    className="num"
                    style={{ fontSize: 22, color: 'var(--ink)', fontWeight: 500 }}
                  >
                    92
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>/ 100</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4 }}>新鲜度</div>
                <CxStatus tone="good">2h ago</CxStatus>
              </div>
            </div>
            <div
              style={{
                paddingTop: 10,
                borderTop: '1px solid var(--line-soft)',
                fontSize: 12,
                color: 'var(--ink-soft)',
                lineHeight: 1.7,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>已填写槽位</span>
                <span className="num">11 / 12</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>有引用依据</span>
                <span className="num" style={{ color: 'var(--good)' }}>
                  10 / 11
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>需复查</span>
                <span className="num" style={{ color: 'var(--warn)' }}>
                  1
                </span>
              </div>
            </div>
          </CxPanel>

          <CxPanel title="自动更新建议">
            {SUGGESTIONS.map((s, i) => (
              <div
                key={s.t}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '9px 0',
                  borderBottom: i === SUGGESTIONS.length - 1 ? 'none' : '1px solid var(--line-soft)',
                }}
              >
                <span
                  style={{
                    width: 5,
                    marginTop: 4,
                    height: 5,
                    borderRadius: 99,
                    background: 'var(--accent)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 500 }}>
                    {s.t}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                    {s.note}
                  </div>
                </div>
                <button
                  type="button"
                  style={{
                    fontSize: 11,
                    color: 'var(--accent)',
                    padding: '2px 8px',
                    border: '1px solid var(--accent-bg)',
                    background: 'var(--accent-bg)',
                    borderRadius: 'var(--r-sm)',
                    height: 22,
                    flexShrink: 0,
                  }}
                >
                  {s.action}
                </button>
              </div>
            ))}
          </CxPanel>

          <CxPanel
            title="版本历史"
            action={
              <a style={{ fontSize: 11.5, color: 'var(--ink-mute)' }} href="#">
                全部 →
              </a>
            }
          >
            {VERSIONS.map((v) => (
              <div
                key={v.v}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '7px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}
              >
                <span
                  className="num"
                  style={{
                    fontSize: 11.5,
                    color: v.curr ? 'var(--accent)' : 'var(--ink-mute)',
                    fontWeight: 500,
                    minWidth: 28,
                  }}
                >
                  {v.v}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{v.c}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>
                    {v.w} · {v.d}
                  </div>
                </div>
              </div>
            ))}
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  )
}
