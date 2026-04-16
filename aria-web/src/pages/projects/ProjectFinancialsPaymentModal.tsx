import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import { ProjectFinancialsPaymentForm } from "./ProjectFinancialsPaymentForm";

type PaymentType = "received" | "invoiced" | "expense";

interface ProjectFinancialsPaymentModalProps {
  defaultType?: PaymentType;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  projectId: string;
}

export function ProjectFinancialsPaymentModal({
  defaultType = "received",
  isOpen,
  onClose,
  onSave,
  projectId,
}: ProjectFinancialsPaymentModalProps) {
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
      toast.error(isZh ? "添加失败" : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  const paymentTypeOptions: Array<{
    activeClass: string;
    labelEn: string;
    labelZh: string;
    value: PaymentType;
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

  const handleFieldChange = (field: "amount" | "payment_date" | "note", value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

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
          <ProjectFinancialsPaymentForm
            form={form}
            isZh={isZh}
            onChange={handleFieldChange}
            onPaymentTypeChange={(value) =>
              setForm((prev) => ({ ...prev, payment_type: value }))
            }
            options={paymentTypeOptions}
          />

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
