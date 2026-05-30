import { Circle, DollarSign, ListTodo, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { ProjectFinancials, ProjectTodo } from "../../types/api";

interface ProjectOverviewSidebarProps {
  financials: ProjectFinancials;
  formatAmount: (amount: number | undefined | null) => string;
  isZh: boolean;
  memoryCard?: ReactNode;
  skillWorkflowsCard?: ReactNode;
  onGoToDocuments: () => void;
  onGoToFinancials: () => void;
  onGoToMilestones: () => void;
  onGoToTodos: () => void;
  recentTodos: ProjectTodo[];
}

export function ProjectOverviewSidebar({
  financials,
  formatAmount,
  isZh,
  memoryCard,
  skillWorkflowsCard,
  onGoToDocuments,
  onGoToFinancials,
  onGoToMilestones,
  onGoToTodos,
  recentTodos,
}: ProjectOverviewSidebarProps) {
  return (
    <div className="col-span-12 space-y-4 lg:col-span-4">
      <div className="rounded-xl border border-codex-line bg-white p-4">
        <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold leading-5 text-codex-ink">
          <DollarSign className="w-4 h-4 text-codex-ink-faint" />
          {isZh ? "财务状况" : "Financials"}
        </h3>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-[13px] leading-5 text-codex-ink-mute">
              {isZh ? "合同金额" : "Contract"}
            </span>
            <span className="text-[13px] font-semibold leading-5 text-codex-ink">
              CNY {formatAmount(financials.contract_amount)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[13px] leading-5 text-codex-ink-mute">
              {isZh ? "已收款" : "Received"}
            </span>
            <span className="text-[13px] font-semibold leading-5 text-codex-good">
              CNY {financials.total_received.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[13px] leading-5 text-codex-ink-mute">
              {isZh ? "已开票" : "Invoiced"}
            </span>
            <span className="text-[13px] font-semibold leading-5 text-codex-accent">
              CNY {financials.total_invoiced.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[13px] leading-5 text-codex-ink-mute">
              {isZh ? "支出" : "Expenses"}
            </span>
            <span className="text-[13px] font-semibold leading-5 text-codex-bad">
              CNY {financials.total_expense.toLocaleString()}
            </span>
          </div>
          <div className="h-px bg-codex-bg-tint" />
          <div className="flex justify-between items-center">
            <span className="text-[13px] font-medium leading-5 text-codex-ink-soft">
              {isZh ? "未收款" : "Outstanding"}
            </span>
            <span className="text-[13px] font-semibold leading-5 text-codex-ink">
              CNY {financials.uncollected.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {memoryCard}

      {skillWorkflowsCard}

      <div className="bg-white rounded-xl border border-codex-line">
        <div className="flex items-center justify-between border-b border-codex-line-soft p-4">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold leading-5 text-codex-ink">
            <ListTodo className="w-4 h-4 text-codex-ink-faint" />
            {isZh ? "最近待办" : "Recent Todos"}
          </h3>
          <button onClick={onGoToTodos} className="text-xs font-medium text-primary hover:underline">
            {isZh ? "查看全部" : "View all"}
          </button>
        </div>
        <div className="p-4">
          {recentTodos.length === 0 ? (
            <div className="text-center py-4 text-codex-ink-faint">
              <p className="text-[13px] leading-5">{isZh ? "暂无待办事项" : "No pending todos"}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTodos.map((todo) => (
                <div key={todo.id} className="flex items-start gap-3">
                  <Circle className="w-5 h-5 text-codex-ink-faint mt-0.5" />
                  <p className="truncate text-[13px] leading-5 text-codex-ink">{todo.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-codex-line bg-white p-4">
        <h3 className="mb-3 text-[13px] font-semibold leading-5 text-codex-ink">
          {isZh ? "快捷操作" : "Quick Actions"}
        </h3>
        <div className="space-y-2">
          <button
            onClick={onGoToMilestones}
            className="flex w-full items-center gap-2.5 rounded-lg p-2.5 text-left transition-colors hover:bg-codex-bg-tint"
          >
            <div className="w-8 h-8 rounded-lg bg-codex-accent-bg flex items-center justify-center">
              <Plus className="w-4 h-4 text-codex-accent" />
            </div>
            <span className="text-[13px] font-medium leading-5 text-codex-ink-soft">
              {isZh ? "添加里程碑" : "Add Milestone"}
            </span>
          </button>
          <button
            onClick={onGoToDocuments}
            className="flex w-full items-center gap-2.5 rounded-lg p-2.5 text-left transition-colors hover:bg-codex-bg-tint"
          >
            <div className="w-8 h-8 rounded-lg bg-codex-accent-bg flex items-center justify-center">
              <Plus className="w-4 h-4 text-codex-good" />
            </div>
            <span className="text-[13px] font-medium leading-5 text-codex-ink-soft">
              {isZh ? "上传文档" : "Upload Document"}
            </span>
          </button>
          <button
            onClick={onGoToFinancials}
            className="flex w-full items-center gap-2.5 rounded-lg p-2.5 text-left transition-colors hover:bg-codex-bg-tint"
          >
            <div className="w-8 h-8 rounded-lg bg-codex-bg-tint flex items-center justify-center">
              <Plus className="w-4 h-4 text-codex-warn" />
            </div>
            <span className="text-[13px] font-medium leading-5 text-codex-ink-soft">
              {isZh ? "记录收款" : "Record Payment"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
