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
    <div className="rounded-xl border border-red-200 bg-white p-6">
      <h3 className="mb-4 font-semibold text-red-600">
        {isZh ? "风险操作" : "Danger Zone"}
      </h3>
      <div className="space-y-4">
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-medium text-gray-900">
              {isZh ? "归档项目" : "Archive Project"}
            </p>
            <p className="text-sm text-gray-500">
              {isZh
                ? "将项目标记为已完成并归档。"
                : "Mark project as completed and archive it."}
            </p>
          </div>
          <button
            onClick={onArchive}
            disabled={isArchived}
            className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
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

        <div className="h-px bg-red-100" />

        <div className="flex flex-col gap-3">
          <div>
            <p className="font-medium text-red-600">
              {isZh ? "删除项目" : "Delete Project"}
            </p>
            <p className="text-sm text-gray-500">
              {isZh
                ? "永久删除当前项目及其所有数据，此操作不可恢复。"
                : "Permanently delete this project and all its data. This cannot be undone."}
            </p>
          </div>
          <button
            onClick={onDelete}
            className="w-full rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-100"
          >
            {isZh ? "删除项目" : "Delete Project"}
          </button>
        </div>
      </div>
    </div>
  );
}
