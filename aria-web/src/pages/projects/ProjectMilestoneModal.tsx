import { Loader2, X } from "lucide-react";

interface MilestoneFormData {
  title: string
  due_date: string
  priority: "low" | "medium" | "high"
  is_done: boolean
}

interface ProjectMilestoneModalProps {
  formData: MilestoneFormData
  isEditing: boolean
  isSaving: boolean
  isZh: boolean
  onChange: (value: MilestoneFormData) => void
  onClose: () => void
  onSave: () => void
}

export function ProjectMilestoneModal({
  formData,
  isEditing,
  isSaving,
  isZh,
  onChange,
  onClose,
  onSave,
}: ProjectMilestoneModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">
            {isEditing
              ? isZh
                ? "编辑里程碑"
                : "Edit Milestone"
              : isZh
                ? "添加里程碑"
                : "Add Milestone"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "里程碑名称" : "Title"}
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(event) => onChange({ ...formData, title: event.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder={isZh ? "请输入里程碑名称" : "Enter milestone title"}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "截止日期" : "Due Date"}
            </label>
            <input
              type="date"
              value={formData.due_date}
              onChange={(event) => onChange({ ...formData, due_date: event.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "优先级" : "Priority"}
            </label>
            <select
              value={formData.priority}
              onChange={(event) =>
                onChange({
                  ...formData,
                  priority: event.target.value as "low" | "medium" | "high",
                })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="low">{isZh ? "低" : "Low"}</option>
              <option value="medium">{isZh ? "中" : "Medium"}</option>
              <option value="high">{isZh ? "高" : "High"}</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="milestone_is_done"
              checked={formData.is_done}
              onChange={(event) => onChange({ ...formData, is_done: event.target.checked })}
              className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <label htmlFor="milestone_is_done" className="text-sm text-gray-700">
              {isZh ? "已完成" : "Completed"}
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isZh ? "保存" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
