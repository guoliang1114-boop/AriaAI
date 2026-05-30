import type { RefObject } from "react";
import { CheckCircle2, Edit3, Loader2 } from "lucide-react";
import type { ProjectStage } from "../../types/enums";
import { ProjectSettingsFormFields } from "./ProjectSettingsFormFields";

interface SuggestionItem {
  description: string;
  name: string;
}

interface ProjectSettingsFormData {
  client: string;
  contract_amount: number | string;
  description: string;
  end_date: string;
  name: string;
  notes: string;
  start_date: string;
  status: ProjectStage;
}

interface ProjectSettingsFormCardProps {
  aiError: string;
  clients: string[];
  formData: ProjectSettingsFormData;
  isAILoading: boolean;
  isEditing: boolean;
  isLoadingClients: boolean;
  isSaving: boolean;
  isZh: boolean;
  onApplySuggestion: (suggestion: SuggestionItem) => void;
  onCancel: () => void;
  onChange: (field: keyof ProjectSettingsFormData, value: string | number) => void;
  onEdit: () => void;
  onPolish: () => void;
  onSave: () => void;
  onSuggest: () => void;
  showSuggestions: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  suggestions: SuggestionItem[];
}

export function ProjectSettingsFormCard({
  aiError,
  clients,
  formData,
  isAILoading,
  isEditing,
  isLoadingClients,
  isSaving,
  isZh,
  onApplySuggestion,
  onCancel,
  onChange,
  onEdit,
  onPolish,
  onSave,
  onSuggest,
  showSuggestions,
  stageRef,
  suggestions,
}: ProjectSettingsFormCardProps) {
  return (
    <div className="rounded-xl border border-codex-line bg-white p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="font-semibold text-codex-ink">
          {isZh ? "项目信息" : "Project Information"}
        </h3>
        {!isEditing ? (
          <button
            onClick={onEdit}
            className="flex items-center gap-2 rounded-lg bg-codex-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-codex-accent/90"
          >
            <Edit3 className="h-4 w-4" />
            {isZh ? "编辑" : "Edit"}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={isSaving}
              className="rounded-lg border border-codex-line px-4 py-2 text-sm font-medium text-codex-ink-soft transition-colors hover:bg-codex-bg-tint disabled:opacity-50"
            >
              {isZh ? "取消" : "Cancel"}
            </button>
            <button
              onClick={onSave}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-codex-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-codex-accent/90 disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {isZh ? "保存" : "Save"}
            </button>
          </div>
        )}
      </div>

      <ProjectSettingsFormFields
        aiError={aiError}
        clients={clients}
        formData={formData}
        isAILoading={isAILoading}
        isEditing={isEditing}
        isLoadingClients={isLoadingClients}
        isZh={isZh}
        onApplySuggestion={onApplySuggestion}
        onChange={onChange}
        onPolish={onPolish}
        onSuggest={onSuggest}
        showSuggestions={showSuggestions}
        stageRef={stageRef}
        suggestions={suggestions}
      />
    </div>
  );
}
