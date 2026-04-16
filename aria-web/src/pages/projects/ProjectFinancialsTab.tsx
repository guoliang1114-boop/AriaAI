import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import { ProjectFinancialsActions } from "./ProjectFinancialsActions";
import { ProjectFinancialsContractAmountModal } from "./ProjectFinancialsContractAmountModal";
import { ProjectFinancialsPaymentModal } from "./ProjectFinancialsPaymentModal";
import { ProjectFinancialsSummary } from "./ProjectFinancialsSummary";
import { ProjectFinancialsTransactions } from "./ProjectFinancialsTransactions";
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
  const { financials } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [defaultPaymentType, setDefaultPaymentType] = useState<PaymentType>("received");

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
