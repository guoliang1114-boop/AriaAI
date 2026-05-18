import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { getApiBaseUrl } from "../../config/api";
import type {
  GeneratedArtifact,
  Message,
  MessageMetadata,
  Reference,
  StreamEvent,
  ToolCallEvent,
  TaskRun,
  TaskRunEvent,
} from "../../types/api";

function parseMessageMetadata(metadataJson: string): MessageMetadata {
  try {
    return JSON.parse(metadataJson || "{}") as MessageMetadata;
  } catch {
    return {};
  }
}

function mergeAssistantMetadata(message: Message, metadata: MessageMetadata): Message {
  const existing = parseMessageMetadata(message.metadata_json);
  return {
    ...message,
    metadata_json: JSON.stringify(
      {
        ...existing,
        ...metadata,
        references: metadata.references ?? existing.references ?? [],
        tool_calls: metadata.tool_calls ?? existing.tool_calls ?? [],
        artifacts: metadata.artifacts ?? existing.artifacts ?? [],
      },
      null,
      0,
    ),
  };
}

function buildAssistantMessage({
  artifacts,
  content,
  conversationId,
  projectId,
  references,
  toolCalls,
}: {
  artifacts: GeneratedArtifact[];
  content: string;
  conversationId: number;
  projectId: number;
  references: Reference[];
  toolCalls: ToolCallEvent[];
}): Message {
  return {
    id: Date.now() + 1,
    conversation_id: conversationId,
    role: "assistant",
    content,
    metadata_json: JSON.stringify({
      artifacts,
      project_id: projectId,
      references,
      tool_calls: toolCalls,
    }),
    created_at: new Date().toISOString(),
  };
}

function summarizeToolResult(result: Record<string, unknown>, fallbackMessage?: string) {
  if (typeof result.error === "string" && result.error) return result.error;
  if (typeof result.file_name === "string" && result.file_name) {
    return `Created ${result.file_name}`;
  }
  if (typeof result.message === "string" && result.message) return result.message;
  return fallbackMessage || "";
}

function artifactFromResult(result: Record<string, unknown>): GeneratedArtifact | null {
  const output = typeof result.output === "object" && result.output !== null
    ? (result.output as Record<string, unknown>)
    : null;
  const source = output && !result.file_path && !result.path ? output : result;
  const path = typeof source.file_path === "string" ? source.file_path : typeof source.path === "string" ? source.path : "";
  const name = typeof source.file_name === "string" ? source.file_name : typeof source.name === "string" ? source.name : "";
  const fileType = typeof source.file_type === "string" ? source.file_type : "";

  if (!path || !name || !fileType) {
    return null;
  }

  return {
    name,
    file_type: fileType,
    path,
    project_file_id: typeof source.project_file_id === "number" ? source.project_file_id : typeof source.id === "number" ? source.id : undefined,
    description: typeof source.note === "string" ? source.note : typeof source.message === "string" ? source.message : "",
  };
}

function artifactFromTaskRunArtifact(artifact: NonNullable<TaskRun["artifacts"]>[number]): GeneratedArtifact | null {
  if (!artifact?.name || !artifact.file_type) return null;
  return {
    name: artifact.name,
    file_type: artifact.file_type,
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

function formatTaskEventTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 19);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function payloadSummary(payload?: Record<string, unknown>) {
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
  if (typeof payload.slide_count === "number") details.push(`页数：${payload.slide_count}`);
  if (Array.isArray(payload.sheets)) {
    const sheetNames = payload.sheets
      .map((sheet) => (sheet && typeof sheet === "object" ? (sheet as Record<string, unknown>).name : sheet))
      .filter((item): item is string => typeof item === "string" && item.length > 0);
    if (sheetNames.length) details.push(`工作表：${sheetNames.join("、")}`);
  }
  if (typeof payload.error_code === "string" && payload.error_code) details.push(`错误：${payload.error_code}`);
  if (typeof payload.retryable === "boolean") details.push(payload.retryable ? "可重试" : "不可重试");
  if (typeof payload.message === "string" && payload.message) details.push(payload.message);
  return details.join("；");
}

function taskEventDetail(event: TaskRunEvent) {
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
  if (typeof output.file_type === "string") details.push(`输出类型：${output.file_type.toUpperCase()}`);
  if (typeof output.file_name === "string") details.push(`输出文件：${output.file_name}`);
  if (typeof output.title === "string") details.push(`标题：${output.title}`);
  if (Array.isArray(output.sheets)) {
    const sheetNames = output.sheets
      .map((sheet) => (sheet && typeof sheet === "object" ? (sheet as Record<string, unknown>).name : sheet))
      .filter((item): item is string => typeof item === "string" && item.length > 0);
    if (sheetNames.length) details.push(`工作表：${sheetNames.join("、")}`);
  }
  if (typeof output.sections_count === "number") details.push(`章节数：${output.sections_count}`);
  if (typeof output.slide_count === "number") details.push(`页数：${output.slide_count}`);
  return details;
}

function workflowStepFromTask(
  step: NonNullable<TaskRun["steps"]>[number],
  total: number,
  events: TaskRunEvent[] = [],
): ToolCallEvent {
  const status: ToolCallEvent["status"] =
    step.status === "completed" || step.status === "skipped"
      ? "completed"
      : step.status === "failed"
        ? "error"
        : "running";
  const eventDetails = events
    .filter((event) => event.step_id === step.id)
    .map(taskEventDetail)
    .filter(Boolean);
  const details = [...stepOutputDetails(step.output), ...eventDetails];
  return {
    tool_name: `步骤 ${step.sort_order}/${total}：${step.title || step.key}`,
    status,
    message:
      status === "completed"
        ? "该步骤已完成。"
        : status === "error"
          ? step.error_message || "该步骤执行失败，可稍后从任务记录重试。"
          : "该步骤正在执行或等待执行。",
    error: status === "error" ? step.error_message : undefined,
    step_index: step.sort_order,
    step_total: total,
    step_title: step.title || step.key,
    details,
  };
}

function buildArtifactFallbackContent(artifacts: GeneratedArtifact[], isZh = true) {
  if (artifacts.length === 0) return "";
  const names = artifacts.map((artifact) => artifact.name).filter(Boolean).join(isZh ? "、" : ", ");
  if (isZh) {
    return names
      ? `已生成附件：${names}。可在本条回复中的文件卡片里直接打开或下载。`
      : "已生成附件。可在本条回复中的文件卡片里直接打开或下载。";
  }
  return names
    ? `Generated attachment: ${names}. You can open or download it from the file card in this reply.`
    : "Generated an attachment. You can open or download it from the file card in this reply.";
}

function upsertWorkflowStep(
  steps: ToolCallEvent[],
  next: ToolCallEvent,
) {
  if (!next.step_index) return [...steps, next];
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

function upsertArtifacts(current: GeneratedArtifact[], incoming: GeneratedArtifact[]) {
  return incoming.reduce<GeneratedArtifact[]>((items, artifact) => {
    if (!artifact.path || items.some((item) => item.path === artifact.path)) return items;
    return [...items, artifact];
  }, current);
}

type UseProjectChatComposerParams = {
  projectId: number;
  activeConvId: number | null;
  selectedSkillId: number | null;
  forceSkill: boolean;
  knowledgeScope: "project" | "client" | "global";
  setMessages: Dispatch<SetStateAction<Message[]>>;
  createConversation: (firstMessage?: string, skillId?: number | null) => Promise<number | null>;
  fetchMessages: (conversationId: number) => Promise<void>;
  fetchConversations: () => Promise<void>;
  isNearBottomRef: MutableRefObject<boolean>;
  scrollToBottom: (smooth?: boolean) => void;
  onSendError: () => void;
};

export function useProjectChatComposer({
  projectId,
  activeConvId,
  selectedSkillId,
  forceSkill,
  knowledgeScope,
  setMessages,
  createConversation,
  fetchMessages,
  fetchConversations,
  isNearBottomRef,
  scrollToBottom,
  onSendError,
}: UseProjectChatComposerParams) {
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingReferences, setStreamingReferences] = useState<Reference[]>([]);
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallEvent[]>([]);
  const [streamingArtifacts, setStreamingArtifacts] = useState<GeneratedArtifact[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetStreamingContent = useCallback(() => {
    setStreamingContent("");
    setStreamingReferences([]);
    setStreamingToolCalls([]);
    setStreamingArtifacts([]);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return false;

    let conversationId = activeConvId;
    const skillId = forceSkill ? selectedSkillId || undefined : undefined;
    setIsLoading(true);
    resetStreamingContent();

    if (!conversationId) {
      conversationId = await createConversation(trimmed, skillId || null);
      if (!conversationId) {
        setIsLoading(false);
        return false;
      }
    }

    const tempUserMsg: Message = {
      id: Date.now(),
      conversation_id: conversationId,
      role: "user",
      content: trimmed,
      metadata_json: "{}",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    isNearBottomRef.current = true;
    setTimeout(() => scrollToBottom(true), 0);

    let fullContent = "";
    let collectedReferences: Reference[] = [];
    let collectedToolCalls: ToolCallEvent[] = [];
    let collectedArtifacts: GeneratedArtifact[] = [];
    let serverPersistedAssistant = false;

    try {
      abortControllerRef.current = new AbortController();
      const response = await fetch(`${getApiBaseUrl()}/chat/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": localStorage.getItem("authToken") || "",
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          content: trimmed,
          project_id: projectId,
          skill_id: skillId,
          force_skill: !!skillId,
          knowledge_scope: knowledgeScope,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error("Failed to send message");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abortControllerRef.current?.signal.aborted) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const line = event
            .split("\n")
            .map((item) => item.trim())
            .find((item) => item.startsWith("data: "));
          if (!line) continue;

          let payload: StreamEvent;
          try {
            payload = JSON.parse(line.replace(/^data:\s*/, "")) as StreamEvent;
          } catch (error) {
            console.error("Failed to parse stream event:", error);
            continue;
          }

          if ((payload.type === "text" || payload.type === "chunk") && payload.content) {
            fullContent += payload.content;
            setStreamingContent(fullContent);
          } else if (payload.type === "status" && payload.message) {
            if (payload.step_index) {
              const stepCall: ToolCallEvent = {
                tool_name: payload.step_title
                  ? `步骤 ${payload.step_index}/${payload.step_total || 4}：${payload.step_title}`
                  : `步骤 ${payload.step_index}/${payload.step_total || 4}`,
                status: payload.step_status || "running",
                message: payload.message,
                step_index: payload.step_index,
                step_total: payload.step_total,
                step_title: payload.step_title,
              };
              collectedToolCalls = upsertWorkflowStep(collectedToolCalls, stepCall);
              setStreamingToolCalls(collectedToolCalls);
              continue;
            }
            if (payload.stage === "saving" || payload.stage === "finalizing") {
              setStreamingToolCalls((prev) => prev.filter((call) => call.status !== "running"));
            }
          } else if (payload.type === "references") {
            collectedReferences = payload.references || [];
            setStreamingReferences(collectedReferences);
          } else if (payload.type === "task_run" && payload.task) {
            const task = payload.task;
            const steps = task.steps || [];
            const taskEvents = task.events || [];
            if (steps.length > 0) {
              collectedToolCalls = steps
                .filter((step) => step.status !== "pending")
                .reduce<ToolCallEvent[]>(
                  (items, step) => upsertWorkflowStep(items, workflowStepFromTask(step, steps.length, taskEvents)),
                  collectedToolCalls,
                );
              setStreamingToolCalls(collectedToolCalls);
            }
            if (Array.isArray(task.artifacts) && task.artifacts.length > 0) {
              collectedArtifacts = upsertArtifacts(
                collectedArtifacts,
                task.artifacts
                  .map((artifact) => artifactFromTaskRunArtifact(artifact))
                  .filter((artifact): artifact is GeneratedArtifact => Boolean(artifact)),
              );
              setStreamingArtifacts(collectedArtifacts);
            }
          } else if (payload.type === "tool_executing" && payload.tool_name) {
            if (collectedToolCalls.some((call) => call.step_index === 3)) {
              const stepCall: ToolCallEvent = {
                tool_name: "步骤 3/4：执行 Skill / 工具",
                status: "running",
                message: payload.message || `正在调用 ${payload.tool_name}`,
                step_index: 3,
                step_total: 4,
                step_title: "执行 Skill / 工具",
              };
              collectedToolCalls = upsertWorkflowStep(collectedToolCalls, stepCall);
              setStreamingToolCalls(collectedToolCalls);
              continue;
            }
            const runningCall: ToolCallEvent = {
              tool_name: payload.tool_name,
              status: "running",
              message: payload.message,
            };
            collectedToolCalls = [
              ...collectedToolCalls.filter((call) => call.tool_name !== payload.tool_name || call.status !== "running"),
              runningCall,
            ];
            setStreamingToolCalls([
              ...collectedToolCalls.filter((call) => call.tool_name !== "Aria" || call.status !== "running"),
            ]);
          } else if (payload.type === "tool_result" && payload.result) {
            const result = payload.result;
            const toolName =
              typeof result.tool_name === "string"
                ? result.tool_name
                : collectedToolCalls[collectedToolCalls.length - 1]?.tool_name || "tool";
            const completedCall: ToolCallEvent = {
              tool_name: toolName,
              status:
                result.status === "error" || result.success === false ? "error" : "completed",
              summary: summarizeToolResult(result),
              error: typeof result.error === "string" ? result.error : undefined,
            };
            collectedToolCalls = [
              ...collectedToolCalls.filter((call) => call.tool_name !== toolName || call.status !== "running"),
              completedCall,
            ];
            if (collectedToolCalls.some((call) => call.step_index === 3)) {
              const stepCall: ToolCallEvent = {
                tool_name: "步骤 3/4：执行 Skill / 工具",
                status: completedCall.status,
                message: completedCall.status === "error" ? "工具执行失败，正在整理可恢复信息。" : "工具执行完成，结果已返回。",
                summary: completedCall.summary,
                error: completedCall.error,
                step_index: 3,
                step_total: 4,
                step_title: "执行 Skill / 工具",
              };
              collectedToolCalls = upsertWorkflowStep(
                collectedToolCalls.filter((call) => call.tool_name !== toolName || call.status !== completedCall.status),
                stepCall,
              );
            }
            setStreamingToolCalls(collectedToolCalls);

            const artifact = artifactFromResult(result);
            if (artifact && !collectedArtifacts.some((item) => item.path === artifact.path)) {
              collectedArtifacts = [...collectedArtifacts, artifact];
              setStreamingArtifacts(collectedArtifacts);
            }
          } else if (payload.type === "done") {
            if (payload.task_run_id || payload.task_type || payload.task) {
              serverPersistedAssistant = true;
            }
            if (Array.isArray(payload.artifacts) && payload.artifacts.length > 0) {
              collectedArtifacts = payload.artifacts.reduce<GeneratedArtifact[]>((items, artifact) => {
                if (!artifact || !artifact.path || items.some((item) => item.path === artifact.path)) {
                  return items;
                }
                return [...items, artifact];
              }, collectedArtifacts);
              setStreamingArtifacts(collectedArtifacts);
            }
          } else if (payload.type === "error") {
            throw new Error(payload.message || payload.error || "Chat failed");
          }
        }
      }

      const finalContent = fullContent.trim() || buildArtifactFallbackContent(collectedArtifacts);
      setStreamingContent("");
      setStreamingToolCalls([]);
      setStreamingReferences([]);
      setStreamingArtifacts([]);
      if (serverPersistedAssistant) {
        await fetchMessages(conversationId);
      } else if (finalContent || collectedToolCalls.length > 0 || collectedArtifacts.length > 0) {
        const assistantMessage = buildAssistantMessage({
          artifacts: collectedArtifacts,
          content: finalContent,
          conversationId,
          projectId,
          references: collectedReferences,
          toolCalls: collectedToolCalls,
        });
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        await fetchMessages(conversationId);
      }
      void fetchConversations();
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const stoppedToolCalls = collectedToolCalls.map((call) =>
          call.status === "running"
            ? { ...call, status: "error" as const, error: "Generation stopped" }
            : call,
        );
        setStreamingContent("");
        setStreamingToolCalls([]);
        if (fullContent.trim()) {
          const assistantMessage = buildAssistantMessage({
            artifacts: collectedArtifacts,
            content: fullContent,
            conversationId,
            projectId,
            references: collectedReferences,
            toolCalls: stoppedToolCalls,
          });
          setMessages((prev) => [...prev, assistantMessage]);
        }
        void fetchConversations();
        return false;
      }
      console.error("Failed to send message:", error);
      setStreamingContent("");
      setStreamingToolCalls([]);
      onSendError();
      await fetchMessages(conversationId);
      return false;
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, [
    activeConvId,
    createConversation,
    fetchConversations,
    fetchMessages,
    isNearBottomRef,
    knowledgeScope,
    onSendError,
    projectId,
    resetStreamingContent,
    scrollToBottom,
    selectedSkillId,
    forceSkill,
    setMessages,
  ]);

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return {
    isLoading,
    streamingArtifacts,
    streamingContent,
    streamingReferences,
    streamingToolCalls,
    resetStreamingContent,
    sendMessage,
    stopGeneration,
  };
}
