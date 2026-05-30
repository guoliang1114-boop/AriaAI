import { Edit3 } from "lucide-react";
import type { ProjectFinancials } from "../../types/api";

interface ProjectFinancialsSummaryProps {
  financials: ProjectFinancials
  formatAmountInTenThousand: (amount: number | undefined | null) => string
  isZh: boolean
  onEditContractAmount: () => void
}

export function ProjectFinancialsSummary({
  financials,
  formatAmountInTenThousand,
  isZh,
  onEditContractAmount,
}: ProjectFinancialsSummaryProps) {
  const formatSummaryAmount = (amount: number | undefined | null): string => {
    if (isZh) {
      return `¥${formatAmountInTenThousand(amount)}万`
    }
    return `¥${(amount ?? 0).toLocaleString()}`
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-codex-line p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-codex-ink-mute">
              {isZh ? "合同金额" : "Contract"}
            </span>
            <button
              onClick={onEditContractAmount}
              className="p-1 rounded hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-ink-soft"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xl font-bold text-codex-ink">
            {financials.contract_amount
              ? formatSummaryAmount(financials.contract_amount)
              : isZh
                ? "未设置"
                : "Not set"}
          </p>
          {financials.contract_amount > 0 && (
            <div className="mt-2 w-full h-1.5 bg-codex-bg-tint rounded-full overflow-hidden">
              <div
                className="h-full bg-codex-accent-bg0 rounded-full"
                style={{
                  width: `${Math.min((financials.total_received / financials.contract_amount) * 100, 100)}%`,
                }}
              />
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-codex-line p-5">
          <span className="text-sm text-codex-ink-mute">
            {isZh ? "已收款" : "Received"}
          </span>
          <p className="text-xl font-bold text-codex-good">
            {formatSummaryAmount(financials.total_received)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-codex-line p-5">
          <span className="text-sm text-codex-ink-mute">
            {isZh ? "已开票" : "Invoiced"}
          </span>
          <p className="text-xl font-bold text-codex-accent">
            {formatSummaryAmount(financials.total_invoiced)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-codex-line p-5">
          <span className="text-sm text-codex-ink-mute">
            {isZh ? "支出" : "Expenses"}
          </span>
          <p className="text-xl font-bold text-codex-bad">
            {formatSummaryAmount(financials.total_expense)}
          </p>
        </div>
      </div>

      <div
        className={`rounded-xl p-4 flex items-center justify-between ${
          financials.remaining >= 0
            ? "bg-codex-accent-bg border border-codex-line"
            : "bg-codex-bg-tint border border-codex-line"
        }`}
      >
        <div>
          <span
            className={`text-sm ${
              financials.remaining >= 0 ? "text-codex-good" : "text-codex-bad"
            }`}
          >
            {isZh ? "净利润" : "Net Profit"}
          </span>
          <p
            className={`text-2xl font-bold ${
              financials.remaining >= 0 ? "text-codex-good" : "text-codex-bad"
            }`}
          >
            {financials.remaining >= 0 ? "+" : "-"}
            {formatSummaryAmount(Math.abs(financials.remaining))}
          </p>
        </div>
        <div className="text-right text-sm text-codex-ink-mute">
          <p>
            {isZh ? "未收款" : "Uncollected"}: {formatSummaryAmount(financials.uncollected)}
          </p>
          {financials.contract_amount > 0 && (
            <p>
              {isZh ? "支出占比" : "Expense"}:{" "}
              {((financials.total_expense / financials.contract_amount) * 100).toFixed(1)}
              %
            </p>
          )}
        </div>
      </div>
    </>
  )
}
