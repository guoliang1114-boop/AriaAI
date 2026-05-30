import { Calendar, CheckCircle2, Edit3, Flag, Plus, Trash2 } from "lucide-react";
import type { Milestone } from "../../types/api";
import { formatDateOnly } from "../../utils/timezone";

interface ProjectMilestonesListProps {
  isZh: boolean
  milestones: Milestone[]
  onAdd: () => void
  onDelete: (milestone: Milestone) => void
  onEdit: (milestone: Milestone) => void
  onToggleDone: (milestone: Milestone) => void
}

export function ProjectMilestonesList({
  isZh,
  milestones,
  onAdd,
  onDelete,
  onEdit,
  onToggleDone,
}: ProjectMilestonesListProps) {
  return (
    <div className="bg-white rounded-xl border border-codex-line">
      <div className="flex items-center justify-between p-5 border-b border-codex-line-soft">
        <h3 className="font-semibold text-codex-ink">
          {isZh ? "里程碑列表" : "Milestones"}
        </h3>
        <button
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2 bg-codex-accent text-white rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          {isZh ? "添加" : "Add"}
        </button>
      </div>
      <div className="divide-y divide-gray-100">
        {milestones.length === 0 ? (
          <div className="text-center py-12 text-codex-ink-faint">
            <Flag className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{isZh ? "暂无里程碑" : "No milestones yet"}</p>
          </div>
        ) : (
          milestones.map((milestone, index) => (
            <div
              key={milestone.id}
              className="flex items-start gap-4 p-5 hover:bg-codex-bg-tint transition-colors group"
            >
              <div className="flex flex-col items-center">
                <button
                  onClick={() => onToggleDone(milestone)}
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                    milestone.is_done
                      ? "bg-codex-accent-bg0 border-codex-line-soft0"
                      : "border-codex-line-strong hover:border-primary"
                  }`}
                >
                  {milestone.is_done && <CheckCircle2 className="w-4 h-4 text-white" />}
                </button>
                {index < milestones.length - 1 && <div className="w-0.5 h-full bg-codex-bg-tint my-2" />}
              </div>
              <div className="flex-1 pb-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h4
                      className={`font-medium ${
                        milestone.is_done ? "text-codex-ink-faint line-through" : "text-codex-ink"
                      }`}
                    >
                      {milestone.title}
                    </h4>
                    {milestone.due_date && (
                      <div className="flex items-center gap-2 mt-2">
                        <Calendar className="w-3.5 h-3.5 text-codex-ink-faint" />
                        <span
                          className={`text-xs ${
                            !milestone.is_done && new Date(milestone.due_date) < new Date()
                              ? "text-codex-bad"
                              : "text-codex-ink-mute"
                          }`}
                        >
                          {isZh ? "截止: " : "Due: "}
                          {formatDateOnly(milestone.due_date)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span
                      className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                        milestone.priority === "high"
                          ? "bg-codex-bg-tint text-codex-bad"
                          : milestone.priority === "medium"
                            ? "bg-codex-bg-tint text-codex-warn"
                            : "bg-codex-bg-tint text-codex-ink-soft"
                      }`}
                    >
                      {milestone.priority}
                    </span>
                    <button
                      onClick={() => onEdit(milestone)}
                      className="p-2 rounded-lg hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-accent"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDelete(milestone)}
                      className="p-2 rounded-lg hover:bg-codex-bg-tint text-codex-ink-faint hover:text-codex-bad"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
