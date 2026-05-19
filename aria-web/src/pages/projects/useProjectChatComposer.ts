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
  TaskRun,
  TaskRunArtifact,
  TaskRunStep,
  ToolCallEvent,
} from "../../types/api";
import {
  artifactFromResult,
  artifactFromTaskRunArtifact,
  attachToolDetailToActiveStep,
  upsertArtifacts,
  upsertWorkflowStep,
  workflowStepFromTask,
} from "./projectChatWorkflow";


function buildAssistantMessage({
  artifacts,
  content,
  conversationId,
  projectId,
  references,
  toolCalls,
  taskRun,
  taskType,
}: {
  artifacts: GeneratedArtifact[];
  content: string;
  conversationId: number;
  projectId: number;
  references: Reference[];
  toolCalls: ToolCallEvent[];
  taskRun?: TaskRun | null;
  taskType?: string;
}): Message {
  const metadata: MessageMetadata = {
    artifacts,
    project_id: projectId,
    references,
    tool_calls: toolCalls,
  };
  if (taskRun) {
    metadata.task_run = taskRun;
    metadata.task_run_id = taskRun.id;
    metadata.task_type = taskType || taskRun.task_type;
  }
  return {
    id: Date.now() + 1,
    conversation_id: conversationId,
    role: "assistant",
    content,
    metadata_json: JSON.stringify(metadata),
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
  const [streamingStatus, setStreamingStatus] = useState("");
  const [streamingReferences, setStreamingReferences] = useState<Reference[]>([]);
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallEvent[]>([]);
  const [streamingArtifacts, setStreamingArtifacts] = useState<GeneratedArtifact[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetStreamingContent = useCallback(() => {
    setStreamingContent("");
    setStreamingStatus("");
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
    let latestTaskRun: TaskRun | null = null;
    let latestTaskType = "";

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
            setStreamingStatus("");
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
            setStreamingStatus(payload.message);
            if (payload.stage === "saving" || payload.stage === "finalizing") {
              setStreamingToolCalls((prev) => prev.filter((call) => call.status !== "running"));
            }
          } else if (payload.type === "references") {
            collectedReferences = payload.references || [];
            setStreamingReferences(collectedReferences);
          } else if (payload.type === "task_run" && payload.task) {
            const task = payload.task as TaskRun;
            latestTaskRun = task;
            latestTaskType = task.task_type || latestTaskType;
            const steps = task.steps || [];
            const taskEvents = task.events || [];
            if (steps.length > 0) {
              collectedToolCalls = steps
                .reduce<ToolCallEvent[]>(
                  (items: ToolCallEvent[], step: TaskRunStep) => upsertWorkflowStep(items, workflowStepFromTask(step, steps.length, taskEvents)),
                  collectedToolCalls,
                );
              setStreamingToolCalls(collectedToolCalls);
            }
            if (Array.isArray(task.artifacts) && task.artifacts.length > 0) {
              collectedArtifacts = upsertArtifacts(
                collectedArtifacts,
                task.artifacts
                  .map((artifact: TaskRunArtifact) => artifactFromTaskRunArtifact(artifact))
                  .filter((artifact: GeneratedArtifact | null): artifact is GeneratedArtifact => Boolean(artifact)),
              );
              setStreamingArtifacts(collectedArtifacts);
            }
          } else if (payload.type === "tool_executing" && payload.tool_name) {
            const toolDetail = payload.message || `正在调用 ${payload.tool_name}`;
            const hasActiveWorkflowStep = collectedToolCalls.some((call) => call.step_index && call.status === "running");
            if (hasActiveWorkflowStep) {
              collectedToolCalls = attachToolDetailToActiveStep(collectedToolCalls, toolDetail);
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
            const resultStatus: ToolCallEvent["status"] =
              result.status === "error" || result.success === false ? "error" : "completed";
            const resultSummary = summarizeToolResult(result);
            const toolName =
              typeof result.tool_name === "string"
                ? result.tool_name
                : collectedToolCalls[collectedToolCalls.length - 1]?.tool_name || "tool";
            const completedCall: ToolCallEvent = {
              tool_name: toolName,
              status: resultStatus,
              summary: resultSummary,
              error: typeof result.error === "string" ? result.error : undefined,
            };
            const hasActiveWorkflowStep = collectedToolCalls.some((call) => call.step_index && call.status === "running");
            if (hasActiveWorkflowStep) {
              const detail = resultStatus === "error"
                ? `工具 ${toolName} 执行失败${completedCall.error ? `：${completedCall.error}` : ""}`
                : `工具 ${toolName} 执行完成${resultSummary ? `：${resultSummary}` : ""}`;
              collectedToolCalls = attachToolDetailToActiveStep(collectedToolCalls, detail, resultStatus === "error" ? "error" : undefined);
            } else {
              collectedToolCalls = [
                ...collectedToolCalls.filter((call) => call.tool_name !== toolName || call.status !== "running"),
                completedCall,
              ];
            }
            setStreamingToolCalls(collectedToolCalls);

            const artifact = artifactFromResult(result);
            if (artifact) {
              collectedArtifacts = upsertArtifacts(collectedArtifacts, [artifact]);
              setStreamingArtifacts(collectedArtifacts);
            }
          } else if (payload.type === "done") {
            if (payload.task_run_id || payload.task_type || payload.task) {
              serverPersistedAssistant = true;
            }
            if (payload.task && typeof payload.task === "object") {
              latestTaskRun = payload.task as TaskRun;
            }
            if (typeof payload.task_type === "string") {
              latestTaskType = payload.task_type;
            }
            if (Array.isArray(payload.artifacts) && payload.artifacts.length > 0) {
              collectedArtifacts = upsertArtifacts(collectedArtifacts, payload.artifacts as GeneratedArtifact[]);
              setStreamingArtifacts(collectedArtifacts);
            }
          } else if (payload.type === "error") {
            throw new Error(payload.message || payload.error || "Chat failed");
          }
        }
      }

      const finalContent = fullContent.trim() || buildArtifactFallbackContent(collectedArtifacts);
      setStreamingContent("");
      setStreamingStatus("");
      setStreamingToolCalls([]);
      setStreamingReferences([]);
      setStreamingArtifacts([]);
      if (finalContent || collectedToolCalls.length > 0 || collectedArtifacts.length > 0) {
        const assistantMessage = buildAssistantMessage({
          artifacts: collectedArtifacts,
          content: finalContent,
          conversationId,
          projectId,
          references: collectedReferences,
          toolCalls: collectedToolCalls,
          taskRun: serverPersistedAssistant ? latestTaskRun : null,
          taskType: latestTaskType,
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
        setStreamingStatus("");
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
      setStreamingStatus("");
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
    streamingStatus,
    streamingReferences,
    streamingToolCalls,
    resetStreamingContent,
    sendMessage,
    stopGeneration,
  };
}
