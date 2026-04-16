import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { getApiBaseUrl } from "../../config/api";
import type { Message } from "../../types/api";

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

  const resetStreamingContent = () => {
    setStreamingContent("");
  };

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return false;

    let conversationId = activeConvId;
    setIsLoading(true);
    setStreamingContent("");

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
            const payload = JSON.parse(line.replace(/^data:\s*/, ""));
            if ((payload.type === "text" || payload.type === "chunk") && payload.content) {
              fullContent += payload.content;
              setStreamingContent(fullContent);
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
  };

  return {
    isLoading,
    streamingContent,
    resetStreamingContent,
    sendMessage,
  };
}
