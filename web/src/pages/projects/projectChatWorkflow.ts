import type {
  GeneratedArtifact,
  TaskRun,
  TaskRunArtifact,
  TaskRunEvent,
  TaskRunStep,
  ToolCallEvent,
} from "../../types/api";

export function formatTaskEventTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 19);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function payloadSummary(payload?: Record<string, unknown>) {
  if (!payload) return "";
  const details: string[] = [];
  const project = payload.project;
  if (project && typeof project === "object") {
    const record = project as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const client = typeof record.client === "string" ? record.client : "";
    if (name || client) details.push(`项目：${[name, client].filter(Boolean).join(" / ")}`);
  }
  if (typeof payload.task_type === "string") details.push(`任务类型：${payload.task_type}`);
  if (typeof payload.file_type === "string") details.push(`文件类型：${payload.file_type.toUpperCase()}`);
  if (typeof payload.file_name === "string") details.push(`文件：${payload.file_name}`);
  if (typeof payload.name === "string") details.push(`文件：${payload.name}`);
  if (typeof payload.title === "string") details.push(`标题：${payload.title}`);
  if (typeof payload.slide_count === "number") details.push(`页数：${payload.slide_count}`);
  if (typeof payload.error_code === "string" && payload.error_code) details.push(`错误：${payload.error_code}`);
  if (typeof payload.retryable === "boolean") details.push(payload.retryable ? "可重试" : "不可重试");
  if (typeof payload.message === "string" && payload.message) details.push(payload.message);
  if (Array.isArray(payload.sheets)) {
    const sheetNames = payload.sheets
      .map((sheet) => (sheet && typeof sheet === "object" ? (sheet as Record<string, unknown>).name : sheet))
      .filter((item): item is string => typeof item === "string" && item.length > 0);
    if (sheetNames.length) details.push(`工作表：${sheetNames.join("、")}`);
  }
  if (Array.isArray(payload.sections)) details.push(`章节数：${payload.sections.length}`);
  return details.join("；");
}

export function taskEventDetail(event: TaskRunEvent) {
  const time = formatTaskEventTime(event.created_at);
  const message = event.message || event.event_type || "任务状态更新";
  const payload = payloadSummary(event.payload);
  return `${time ? `[${time}] ` : ""}${message}${payload ? `（${payload}）` : ""}`;
}

function stepOutputDetails(output?: Record<string, unknown>) {
  if (!output) return [];
  const details: string[] = [];
  if (typeof output.project_name === "string" || typeof output.client === "string") {
    details.push(`上下文：${[output.project_name, output.client].filter(Boolean).join(" / ")}`);
  }
  if (output.project && typeof output.project === "object") {
    const project = output.project as Record<string, unknown>;
    details.push(`上下文：${[project.name, project.client].filter((item) => typeof item === "string" && item).join(" / ")}`);
  }
  if (typeof output.file_type === "string") details.push(`输出类型：${output.file_type.toUpperCase()}`);
  if (typeof output.file_name === "string") details.push(`输出文件：${output.file_name}`);
  if (typeof output.name === "string") details.push(`输出文件：${output.name}`);
  if (typeof output.title === "string") details.push(`标题：${output.title}`);
  if (Array.isArray(output.sheets)) {
    const sheetNames = output.sheets
      .map((sheet) => (sheet && typeof sheet === "object" ? (sheet as Record<string, unknown>).name : sheet))
      .filter((item): item is string => typeof item === "string" && item.length > 0);
    if (sheetNames.length) details.push(`工作表：${sheetNames.join("、")}`);
  }
  if (Array.isArray(output.sections)) details.push(`章节数：${output.sections.length}`);
  if (Array.isArray(output.slides)) details.push(`页数：${output.slides.length}`);
  if (typeof output.sections_count === "number") details.push(`章节数：${output.sections_count}`);
  if (typeof output.slide_count === "number") details.push(`页数：${output.slide_count}`);
  return details.filter(Boolean);
}

export function workflowStepFromTask(
  step: TaskRunStep,
  total: number,
  events: TaskRunEvent[] = [],
): ToolCallEvent {
  const status: ToolCallEvent["status"] =
    step.status === "completed" || step.status === "skipped"
      ? "completed"
      : step.status === "failed" || step.status === "canceled"
        ? "error"
        : step.status === "running"
          ? "running"
          : "pending";
  const eventDetails = events
    .filter((event) => event.step_id === step.id)
    .map(taskEventDetail)
    .filter(Boolean);
  return {
    tool_name: `步骤 ${step.sort_order}/${total}：${step.title || step.key}`,
    status,
    message:
      step.status === "skipped"
        ? step.error_message || "该步骤已跳过。"
        : status === "completed"
          ? "该步骤已完成。"
          : status === "error"
            ? step.error_message || "该步骤已停止，请打开任务面板处理。"
            : status === "running"
              ? "该步骤正在执行。"
              : "该步骤等待前序步骤完成。",
    error: status === "error" ? step.error_message : undefined,
    details: [...stepOutputDetails(step.output), ...eventDetails],
    step_index: step.sort_order,
    step_total: total,
    step_title: step.title || step.key,
    has_recoverable_task: true,
  };
}

export function workflowStepsFromTask(task?: TaskRun): ToolCallEvent[] {
  const steps = task?.steps || [];
  if (!steps.length) return [];
  return steps.map((step) => workflowStepFromTask(step, steps.length, task?.events || []));
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  manage_project_files: "管理项目文件",
  manage_project_folders: "管理项目文件夹",
  read_project_file: "读取项目文件",
  read_project_markdown_document: "读取项目文档",
  update_project_markdown_document: "写入项目 Markdown 文档",
  write_project_office_document: "生成项目文档",
};

const STATUS_PRIORITY: Record<ToolCallEvent["status"], number> = {
  error: 6,
  blocked: 5,
  confirmation_required: 4,
  running: 3,
  pending: 2,
  skipped: 1,
  completed: 0,
};

function readableToolName(toolName: string) {
  return TOOL_DISPLAY_NAMES[toolName] || toolName;
}

function isLowValueToolText(text: string, toolName: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^Executing\s+\w+/.test(trimmed)) return true;
  if (trimmed === `工具 ${toolName} 执行完成。`) return true;
  if (trimmed === `工具 ${toolName} 执行完成`) return true;
  return false;
}

function dedupeStrings(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = item.trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function toolCallStatusLabel(status: ToolCallEvent["status"]) {
  if (status === "completed") return "已完成";
  if (status === "running") return "执行中";
  if (status === "pending") return "等待中";
  if (status === "blocked") return "已拦截";
  if (status === "confirmation_required") return "待确认";
  if (status === "skipped") return "已跳过";
  return "失败";
}

function toolCallDetail(call: ToolCallEvent) {
  const name = readableToolName(call.tool_name);
  const messages = dedupeStrings([
    call.summary || "",
    call.message || "",
    call.error || "",
    ...(call.details || []),
  ]).filter((item) => !isLowValueToolText(item, call.tool_name));
  const suffix = messages.length ? `：${messages.join("；")}` : "。";
  return `${name}：${toolCallStatusLabel(call.status)}${suffix}`;
}

function summarizeToolCalls(calls: ToolCallEvent[]) {
  const byTool = new Map<string, ToolCallEvent>();
  for (const call of calls) {
    const current = byTool.get(call.tool_name);
    if (!current || STATUS_PRIORITY[call.status] >= STATUS_PRIORITY[current.status]) {
      byTool.set(call.tool_name, call);
    }
  }
  return Array.from(byTool.values());
}

export function workflowStepsFromToolCalls(calls: ToolCallEvent[]): ToolCallEvent[] {
  if (!calls.length || calls.some((call) => call.step_index !== undefined && call.step_index !== null)) {
    return calls;
  }

  const summarizedCalls = summarizeToolCalls(calls);
  const toolStatus = summarizedCalls.reduce<ToolCallEvent["status"]>(
    (status, call) => (STATUS_PRIORITY[call.status] > STATUS_PRIORITY[status] ? call.status : status),
    "completed",
  );
  const toolDetails = summarizedCalls.map(toolCallDetail).filter(Boolean);
  const hasWriteTool = summarizedCalls.some((call) =>
    ["manage_project_files", "manage_project_folders", "update_project_markdown_document", "write_project_office_document"].includes(
      call.tool_name,
    ),
  );

  return [
    {
      tool_name: "理解需求与上下文",
      status: "completed",
      message: "已读取当前问题、项目上下文和可用知识范围。",
      step_index: 1,
      step_total: 4,
      step_title: "理解需求与上下文",
    },
    {
      tool_name: "制定执行计划",
      status: "completed",
      message: hasWriteTool
        ? "已判断本轮需要读取资料并执行项目空间写入或管理操作。"
        : "已判断本轮需要读取项目资料后再生成回答。",
      step_index: 2,
      step_total: 4,
      step_title: "制定执行计划",
    },
    {
      tool_name: "执行 Skill / 工具",
      status: toolStatus,
      message:
        toolStatus === "completed"
          ? `已完成 ${summarizedCalls.length} 个工具步骤。`
          : "工具执行过程中出现需要关注的状态。",
      details: toolDetails,
      error: summarizedCalls.find((call) => call.status === "error")?.error,
      confirmation_token: summarizedCalls.find((call) => call.status === "confirmation_required")?.confirmation_token,
      step_index: 3,
      step_total: 4,
      step_title: "执行 Skill / 工具",
    },
    {
      tool_name: "整理结果与链接",
      status: toolStatus === "running" || toolStatus === "pending" ? "running" : "completed",
      message: "已保存本次回复，并整理可查看的结果。",
      step_index: 4,
      step_total: 4,
      step_title: "整理结果与链接",
    },
  ];
}

export function artifactFromTaskRunArtifact(artifact: TaskRunArtifact): GeneratedArtifact | null {
  if (!artifact?.name || !artifact.file_type) return null;
  return {
    id: artifact.id,
    name: artifact.name,
    file_type: normalizeArtifactFileType(artifact.file_type, artifact.name, artifact.path),
    path: artifact.path || "",
    project_file_id: artifact.project_file_id,
    description:
      typeof artifact.metadata?.content === "string"
        ? artifact.metadata.content
        : typeof artifact.metadata?.summary === "string"
          ? artifact.metadata.summary
          : typeof artifact.metadata?.message === "string"
            ? artifact.metadata.message
            : "",
  };
}

export function normalizeArtifactFileType(fileType: string, name = "", path = "") {
  const normalized = (fileType || "").toLowerCase().replace(/^\./, "");
  const maybeMarkdown = `${name}\n${path}`.toLowerCase();
  if (maybeMarkdown.includes(".md")) return "md";
  return normalized;
}

export function artifactFromResult(result: Record<string, unknown>): GeneratedArtifact | null {
  const output = typeof result.output === "object" && result.output !== null
    ? (result.output as Record<string, unknown>)
    : null;
  const source = output && !result.file_path && !result.path ? output : result;
  const path = typeof source.file_path === "string" ? source.file_path : typeof source.path === "string" ? source.path : "";
  const name = typeof source.file_name === "string" ? source.file_name : typeof source.name === "string" ? source.name : "";
  const rawFileType = typeof source.file_type === "string" ? source.file_type : "";
  const fileType = normalizeArtifactFileType(rawFileType, name, path);
  if (!path || !name || !fileType) return null;
  return {
    name,
    file_type: fileType,
    path,
    project_file_id: typeof source.project_file_id === "number" ? source.project_file_id : typeof source.id === "number" ? source.id : undefined,
    description: typeof source.note === "string" ? source.note : typeof source.message === "string" ? source.message : "",
  };
}

export function mergeArtifacts(primary: GeneratedArtifact[], fallback: GeneratedArtifact[]) {
  return [...primary, ...fallback].reduce<GeneratedArtifact[]>((items, artifact) => {
    const key = artifact.path || `${artifact.file_type}:${artifact.id ?? artifact.project_file_id ?? artifact.name}`;
    const exists = items.some((item) => {
      const itemKey = item.path || `${item.file_type}:${item.id ?? item.project_file_id ?? item.name}`;
      return itemKey === key;
    });
    return exists ? items : [...items, artifact];
  }, []);
}

export function upsertWorkflowStep(steps: ToolCallEvent[], next: ToolCallEvent) {
  if (next.step_index === undefined || next.step_index === null) return [...steps, next];
  const existingIndex = steps.findIndex((item) => item.step_index === next.step_index);
  if (existingIndex === -1) return [...steps, next];
  return steps.map((item, index) =>
    index === existingIndex
      ? {
          ...item,
          ...next,
          summary: next.summary ?? item.summary,
          error: next.error ?? item.error,
          details: next.details ?? item.details,
        }
      : item,
  );
}

export function upsertArtifacts(current: GeneratedArtifact[], incoming: GeneratedArtifact[]) {
  return incoming.reduce<GeneratedArtifact[]>((items, artifact) => mergeArtifacts(items, [artifact]), current);
}

export function attachToolDetailToActiveStep(
  calls: ToolCallEvent[],
  detail: string,
  status?: ToolCallEvent["status"],
  patch?: Partial<ToolCallEvent>,
) {
  const activeIndex = calls.findIndex((call) => call.step_index !== undefined && call.step_index !== null && call.status === "running");
  if (activeIndex === -1) return calls;
  return calls.map((call, index) =>
    index === activeIndex
      ? {
          ...call,
          ...patch,
          status: status || call.status,
          details: [...(call.details || []), detail],
        }
      : call,
  );
}
