import { FileText, Plus, TrendingUp } from "lucide-react";

interface ProjectFinancialsActionsProps {
  isZh: boolean
  onAddExpense: () => void
  onAddInvoice: () => void
  onAddPayment: () => void
}

export function ProjectFinancialsActions({
  isZh,
  onAddExpense,
  onAddInvoice,
  onAddPayment,
}: ProjectFinancialsActionsProps) {
  return (
    <div className="flex gap-3">
      <button
        onClick={onAddPayment}
        className="flex-1 flex items-center justify-center gap-2 p-3 bg-codex-good text-white rounded-xl font-medium hover:bg-codex-good transition-colors"
      >
        <Plus className="w-5 h-5" />
        {isZh ? "收款" : "Payment"}
      </button>
      <button
        onClick={onAddInvoice}
        className="flex-1 flex items-center justify-center gap-2 p-3 bg-codex-accent-bg text-codex-accent-ink rounded-xl font-medium hover:bg-codex-accent-bg transition-colors"
      >
        <FileText className="w-5 h-5" />
        {isZh ? "开票" : "Invoice"}
      </button>
      <button
        onClick={onAddExpense}
        className="flex-1 flex items-center justify-center gap-2 p-3 bg-codex-bg-tint text-codex-bad rounded-xl font-medium hover:bg-codex-bg-tint transition-colors"
      >
        <TrendingUp className="w-5 h-5 rotate-180" />
        {isZh ? "支出" : "Expense"}
      </button>
    </div>
  )
}
