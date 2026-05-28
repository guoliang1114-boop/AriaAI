import { useCallback, useEffect, useRef } from "react";

import { getApiBaseUrl } from "../../config/api";
import type {
  GeneratedArtifact,
  Message,
  MessageMetadata,
  PendingToolConfirmation,
  Reference,
  TaskRun,
  TaskRunArtifact,
  TaskRunStep,
  ToolCallEvent,
} from "../../types/api";
import type { StreamEvent } from "../../types/chat";
import { isProductRunEvent } from "../../types/productRunEvent";
import { useChatStreamStore } from "../../stores/chatStreamStore";
import { useRunActivityStore } from "../../stores/runActivityStore";
import { isRunHarnessV1Enabled } from "../../utils/runHarnessFlag";
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
  id,
  projectId,
  references,
  toolCalls,
  pendingToolConfirmations,
  resolvedActionConfirmations,
  taskRun,
  taskType,
}: {
  artifacts: GeneratedArtifact[];
  content: string;
  conversationId: number;
  id?: number;
  projectId: number;
  references: Reference[];
  toolCalls: ToolCallEvent[];
  pendingToolConfirmations?: PendingToolConfirmation[];
  resolvedActionConfirmations?: string[];
  taskRun?: TaskRun | null;
  taskType?: string;
}): Message {
  const metadata: MessageMetadata = {
    artifacts,
    project_id: projectId,
    references,
    tool_calls: toolCalls,
  };
  if (pendingToolConfirmations?.length) {
    metadata.pending_tool_confirmations = pendingToolConfirmations;
  }
  if (resolvedActionConfirmations?.length) {
    metadata.resolved_action_confirmations = resolvedActionConfirmations;
  }
  if (taskRun) {
    metadata.task_run = taskRun;
    metadata.task_run_id = taskRun.id;
    metadata.task_type = taskType || taskRun.task_type;
  }
  return {
    id: id ?? Date.now() + 1,
    conversation_id: conversationId,
    role: "assistant",
    content,
    metadata_json: JSON.stringify(metadata),
    created_at: new Date().toISOString(),
  };
}

function upsertMessageById(messages: Message[], message: Message) {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  if (existingIndex < 0) {
    return [...messages, message];
  }
  const next = [...messages];
  next[existingIndex] = message;
  return next;
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
  fetchMessages: (conversationId: number, options?: { silent?: boolean }) => Promise<void>;
  fetchConversations: (options?: { silent?: boolean }) => Promise<void>;
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
  // Product Run Event v1 timeline store (feature-flagged). Apply ingests every
  // recognised v1 event; reset clears the timeline at send / cleanup time.
  const applyRunActivity = useRunActivityStore((state) => state.apply);
  const resetRunActivity = useRunActivityStore((state) => state.reset);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortControllerAsyncRef = useRef<AbortController | null>(null);
  const activeConvIdRef = useRef<number | null>(activeConvId);
  const streamRequestSeqRef = useRef(0);
  const sendInFlightRef = useRef(false);

  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);

  const canUpdateConversation = useCallback((conversationId: number) => {
    const current = activeConvIdRef.current;
    return current === conversationId;
  }, []);

  const canUpdateVisibleStream = useCallback(
    (requestId: number, conversationId: number) =>
      requestId === streamRequestSeqRef.current && canUpdateConversation(conversationId),
    [canUpdateConversation],
  );

  const resetStreamingContent = useCallback(() => {
    resetStream();
  }, [resetStream]);

  const sendMessage = useCallback(
    async (content: string, options: SendMessageOptions = {}) => {
      const trimmed = content.trim();
      if (!trimmed) return false;
      if (sendInFlightRef.current) return false;
      sendInFlightRef.current = true;

      let conversationId = activeConvId;
      const skillId = forceSkill ? selectedSkillId || undefined : undefined;
      const requestId = streamRequestSeqRef.current + 1;
      streamRequestSeqRef.current = requestId;
      const optimisticMessageId = Date.now();
      resetStream();
      resetRunActivity();
      setStreamIsLoading(true);
      setStreamStatus("AI 正在读取项目上下文并准备回复...");

      const tempUserMsg: Message = {
        id: optimisticMessageId,
        conversation_id: conversationId ?? -requestId,
        role: "user",
        content: trimmed,
        metadata_json: "{}",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMsg]);
      isNearBottomRef.current = true;
      scrollToBottom(true);
      setTimeout(() => scrollToBottom(true), 0);

      if (!conversationId) {
        conversationId = await createConversation(trimmed, skillId || null);
        if (!conversationId) {
          setMessages((prev) => prev.filter((message) => message.id !== optimisticMessageId));
          resetStream();
          return false;
        }
        const createdConversationId = conversationId;
        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimisticMessageId
              ? { ...message, conversation_id: createdConversationId }
              : message,
          ),
        );
      }
      if (activeConvIdRef.current === null) {
        activeConvIdRef.current = conversationId;
      }

      let fullContent = "";
      let collectedReferences: Reference[] = [];
      let collectedToolCalls: ToolCallEvent[] = [];
      let collectedArtifacts: GeneratedArtifact[] = [];
        let collectedPendingToolConfirmations: PendingToolConfirmation[] = [];
        let collectedResolvedActionConfirmations: string[] = options.actionConfirmations || [];
      let serverPersistedAssistant = false;
      let latestTaskRun: TaskRun | null = null;
      let latestTaskType = "";
      let wasTruncated = false;
      let assistantMessageId: number | null = null;

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

            // Product Run Event v1 dispatch (additive, behind a flag). Feeds
            // the run-activity store without touching the legacy event chain
            // below — both consumers run while we're in double-send.
            if (isRunHarnessV1Enabled() && isProductRunEvent(payload)) {
              applyRunActivity(payload);
            }

            if ((payload.type === "text" || payload.type === "chunk") && payload.content) {
              fullContent += payload.content;
              if (canUpdateVisibleStream(requestId, conversationId)) {
                appendStreamText(payload.content);
                setStreamStatus("");
              }
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
                if (canUpdateVisibleStream(requestId, conversationId)) {
                  setStreamToolCalls(collectedToolCalls);
                }
                continue;
              }
              if (canUpdateVisibleStream(requestId, conversationId)) {
                setStreamStatus(payload.message);
              }
              if (payload.stage === "saving" || payload.stage === "finalizing") {
                if (canUpdateVisibleStream(requestId, conversationId)) {
                  setStreamToolCalls(collectedToolCalls.filter((call) => call.step_index || call.status !== "running"));
                }
              }
            } else if (payload.type === "references") {
              collectedReferences = payload.references || [];
              if (canUpdateVisibleStream(requestId, conversationId)) {
                setStreamReferences(collectedReferences);
              }
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
                if (canUpdateVisibleStream(requestId, conversationId)) {
                  setStreamToolCalls(collectedToolCalls);
                }
              }
              if (Array.isArray(task.artifacts) && task.artifacts.length > 0) {
                collectedArtifacts = upsertArtifacts(
                  collectedArtifacts,
                  task.artifacts
                    .map((artifact: TaskRunArtifact) => artifactFromTaskRunArtifact(artifact))
                    .filter((artifact: GeneratedArtifact | null): artifact is GeneratedArtifact => Boolean(artifact)),
                );
                if (canUpdateVisibleStream(requestId, conversationId)) {
                  setStreamArtifacts(collectedArtifacts);
                }
              }
            } else if (payload.type === "tool_executing" && payload.tool_name) {
              const toolDetail = payload.message || `正在调用 ${payload.tool_name}`;
              const hasActiveWorkflowStep = collectedToolCalls.some(
                (call) => call.step_index !== undefined && call.step_index !== null && call.status === "running",
              );
              if (hasActiveWorkflowStep) {
                collectedToolCalls = attachToolDetailToActiveStep(collectedToolCalls, toolDetail);
                if (canUpdateVisibleStream(requestId, conversationId)) {
                  setStreamToolCalls(collectedToolCalls);
                }
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
              if (canUpdateVisibleStream(requestId, conversationId)) {
                setStreamToolCalls([
                  ...collectedToolCalls.filter((call) => call.tool_name !== "Aria" || call.status !== "running"),
                ]);
              }
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
              if (canUpdateVisibleStream(requestId, conversationId)) {
                setStreamToolCalls(collectedToolCalls);
              }

              const artifact = artifactFromResult(result);
              if (artifact) {
                collectedArtifacts = upsertArtifacts(collectedArtifacts, [artifact]);
                if (canUpdateVisibleStream(requestId, conversationId)) {
                  setStreamArtifacts(collectedArtifacts);
                }
              }
            } else if (payload.type === "done") {
              if (typeof payload.assistant_message_id === "number") {
                assistantMessageId = payload.assistant_message_id;
              }
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
                if (canUpdateVisibleStream(requestId, conversationId)) {
                  setStreamArtifacts(collectedArtifacts);
                }
              }
              if (Array.isArray(payload.pending_tool_confirmations)) {
                collectedPendingToolConfirmations = payload.pending_tool_confirmations;
              }
              if (Array.isArray(payload.resolved_action_confirmations)) {
                collectedResolvedActionConfirmations = payload.resolved_action_confirmations;
              }
            } else if (payload.type === "truncated") {
              wasTruncated = true;
              if (canUpdateVisibleStream(requestId, conversationId)) {
                setStreamTruncated(true);
              }
            } else if (payload.type === "error") {
              throw new Error(payload.message || payload.error || "Chat failed");
            }
          }
          if (done) break;
        }

        const hasWorkflowSteps = collectedToolCalls.some((call) => call.step_index !== undefined && call.step_index !== null);
        if (hasWorkflowSteps) {
          collectedToolCalls = clearStandaloneRunningTools(collectedToolCalls);
          if (canUpdateVisibleStream(requestId, conversationId)) {
            setStreamToolCalls(collectedToolCalls);
          }
        }
        const finalContent = fullContent.trim() || buildArtifactFallbackContent(collectedArtifacts);
        const isTruncated = wasTruncated;
        const hasLocalAssistantPayload =
          !!finalContent
          || collectedToolCalls.length > 0
          || collectedArtifacts.length > 0
          || collectedReferences.length > 0
          || collectedPendingToolConfirmations.length > 0
          || !!latestTaskRun;

        if (hasLocalAssistantPayload) {
          const assistantMessage = buildAssistantMessage({
            artifacts: collectedArtifacts,
            content: finalContent,
            conversationId,
            id: assistantMessageId ?? undefined,
            projectId,
            references: collectedReferences,
            toolCalls: collectedToolCalls,
            pendingToolConfirmations: collectedPendingToolConfirmations,
            resolvedActionConfirmations: collectedResolvedActionConfirmations,
            taskRun: serverPersistedAssistant ? latestTaskRun : null,
            taskType: latestTaskType,
          });
          if (isTruncated) {
            assistantMessage.metadata_json = JSON.stringify({
              ...JSON.parse(assistantMessage.metadata_json || "{}"),
              truncated: true,
            });
          }
          if (canUpdateVisibleStream(requestId, conversationId)) {
            setMessages((prev) => upsertMessageById(prev, assistantMessage));
            resetStream();
          }
          if (assistantMessageId && canUpdateConversation(conversationId)) {
            void fetchMessages(conversationId, { silent: true });
          }
        } else {
          if (canUpdateVisibleStream(requestId, conversationId)) {
            resetStream();
          }
          if (canUpdateConversation(conversationId)) {
            void fetchMessages(conversationId, { silent: true });
          }
        }
        void fetchConversations({ silent: true });
        return true;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          const stoppedToolCalls = collectedToolCalls.map((call) =>
            call.status === "running"
              ? { ...call, status: "error" as const, error: "Generation stopped" }
              : call,
          );
          if (canUpdateVisibleStream(requestId, conversationId)) {
            resetStream();
          }
          if (fullContent.trim()) {
            const assistantMessage = buildAssistantMessage({
              artifacts: collectedArtifacts,
              content: fullContent,
              conversationId,
              projectId,
              references: collectedReferences,
              toolCalls: stoppedToolCalls,
              pendingToolConfirmations: collectedPendingToolConfirmations,
              resolvedActionConfirmations: collectedResolvedActionConfirmations,
            });
            if (canUpdateVisibleStream(requestId, conversationId)) {
              setMessages((prev) => [...prev, assistantMessage]);
            }
          }
          void fetchConversations();
          return false;
        }
        console.error("Failed to send message:", error);
        if (canUpdateVisibleStream(requestId, conversationId)) {
          resetStream();
        }
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
            pendingToolConfirmations: collectedPendingToolConfirmations,
            resolvedActionConfirmations: collectedResolvedActionConfirmations,
            taskRun: serverPersistedAssistant ? latestTaskRun : null,
            taskType: latestTaskType,
          });
          assistantMessage.metadata_json = JSON.stringify({
            ...JSON.parse(assistantMessage.metadata_json || "{}"),
            stream_interrupted: true,
          });
          if (canUpdateVisibleStream(requestId, conversationId)) {
            setMessages((prev) => [...prev, assistantMessage]);
          }
          void fetchConversations();
        } else {
          onSendError();
          if (canUpdateConversation(conversationId)) {
            await fetchMessages(conversationId, { silent: true });
          }
        }
        return false;
      } finally {
        sendInFlightRef.current = false;
        abortControllerRef.current = null;
        // Clear isLoading whenever this stream is still the active one, even if
        // the user has switched conversations in the meantime. If a newer send
        // has already bumped streamRequestSeqRef, leave its loading state alone.
        if (requestId === streamRequestSeqRef.current) {
          setStreamIsLoading(false);
        }
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
      canUpdateConversation,
      canUpdateVisibleStream,
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
      const requestId = streamRequestSeqRef.current + 1;
      streamRequestSeqRef.current = requestId;

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
      if (activeConvIdRef.current === null) {
        activeConvIdRef.current = conversationId;
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
        if (canUpdateVisibleStream(requestId, conversationId)) {
          setMessages((prev) => [...prev, backgroundMessage]);
        }
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
        if (canUpdateVisibleStream(requestId, conversationId)) {
          resetStream();
        }
      }
    },
    [
      activeConvId,
      createConversation,
      canUpdateVisibleStream,
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
