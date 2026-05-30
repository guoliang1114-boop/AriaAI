interface ProjectSettingsDangerZoneProps {
  isArchived: boolean;
  isZh: boolean;
  onArchive: () => void;
  onDelete: () => void;
}

export function ProjectSettingsDangerZone({
  isArchived,
  isZh,
  onArchive,
  onDelete,
}: ProjectSettingsDangerZoneProps) {
  return (
    <div className="rounded-xl border border-codex-line bg-white p-6">
      <h3 className="mb-4 font-semibold text-codex-bad">
        {isZh ? "风险操作" : "Danger Zone"}
      </h3>
      <div className="space-y-4">
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-medium text-codex-ink">
              {isZh ? "归档项目" : "Archive Project"}
            </p>
            <p className="text-sm text-codex-ink-mute">
              {isZh
                ? "将项目标记为已完成并归档。"
                : "Mark project as completed and archive it."}
            </p>
          </div>
          <button
            onClick={onArchive}
            disabled={isArchived}
            className="w-full rounded-lg border border-codex-line px-4 py-2 text-sm font-medium transition-colors hover:bg-codex-bg-tint disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isArchived
              ? isZh
                ? "已归档"
                : "Archived"
              : isZh
                ? "归档项目"
                : "Archive Project"}
          </button>
        </div>

        <div className="h-px bg-codex-bg-tint" />

        <div className="flex flex-col gap-3">
          <div>
            <p className="font-medium text-codex-bad">
              {isZh ? "删除项目" : "Delete Project"}
            </p>
            <p className="text-sm text-codex-ink-mute">
              {isZh
                ? "永久删除当前项目及其所有数据，此操作不可恢复。"
                : "Permanently delete this project and all its data. This cannot be undone."}
            </p>
          </div>
          <button
            onClick={onDelete}
            className="w-full rounded-lg border border-codex-line-soft bg-codex-bg-tint px-4 py-2 text-sm font-medium text-codex-bad transition-colors hover:bg-codex-bg-tint"
          >
            {isZh ? "删除项目" : "Delete Project"}
          </button>
        </div>
      </div>
    </div>
  );
}
