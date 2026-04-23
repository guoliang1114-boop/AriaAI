import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import { ProjectMemoryInsightCard } from "./ProjectMemoryInsightCard";
import { ProjectFinancialsActions } from "./ProjectFinancialsActions";
import { ProjectFinancialsContractAmountModal } from "./ProjectFinancialsContractAmountModal";
import { ProjectFinancialsPaymentModal } from "./ProjectFinancialsPaymentModal";
import { ProjectFinancialsSummary } from "./ProjectFinancialsSummary";
import { ProjectFinancialsTransactions } from "./ProjectFinancialsTransactions";
import { useProjectMemorySummary } from "./useProjectMemorySummary";
import type {
  ProjectDetail as ProjectDetailType,
  ProjectPayment,
} from "../../types/api";

type PaymentFilter = "all" | "received" | "invoiced" | "expense";
type PaymentType = "received" | "invoiced" | "expense";

interface ProjectFinancialsTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}

const formatAmountInTenThousand = (amount: number | undefined | null): string => {
  if (!amount || amount === 0) return "0";
  const tenThousand = amount / 10000;
  if (tenThousand < 1) {
    return amount.toLocaleString("zh-CN");
  }
  const hasFraction = tenThousand % 1 !== 0;
  return hasFraction
    ? tenThousand.toLocaleString("zh-CN", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    : tenThousand.toLocaleString("zh-CN");
};

export function ProjectFinancialsTab({
  projectDetail,
  projectId,
  onUpdate,
}: ProjectFinancialsTabProps) {
  const { financials, project } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const financialInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成财务风险摘要失败，请稍后重试" : "Failed to generate financial risk summary",
    language: i18n.language,
    memoryVersion: project.memory_version ?? 0,
    projectId,
    summaryType: "financial",
  });
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [defaultPaymentType, setDefaultPaymentType] = useState<PaymentType>("received");
  const hasFinancialData =
    (financials.contract_amount || 0) > 0 ||
    (financials.total_received || 0) > 0 ||
    (financials.total_expense || 0) > 0 ||
    (financials.total_invoiced || 0) > 0 ||
    (financials.payments || []).length > 0;

  const filteredPayments = useMemo(
    () =>
      (financials.payments || []).filter(
        (payment) => filter === "all" || payment.payment_type === filter,
      ),
    [filter, financials.payments],
  );

  const handleDeletePayment = async (paymentId: number) => {
    const confirmed = confirm(
      isZh
        ? "确定要删除这条记录吗？"
        : "Are you sure you want to delete this record?",
    );
    if (!confirmed) return;

    try {
      await api.delete(`/projects/${projectId}/financials/${paymentId}`);
      onUpdate();
    } catch (error) {
      console.error("Failed to delete payment:", error);
      toast.error(isZh ? "删除失败" : "Failed to delete");
    }
  };

  const getPaymentColor = (type: ProjectPayment["payment_type"]) => {
    switch (type) {
      case "received":
        return "bg-emerald-100 text-emerald-600";
      case "invoiced":
        return "bg-blue-100 text-blue-600";
      case "expense":
        return "bg-red-100 text-red-600";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

  const getPaymentLabel = (type: ProjectPayment["payment_type"]) => {
    switch (type) {
      case "received":
        return isZh ? "收款" : "Received";
      case "invoiced":
        return isZh ? "开票" : "Invoiced";
      case "expense":
        return isZh ? "支出" : "Expense";
      default:
        return type;
    }
  };

  return (
    <div className="w-full space-y-6">
      <ProjectMemoryInsightCard
        content={financialInsight.content}
        emptyDescription={
          hasFinancialData
            ? isZh
              ? "财务记录已存在，但当前记忆版本还没有财务摘要。点击生成财务摘要后，会只刷新财务维度，避免长请求超时。"
              : "Financial records exist, but this memory version does not have a financial summary yet. Generate will refresh only the financial view to avoid long request timeouts."
            : isZh
              ? "当前项目还没有合同金额、回款、开票或支出记录。可先补充财务数据；也可以生成财务摘要，让 AI 明确标记财务数据暂缺。"
              : "This project has no contract, received, invoiced, or expense records yet. Add financial data first, or generate the financial summary so AI can mark financial data as missing."
        }
        emptyTitle={
          hasFinancialData
            ? isZh
              ? "财务摘要尚未生成"
              : "Financial summary not generated"
            : isZh
              ? "财务数据为空"
              : "No financial data"
        }
        error={financialInsight.error}
        generated={financialInsight.generated}
        hint={
          isZh
            ? "基于项目记忆整理当前财务风险、回款关注点和需要优先处理的阻塞项"
            : "Structured-memory risk view for financial signals, collections, and blockers"
        }
        isZh={isZh}
        loading={financialInsight.loading}
        actionLabel={
          financialInsight.content || financialInsight.generated
            ? isZh ? "重新生成财务摘要" : "Regenerate financial summary"
            : isZh ? "生成财务摘要" : "Generate financial summary"
        }
        onRefresh={() => {
          void financialInsight.refresh(true);
        }}
        title={isZh ? "AI 财务风险摘要" : "AI Financial Risk Summary"}
      />

      <ProjectFinancialsSummary
        financials={financials}
        formatAmountInTenThousand={formatAmountInTenThousand}
        isZh={isZh}
        onEditContractAmount={() => setShowContractModal(true)}
      />

      <ProjectFinancialsActions
        isZh={isZh}
        onAddExpense={() => {
          setDefaultPaymentType("expense");
          setShowPaymentModal(true);
        }}
        onAddInvoice={() => {
          setDefaultPaymentType("invoiced");
          setShowPaymentModal(true);
        }}
        onAddPayment={() => {
          setDefaultPaymentType("received");
          setShowPaymentModal(true);
        }}
      />

      <ProjectFinancialsTransactions
        filter={filter}
        filteredPayments={filteredPayments}
        getPaymentColor={getPaymentColor}
        getPaymentLabel={getPaymentLabel}
        isZh={isZh}
        onDeletePayment={handleDeletePayment}
        onFilterChange={setFilter}
      />

      <ProjectFinancialsPaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSave={onUpdate}
        projectId={projectId}
        defaultType={defaultPaymentType}
      />
      <ProjectFinancialsContractAmountModal
        isOpen={showContractModal}
        onClose={() => setShowContractModal(false)}
        currentAmount={financials.contract_amount || 0}
        projectId={projectId}
        onSave={onUpdate}
      />
    </div>
  );
}
