import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  Check,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
} from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type {
  Milestone,
  ProjectDetail as ProjectDetailType,
  ProjectMemory,
  ProjectMemoryResponse,
} from "../../types/api";
import { useEffect } from "react";
import { ProjectMilestoneModal } from "./ProjectMilestoneModal";
import { ProjectTodoCreateForm } from "./ProjectTodoCreateForm";
import { ProjectTodoDeleteDialog } from "./ProjectTodoDeleteDialog";
import { CxPanel } from "./ProjectOverviewPanels";
import { useProjectTodosManager } from "./useProjectTodosManager";
import { formatDateOnly, parseAppDateTime } from "../../utils/timezone";

interface ProjectMilestonesTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}

type MilestoneStatus = "done" | "in-progress" | "next" | "planned";

interface RequestError {
  message?: string;
  response?: { data?: { detail?: string } };
}

function getApiErrorMessage(error: unknown) {
  const requestError = error as RequestError;
  return requestError.response?.data?.detail || requestError.message || "";
}

function milestoneStatus(milestone: Milestone, nextMilestoneId: number | null): MilestoneStatus {
  if (milestone.is_done) return "done";
  if (milestone.id === nextMilestoneId) return "next";
  if (milestone.due_date) {
    const dueTime = parseAppDateTime(milestone.due_date).getTime();
    if (Number.isFinite(dueTime) && dueTime <= Date.now()) return "in-progress";
  }
  return "planned";
}

const STATUS_COLOR: Record<MilestoneStatus, string> = {
  done: "var(--color-codex-good)",
  "in-progress": "var(--color-codex-accent)",
  next: "var(--color-codex-accent)",
  planned: "var(--color-codex-line-strong, var(--color-codex-line))",
};

const STATUS_LABEL_ZH: Record<MilestoneStatus, string> = {
  done: "已完成",
  "in-progress": "进行中",
  next: "下一个",
  planned: "计划",
};
const STATUS_LABEL_EN: Record<MilestoneStatus, string> = {
  done: "Done",
  "in-progress": "Active",
  next: "Next",
  planned: "Planned",
};

export function ProjectMilestonesTab({
  projectDetail,
  projectId,
  onUpdate,
}: ProjectMilestonesTabProps) {
  const { milestones, project, todos } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();

  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.get<ProjectMemoryResponse>(`/projects/${projectId}/memory`);
        if (!cancelled) {
          setMemory(data.memory);
          setMemoryLoaded(true);
        }
      } catch (error) {
        console.error("Failed to load project memory:", error);
        if (!cancelled) setMemoryLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const [showModal, setShowModal] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    due_date: "",
    priority: "medium" as "low" | "medium" | "high",
    is_done: false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const completedCount = milestones.filter((milestone) => milestone.is_done).length;
  const progress = milestones.length > 0 ? completedCount / milestones.length : 0;

  // Order milestones chronologically by due_date so the timeline reads top-to-bottom.
  const orderedMilestones = useMemo(
    () =>
      [...milestones].sort((a, b) => {
        const aTime = parseAppDateTime(a.due_date || a.created_at || "").getTime();
        const bTime = parseAppDateTime(b.due_date || b.created_at || "").getTime();
        const aValid = Number.isFinite(aTime);
        const bValid = Number.isFinite(bTime);
        if (!aValid && !bValid) return 0;
        if (!aValid) return 1;
        if (!bValid) return -1;
        return aTime - bTime;
      }),
    [milestones],
  );

  // The "next" milestone is the first non-done milestone closest in the future.
  const nextMilestoneId = useMemo(() => {
    const now = Date.now();
    const upcoming = orderedMilestones
      .filter((m) => !m.is_done && parseAppDateTime(m.due_date || "").getTime() >= now)
      .sort(
        (a, b) =>
          parseAppDateTime(a.due_date || "").getTime() -
          parseAppDateTime(b.due_date || "").getTime(),
      );
    return upcoming[0]?.id ?? null;
  }, [orderedMilestones]);

  // Velocity metrics: planned span, days elapsed, avg interval, forecast drift.
  const velocity = useMemo(() => {
    const dated = orderedMilestones
      .map((m) => parseAppDateTime(m.due_date || "").getTime())
      .filter((value) => Number.isFinite(value)) as number[];
    if (dated.length < 2) return null;
    const planned = (dated[dated.length - 1] - dated[0]) / 86_400_000;
    const elapsed = (Date.now() - dated[0]) / 86_400_000;
    const intervals = dated.slice(1).map((value, idx) => (value - dated[idx]) / 86_400_000);
    const avgInterval = intervals.reduce((sum, value) => sum + value, 0) / Math.max(intervals.length, 1);
    // Forecast drift: compare actual completion ratio vs expected by date.
    const expectedRatio = Math.max(0, Math.min(1, elapsed / Math.max(planned, 1)));
    const actualRatio = progress;
    const drift = Math.round((expectedRatio - actualRatio) * planned);
    return {
      planned: Math.round(planned),
      elapsed: Math.max(0, Math.round(elapsed)),
      avgInterval: Math.round(avgInterval),
      drift,
    };
  }, [orderedMilestones, progress]);

  const handleAdd = () => {
    setEditingMilestone(null);
    setFormData({ title: "", due_date: "", priority: "medium", is_done: false });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      toast.warning(isZh ? "请输入里程碑名称" : "Please enter milestone title");
      return;
    }
    setIsSaving(true);
    try {
      if (editingMilestone) {
        await api.patch(`/projects/${projectId}/milestones/${editingMilestone.id}`, formData);
      } else {
        await api.post(`/projects/${projectId}/milestones`, formData);
      }
      await onUpdate();
      setShowModal(false);
    } catch (error) {
      const message = getApiErrorMessage(error);
      console.error("Failed to save milestone:", error);
      toast.error(isZh ? `保存失败: ${message}` : `Failed to save: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleMilestone = async (milestone: Milestone) => {
    try {
      await api.patch(`/projects/${projectId}/milestones/${milestone.id}`, {
        is_done: !milestone.is_done,
      });
      await onUpdate();
    } catch (error) {
      const message = getApiErrorMessage(error);
      console.error("Failed to toggle milestone:", error);
      toast.error(isZh ? `更新失败: ${message}` : `Failed to update: ${message}`);
    }
  };

  const todosManager = useProjectTodosManager({
    isZh,
    onUpdate,
    projectId,
    showError: toast.error,
    todos,
  });

  const openTodos = todos.filter((todo) => !todo.is_done);
  const doneThisWeek = todos.filter((todo) => {
    if (!todo.is_done) return false;
    const updated = parseAppDateTime(todo.updated_at || todo.created_at || "").getTime();
    return Number.isFinite(updated) && Date.now() - updated < 7 * 86_400_000;
  });
  const highPriorityCount = openTodos.filter((todo) =>
    parseAppDateTime(todo.due_date || "").getTime() < Date.now() + 86_400_000,
  ).length;

  const projectRisks = (memory?.key_risks || []).filter(Boolean).slice(0, 3);

  return (
    <div
      className="grid gap-6"
      style={{ gridTemplateColumns: "minmax(0, 1fr) 300px", alignItems: "start" }}
    >
      <div className="flex min-w-0 flex-col" style={{ gap: 18 }}>
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between" style={{ gap: 12 }}>
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 500,
                color: "var(--color-codex-ink)",
                letterSpacing: "-0.015em",
              }}
            >
              {isZh
                ? `里程碑 · ${completedCount} / ${milestones.length} 完成`
                : `Milestones · ${completedCount} / ${milestones.length}`}
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
              }}
            >
              {velocity
                ? isZh
                  ? `共 ${velocity.planned} 天 · 已过 ${velocity.elapsed} 天`
                  : `${velocity.planned} planned days · ${velocity.elapsed} elapsed`
                : isZh
                  ? "未设置里程碑时间"
                  : "No timeline yet"}
            </p>
          </div>
          <div className="flex" style={{ gap: 6 }}>
            <button
              type="button"
              onClick={() => toast.info(isZh ? "导出甘特即将上线" : "Gantt export is coming")}
              className="inline-flex items-center transition-colors"
              style={{
                gap: 5,
                padding: "6px 12px",
                fontSize: 12,
                color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-sm, 6px)",
                background: "transparent",
              }}
            >
              <ArrowDownToLine className="h-3 w-3" />
              {isZh ? "导出甘特" : "Export Gantt"}
            </button>
            <button
              type="button"
              onClick={handleAdd}
              className="inline-flex items-center transition-colors"
              style={{
                gap: 5,
                padding: "6px 12px",
                fontSize: 12,
                background: "var(--color-codex-ink)",
                color: "var(--color-codex-bg-elev)",
                borderRadius: "var(--codex-r-sm, 6px)",
                border: "none",
              }}
            >
              <Plus className="h-3 w-3" />
              {isZh ? "添加里程碑" : "Add milestone"}
            </button>
          </div>
        </div>

        {/* Progress strip */}
        <div
          style={{
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 8px)",
            padding: "18px 20px",
          }}
        >
          <div
            className="flex items-baseline justify-between"
            style={{ marginBottom: 12, gap: 12 }}
          >
            <div>
              <span
                style={{
                  fontFamily:
                    'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                  fontSize: 22,
                  color: "var(--color-codex-ink)",
                  fontWeight: 500,
                }}
              >
                {Math.round(progress * 100)}%
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--color-codex-ink-mute)",
                  marginLeft: 8,
                }}
              >
                {isZh ? "整体进度" : "Overall progress"}
              </span>
            </div>
            {velocity ? (
              <span style={{ fontSize: 11.5, color: "var(--color-codex-ink-mute)" }}>
                {isZh
                  ? `已过 ${velocity.elapsed} / ${velocity.planned} 天`
                  : `${velocity.elapsed} / ${velocity.planned} days elapsed`}
              </span>
            ) : null}
          </div>
          <div
            style={{
              height: 8,
              background: "var(--color-codex-bg-tint)",
              borderRadius: 99,
              overflow: "hidden",
              display: "flex",
            }}
          >
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                background: "var(--color-codex-accent)",
              }}
            />
            {velocity ? (
              <div
                style={{
                  width: `${Math.min(20, Math.round((velocity.elapsed / Math.max(velocity.planned, 1)) * 100) - Math.round(progress * 100))}%`,
                  background: "var(--color-codex-accent-bg)",
                }}
              />
            ) : null}
          </div>
        </div>

        {/* Vertical timeline */}
        <div
          style={{
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 8px)",
            padding: "20px 24px",
          }}
        >
          {milestones.length === 0 ? (
            <div
              style={{
                padding: "32px 8px",
                textAlign: "center",
                color: "var(--color-codex-ink-mute)",
                fontSize: 12.5,
              }}
            >
              {isZh ? "暂无里程碑。点 + 添加来排出 Q3 节奏。" : "No milestones yet. Add one to outline cadence."}
            </div>
          ) : (
            <div className="relative" style={{ paddingLeft: 22 }}>
              <div
                style={{
                  position: "absolute",
                  left: 6,
                  top: 8,
                  bottom: 8,
                  width: 1,
                  background: "var(--color-codex-line)",
                }}
              />
              {orderedMilestones.map((milestone, i) => {
                const status = milestoneStatus(milestone, nextMilestoneId);
                const color = STATUS_COLOR[status];
                const filled = status === "done" || status === "in-progress";
                return (
                  <div
                    key={milestone.id}
                    className="grid"
                    style={{
                      gridTemplateColumns: "60px 1fr auto",
                      gap: 18,
                      padding: "11px 0",
                      alignItems: "center",
                      borderBottom:
                        i === orderedMilestones.length - 1
                          ? "none"
                          : "1px solid var(--color-codex-line-soft)",
                      position: "relative",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: -22,
                        top: 17,
                        width: 13,
                        height: 13,
                        borderRadius: 99,
                        background: filled ? color : "var(--color-codex-bg-elev)",
                        border: `1.5px solid ${color}`,
                        boxShadow:
                          status === "next"
                            ? `0 0 0 4px color-mix(in oklch, ${color} 20%, transparent)`
                            : "none",
                      }}
                    />
                    <span
                      style={{
                        fontFamily:
                          'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                        fontSize: 12.5,
                        color:
                          status === "next" || status === "in-progress"
                            ? "var(--color-codex-accent)"
                            : "var(--color-codex-ink-mute)",
                        fontWeight: 500,
                      }}
                    >
                      {milestone.due_date ? formatDateOnly(milestone.due_date) : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleToggleMilestone(milestone)}
                      className="min-w-0 text-left"
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 14,
                          color: "var(--color-codex-ink)",
                          fontWeight:
                            status === "done" || status === "next" || status === "in-progress"
                              ? 500
                              : 400,
                          textDecoration: status === "done" ? "line-through" : "none",
                          textDecorationColor:
                            status === "done"
                              ? "var(--color-codex-ink-faint, var(--color-codex-ink-mute))"
                              : undefined,
                        }}
                      >
                        {milestone.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--color-codex-ink-mute)",
                          marginTop: 2,
                        }}
                      >
                        {isZh ? "优先级" : "Priority"} {milestone.priority || "medium"}
                      </div>
                    </button>
                    <span
                      className="inline-flex items-center"
                      style={{
                        gap: 4,
                        padding: "1px 7px",
                        fontSize: 10.5,
                        color,
                        background: `color-mix(in oklch, ${color} 12%, transparent)`,
                        borderRadius: 999,
                      }}
                    >
                      {isZh ? STATUS_LABEL_ZH[status] : STATUS_LABEL_EN[status]}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Weekly todos */}
        <CxPanel
          title={isZh ? `本周待办 · ${openTodos.length}` : `Open todos · ${openTodos.length}`}
          subtitle={
            highPriorityCount > 0
              ? isZh
                ? `${highPriorityCount} 项今日/明日截止`
                : `${highPriorityCount} due today or tomorrow`
              : isZh
                ? "无即将到期"
                : "Nothing due soon"
          }
          action={
            <button
              type="button"
              onClick={() => toast.info(isZh ? "从对话抽取即将上线" : "Extract from chat coming soon")}
              className="inline-flex items-center"
              style={{
                gap: 4,
                fontSize: 11.5,
                color: "var(--color-codex-accent)",
                background: "transparent",
                border: "none",
                padding: 0,
              }}
            >
              <Sparkles className="h-3 w-3" />
              {isZh ? "从对话抽取" : "Pull from chat"}
            </button>
          }
        >
          {openTodos.length === 0 ? (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
                padding: "6px 0",
              }}
            >
              {isZh ? "本周无未完成待办。" : "No open todos this week."}
            </p>
          ) : (
            openTodos.slice(0, 6).map((todo, i, arr) => {
              const dueLabel = todo.due_date ? formatDateOnly(todo.due_date) : (isZh ? "未排期" : "Unscheduled");
              const dueColor =
                todo.due_date && parseAppDateTime(todo.due_date).getTime() < Date.now() + 86_400_000
                  ? "var(--color-codex-warn)"
                  : "var(--color-codex-ink-mute)";
              const assignee = todo.assigned_user?.display_name;
              const initial = assignee?.slice(0, 1) || "·";
              return (
                <div
                  key={todo.id}
                  className="grid"
                  style={{
                    gridTemplateColumns: "20px 1fr 80px 80px",
                    gap: 12,
                    padding: "10px 0",
                    alignItems: "center",
                    borderBottom:
                      i === Math.min(openTodos.length, 6) - 1
                        ? "none"
                        : "1px solid var(--color-codex-line-soft)",
                  }}
                >
                  <span
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 3,
                      border: `1.5px solid var(--color-codex-line-strong, var(--color-codex-line))`,
                      flexShrink: 0,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void todosManager.handleToggle(todo)}
                    className="min-w-0 text-left"
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      fontSize: 13,
                      color: "var(--color-codex-ink)",
                      lineHeight: 1.5,
                      cursor: "pointer",
                    }}
                  >
                    {todo.content}
                  </button>
                  <span style={{ fontSize: 11.5, color: dueColor }}>{dueLabel}</span>
                  <div className="flex items-center" style={{ gap: 6 }}>
                    {assignee ? (
                      <>
                        <span
                          className="inline-flex flex-shrink-0 items-center justify-center"
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 99,
                            background: "var(--color-codex-accent-bg)",
                            color: "var(--color-codex-accent-ink)",
                            fontSize: 10,
                          }}
                        >
                          {initial}
                        </span>
                        <span
                          className="truncate"
                          style={{ fontSize: 11.5, color: "var(--color-codex-ink-mute)" }}
                        >
                          {assignee}
                        </span>
                      </>
                    ) : (
                      <MoreHorizontal
                        className="h-3 w-3"
                        style={{ color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))" }}
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}

          <div
            className="flex items-center justify-between"
            style={{
              paddingTop: 10,
              marginTop: 6,
              borderTop: "1px solid var(--color-codex-line-soft)",
              fontSize: 11.5,
              color: "var(--color-codex-ink-mute)",
            }}
          >
            <span>
              {isZh
                ? `本周已完成 ${doneThisWeek.length} 项 · 累计 ${todos.filter((t) => t.is_done).length} 项`
                : `${doneThisWeek.length} done this week · ${todos.filter((t) => t.is_done).length} cumulative`}
            </span>
          </div>

          <ProjectTodoCreateForm
            isAdding={todosManager.isAdding}
            isZh={isZh}
            loadingUsers={todosManager.loadingUsers}
            newAssignee={todosManager.newAssignee}
            newContent={todosManager.newContent}
            newDueDate={todosManager.newDueDate}
            onAssigneeChange={todosManager.setNewAssignee}
            onContentChange={todosManager.setNewContent}
            onCreate={todosManager.handleCreate}
            onDueDateChange={todosManager.setNewDueDate}
            users={todosManager.users}
          />
        </CxPanel>

        {todosManager.showDeleteDialog && todosManager.todoToDelete ? (
          <ProjectTodoDeleteDialog
            isZh={isZh}
            onCancel={todosManager.closeDeleteDialog}
            onConfirm={todosManager.confirmDelete}
            todoContent={todosManager.todoToDelete.content}
          />
        ) : null}
      </div>

      <aside className="flex flex-col" style={{ gap: 16, position: "sticky", top: 76 }}>
        <CxPanel title={isZh ? "风险预警" : "Risk alerts"}>
          {!memoryLoaded ? (
            <div
              className="flex items-center"
              style={{ gap: 6, padding: "8px 0", color: "var(--color-codex-ink-mute)" }}
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              <span style={{ fontSize: 12 }}>
                {isZh ? "加载风险记忆…" : "Loading risks…"}
              </span>
            </div>
          ) : projectRisks.length === 0 ? (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
                padding: "6px 0",
              }}
            >
              {isZh
                ? "暂无风险记忆。在记忆页固定关键风险后会自动出现。"
                : "No risks pinned. Pin them in Memory and they'll appear here."}
            </p>
          ) : (
            <div className="flex flex-col" style={{ gap: 10 }}>
              {projectRisks.map((risk, i) => {
                const tone = i === 0 ? "var(--color-codex-bad)" : "var(--color-codex-warn)";
                return (
                  <div
                    key={`${risk}-${i}`}
                    style={{
                      padding: "10px 12px",
                      background: `color-mix(in oklch, ${tone} 8%, transparent)`,
                      border: `1px solid color-mix(in oklch, ${tone} 25%, transparent)`,
                      borderRadius: "var(--codex-r-sm, 6px)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        color: tone,
                        fontWeight: 500,
                        marginBottom: 3,
                      }}
                    >
                      {i === 0 ? "● " : "○ "}
                      {risk}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CxPanel>

        <CxPanel title={isZh ? "速度指标" : "Velocity"}>
          {velocity ? (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.85,
                color: "var(--color-codex-ink)",
              }}
            >
              <div className="flex justify-between">
                <span style={{ color: "var(--color-codex-ink-mute)" }}>
                  {isZh ? "计划周期" : "Planned span"}
                </span>
                <span
                  style={{
                    fontFamily:
                      'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                  }}
                >
                  {velocity.planned} {isZh ? "天" : "d"}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--color-codex-ink-mute)" }}>
                  {isZh ? "已用" : "Elapsed"}
                </span>
                <span
                  style={{
                    fontFamily:
                      'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                  }}
                >
                  {velocity.elapsed} {isZh ? "天" : "d"} ({Math.round(progress * 100)}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--color-codex-ink-mute)" }}>
                  {isZh ? "平均里程碑间隔" : "Avg milestone gap"}
                </span>
                <span
                  style={{
                    fontFamily:
                      'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                  }}
                >
                  {velocity.avgInterval} {isZh ? "天" : "d"}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--color-codex-ink-mute)" }}>
                  {isZh ? "预测偏差" : "Forecast drift"}
                </span>
                <span
                  style={{
                    fontFamily:
                      'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                    color:
                      velocity.drift > 7
                        ? "var(--color-codex-warn)"
                        : velocity.drift < -7
                          ? "var(--color-codex-good)"
                          : "var(--color-codex-ink)",
                  }}
                >
                  {velocity.drift > 0 ? "+" : ""}
                  {velocity.drift} {isZh ? "天" : "d"}
                </span>
              </div>
            </div>
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
                padding: "6px 0",
                lineHeight: 1.55,
              }}
            >
              {isZh
                ? "需要至少 2 个有日期的里程碑才能计算速度。"
                : "Need at least 2 dated milestones to compute velocity."}
            </p>
          )}
        </CxPanel>

        <CxPanel
          title={isZh ? "完成情况" : "Completion"}
          subtitle={
            isZh
              ? `${doneThisWeek.length} 项本周完成 · ${todos.filter((t) => t.is_done).length} 项累计`
              : `${doneThisWeek.length} done this week · ${todos.filter((t) => t.is_done).length} cumulative`
          }
        >
          <div className="flex items-center" style={{ gap: 8, padding: "6px 0" }}>
            <span
              className="inline-flex items-center justify-center"
              style={{
                width: 26,
                height: 26,
                borderRadius: 99,
                background: "color-mix(in oklch, var(--color-codex-good) 14%, transparent)",
                color: "var(--color-codex-good)",
              }}
            >
              <Check className="h-3 w-3" />
            </span>
            <div style={{ flex: 1, fontSize: 12.5, color: "var(--color-codex-ink-soft, var(--color-codex-ink))" }}>
              {isZh ? "本周完成的项目动作" : "Items completed this week"}
            </div>
            <span
              style={{
                fontFamily:
                  'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                fontSize: 14,
                color: "var(--color-codex-ink)",
                fontWeight: 500,
              }}
            >
              {doneThisWeek.length}
            </span>
          </div>
        </CxPanel>
      </aside>

      {showModal ? (
        <ProjectMilestoneModal
          formData={formData}
          isEditing={Boolean(editingMilestone)}
          isSaving={isSaving}
          isZh={isZh}
          onChange={setFormData}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
}
