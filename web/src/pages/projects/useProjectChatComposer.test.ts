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

  it("shows an optimistic user turn and AI status before a new conversation is created", async () => {
    let messages: Message[] = [];
    const setMessages = vi.fn((updater: SetStateAction<Message[]>) => {
      messages = typeof updater === "function" ? updater(messages) : updater;
    });
    const fetchMessages = vi.fn().mockResolvedValue(undefined);
    const fetchConversations = vi.fn().mockResolvedValue(undefined);
    let resolveConversation: (value: number | null) => void = () => {};
    const createConversation = vi.fn(
      () =>
        new Promise<number | null>((resolve) => {
          resolveConversation = resolve;
        }),
    );
    const scrollToBottom = vi.fn();
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

    const { result } = renderHook(() =>
      useProjectChatComposer({
        projectId: 32,
        activeConvId: null,
        selectedSkillId: null,
        forceSkill: false,
        knowledgeScope: "project",
        selectedModel: "",
        setMessages,
        createConversation,
        fetchMessages,
        fetchConversations,
        isNearBottomRef: { current: false },
        scrollToBottom,
        onSendError: vi.fn(),
      }),
    );

    let sendPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      sendPromise = result.current.sendMessage("解释一下这个表格");
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "解释一下这个表格",
      conversation_id: -1,
    });
    expect(useChatStreamStore.getState().isLoading).toBe(true);
    expect(useChatStreamStore.getState().streamingStatus).toBe("AI 正在读取项目上下文并准备回复...");
    expect(scrollToBottom).toHaveBeenCalled();

    await act(async () => {
      resolveConversation(7);
    });

    await waitFor(() => {
      expect(streamController).not.toBeNull();
    });

    await act(async () => {
      streamController?.enqueue(encoder.encode(sse({ type: "text", content: "回答" })));
      streamController?.enqueue(encoder.encode(sse({ type: "done", assistant_message_id: 9000 })));
      streamController?.close();
      await sendPromise;
    });

    expect(messages.some((message) => message.role === "assistant")).toBe(true);
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

  it("blocks overlapping sends while a stream is in flight", async () => {
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
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(responseStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result } = renderHook(() =>
      useProjectChatComposer({
        projectId: 32,
        activeConvId: 1,
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
    );

    let firstSend: Promise<boolean> = Promise.resolve(false);
    let secondSend: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      firstSend = result.current.sendMessage("第一轮");
      secondSend = result.current.sendMessage("第二轮");
    });

    await waitFor(() => {
      expect(streamController).not.toBeNull();
    });

    await act(async () => {
      streamController?.enqueue(encoder.encode(sse({ type: "text", content: "回答" })));
      streamController?.enqueue(encoder.encode(sse({ type: "done", assistant_message_id: 9002 })));
      streamController?.close();
      await firstSend;
    });

    await expect(secondSend).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user", content: "第一轮" });
  });
});
