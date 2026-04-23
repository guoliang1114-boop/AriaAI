import {
  useCallback,
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
    description: typeof source.note === "string" ? source.note : typeof source.message === "string" ? source.message : "",
  };
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

    try {
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
      });

      if (!response.ok) throw new Error("Failed to send message");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let collectedReferences: Reference[] = [];
      let collectedToolCalls: ToolCallEvent[] = [];
      let collectedArtifacts: GeneratedArtifact[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
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
            if (payload.stage === "saving" || payload.stage === "finalizing") {
              setStreamingToolCalls((prev) =>
                prev.filter((call) => call.tool_name !== "Aria" || call.status !== "running"),
              );
              continue;
            }
            const statusCall: ToolCallEvent = {
              tool_name: "Aria",
              status: "running",
              message: payload.message,
            };
            setStreamingToolCalls((prev) => [
              ...prev.filter((call) => call.tool_name !== "Aria" || call.status !== "running"),
              statusCall,
            ]);
          } else if (payload.type === "references") {
            collectedReferences = payload.references || [];
            setStreamingReferences(collectedReferences);
          } else if (payload.type === "tool_executing" && payload.tool_name) {
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
            setStreamingToolCalls(collectedToolCalls);

            const artifact = artifactFromResult(result);
            if (artifact && !collectedArtifacts.some((item) => item.path === artifact.path)) {
              collectedArtifacts = [...collectedArtifacts, artifact];
              setStreamingArtifacts(collectedArtifacts);
            }
          } else if (payload.type === "error") {
            throw new Error(payload.message || payload.error || "Chat failed");
          }
        }
      }

      setStreamingContent("");
      setStreamingToolCalls([]);
      await fetchMessages(conversationId);
      if (
        collectedReferences.length > 0 ||
        collectedToolCalls.length > 0 ||
        collectedArtifacts.length > 0
      ) {
        setMessages((prev) => {
          const next = [...prev];
          for (let index = next.length - 1; index >= 0; index -= 1) {
            if (next[index]?.role === "assistant") {
              next[index] = mergeAssistantMetadata(next[index], {
                references: collectedReferences,
                tool_calls: collectedToolCalls,
                artifacts: collectedArtifacts,
                project_id: projectId,
              });
              break;
            }
          }
          return next;
        });
      }
      await fetchConversations();
      return true;
    } catch (error) {
      console.error("Failed to send message:", error);
      setStreamingContent("");
      setStreamingToolCalls([]);
      onSendError();
      await fetchMessages(conversationId);
      return false;
    } finally {
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

  return {
    isLoading,
    streamingArtifacts,
    streamingContent,
    streamingReferences,
    streamingToolCalls,
    resetStreamingContent,
    sendMessage,
  };
}
