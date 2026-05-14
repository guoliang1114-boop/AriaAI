import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProjectChatConversations } from "./useProjectChatConversations";
import type { Conversation, Message } from "../../types/api";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

vi.mock("./projectChatCopy", () => ({
  buildDefaultChatTitle: (content: string, _isZh: boolean) => {
    if (!content) return "New Chat";
    return content.slice(0, 15) + (content.length > 15 ? "..." : "");
  },
}));

const makeConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 1,
  title: "Test Conversation",
  project_id: 10,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  ...overrides,
});

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  conversation_id: 1,
  role: "user",
  content: "Hello",
  metadata_json: "{}",
  created_at: "2025-01-01T00:00:00Z",
  ...overrides,
});

const defaultProps = {
  projectId: 10,
  isZh: true,
  onCreateConversationError: vi.fn(),
  onDeleteConversationError: vi.fn(),
  onRenameConversationError: vi.fn(),
};

describe("useProjectChatConversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("fetches conversations on mount and sets loading state", async () => {
    const conv = makeConversation();
    mockGet.mockResolvedValue([conv]);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    expect(result.current.isLoadingConversations).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoadingConversations).toBe(false);
    });
    expect(result.current.conversations).toEqual([conv]);
    expect(result.current.activeConvId).toBe(1);
  });

  it("sets active conversation to first conversation if none active", async () => {
    const convs = [
      makeConversation({ id: 10 }),
      makeConversation({ id: 20 }),
    ];
    mockGet.mockResolvedValue(convs);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.activeConvId).toBe(10);
    });
  });

  it("fetches messages when activeConvId changes", async () => {
    const conv = makeConversation({ id: 5 });
    const msgs = [makeMessage({ id: 1, conversation_id: 5 })];
    mockGet.mockImplementation((url: string) => {
      if (url.includes("/chat/conversations?")) return Promise.resolve([conv]);
      if (url.includes("/messages")) return Promise.resolve(msgs);
      return Promise.resolve([]);
    });

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.messages).toEqual(msgs);
    });
    expect(result.current.isLoadingMessages).toBe(false);
  });

  it("handles fetch conversations error gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGet.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.isLoadingConversations).toBe(false);
    });
    expect(result.current.conversations).toEqual([]);
    consoleSpy.mockRestore();
  });

  it("creates a conversation and adds it to the list", async () => {
    mockGet.mockResolvedValue([]);
    const newConv = makeConversation({ id: 99, title: "Hello..." });
    mockPost.mockResolvedValue(newConv);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.isLoadingConversations).toBe(false);
    });

    let newId: number | null = null;
    await act(async () => {
      newId = await result.current.createConversation("Hello World");
    });

    expect(newId).toBe(99);
    expect(result.current.conversations[0].id).toBe(99);
    expect(result.current.activeConvId).toBe(99);
    expect(mockPost).toHaveBeenCalledWith("/chat/conversations", {
      project_id: 10,
      skill_id: undefined,
      title: "Hello World",
    });
  });

  it("calls onCreateConversationError when create fails", async () => {
    const onError = vi.fn();
    mockGet.mockResolvedValue([]);
    mockPost.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() =>
      useProjectChatConversations({ ...defaultProps, onCreateConversationError: onError }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingConversations).toBe(false);
    });

    let newId: number | null = null;
    await act(async () => {
      newId = await result.current.createConversation("msg");
    });

    expect(newId).toBeNull();
    expect(onError).toHaveBeenCalled();
  });

  it("deletes a conversation and removes it from list", async () => {
    const convs = [makeConversation({ id: 1 }), makeConversation({ id: 2 })];
    mockGet.mockResolvedValue(convs);
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(2);
    });

    await act(async () => {
      await result.current.deleteConversation(1);
    });

    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.conversations[0].id).toBe(2);
    expect(mockDelete).toHaveBeenCalledWith("/chat/conversations/1");
  });

  it("clears messages when deleting active conversation", async () => {
    const conv = makeConversation({ id: 1 });
    mockGet.mockImplementation((url: string) => {
      if (url.includes("/chat/conversations?")) return Promise.resolve([conv]);
      if (url.includes("/messages")) return Promise.resolve([makeMessage()]);
      return Promise.resolve([]);
    });
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.activeConvId).toBe(1);
    });

    await act(async () => {
      await result.current.deleteConversation(1);
    });

    expect(result.current.activeConvId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it("calls onDeleteConversationError when delete fails", async () => {
    const onError = vi.fn();
    mockGet.mockResolvedValue([makeConversation()]);
    mockDelete.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() =>
      useProjectChatConversations({ ...defaultProps, onDeleteConversationError: onError }),
    );

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteConversation(1);
    });

    expect(onError).toHaveBeenCalled();
  });

  it("renames a conversation", async () => {
    const conv = makeConversation({ id: 1, title: "Old Title" });
    mockGet.mockResolvedValue([conv]);
    mockPatch.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    await act(async () => {
      await result.current.renameConversation(1, "New Title");
    });

    expect(result.current.conversations[0].title).toBe("New Title");
    expect(result.current.editingConvId).toBeNull();
    expect(mockPatch).toHaveBeenCalledWith("/chat/conversations/1", { title: "New Title" });
  });

  it("rename skips API call and clears editing state when title is empty", async () => {
    const conv = makeConversation({ id: 1, title: "Old" });
    mockGet.mockResolvedValue([conv]);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    act(() => {
      result.current.setEditingConvId(1);
    });

    await act(async () => {
      await result.current.renameConversation(1, "   ");
    });

    expect(mockPatch).not.toHaveBeenCalled();
    expect(result.current.editingConvId).toBeNull();
  });

  it("calls onRenameConversationError when rename fails", async () => {
    const onError = vi.fn();
    mockGet.mockResolvedValue([makeConversation()]);
    mockPatch.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() =>
      useProjectChatConversations({ ...defaultProps, onRenameConversationError: onError }),
    );

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    await act(async () => {
      await result.current.renameConversation(1, "New");
    });

    expect(onError).toHaveBeenCalled();
  });

  it("beginRenameConversation sets editing state", async () => {
    mockGet.mockResolvedValue([makeConversation({ id: 5, title: "Chat" })]);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    act(() => {
      result.current.beginRenameConversation(makeConversation({ id: 5, title: "Chat" }));
    });

    expect(result.current.editingConvId).toBe(5);
    expect(result.current.editTitle).toBe("Chat");
  });

  it("startNewChat clears activeConvId and messages", async () => {
    const conv = makeConversation();
    mockGet.mockImplementation((url: string) => {
      if (url.includes("/chat/conversations?")) return Promise.resolve([conv]);
      if (url.includes("/messages")) return Promise.resolve([makeMessage()]);
      return Promise.resolve([]);
    });

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    act(() => {
      result.current.startNewChat();
    });

    expect(result.current.activeConvId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it("activeConversation returns the matching conversation", async () => {
    const convs = [
      makeConversation({ id: 1, title: "First" }),
      makeConversation({ id: 2, title: "Second" }),
    ];
    mockGet.mockResolvedValue(convs);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.activeConversation?.title).toBe("First");
    });
  });

  it("openDeleteConversationDialog and closeDeleteConversationDialog work", async () => {
    mockGet.mockResolvedValue([makeConversation()]);

    const { result } = renderHook(() =>
      useProjectChatConversations(defaultProps),
    );

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    const conv = makeConversation();
    act(() => {
      result.current.openDeleteConversationDialog(conv);
    });
    expect(result.current.conversationPendingDelete).toEqual(conv);

    act(() => {
      result.current.closeDeleteConversationDialog();
    });
    expect(result.current.conversationPendingDelete).toBeNull();
  });
});
