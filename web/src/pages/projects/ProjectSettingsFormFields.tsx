import type { RefObject } from "react";
import type { ProjectStage } from "../../types/enums";
import { ProjectSettingsAIAssistant } from "./ProjectSettingsAIAssistant";
import { ProjectSettingsBasicFields } from "./ProjectSettingsBasicFields";
import { ProjectSettingsStageField } from "./ProjectSettingsStageField";
import { ProjectSettingsTextFields } from "./ProjectSettingsTextFields";

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

interface ProjectSettingsFormFieldsProps {
  aiError: string;
  clients: string[];
  formData: ProjectSettingsFormData;
  isAILoading: boolean;
  isEditing: boolean;
  isLoadingClients: boolean;
  isZh: boolean;
  onApplySuggestion: (suggestion: SuggestionItem) => void;
  onChange: (field: keyof ProjectSettingsFormData, value: string | number) => void;
  onPolish: () => void;
  onSuggest: () => void;
  showSuggestions: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  suggestions: SuggestionItem[];
}

export function ProjectSettingsFormFields({
  aiError,
  clients,
  formData,
  isAILoading,
  isEditing,
  isLoadingClients,
  isZh,
  onApplySuggestion,
  onChange,
  onPolish,
  onSuggest,
  showSuggestions,
  stageRef,
  suggestions,
}: ProjectSettingsFormFieldsProps) {
  return (
    <div className="space-y-4">
      <ProjectSettingsBasicFields
        client={formData.client}
        clients={clients}
        contractAmount={formData.contract_amount}
        endDate={formData.end_date}
        isEditing={isEditing}
        isLoadingClients={isLoadingClients}
        isZh={isZh}
        name={formData.name}
        onChange={(field, value) => onChange(field, value)}
        startDate={formData.start_date}
      />

      <div ref={stageRef}>
        <ProjectSettingsStageField
          isEditing={isEditing}
          isZh={isZh}
          onChange={(value) => onChange("status", value)}
          value={formData.status}
        />
      </div>

      {isEditing && (
        <ProjectSettingsAIAssistant
          aiError={aiError}
          description={formData.description}
          isAILoading={isAILoading}
          isZh={isZh}
          onApplySuggestion={onApplySuggestion}
          onPolish={onPolish}
          onSuggest={onSuggest}
          showSuggestions={showSuggestions}
          suggestions={suggestions}
        />
      )}

      <ProjectSettingsTextFields
        description={formData.description}
        isEditing={isEditing}
        isZh={isZh}
        notes={formData.notes}
        onChange={(field, value) => onChange(field, value)}
      />
    </div>
  );
}
