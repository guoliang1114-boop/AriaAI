import type { ProjectDetail as ProjectDetailType, ProjectPayment } from '../../../../types/api'
import { CxProjectShell } from '../CxProjectShell'
import { CxPanel, CxStatus, type CxTone } from '../CxPrimitives'
import { formatAmountWan } from '../useProjectsApi'

interface FinanceProps {
  projectId: number
  detail: ProjectDetailType
}

const SCHED_GRID = '1.4fr 80px 110px 110px 90px'

const PAYMENT_LABEL: Record<ProjectPayment['payment_type'], [string, CxTone]> = {
  received: ['已回款', 'good'],
  invoiced: ['已开票待回款', 'warn'],
  milestone_payment: ['里程碑收款', 'accent'],
  expense: ['支出', 'mute'],
}

export function CxProjectFinance({ projectId, detail }: FinanceProps) {
  const { project, financials } = detail
  const contract = financials.contract_amount || project.contract_amount || 0
  const received = financials.total_received || 0
  const uncollected = financials.uncollected || 0
  const remaining = financials.remaining || 0
  const totalExpense = financials.total_expense || 0

  const pctReceived = contract ? Math.min(100, Math.round((received / contract) * 100)) : 0
  const pctInvoiced = contract ? Math.min(100 - pctReceived, Math.round((uncollected / contract) * 100)) : 0

  const incoming = financials.payments.filter((p) => p.payment_type !== 'expense')
  const expenses = financials.payments.filter((p) => p.payment_type === 'expense')

  return (
    <CxProjectShell activeTab="finance" projectId={projectId} project={project}>
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
          <KpiCard label="合同总额" value={formatAmountWan(contract)} tone="neutral" sub="项目签订金额" />
          <KpiCard
            label="已回款"
            value={formatAmountWan(received)}
            tone="good"
            sub={contract ? `${pctReceived}% 完成` : '—'}
          />
          <KpiCard
            label="已开票待回款"
            value={formatAmountWan(uncollected)}
            tone="warn"
            sub={contract ? `${pctInvoiced}% 待收` : '—'}
          />
          <KpiCard
            label="剩余应收"
            value={formatAmountWan(remaining)}
            tone="accent"
            sub="未到收款节点"
          />
        </div>

        <CxPanel
          title="回款进度"
          subtitle={`已回款 ${formatAmountWan(received)} / 合同 ${formatAmountWan(contract)}`}
        >
          {contract === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>
              尚未录入合同金额。
            </div>
          ) : (
            <>
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
                <div style={{ width: `${pctReceived}%`, background: 'var(--good)' }} />
                <div
                  style={{
                    width: `${pctInvoiced}%`,
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
                <LegendDot label={`已回款 ${pctReceived}%`} color="var(--good)" />
                <LegendDot
                  label={`已开票待回款 ${pctInvoiced}%`}
                  color="color-mix(in oklch, var(--warn) 60%, transparent)"
                />
                <LegendDot
                  label={`未到期 ${Math.max(0, 100 - pctReceived - pctInvoiced)}%`}
                  color="var(--bg-tint)"
                />
              </div>
            </>
          )}
        </CxPanel>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, minWidth: 0 }}>
          <CxPanel
            title="收款记录"
            subtitle={`${incoming.length} 笔`}
            action={
              <button type="button" style={{ fontSize: 12, color: 'var(--accent)' }}>
                + 添加收款
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
              <span>说明</span>
              <span>类型</span>
              <span>金额</span>
              <span>日期</span>
              <span>状态</span>
            </div>
            {incoming.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '14px 4px' }}>
                还没有收款记录。
              </div>
            ) : (
              incoming.map((r, i) => {
                const [label, tone] = PAYMENT_LABEL[r.payment_type]
                return (
                  <div
                    key={r.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: SCHED_GRID,
                      gap: 12,
                      padding: '12px 4px',
                      alignItems: 'center',
                      borderBottom:
                        i === incoming.length - 1 ? 'none' : '1px solid var(--line-soft)',
                    }}
                  >
                    <div
                      className="ui"
                      style={{
                        fontSize: 13,
                        color: 'var(--ink)',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.note || '—'}
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>{label}</span>
                    <span className="num" style={{ fontSize: 13, color: 'var(--ink)' }}>
                      {formatAmountWan(r.amount)}
                    </span>
                    <span className="num" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                      {r.payment_date}
                    </span>
                    <CxStatus tone={tone}>{label}</CxStatus>
                  </div>
                )
              })
            )}
          </CxPanel>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <CxPanel title="成本与支出">
              <div style={{ fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0' }}>
                  <span style={{ color: 'var(--ink-mute)' }}>累计支出</span>
                  <span className="num" style={{ color: 'var(--ink)' }}>
                    {formatAmountWan(totalExpense)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0' }}>
                  <span style={{ color: 'var(--ink-mute)' }}>累计开票</span>
                  <span className="num" style={{ color: 'var(--ink)' }}>
                    {formatAmountWan(financials.total_invoiced)}
                  </span>
                </div>
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
                <span style={{ fontSize: 12, color: 'var(--accent-ink)' }}>已回款 / 合同</span>
                <span
                  className="num"
                  style={{ fontSize: 15, fontWeight: 500, color: 'var(--accent-ink)' }}
                >
                  {pctReceived}%
                </span>
              </div>
            </CxPanel>

            <CxPanel title="支出记录">
              {expenses.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>暂无支出记录。</div>
              ) : (
                expenses.map((e, i) => (
                  <div
                    key={e.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 0',
                      borderBottom:
                        i === expenses.length - 1 ? 'none' : '1px solid var(--line-soft)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ui" style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                        {e.note || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                        {e.payment_date}
                      </div>
                    </div>
                    <span className="num" style={{ fontSize: 13, color: 'var(--ink)' }}>
                      {formatAmountWan(e.amount)}
                    </span>
                  </div>
                ))
              )}
            </CxPanel>
          </aside>
        </div>
      </div>
    </CxProjectShell>
  )
}

function KpiCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string
  value: string
  tone: 'neutral' | 'good' | 'warn' | 'accent'
  sub: string
}) {
  return (
    <div
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: '16px 18px',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 8 }}>
        <span
          className="num"
          style={{
            fontSize: 26,
            fontWeight: 500,
            lineHeight: 1,
            color:
              tone === 'good'
                ? 'var(--good)'
                : tone === 'warn'
                  ? 'var(--warn)'
                  : tone === 'accent'
                    ? 'var(--accent-ink)'
                    : 'var(--ink)',
          }}
        >
          {value}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 7 }}>{sub}</div>
    </div>
  )
}

function LegendDot({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      {label}
    </span>
  )
}
