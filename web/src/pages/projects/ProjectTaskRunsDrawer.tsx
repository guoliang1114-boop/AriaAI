import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileText, Loader2, Pause, Play, RotateCcw, Square, TriangleAlert, X } from "lucide-react";

import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import type { GeneratedArtifact, TaskRun, TaskRunEvent, TaskRunStep } from "../../types/api";
import { ProjectChatArtifactCard } from "./ProjectChatArtifactCard";
import { artifactFromTaskRunArtifact } from "./projectChatWorkflow";
import { formatDateTime, parseAppDateTime } from "../../utils/timezone";

type ProjectTaskRunsDrawerProps = {
  isOpen: boolean;
  isZh: boolean;
  projectId: number;
  onClose: () => void;
  onOpenArtifact?: (artifact: GeneratedArtifact) => void;
  onDownloadArtifact: (artifact: GeneratedArtifact) => void;
  onTaskUpdated?: (task: TaskRun) => void;
};

const STATUS_COPY: Record<string, { zh: string; en: string; className: string }> = {
  pending: { zh: "等待中", en: "Pending", className: "bg-codex-bg-tint text-codex-ink-soft" },
  running: { zh: "执行中", en: "Running", className: "bg-codex-accent-bg text-codex-accent-ink" },
  completed: { zh: "已完成", en: "Completed", className: "bg-codex-accent-bg text-codex-good" },
  failed: { zh: "失败", en: "Failed", className: "bg-codex-bg-tint text-codex-bad" },
  canceled: { zh: "已取消", en: "Canceled", className: "bg-codex-bg-tint text-codex-ink-soft" },
  paused: { zh: "已暂停", en: "Paused", className: "bg-codex-bg-tint text-codex-warn" },
  skipped: { zh: "已跳过", en: "Skipped", className: "bg-codex-bg-tint text-codex-ink-mute" },
};

function statusCopy(status: string, isZh: boolean) {
  const item = STATUS_COPY[status] || STATUS_COPY.pending;
  return isZh ? item.zh : item.en;
}

function statusClass(status: string) {
  return (STATUS_COPY[status] || STATUS_COPY.pending).className;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin" />;
  if (status === "completed") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "failed") return <TriangleAlert className="h-4 w-4" />;
  return <Clock3 className="h-4 w-4" />;
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = parseAppDateTime(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 19);
  return formatDateTime(date, "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventText(event: TaskRunEvent) {
  const payload = event.payload || {};
  const details: string[] = [];
  if (typeof payload.error_code === "string" && payload.error_code) details.push(payload.error_code);
  if (typeof payload.retryable === "boolean") details.push(payload.retryable ? "可重试" : "不可重试");
  if (typeof payload.file_name === "string" && payload.file_name) details.push(payload.file_name);
  if (typeof payload.name === "string" && payload.name) details.push(payload.name);
  return `${event.message || event.event_type}${details.length ? `（${details.join("；")}）` : ""}`;
}

function StepRow({ events, isZh, step }: { events: TaskRunEvent[]; isZh: boolean; step: TaskRunStep }) {
  const stepEvents = events.filter((event) => event.step_id === step.id);
  return (
    <div className="rounded-2xl border border-codex-line bg-white p-3">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${statusClass(step.status)}`}>
          <StatusIcon status={step.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-codex-ink">
              {step.sort_order}. {step.title}
            </p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(step.status)}`}>
              {statusCopy(step.status, isZh)}
            </span>
          </div>
          {step.error_message ? <p className="mt-1 text-xs text-codex-bad">{step.error_message}</p> : null}
          {stepEvents.length ? (
            <div className="mt-2 space-y-1 border-t border-codex-line-soft pt-2">
              {stepEvents.map((event) => (
                <p key={event.id || `${step.id}-${event.created_at}-${event.event_type}`} className="text-xs leading-5 text-codex-ink-mute">
                  <span className="text-codex-ink-faint">{formatTime(event.created_at)}</span>
                  <span className="mx-1.5 text-codex-ink-faint">·</span>
                  {eventText(event)}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProjectTaskRunsDrawer({
  isOpen,
  isZh,
  projectId,
  onClose,
  onDownloadArtifact,
  onOpenArtifact,
  onTaskUpdated,
}: ProjectTaskRunsDrawerProps) {
  const toast = useToast();
  const [tasks, setTasks] = useState<TaskRun[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionTaskId, setActionTaskId] = useState<number | null>(null);

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.get<TaskRun[]>(`/projects/${projectId}/task-runs`);
      setTasks(data);
      setSelectedTaskId((current) => current ?? data[0]?.id ?? null);
    } catch (error) {
      console.error("Failed to load project tasks:", error);
      toast.error(isZh ? "加载任务记录失败" : "Failed to load task runs");
    } finally {
      setIsLoading(false);
    }
  }, [isZh, projectId]);

  useEffect(() => {
    if (isOpen) void loadTasks();
  }, [isOpen, loadTasks]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || tasks[0] || null,
    [selectedTaskId, tasks],
  );
  const selectedTaskNeedsConfirmation = selectedTask?.input?.requires_confirmation === true;

  const refreshTask = async (taskId: number) => {
    const nextTask = await api.get<TaskRun>(`/projects/${projectId}/task-runs/${taskId}`);
    setTasks((current) => current.map((task) => (task.id === taskId ? nextTask : task)));
    return nextTask;
  };

  const retryTask = async (task: TaskRun) => {
    setActionTaskId(task.id);
    try {
      await api.post<TaskRun>(`/projects/${projectId}/task-runs/${task.id}/retry`, {});
      toast.success(isZh ? "已重新加入执行" : "Retry queued");
      const nextTask = await refreshTask(task.id);
      onTaskUpdated?.(nextTask);
    } catch (error) {
      console.error("Failed to retry project task:", error);
      toast.error(isZh ? "重试任务失败" : "Failed to retry task");
    } finally {
      setActionTaskId(null);
    }
  };

  const cancelTask = async (task: TaskRun) => {
    setActionTaskId(task.id);
    try {
      const nextTask = await api.post<TaskRun>(`/projects/${projectId}/task-runs/${task.id}/cancel`, {});
      setTasks((current) => current.map((item) => (item.id === task.id ? nextTask : item)));
      onTaskUpdated?.(nextTask);
      toast.success(isZh ? "任务已取消" : "Task canceled");
    } catch (error) {
      console.error("Failed to cancel project task:", error);
      toast.error(isZh ? "取消任务失败" : "Failed to cancel task");
    } finally {
      setActionTaskId(null);
    }
  };

  const pauseTask = async (task: TaskRun) => {
    setActionTaskId(task.id);
    try {
      const nextTask = await api.post<TaskRun>(`/projects/${projectId}/task-runs/${task.id}/pause`, {});
      setTasks((current) => current.map((item) => (item.id === task.id ? nextTask : item)));
      onTaskUpdated?.(nextTask);
      toast.success(isZh ? "任务已暂停" : "Task paused");
    } catch (error) {
      console.error("Failed to pause project task:", error);
      toast.error(isZh ? "暂停任务失败" : "Failed to pause task");
    } finally {
      setActionTaskId(null);
    }
  };

  const resumeTask = async (task: TaskRun) => {
    setActionTaskId(task.id);
    try {
      const nextTask = await api.post<TaskRun>(`/projects/${projectId}/task-runs/${task.id}/resume`, {});
      setTasks((current) => current.map((item) => (item.id === task.id ? nextTask : item)));
      onTaskUpdated?.(nextTask);
      toast.success(isZh ? "任务已恢复执行" : "Task resumed");
    } catch (error) {
      console.error("Failed to resume project task:", error);
      toast.error(isZh ? "恢复任务失败" : "Failed to resume task");
    } finally {
      setActionTaskId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-codex-ink/25 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label={isZh ? "关闭任务面板" : "Close tasks"} />
      <aside className="relative flex h-full w-full max-w-5xl flex-col bg-codex-bg-tint shadow-2xl sm:w-[88vw] xl:w-[980px]">
        <div className="flex items-start justify-between gap-4 border-b border-codex-line bg-white px-5 py-4">
          <div>
            <p className="text-xs font-medium text-codex-ink-faint">{isZh ? "项目任务" : "Project tasks"}</p>
            <h2 className="mt-1 text-lg font-semibold text-codex-ink">{isZh ? "任务详情" : "Task details"}</h2>
            <p className="mt-1 text-sm text-codex-ink-mute">
              {isZh ? "查看每一步、日志、生成物，并处理失败任务。" : "Inspect steps, logs, artifacts, and failed runs."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-codex-ink-faint hover:bg-codex-bg-tint hover:text-codex-ink-soft">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-codex-line bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-codex-ink-soft">{isZh ? "任务记录" : "Runs"}</p>
              <button type="button" onClick={() => void loadTasks()} className="rounded-lg px-2 py-1 text-xs text-codex-ink-mute hover:bg-codex-bg-tint">
                {isZh ? "刷新" : "Refresh"}
              </button>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-codex-line bg-codex-bg-tint p-4 text-sm text-codex-ink-mute">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isZh ? "加载中..." : "Loading..."}
              </div>
            ) : tasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-codex-line bg-codex-bg-tint p-4 text-sm text-codex-ink-mute">
                {isZh ? "暂无任务记录。" : "No task runs yet."}
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setSelectedTaskId(task.id)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      selectedTask?.id === task.id
                        ? "border-codex-line bg-codex-accent-bg"
                        : "border-codex-line bg-white hover:border-codex-line-strong hover:bg-codex-bg-tint"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="max-h-10 overflow-hidden text-sm font-semibold leading-5 text-codex-ink">{task.goal || task.task_type}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(task.status)}`}>
                        {statusCopy(task.status, isZh)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-codex-ink-faint">{formatTime(task.created_at)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            {selectedTask ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-codex-line bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-codex-ink">{selectedTask.goal || selectedTask.task_type}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(selectedTask.status)}`}>
                          {statusCopy(selectedTask.status, isZh)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-codex-ink-mute">
                        {selectedTask.task_type}
                        <span className="mx-2 text-codex-ink-faint">·</span>
                        {formatTime(selectedTask.created_at)}
                      </p>
                      {selectedTaskNeedsConfirmation && typeof selectedTask.input?.confirmation_reason === "string" ? (
                        <p className="mt-2 rounded-lg border border-codex-line bg-codex-bg-tint px-3 py-2 text-sm text-codex-warn">
                          {selectedTask.input.confirmation_reason}
                        </p>
                      ) : null}
                      {selectedTask.error_message ? <p className="mt-2 text-sm text-codex-bad">{selectedTask.error_message}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {selectedTask.status === "failed" ? (
                        <button
                          type="button"
                          disabled={actionTaskId === selectedTask.id}
                          onClick={() => void retryTask(selectedTask)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-codex-accent px-3 py-2 text-sm font-medium text-white hover:bg-codex-accent disabled:opacity-60"
                        >
                          <RotateCcw className="h-4 w-4" />
                          {isZh ? "从失败处重试" : "Retry"}
                        </button>
                      ) : null}
                      {["pending", "running"].includes(selectedTask.status) ? (
                        <button
                          type="button"
                          disabled={actionTaskId === selectedTask.id}
                          onClick={() => void pauseTask(selectedTask)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-codex-line bg-codex-bg-tint px-3 py-2 text-sm font-medium text-codex-warn hover:bg-codex-bg-tint disabled:opacity-60"
                        >
                          <Pause className="h-4 w-4" />
                          {isZh ? "暂停" : "Pause"}
                        </button>
                      ) : null}
                      {selectedTask.status === "paused" ? (
                        <button
                          type="button"
                          disabled={actionTaskId === selectedTask.id}
                          onClick={() => void resumeTask(selectedTask)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-codex-accent px-3 py-2 text-sm font-medium text-white hover:bg-codex-accent disabled:opacity-60"
                        >
                          <Play className="h-4 w-4" />
                          {selectedTaskNeedsConfirmation ? (isZh ? "确认并执行" : "Confirm and run") : (isZh ? "恢复" : "Resume")}
                        </button>
                      ) : null}
                      {["pending", "running", "failed", "paused"].includes(selectedTask.status) ? (
                        <button
                          type="button"
                          disabled={actionTaskId === selectedTask.id}
                          onClick={() => void cancelTask(selectedTask)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-codex-line bg-codex-bg-tint px-3 py-2 text-sm font-medium text-codex-bad hover:bg-codex-bg-tint disabled:opacity-60"
                        >
                          <Square className="h-4 w-4" />
                          {isZh ? "取消任务" : "Cancel"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <section className="space-y-2">
                  <h4 className="text-sm font-semibold text-codex-ink-soft">{isZh ? "执行步骤" : "Steps"}</h4>
                  {(selectedTask.steps || []).map((step) => (
                    <StepRow key={step.id} step={step} events={selectedTask.events || []} isZh={isZh} />
                  ))}
                </section>

                {(selectedTask.artifacts || []).length ? (
                  <section className="space-y-2">
                    <h4 className="text-sm font-semibold text-codex-ink-soft">{isZh ? "生成物" : "Artifacts"}</h4>
                    {(selectedTask.artifacts || [])
                      .map(artifactFromTaskRunArtifact)
                      .filter((artifact): artifact is GeneratedArtifact => Boolean(artifact))
                      .map((artifact) => (
                        <ProjectChatArtifactCard
                          key={artifact.id || artifact.path}
                          artifact={artifact}
                          isZh={isZh}
                          onDownload={onDownloadArtifact}
                          onOpen={onOpenArtifact}
                        />
                      ))}
                  </section>
                ) : null}

                <section className="space-y-2">
                  <h4 className="text-sm font-semibold text-codex-ink-soft">{isZh ? "完整日志" : "Event log"}</h4>
                  <div className="rounded-2xl border border-codex-line bg-white p-3">
                    {(selectedTask.events || []).length ? (
                      <div className="space-y-2">
                        {(selectedTask.events || []).map((event) => (
                          <p key={event.id || `${event.created_at}-${event.event_type}`} className="text-xs leading-5 text-codex-ink-mute">
                            <span className="text-codex-ink-faint">{formatTime(event.created_at)}</span>
                            <span className="mx-1.5 text-codex-ink-faint">·</span>
                            {eventText(event)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-codex-ink-faint">
                        <FileText className="h-4 w-4" />
                        {isZh ? "暂无日志。" : "No logs yet."}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-codex-line bg-white text-sm text-codex-ink-mute">
                {isZh ? "选择一个任务查看详情。" : "Select a task to inspect."}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
