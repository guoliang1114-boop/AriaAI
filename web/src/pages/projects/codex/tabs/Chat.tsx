import { CxIcon } from '../CxIcons'
import { CxProjectShell } from '../CxProjectShell'
import { CxStatus } from '../CxPrimitives'

interface ChatProps {
  projectId: string
}

const CONVERSATIONS = [
  { id: 'c1', title: '鼎和保险 · 数字化转型框架草稿', time: '刚刚' },
  { id: 'c2', title: '续保业务 KPI 拆解', time: '1 小时前' },
  { id: 'c3', title: '会前简报 · 6 月 3 日例会', time: '今早' },
  { id: 'c4', title: '决策链梳理初稿', time: '昨天' },
  { id: 'c5', title: 'POC 评估指标讨论', time: '2 天前' },
]

const ANSWER_LAYERS: Array<[string, string, string]> = [
  ['01', '业务层', '围绕续保与理赔两个高频场景,先建立数据闭环。'],
  ['02', '技术层', '以现有核心系统为锚,搭建轻量中台与 AI 推理层。'],
  ['03', '组织层', '设立 4 人 + 2 顾问的转型办公室,直接向 COO 汇报。'],
]

export function CxProjectChat({ projectId }: ChatProps) {
  return (
    <CxProjectShell activeTab="chat" projectId={projectId}>
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '260px 1fr',
          minHeight: 0,
        }}
      >
        {/* Conversation list */}
        <aside
          style={{
            borderRight: '1px solid var(--line)',
            padding: '20px 14px',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 12px',
              background: 'var(--ink)',
              color: 'var(--bg-elev)',
              borderRadius: 'var(--r-sm)',
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            <CxIcon name="plus" size={13} /> 新建对话
            <span style={{ marginLeft: 'auto', fontSize: 10.5, opacity: 0.6 }}>⌘N</span>
          </button>

          <div style={{ color: 'var(--ink-faint)', fontSize: 11, padding: '6px 10px' }}>今天</div>
          {CONVERSATIONS.slice(0, 3).map((c, i) => (
            <a
              key={c.id}
              href="#"
              className="row-hov"
              style={{
                display: 'block',
                padding: '8px 10px',
                borderRadius: 'var(--r-sm)',
                background: i === 0 ? 'var(--bg-tint)' : 'transparent',
                position: 'relative',
                textDecoration: 'none',
              }}
            >
              {i === 0 && (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: 'var(--accent)',
                    borderRadius: 99,
                  }}
                />
              )}
              <div
                style={{
                  fontSize: 13,
                  color: i === 0 ? 'var(--ink)' : 'var(--ink-soft)',
                  fontWeight: i === 0 ? 500 : 400,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{c.time}</div>
            </a>
          ))}

          <div style={{ color: 'var(--ink-faint)', fontSize: 11, padding: '14px 10px 4px' }}>
            更早
          </div>
          {CONVERSATIONS.slice(3).map((c) => (
            <a
              key={c.id}
              href="#"
              className="row-hov"
              style={{
                display: 'block',
                padding: '8px 10px',
                borderRadius: 'var(--r-sm)',
                textDecoration: 'none',
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{c.time}</div>
            </a>
          ))}
        </aside>

        {/* Thread column */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div
            style={{
              padding: '18px 40px 14px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h2
                className="ui"
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 500,
                  color: 'var(--ink)',
                  letterSpacing: '-0.015em',
                }}
              >
                鼎和保险 · 数字化转型框架草稿
              </h2>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ink-mute)',
                  marginTop: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span>项目对话</span>
                <span style={{ color: 'var(--ink-faint)' }}>·</span>
                <span>gpt-5</span>
                <span style={{ color: 'var(--ink-faint)' }}>·</span>
                <span>12 条消息</span>
                <span style={{ color: 'var(--ink-faint)' }}>·</span>
                <CxStatus tone="accent" pulse>
                  正在回复
                </CxStatus>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                style={{
                  padding: '6px 12px',
                  fontSize: 12.5,
                  color: 'var(--ink-soft)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                导出
              </button>
              <button type="button" style={{ padding: '6px 10px', color: 'var(--ink-mute)' }}>
                <CxIcon name="more" size={14} />
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              padding: '28px 56px',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 32,
              width: '100%',
            }}
          >
            {/* User */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 99,
                  background: 'var(--bg-tint)',
                  color: 'var(--ink-soft)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 500,
                  flexShrink: 0,
                }}
              >
                陈
              </span>
              <div style={{ flex: 1, paddingTop: 4 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 6 }}>
                  陈悦 · 14:32
                </div>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.75, color: 'var(--ink)' }}>
                  帮我把鼎和保险的数字化转型咨询拆成一个三层战略框架,引用最近三次会议纪要,并提示风险点。
                </p>
              </div>
            </div>

            {/* Assistant */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 99,
                  background: 'var(--accent-bg)',
                  color: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <CxIcon name="sparkle" size={14} />
              </span>
              <div style={{ flex: 1, paddingTop: 4 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-mute)',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ color: 'var(--accent-ink)', fontWeight: 500 }}>Aria</span>
                  <span>14:32 · gpt-5</span>
                  <span style={{ color: 'var(--ink-faint)' }}>·</span>
                  <span>
                    调用了 <span style={{ color: 'var(--accent)' }}>数字化战略分析</span>
                  </span>
                </div>

                <div
                  style={{
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                    padding: '10px 14px',
                    marginBottom: 16,
                    fontSize: 12,
                    color: 'var(--ink-soft)',
                    lineHeight: 1.7,
                  }}
                >
                  <div style={{ color: 'var(--ink-mute)', marginBottom: 4 }}>
                    检索了项目记忆与文档
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 16,
                      color: 'var(--ink-faint)',
                      fontSize: 11.5,
                    }}
                  >
                    <span>· 关键词「续保」 7 条</span>
                    <span>· 关键词「理赔」 5 条</span>
                    <span>· 2 份相关文档</span>
                  </div>
                </div>

                <p
                  style={{
                    margin: '0 0 14px',
                    fontSize: 14.5,
                    lineHeight: 1.75,
                    color: 'var(--ink)',
                  }}
                >
                  我把战略分成{' '}
                  <span style={{ color: 'var(--accent-ink)', fontWeight: 500 }}>
                    业务、技术、组织
                  </span>{' '}
                  三层,基于过去三次会议纪要
                  <sup style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 1 }}>[1][2][3]</sup>
                  :
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    rowGap: 14,
                    columnGap: 14,
                    marginBottom: 14,
                  }}
                >
                  {ANSWER_LAYERS.map(([n, t, d]) => (
                    <span key={n} style={{ display: 'contents' }}>
                      <span
                        className="num"
                        style={{
                          fontSize: 12,
                          color: 'var(--accent)',
                          paddingTop: 3,
                          fontWeight: 500,
                        }}
                      >
                        {n}
                      </span>
                      <div>
                        <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--ink)' }}>
                          {t}
                        </div>
                        <div
                          style={{
                            fontSize: 13.5,
                            color: 'var(--ink-soft)',
                            lineHeight: 1.7,
                            marginTop: 3,
                          }}
                        >
                          {d}
                        </div>
                      </div>
                    </span>
                  ))}
                </div>

                <p
                  style={{
                    margin: '12px 0 0',
                    fontSize: 13.5,
                    color: 'var(--ink-soft)',
                    lineHeight: 1.7,
                  }}
                >
                  主要风险点 — 数据治理基础薄弱、组织变革阻力。建议在 POC 阶段锁定 CTO 王浩与 COO
                  张丽两位关键决策人
                  <span className="cursor-blink" />
                </p>
              </div>
            </div>
          </div>

          {/* Composer */}
          <div style={{ padding: '0 56px 22px', width: '100%' }}>
            <div
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                padding: '14px 16px',
              }}
            >
              <div
                className="ui"
                style={{ fontSize: 14, color: 'var(--ink-faint)', minHeight: 42 }}
              >
                继续向 Aria 提问…
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--line-soft)',
                  fontSize: 12,
                  color: 'var(--ink-mute)',
                }}
              >
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <button
                    type="button"
                    style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <CxIcon name="paperclip" size={13} /> 附件
                  </button>
                  <button
                    type="button"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      color: 'var(--accent-ink)',
                    }}
                  >
                    @ 鼎和保险
                  </button>
                  <button
                    type="button"
                    style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    / Skill
                  </button>
                </div>
                <button
                  type="button"
                  style={{
                    padding: '5px 14px',
                    background: 'var(--accent)',
                    color: 'var(--bg-elev)',
                    borderRadius: 'var(--r-sm)',
                    fontSize: 12.5,
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  发送 <CxIcon name="arrow-right" size={11} stroke={1.8} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CxProjectShell>
  )
}
