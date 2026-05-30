interface ProjectMilestonesProgressCardProps {
  completedCount: number
  isZh: boolean
  progress: number
  totalCount: number
}

export function ProjectMilestonesProgressCard({
  completedCount,
  isZh,
  progress,
  totalCount,
}: ProjectMilestonesProgressCardProps) {
  return (
    <div className="bg-white rounded-xl border border-codex-line p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-codex-ink">
            {isZh ? "项目进度" : "Project Progress"}
          </h3>
          <p className="text-sm text-codex-ink-mute mt-1">
            {completedCount} {isZh ? "已完成，共" : "completed of"} {totalCount}{" "}
            {isZh ? "个里程碑" : "milestones"}
          </p>
        </div>
        <span className="text-2xl font-bold text-codex-ink">{progress.toFixed(0)}%</span>
      </div>
      <div className="h-3 bg-codex-bg-tint rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
