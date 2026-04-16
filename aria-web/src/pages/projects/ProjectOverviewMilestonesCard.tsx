import { CheckCircle2, Circle, Flag } from "lucide-react";
import type { Milestone } from "../../types/api";

interface ProjectOverviewMilestonesCardProps {
  isZh: boolean
  milestones: Milestone[]
  onOpen: () => void
}

export function ProjectOverviewMilestonesCard({
  isZh,
  milestones,
  onOpen,
}: ProjectOverviewMilestonesCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center justify-between p-5 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Flag className="w-4 h-4 text-gray-400" />
          {isZh ? "里程碑" : "Milestones"}
        </h3>
        <button onClick={onOpen} className="text-sm text-primary hover:underline">
          {isZh ? "查看全部" : "View all"}
        </button>
      </div>
      <div className="p-5">
        {milestones.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm">{isZh ? "暂无里程碑" : "No milestones yet"}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {milestones.map((milestone) => (
              <div key={milestone.id} className="flex items-start gap-3">
                {milestone.is_done ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-300 mt-0.5" />
                )}
                <div className="flex-1">
                  <p
                    className={`text-sm ${milestone.is_done ? "text-gray-400 line-through" : "text-gray-900"}`}
                  >
                    {milestone.title}
                  </p>
                  {milestone.due_date && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {isZh ? "截止: " : "Due: "}
                      {new Date(milestone.due_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    milestone.priority === "high"
                      ? "bg-red-50 text-red-600"
                      : milestone.priority === "medium"
                        ? "bg-amber-50 text-amber-600"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {milestone.priority}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
