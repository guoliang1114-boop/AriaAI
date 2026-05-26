import { act, renderHook, waitFor } from "@testing-library/react";
import type { SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../types/api";
import { useChatStreamStore } from "../../stores/chatStreamStore";
import { useProjectChatComposer } from "./useProjectChatComposer";

vi.mock("../../config/api", () => ({
  getApiBaseUrl: () => "https://api.test",
}));

function sse(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("useProjectChatComposer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStreamStore.getState().reset();
    window.localStorage.setItem("authToken", "token");
  });

  it("ignores late stream updates after switching to another conversation", async () => {
    let messages: Message[] = [];
    const setMessages = vi.fn((updater: SetStateAction<Message[]>) => {
      messages = typeof updater === "function" ? updater(messages) : updater;
    });
    const fetchMessages = vi.fn().mockResolvedValue(undefined);
    const fetchConversations = vi.fn().mockResolvedValue(undefined);
    const createConversation = vi.fn();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();
    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(responseStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result, rerender } = renderHook(
      ({ activeConvId }) =>
        useProjectChatComposer({
          projectId: 32,
          activeConvId,
          selectedSkillId: null,
          forceSkill: false,
          knowledgeScope: "project",
          selectedModel: "",
          setMessages,
          createConversation,
          fetchMessages,
          fetchConversations,
          isNearBottomRef: { current: false },
          scrollToBottom: vi.fn(),
          onSendError: vi.fn(),
        }),
      { initialProps: { activeConvId: 1 as number | null } },
    );

    let sendPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      sendPromise = result.current.sendMessage("分析一下风险");
    });

    rerender({ activeConvId: 2 });

    await waitFor(() => {
      expect(streamController).not.toBeNull();
    });

    await act(async () => {
      streamController?.enqueue(encoder.encode(sse({ type: "text", content: "旧对话回复" })));
      streamController?.enqueue(encoder.encode(sse({ type: "done", assistant_message_id: 9001 })));
      streamController?.close();
      await sendPromise;
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ conversation_id: 1, role: "user" });
    expect(messages.some((message) => message.role === "assistant")).toBe(false);
    expect(useChatStreamStore.getState().streamingContent).not.toContain("旧对话回复");
    expect(fetchMessages).not.toHaveBeenCalledWith(1, expect.anything());
  });
});
