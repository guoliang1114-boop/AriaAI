import { useCallback, useRef } from "react";

import { getApiBaseUrl } from "../../config/api";
import type {
  GeneratedArtifact,
  Message,
  MessageMetadata,
  Reference,
  TaskRun,
  TaskRunArtifact,
  TaskRunStep,
  ToolCallEvent,
} from "../../types/api";
import type { StreamEvent } from "../../types/chat";
import { useChatStreamStore } from "../../stores/chatStreamStore";
import {
  artifactFromResult,
  artifactFromTaskRunArtifact,
  attachToolDetailToActiveStep,
  upsertArtifacts,
  upsertWorkflowStep,
  workflowStepFromTask,
} from "./projectChatWorkflow";
import { parseMentions } from "./projectChatMentions";

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
  if (typeof result.summary === "string" && result.summary) return result.summary;
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

function clearStandaloneRunningTools(calls: ToolCallEvent[], toolName?: string) {
  return calls.filter((call) => {
    if (call.step_index !== undefined && call.step_index !== null) return true;
    if (call.status !== "running") return true;
    return toolName ? call.tool_name !== toolName : false;
  });
}

type UseProjectChatComposerParams = {
  projectId: number;
  activeConvId: number | null;
  selectedSkillId: number | null;
  forceSkill: boolean;
  knowledgeScope: "project" | "client" | "global";
  selectedModel: string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  createConversation: (firstMessage?: string, skillId?: number | null) => Promise<number | null>;
  fetchMessages: (conversationId: number) => Promise<void>;
  fetchConversations: () => Promise<void>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  scrollToBottom: (smooth?: boolean) => void;
  onSendError: () => void;
};

type SendMessageOptions = {
  actionConfirmations?: string[];
};

export function useProjectChatComposer({
  projectId,
  activeConvId,
  selectedSkillId,
  forceSkill,
  knowledgeScope,
  selectedModel,
  setMessages,
  createConversation,
  fetchMessages,
  fetchConversations,
  isNearBottomRef,
  scrollToBottom,
  onSendError,
}: UseProjectChatComposerParams) {
  const isLoading = useChatStreamStore((state) => state.isLoading);
  const streamingArtifacts = useChatStreamStore((state) => state.streamingArtifacts);
  const streamingContent = useChatStreamStore((state) => state.streamingContent);
  const streamingStatus = useChatStreamStore((state) => state.streamingStatus);
  const streamingReferences = useChatStreamStore((state) => state.streamingReferences);
  const streamingToolCalls = useChatStreamStore((state) => state.streamingToolCalls);
  const streamingTruncated = useChatStreamStore((state) => state.streamingTruncated);
  const setStreamIsLoading = useChatStreamStore((state) => state.setIsLoading);
  const appendStreamText = useChatStreamStore((state) => state.appendText);
  const setStreamStatus = useChatStreamStore((state) => state.setStatus);
  const setStreamToolCalls = useChatStreamStore((state) => state.setStreamingToolCalls);
  const setStreamReferences = useChatStreamStore((state) => state.setReferences);
  const setStreamArtifacts = useChatStreamStore((state) => state.setStreamingArtifacts);
  const setStreamTruncated = useChatStreamStore((state) => state.setTruncated);
  const resetStream = useChatStreamStore((state) => state.reset);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortControllerAsyncRef = useRef<AbortController | null>(null);

  const resetStreamingContent = useCallback(() => {
    resetStream();
  }, [resetStream]);

  const sendMessage = useCallback(
    async (content: string, options: SendMessageOptions = {}) => {
      const trimmed = content.trim();
      if (!trimmed) return false;

      let conversationId = activeConvId;
      const skillId = forceSkill ? selectedSkillId || undefined : undefined;
      resetStream();
      setStreamIsLoading(true);
      setStreamStatus("我已收到，会先确认需求和可用上下文；如果需要调用工具，我会把每一步进度显示在这里。");

      if (!conversationId) {
        conversationId = await createConversation(trimmed, skillId || null);
        if (!conversationId) {
          resetStream();
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
      let wasTruncated = false;

      const mentions = parseMentions(trimmed);
      const mentionContext =
        mentions.length > 0
          ? {
              file_ids: mentions.filter((m) => m.type === "file").map((m) => m.id),
              stakeholder_ids: mentions.filter((m) => m.type === "stakeholder").map((m) => m.id),
              milestone_ids: mentions.filter((m) => m.type === "milestone").map((m) => m.id),
            }
          : undefined;

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
            model: selectedModel || undefined,
            mention_context: mentionContext,
            action_confirmations: options.actionConfirmations,
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
          if (done) {
            const tail = decoder.decode();
            if (tail) buffer += tail;
            if (!buffer.trim()) break;
          } else {
            if (abortControllerRef.current?.signal.aborted) break;
            buffer += decoder.decode(value, { stream: true });
          }

          const events = buffer.split("\n\n");
          buffer = done ? "" : events.pop() || "";

          for (const event of events) {
            if (!event.trim()) continue;
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
              appendStreamText(payload.content);
              setStreamStatus("");
            } else if (payload.type === "status" && payload.message) {
              if (payload.step_index !== undefined && payload.step_index !== null) {
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
                setStreamToolCalls(collectedToolCalls);
                continue;
              }
              setStreamStatus(payload.message);
              if (payload.stage === "saving" || payload.stage === "finalizing") {
                setStreamToolCalls(collectedToolCalls.filter((call) => call.step_index || call.status !== "running"));
              }
            } else if (payload.type === "references") {
              collectedReferences = payload.references || [];
              setStreamReferences(collectedReferences);
            } else if (payload.type === "task_run" && payload.task) {
              const task = payload.task as TaskRun;
              latestTaskRun = task;
              latestTaskType = task.task_type || latestTaskType;
              const steps = task.steps || [];
              const taskEvents = task.events || [];
              if (steps.length > 0) {
                collectedToolCalls = steps.reduce<ToolCallEvent[]>(
                  (items: ToolCallEvent[], step: TaskRunStep) =>
                    upsertWorkflowStep(items, workflowStepFromTask(step, steps.length, taskEvents)),
                  collectedToolCalls,
                );
                setStreamToolCalls(collectedToolCalls);
              }
              if (Array.isArray(task.artifacts) && task.artifacts.length > 0) {
                collectedArtifacts = upsertArtifacts(
                  collectedArtifacts,
                  task.artifacts
                    .map((artifact: TaskRunArtifact) => artifactFromTaskRunArtifact(artifact))
                    .filter((artifact: GeneratedArtifact | null): artifact is GeneratedArtifact => Boolean(artifact)),
                );
                setStreamArtifacts(collectedArtifacts);
              }
            } else if (payload.type === "tool_executing" && payload.tool_name) {
              const toolDetail = payload.message || `正在调用 ${payload.tool_name}`;
              const hasActiveWorkflowStep = collectedToolCalls.some(
                (call) => call.step_index !== undefined && call.step_index !== null && call.status === "running",
              );
              if (hasActiveWorkflowStep) {
                collectedToolCalls = attachToolDetailToActiveStep(collectedToolCalls, toolDetail);
                setStreamToolCalls(collectedToolCalls);
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
              setStreamToolCalls([
                ...collectedToolCalls.filter((call) => call.tool_name !== "Aria" || call.status !== "running"),
              ]);
            } else if (payload.type === "tool_result" && payload.result) {
              const result = payload.result;
              const resultStatus: ToolCallEvent["status"] =
                result.status === "confirmation_required"
                  ? "confirmation_required"
                  : result.status === "error" || result.success === false
                  ? "error"
                  : result.status === "skipped"
                    ? "skipped"
                    : "completed";
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
                confirmation_token: typeof result.confirmation_token === "string" ? result.confirmation_token : undefined,
                details: Array.isArray(result.details) ? result.details.filter((item): item is string => typeof item === "string") : undefined,
              };
              const hasActiveWorkflowStep = collectedToolCalls.some(
                (call) => call.step_index !== undefined && call.step_index !== null && call.status === "running",
              );
              if (hasActiveWorkflowStep && resultStatus === "confirmation_required") {
                collectedToolCalls = attachToolDetailToActiveStep(
                  clearStandaloneRunningTools(collectedToolCalls),
                  resultSummary || `工具 ${toolName} 等待确认`,
                  "confirmation_required",
                  {
                    confirmation_token: completedCall.confirmation_token,
                    details: completedCall.details,
                    summary: completedCall.summary,
                  },
                );
              } else if (hasActiveWorkflowStep) {
                const detail =
                  resultStatus === "error"
                    ? `工具 ${toolName} 执行失败${completedCall.error ? `：${completedCall.error}` : ""}`
                    : `工具 ${toolName} 执行完成${resultSummary ? `：${resultSummary}` : ""}`;
                collectedToolCalls = attachToolDetailToActiveStep(
                  clearStandaloneRunningTools(collectedToolCalls, toolName),
                  detail,
                  resultStatus === "error" ? "error" : undefined,
                );
              } else {
                collectedToolCalls = [
                  ...collectedToolCalls.filter((call) => call.tool_name !== toolName || call.status !== "running"),
                  completedCall,
                ];
              }
              setStreamToolCalls(collectedToolCalls);

              const artifact = artifactFromResult(result);
              if (artifact) {
                collectedArtifacts = upsertArtifacts(collectedArtifacts, [artifact]);
                setStreamArtifacts(collectedArtifacts);
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
                setStreamArtifacts(collectedArtifacts);
              }
            } else if (payload.type === "truncated") {
              wasTruncated = true;
              setStreamTruncated(true);
            } else if (payload.type === "error") {
              throw new Error(payload.message || payload.error || "Chat failed");
            }
          }
          if (done) break;
        }

        const hasWorkflowSteps = collectedToolCalls.some((call) => call.step_index !== undefined && call.step_index !== null);
        if (hasWorkflowSteps) {
          collectedToolCalls = clearStandaloneRunningTools(collectedToolCalls);
          setStreamToolCalls(collectedToolCalls);
        }
        const finalContent = fullContent.trim() || buildArtifactFallbackContent(collectedArtifacts);
        const isTruncated = wasTruncated;
        resetStream();
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
          if (isTruncated) {
            assistantMessage.metadata_json = JSON.stringify({
              ...JSON.parse(assistantMessage.metadata_json || "{}"),
              truncated: true,
            });
          }
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
          resetStream();
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
        resetStream();
        const failedToolCalls = collectedToolCalls.map((call) =>
          call.status === "running"
            ? { ...call, status: "error" as const, error: "连接中断，已保留当前收到的内容。" }
            : call,
        );
        if (fullContent.trim() || failedToolCalls.length > 0 || collectedArtifacts.length > 0) {
          const assistantMessage = buildAssistantMessage({
            artifacts: collectedArtifacts,
            content: fullContent.trim() || "连接中断，已保留当前已收到的执行记录。你可以稍后重试。",
            conversationId,
            projectId,
            references: collectedReferences,
            toolCalls: failedToolCalls,
            taskRun: serverPersistedAssistant ? latestTaskRun : null,
            taskType: latestTaskType,
          });
          assistantMessage.metadata_json = JSON.stringify({
            ...JSON.parse(assistantMessage.metadata_json || "{}"),
            stream_interrupted: true,
          });
          setMessages((prev) => [...prev, assistantMessage]);
          void fetchConversations();
        } else {
          onSendError();
          await fetchMessages(conversationId);
        }
        return false;
      } finally {
        abortControllerRef.current = null;
        setStreamIsLoading(false);
      }
    },
    [
      activeConvId,
      createConversation,
      fetchConversations,
      fetchMessages,
      isNearBottomRef,
      knowledgeScope,
      onSendError,
      projectId,
      appendStreamText,
      scrollToBottom,
      selectedSkillId,
      selectedModel,
      forceSkill,
      resetStream,
      setStreamArtifacts,
      setStreamIsLoading,
      setStreamReferences,
      setStreamStatus,
      setStreamToolCalls,
      setStreamTruncated,
      setMessages,
    ],
  );

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerAsyncRef.current?.abort();
  }, []);

  const sendMessageAsync = useCallback(
    async (content: string, options: SendMessageOptions = {}) => {
      const trimmed = content.trim();
      if (!trimmed) return false;

      let conversationId = activeConvId;
      const skillId = forceSkill ? selectedSkillId || undefined : undefined;

      resetStream();
      setStreamIsLoading(true);
      setStreamStatus("已提交到后台，正在创建任务…");

      if (!conversationId) {
        conversationId = await createConversation(trimmed, skillId || null);
        if (!conversationId) {
          resetStream();
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

      const mentions = parseMentions(trimmed);
      const mentionContext =
        mentions.length > 0
          ? {
              file_ids: mentions.filter((m) => m.type === "file").map((m) => m.id),
              stakeholder_ids: mentions.filter((m) => m.type === "stakeholder").map((m) => m.id),
              milestone_ids: mentions.filter((m) => m.type === "milestone").map((m) => m.id),
            }
          : undefined;

      abortControllerAsyncRef.current = new AbortController();
      const timeoutId = window.setTimeout(() => {
        abortControllerAsyncRef.current?.abort();
      }, 30000);

      try {
        const response = await fetch(`${getApiBaseUrl()}/chat/send-async`, {
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
            model: selectedModel || undefined,
            mention_context: mentionContext,
            action_confirmations: options.actionConfirmations,
          }),
          signal: abortControllerAsyncRef.current.signal,
        });
        window.clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(`Background request failed: ${response.status}`);
        }
        const result = (await response.json().catch(() => null)) as {
          conversation_id?: number;
          task_run_id?: number;
          status?: string;
        } | null;
        const backgroundMessage = buildAssistantMessage({
          artifacts: [],
          content: result?.task_run_id
            ? `已转入后台执行。任务记录 #${result.task_run_id} 已创建，你可以稍后回到这个对话查看结果。`
            : "已转入后台执行。你可以稍后回到这个对话查看结果；任务完成后会写入同一条对话历史。",
          conversationId: result?.conversation_id || conversationId,
          projectId,
          references: [],
          toolCalls: [
            {
              tool_name: "后台任务",
              status: "running",
              message: result?.task_run_id
                ? `请求已提交，后台任务 #${result.task_run_id} 正在执行。`
                : "请求已提交，正在后台执行。",
            },
          ],
        });
        setMessages((prev) => [...prev, backgroundMessage]);
        void fetchConversations();
        return true;
      } catch (error) {
        window.clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
          console.error("Background request timed out after 30s");
          onSendError();
          return false;
        }
        console.error("Failed to send async message:", error);
        onSendError();
        return false;
      } finally {
        abortControllerAsyncRef.current = null;
        resetStream();
      }
    },
    [
      activeConvId,
      createConversation,
      fetchConversations,
      forceSkill,
      knowledgeScope,
      onSendError,
      projectId,
      resetStream,
      scrollToBottom,
      selectedSkillId,
      selectedModel,
      setStreamIsLoading,
      setStreamStatus,
      setMessages,
      isNearBottomRef,
    ],
  );

  return {
    isLoading,
    streamingArtifacts,
    streamingContent,
    streamingStatus,
    streamingReferences,
    streamingToolCalls,
    streamingTruncated,
    resetStreamingContent,
    sendMessage,
    sendMessageAsync,
    stopGeneration,
  };
}
