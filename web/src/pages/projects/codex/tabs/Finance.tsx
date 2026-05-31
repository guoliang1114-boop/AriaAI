import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus, type CxTone } from '../CxPrimitives'

interface FinanceProps {
  projectId: string
}

const KPIS = [
  { l: '合同总额', v: '¥280', u: '万', tone: 'neutral' as const, sub: '含税 · 一次签订' },
  { l: '已回款', v: '¥84', u: '万', tone: 'good' as const, sub: '30% · 预付款' },
  { l: '应收余额', v: '¥196', u: '万', tone: 'accent' as const, sub: '70% 待收' },
  { l: '预估毛利率', v: '42', u: '%', tone: 'neutral' as const, sub: '毛利 ¥118 万' },
]

const SCHEDULE = [
  { node: '预付款', pctp: '30%', amt: '¥84 万', due: '2026-04-20', state: 'received' as const, inv: '已开票' },
  { node: 'POC 验收款', pctp: '30%', amt: '¥84 万', due: '2026-06-30', state: 'invoiced' as const, inv: '已开票' },
  { node: '方案交付款', pctp: '25%', amt: '¥70 万', due: '2026-08-15', state: 'pending' as const, inv: '待开票' },
  { node: '尾款', pctp: '15%', amt: '¥42 万', due: '2026-09-30', state: 'pending' as const, inv: '待开票' },
]

const STATE_MAP: Record<'received' | 'invoiced' | 'pending', [string, CxTone]> = {
  received: ['已回款', 'good'],
  invoiced: ['待回款', 'warn'],
  pending: ['未到期', 'neutral'],
}

const COSTS: Array<[string, string]> = [
  ['顾问人天', '320 人天'],
  ['人力成本', '¥138 万'],
  ['差旅 / 其他', '¥24 万'],
  ['成本合计', '¥162 万'],
]

const INVOICES = [
  { code: 'INV-2026-0418', amt: '¥84 万', date: '2026-04-18', status: '已回款', tone: 'good' as const },
  {
    code: 'INV-2026-0605',
    amt: '¥84 万',
    date: '2026-06-05',
    status: '待回款 · 25 天',
    tone: 'warn' as const,
  },
]

const SCHED_GRID = '1.4fr 60px 90px 110px 90px'

export function CxProjectFinance({ projectId }: FinanceProps) {
  return (
    <CxProjectShell activeTab="finance" projectId={projectId}>
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '24px 40px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          minWidth: 0,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {KPIS.map((k) => (
            <div
              key={k.l}
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                padding: '16px 18px',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{k.l}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 8 }}>
                <span
                  className="num"
                  style={{
                    fontSize: 26,
                    fontWeight: 500,
                    lineHeight: 1,
                    color:
                      k.tone === 'good'
                        ? 'var(--good)'
                        : k.tone === 'accent'
                          ? 'var(--accent-ink)'
                          : 'var(--ink)',
                  }}
                >
                  {k.v}
                </span>
                <span className="num" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
                  {k.u}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 7 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        <CxPanel title="回款进度" subtitle="已回款 ¥84 万 / 合同 ¥280 万 · 30%">
          <div
            style={{
              display: 'flex',
              height: 10,
              borderRadius: 99,
              overflow: 'hidden',
              background: 'var(--bg-tint)',
              marginTop: 2,
            }}
          >
            <div style={{ width: '30%', background: 'var(--good)' }} />
            <div
              style={{
                width: '30%',
                background: 'color-mix(in oklch, var(--warn) 60%, transparent)',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 18,
              marginTop: 12,
              fontSize: 11.5,
              color: 'var(--ink-mute)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--good)' }} />
              已回款 30%
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: 'color-mix(in oklch, var(--warn) 60%, transparent)',
                }}
              />
              已开票待回款 30%
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--bg-tint)' }} />
              未到期 40%
            </span>
          </div>
        </CxPanel>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, minWidth: 0 }}>
          <CxPanel
            title="收款计划"
            subtitle="按里程碑节点收款"
            action={
              <button type="button" style={{ fontSize: 12, color: 'var(--accent)' }}>
                导出对账单
              </button>
            }
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: SCHED_GRID,
                gap: 12,
                padding: '0 4px 8px',
                fontSize: 11,
                color: 'var(--ink-faint)',
                borderBottom: '1px solid var(--line-soft)',
              }}
            >
              <span>付款节点</span>
              <span>比例</span>
              <span>金额</span>
              <span>计划日期</span>
              <span>状态</span>
            </div>
            {SCHEDULE.map((r, i) => {
              const [sl, st] = STATE_MAP[r.state]
              return (
                <div
                  key={r.node}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: SCHED_GRID,
                    gap: 12,
                    padding: '12px 4px',
                    alignItems: 'center',
                    borderBottom:
                      i === SCHEDULE.length - 1 ? 'none' : '1px solid var(--line-soft)',
                  }}
                >
                  <div>
                    <div className="ui" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                      {r.node}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>
                      {r.inv}
                    </div>
                  </div>
                  <span className="num" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                    {r.pctp}
                  </span>
                  <span className="num" style={{ fontSize: 13, color: 'var(--ink)' }}>
                    {r.amt}
                  </span>
                  <span className="num" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                    {r.due}
                  </span>
                  <CxStatus tone={st}>{sl}</CxStatus>
                </div>
              )
            })}
          </CxPanel>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <CxPanel title="成本与毛利">
              <div style={{ fontSize: 12.5 }}>
                {COSTS.map(([k, v], i) => (
                  <div
                    key={k}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '7px 0',
                      borderBottom: i === COSTS.length - 1 ? 'none' : '1px solid var(--line-soft)',
                      fontWeight: i === COSTS.length - 1 ? 500 : 400,
                    }}
                  >
                    <span
                      style={{
                        color: i === COSTS.length - 1 ? 'var(--ink)' : 'var(--ink-mute)',
                      }}
                    >
                      {k}
                    </span>
                    <span className="num" style={{ color: 'var(--ink)' }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  background: 'var(--accent-bg)',
                  borderRadius: 'var(--r-sm)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--accent-ink)' }}>预估毛利</span>
                <span
                  className="num"
                  style={{ fontSize: 15, fontWeight: 500, color: 'var(--accent-ink)' }}
                >
                  ¥118 万 · 42%
                </span>
              </div>
            </CxPanel>

            <CxPanel title="开票记录">
              {INVOICES.map((iv, i) => (
                <div
                  key={iv.code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 0',
                    borderBottom:
                      i === INVOICES.length - 1 ? 'none' : '1px solid var(--line-soft)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="num" style={{ fontSize: 12, color: 'var(--ink)' }}>
                      {iv.code}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                      {iv.date}
                    </div>
                  </div>
                  <span className="num" style={{ fontSize: 13, color: 'var(--ink)' }}>
                    {iv.amt}
                  </span>
                  <CxStatus tone={iv.tone}>{iv.status}</CxStatus>
                </div>
              ))}
            </CxPanel>
          </aside>
        </div>
      </div>
    </CxProjectShell>
  )
}
