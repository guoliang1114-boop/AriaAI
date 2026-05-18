import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";

interface ProjectFinancialsContractAmountModalProps {
  currentAmount: number;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  projectId: string;
}

export function ProjectFinancialsContractAmountModal({
  currentAmount,
  isOpen,
  onClose,
  onSave,
  projectId,
}: ProjectFinancialsContractAmountModalProps) {
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
              楼
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
