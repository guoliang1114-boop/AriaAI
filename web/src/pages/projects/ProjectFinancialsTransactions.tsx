import { DollarSign, FileText, Receipt, Trash2, TrendingUp } from "lucide-react";
import type { ProjectPayment } from "../../types/api";
import { formatDateOnly } from "../../utils/timezone";

type PaymentFilter = "all" | "received" | "invoiced" | "expense";

interface ProjectFinancialsTransactionsProps {
  filter: PaymentFilter
  filteredPayments: ProjectPayment[]
  getPaymentColor: (type: ProjectPayment["payment_type"]) => string
  getPaymentLabel: (type: ProjectPayment["payment_type"]) => string
  isZh: boolean
  onDeletePayment: (paymentId: number) => void
  onFilterChange: (filter: PaymentFilter) => void
}

function PaymentIcon({ type }: { type: ProjectPayment["payment_type"] }) {
  switch (type) {
    case "received":
      return <TrendingUp className="w-5 h-5" />;
    case "invoiced":
      return <FileText className="w-5 h-5" />;
    case "expense":
      return <TrendingUp className="w-5 h-5 rotate-180" />;
    default:
      return <DollarSign className="w-5 h-5" />;
  }
}

export function ProjectFinancialsTransactions({
  filter,
  filteredPayments,
  getPaymentColor,
  getPaymentLabel,
  isZh,
  onDeletePayment,
  onFilterChange,
}: ProjectFinancialsTransactionsProps) {
  return (
    <div className="bg-white rounded-xl border border-codex-line">
      <div className="flex items-center justify-between p-5 border-b border-codex-line-soft">
        <h3 className="font-semibold text-codex-ink">
          {isZh ? "交易记录" : "Transactions"}
        </h3>
        <div className="flex items-center gap-2">
          {[
            {
              key: "all" as const,
              label: isZh ? "全部" : "All",
              activeClass: "bg-codex-bg-tint text-codex-ink-soft font-medium",
            },
            {
              key: "received" as const,
              label: isZh ? "收款" : "Received",
              activeClass: "bg-codex-accent-bg text-codex-good font-medium",
            },
            {
              key: "invoiced" as const,
              label: isZh ? "开票" : "Invoiced",
              activeClass: "bg-codex-accent-bg text-codex-accent-ink font-medium",
            },
            {
              key: "expense" as const,
              label: isZh ? "支出" : "Expense",
              activeClass: "bg-codex-bg-tint text-codex-bad font-medium",
            },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => onFilterChange(item.key)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === item.key ? item.activeClass : "text-codex-ink-soft hover:bg-codex-bg-tint"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {filteredPayments.length === 0 ? (
          <div className="text-center py-12 text-codex-ink-faint">
            <Receipt className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{isZh ? "暂无交易记录" : "No transactions yet"}</p>
          </div>
        ) : (
          filteredPayments.map((payment) => (
            <div
              key={payment.id}
              className="flex items-center justify-between p-5 hover:bg-codex-bg-tint transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${getPaymentColor(payment.payment_type)}`}
                >
                  <PaymentIcon type={payment.payment_type} />
                </div>
                <div>
                  <p className="font-medium text-codex-ink">
                    {getPaymentLabel(payment.payment_type)}
                  </p>
                  {payment.note && <p className="text-sm text-codex-ink-mute">{payment.note}</p>}
                  <p className="text-xs text-codex-ink-faint mt-0.5">
                    {formatDateOnly(payment.payment_date)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span
                  className={`font-semibold ${
                    payment.payment_type === "expense"
                      ? "text-codex-bad"
                      : payment.payment_type === "invoiced"
                        ? "text-codex-accent"
                        : "text-codex-good"
                  }`}
                >
                  {payment.payment_type === "expense" ? "-" : "+"}¥
                  {Math.abs(payment.amount).toLocaleString()}
                </span>
                <button
                  onClick={() => onDeletePayment(payment.id)}
                  className="p-2 rounded-lg text-codex-ink-faint hover:text-codex-bad hover:bg-codex-bg-tint opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
