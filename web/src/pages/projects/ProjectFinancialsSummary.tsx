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
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">
              {isZh ? "合同金额" : "Contract"}
            </span>
            <button
              onClick={onEditContractAmount}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xl font-bold text-gray-900">
            {financials.contract_amount
              ? formatSummaryAmount(financials.contract_amount)
              : isZh
                ? "未设置"
                : "Not set"}
          </p>
          {financials.contract_amount > 0 && (
            <div className="mt-2 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{
                  width: `${Math.min((financials.total_received / financials.contract_amount) * 100, 100)}%`,
                }}
              />
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm text-gray-500">
            {isZh ? "已收款" : "Received"}
          </span>
          <p className="text-xl font-bold text-emerald-600">
            {formatSummaryAmount(financials.total_received)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm text-gray-500">
            {isZh ? "已开票" : "Invoiced"}
          </span>
          <p className="text-xl font-bold text-blue-600">
            {formatSummaryAmount(financials.total_invoiced)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm text-gray-500">
            {isZh ? "支出" : "Expenses"}
          </span>
          <p className="text-xl font-bold text-red-600">
            {formatSummaryAmount(financials.total_expense)}
          </p>
        </div>
      </div>

      <div
        className={`rounded-xl p-4 flex items-center justify-between ${
          financials.remaining >= 0
            ? "bg-emerald-50 border border-emerald-200"
            : "bg-red-50 border border-red-200"
        }`}
      >
        <div>
          <span
            className={`text-sm ${
              financials.remaining >= 0 ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {isZh ? "净利润" : "Net Profit"}
          </span>
          <p
            className={`text-2xl font-bold ${
              financials.remaining >= 0 ? "text-emerald-900" : "text-red-900"
            }`}
          >
            {financials.remaining >= 0 ? "+" : "-"}
            {formatSummaryAmount(Math.abs(financials.remaining))}
          </p>
        </div>
        <div className="text-right text-sm text-gray-500">
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
