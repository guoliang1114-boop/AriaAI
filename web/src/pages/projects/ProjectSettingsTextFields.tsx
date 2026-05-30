interface ProjectSettingsTextFieldsProps {
  description: string;
  isEditing: boolean;
  isZh: boolean;
  notes: string;
  onChange: (field: "description" | "notes", value: string) => void;
}

export function ProjectSettingsTextFields({
  description,
  isEditing,
  isZh,
  notes,
  onChange,
}: ProjectSettingsTextFieldsProps) {
  return (
    <>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-codex-ink-soft">
          {isZh ? "项目描述" : "Description"}
        </label>
        <textarea
          value={description}
          onChange={(event) => onChange("description", event.target.value)}
          disabled={!isEditing}
          rows={4}
          className="w-full resize-none rounded-lg border border-codex-line bg-codex-bg-tint px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-codex-bg-tint disabled:text-codex-ink-mute"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-codex-ink-soft">
          {isZh ? "备注" : "Notes"}
        </label>
        <textarea
          value={notes}
          onChange={(event) => onChange("notes", event.target.value)}
          disabled={!isEditing}
          rows={3}
          className="w-full resize-none rounded-lg border border-codex-line bg-codex-bg-tint px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-codex-bg-tint disabled:text-codex-ink-mute"
        />
      </div>
    </>
  );
}
