import { Calendar, ChevronDown, DollarSign, Edit3, User } from "lucide-react";
import { resolveProjectStage } from "../../types/enums";

interface ProjectOverviewInfoCardProps {
  contractAmountText: string;
  createdAt: string;
  descExpanded: boolean;
  description?: string | null;
  isZh: boolean;
  notes?: string | null;
  onEdit: () => void;
  onToggleDescription: () => void;
  projectClient: string;
  projectStatus: string;
}

export function ProjectOverviewInfoCard({
  contractAmountText,
  createdAt,
  descExpanded,
  description,
  isZh,
  notes,
  onEdit,
  onToggleDescription,
  projectClient,
  projectStatus,
}: ProjectOverviewInfoCardProps) {
  const stage = resolveProjectStage(projectStatus);
  const Icon = stage.icon;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">
          {isZh ? "项目基本信息" : "Project Info"}
        </h3>
        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
        >
          <Edit3 className="w-4 h-4" />
          {isZh ? "编辑" : "Edit"}
        </button>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{isZh ? "阶段：" : "Stage:"}</span>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${stage.bgColor} ${stage.color} ${stage.borderColor}`}
          >
            <Icon className="w-3 h-3" />
            {isZh ? stage.labelZh : stage.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <User className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-600">
            {isZh ? "客户：" : "Client: "}
            {projectClient}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-600">
            {isZh ? "创建时间：" : "Created: "}
            {createdAt}
          </span>
        </div>
        {contractAmountText && (
          <div className="flex items-center gap-3">
            <DollarSign className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600">
              {isZh ? "合同金额：" : "Contract: "}
              {contractAmountText}
            </span>
          </div>
        )}
        {description && (
          <div className="pt-3 border-t border-gray-100">
            <button
              onClick={onToggleDescription}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors w-full text-left mb-1"
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${descExpanded ? "rotate-180" : ""}`}
              />
              {isZh ? "项目描述" : "Description"}
            </button>
            {descExpanded && (
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{description}</p>
            )}
          </div>
        )}
        {notes && (
          <div className="pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-1">{isZh ? "备注" : "Notes"}</p>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
