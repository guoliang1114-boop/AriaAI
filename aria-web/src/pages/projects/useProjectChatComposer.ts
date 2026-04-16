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
  const path = typeof result.file_path === "string" ? result.file_path : typeof result.path === "string" ? result.path : "";
  const name = typeof result.file_name === "string" ? result.file_name : typeof result.name === "string" ? result.name : "";
  const fileType = typeof result.file_type === "string" ? result.file_type : "";

  if (!path || !name || !fileType) {
    return null;
  }

  return {
    name,
    file_type: fileType,
    path,
    description: typeof result.note === "string" ? result.note : typeof result.message === "string" ? result.message : "",
  };
}

type UseProjectChatComposerParams = {
  projectId: number;
  activeConvId: number | null;
  knowledgeScope: "project" | "client" | "global";
  setMessages: Dispatch<SetStateAction<Message[]>>;
  createConversation: (firstMessage?: string) => Promise<number | null>;
  fetchMessages: (conversationId: number) => Promise<void>;
  fetchConversations: () => Promise<void>;
  isNearBottomRef: MutableRefObject<boolean>;
  scrollToBottom: (smooth?: boolean) => void;
  onSendError: () => void;
};

export function useProjectChatComposer({
  projectId,
  activeConvId,
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
    setIsLoading(true);
    resetStreamingContent();

    if (!conversationId) {
      conversationId = await createConversation(trimmed);
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

          try {
            const payload = JSON.parse(line.replace(/^data:\s*/, "")) as StreamEvent;
            if ((payload.type === "text" || payload.type === "chunk") && payload.content) {
              fullContent += payload.content;
              setStreamingContent(fullContent);
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
              setStreamingToolCalls(collectedToolCalls);
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
          } catch (error) {
            console.error("Failed to parse stream event:", error);
          }
        }
      }

      setStreamingContent("");
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
