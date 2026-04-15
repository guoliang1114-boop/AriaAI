import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  DollarSign,
  Edit3,
  FileText,
  Plus,
  Receipt,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
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

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  projectId: string;
  defaultType?: PaymentType;
}

function PaymentModal({
  isOpen,
  onClose,
  onSave,
  projectId,
  defaultType = "received",
}: PaymentModalProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const [form, setForm] = useState({
    amount: "",
    payment_date: new Date().toISOString().split("T")[0],
    note: "",
    payment_type: defaultType,
  });
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.amount) return;

    setSaving(true);
    try {
      await api.post(`/projects/${projectId}/financials`, {
        amount: parseFloat(form.amount),
        payment_date: form.payment_date,
        note: form.note,
        payment_type: form.payment_type,
      });
      onSave();
      onClose();
    } catch (error) {
      console.error("Failed to add payment:", error);
      toast.error(isZh ? "新增失败" : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  const paymentTypeOptions: Array<{
    value: PaymentType;
    labelZh: string;
    labelEn: string;
    activeClass: string;
  }> = [
    {
      value: "received",
      labelZh: "收款",
      labelEn: "Received",
      activeClass: "bg-emerald-50 border-emerald-200 text-emerald-700",
    },
    {
      value: "invoiced",
      labelZh: "开票",
      labelEn: "Invoiced",
      activeClass: "bg-blue-50 border-blue-200 text-blue-700",
    },
    {
      value: "expense",
      labelZh: "支出",
      labelEn: "Expense",
      activeClass: "bg-red-50 border-red-200 text-red-700",
    },
  ];

  const title =
    form.payment_type === "received"
      ? isZh
        ? "记录收款"
        : "Record Payment"
      : form.payment_type === "invoiced"
        ? isZh
          ? "记录开票"
          : "Record Invoice"
        : isZh
          ? "记录支出"
          : "Record Expense";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isZh ? "类型" : "Type"}
            </label>
            <div className="flex gap-2">
              {paymentTypeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, payment_type: option.value }))}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    form.payment_type === option.value
                      ? option.activeClass
                      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {isZh ? option.labelZh : option.labelEn}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isZh ? "金额" : "Amount"}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                ¥
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.amount}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, amount: event.target.value }))
                }
                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isZh ? "日期" : "Date"}
            </label>
            <input
              type="date"
              required
              value={form.payment_date}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, payment_date: event.target.value }))
              }
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isZh ? "备注" : "Note"}
            </label>
            <input
              type="text"
              value={form.note}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, note: event.target.value }))
              }
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder={isZh ? "可选" : "Optional"}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              {isZh ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={saving || !form.amount}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (isZh ? "保存中..." : "Saving...") : isZh ? "保存" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ContractAmountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAmount: number;
  projectId: string;
  onSave: () => void;
}

function ContractAmountModal({
  isOpen,
  onClose,
  currentAmount,
  projectId,
  onSave,
}: ContractAmountModalProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const [amount, setAmount] = useState(currentAmount.toString());
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/projects/${projectId}`, {
        contract_amount: parseFloat(amount) || 0,
      });
      onSave();
      onClose();
    } catch (error) {
      console.error("Failed to update contract amount:", error);
      toast.error(isZh ? "更新失败" : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm m-4 p-5">
        <h3 className="text-lg font-bold text-gray-900 mb-4">
          {isZh ? "设置合同金额" : "Set Contract Amount"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              ¥
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="0.00"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              {isZh ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90"
            >
              {saving ? (isZh ? "保存中..." : "Saving...") : isZh ? "保存" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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

  const getPaymentIcon = (type: ProjectPayment["payment_type"]) => {
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">
              {isZh ? "合同金额" : "Contract"}
            </span>
            <button
              onClick={() => setShowContractModal(true)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xl font-bold text-gray-900">
            {financials.contract_amount
              ? `¥${formatAmountInTenThousand(financials.contract_amount)}${isZh ? "万" : "K"}`
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
            ¥{financials.total_received.toLocaleString()}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm text-gray-500">
            {isZh ? "已开票" : "Invoiced"}
          </span>
          <p className="text-xl font-bold text-blue-600">
            ¥{financials.total_invoiced.toLocaleString()}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm text-gray-500">
            {isZh ? "支出" : "Expenses"}
          </span>
          <p className="text-xl font-bold text-red-600">
            ¥{financials.total_expense.toLocaleString()}
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
            {financials.remaining >= 0 ? "+" : "-"}¥
            {Math.abs(financials.remaining).toLocaleString()}
          </p>
        </div>
        <div className="text-right text-sm text-gray-500">
          <p>
            {isZh ? "未收款" : "Uncollected"}: ¥
            {financials.uncollected.toLocaleString()}
          </p>
          {financials.contract_amount > 0 && (
            <p>
              {isZh ? "支出占比" : "Expense"}:{" "}
              {(
                (financials.total_expense / financials.contract_amount) *
                100
              ).toFixed(1)}
              %
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => {
            setDefaultPaymentType("received");
            setShowPaymentModal(true);
          }}
          className="flex-1 flex items-center justify-center gap-2 p-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          {isZh ? "收款" : "Payment"}
        </button>
        <button
          onClick={() => {
            setDefaultPaymentType("invoiced");
            setShowPaymentModal(true);
          }}
          className="flex-1 flex items-center justify-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-xl font-medium hover:bg-blue-100 transition-colors"
        >
          <FileText className="w-5 h-5" />
          {isZh ? "开票" : "Invoice"}
        </button>
        <button
          onClick={() => {
            setDefaultPaymentType("expense");
            setShowPaymentModal(true);
          }}
          className="flex-1 flex items-center justify-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl font-medium hover:bg-red-100 transition-colors"
        >
          <TrendingUp className="w-5 h-5 rotate-180" />
          {isZh ? "支出" : "Expense"}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">
            {isZh ? "交易记录" : "Transactions"}
          </h3>
          <div className="flex items-center gap-2">
            {[
              {
                key: "all" as const,
                label: isZh ? "全部" : "All",
                activeClass: "bg-gray-100 text-gray-700 font-medium",
              },
              {
                key: "received" as const,
                label: isZh ? "收款" : "Received",
                activeClass: "bg-emerald-50 text-emerald-700 font-medium",
              },
              {
                key: "invoiced" as const,
                label: isZh ? "开票" : "Invoiced",
                activeClass: "bg-blue-50 text-blue-700 font-medium",
              },
              {
                key: "expense" as const,
                label: isZh ? "支出" : "Expense",
                activeClass: "bg-red-50 text-red-700 font-medium",
              },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  filter === item.key
                    ? item.activeClass
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {filteredPayments.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Receipt className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{isZh ? "暂无交易记录" : "No transactions yet"}</p>
            </div>
          ) : (
            filteredPayments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between p-5 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${getPaymentColor(payment.payment_type)}`}
                  >
                    {getPaymentIcon(payment.payment_type)}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {getPaymentLabel(payment.payment_type)}
                    </p>
                    {payment.note && (
                      <p className="text-sm text-gray-500">{payment.note}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(payment.payment_date).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className={`font-semibold ${
                      payment.payment_type === "expense"
                        ? "text-red-600"
                        : payment.payment_type === "invoiced"
                          ? "text-blue-600"
                          : "text-emerald-600"
                    }`}
                  >
                    {payment.payment_type === "expense" ? "-" : "+"}¥
                    {Math.abs(payment.amount).toLocaleString()}
                  </span>
                  <button
                    onClick={() => handleDeletePayment(payment.id)}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSave={onUpdate}
        projectId={projectId}
        defaultType={defaultPaymentType}
      />
      <ContractAmountModal
        isOpen={showContractModal}
        onClose={() => setShowContractModal(false)}
        currentAmount={financials.contract_amount || 0}
        projectId={projectId}
        onSave={onUpdate}
      />
    </div>
  );
}
