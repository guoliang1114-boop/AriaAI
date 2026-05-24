import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectChatPanel } from "./useProjectChatPanel";

describe("useProjectChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default state values", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    expect(result.current.knowledgeScope).toBe("project");
    expect(result.current.inputValue).toBe("");
    expect(result.current.isSidebarOpen).toBe(true);
    expect(result.current.isAutoFollow).toBe(true);
    expect(result.current.showScrollToBottom).toBe(false);
    expect(result.current.saveModalOpen).toBe(false);
    expect(result.current.saveMessageId).toBeNull();
    expect(result.current.conversationSaveModalOpen).toBe(false);
  });

  it("setKnowledgeScope changes knowledge scope", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    act(() => {
      result.current.setKnowledgeScope("client");
    });
    expect(result.current.knowledgeScope).toBe("client");

    act(() => {
      result.current.setKnowledgeScope("global");
    });
    expect(result.current.knowledgeScope).toBe("global");
  });

  it("setInputValue changes input value", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    act(() => {
      result.current.setInputValue("hello world");
    });
    expect(result.current.inputValue).toBe("hello world");
  });

  it("setIsSidebarOpen toggles sidebar", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    act(() => {
      result.current.setIsSidebarOpen(false);
    });
    expect(result.current.isSidebarOpen).toBe(false);

    act(() => {
      result.current.setIsSidebarOpen(true);
    });
    expect(result.current.isSidebarOpen).toBe(true);
  });

  it("openSaveModal sets modal state and message id", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    act(() => {
      result.current.openSaveModal(42);
    });
    expect(result.current.saveModalOpen).toBe(true);
    expect(result.current.saveMessageId).toBe(42);
  });

  it("closeSaveModal closes the save modal", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    act(() => {
      result.current.openSaveModal(42);
    });
    expect(result.current.saveModalOpen).toBe(true);

    act(() => {
      result.current.closeSaveModal();
    });
    expect(result.current.saveModalOpen).toBe(false);
  });

  it("openConversationSaveModal and closeConversationSaveModal toggle state", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    act(() => {
      result.current.openConversationSaveModal();
    });
    expect(result.current.conversationSaveModalOpen).toBe(true);

    act(() => {
      result.current.closeConversationSaveModal();
    });
    expect(result.current.conversationSaveModalOpen).toBe(false);
  });

  it("handleSend calls sendMessage with current input and clears it", () => {
    const { result } = renderHook(() => useProjectChatPanel());
    const sendMessage = vi.fn();

    act(() => {
      result.current.setInputValue("test message");
    });

    act(() => {
      result.current.handleSend(sendMessage);
    });

    expect(sendMessage).toHaveBeenCalledWith("test message");
    expect(result.current.inputValue).toBe("");
  });

  it("handleSend works with async sendMessage", async () => {
    const { result } = renderHook(() => useProjectChatPanel());
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    act(() => {
      result.current.setInputValue("async msg");
    });

    await act(async () => {
      result.current.handleSend(sendMessage);
    });

    expect(sendMessage).toHaveBeenCalledWith("async msg");
    expect(result.current.inputValue).toBe("");
  });

  it("enableAutoFollow sets isAutoFollow to true", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    const scrollToMock = vi.fn();
    // Disable auto-follow by scrolling far from bottom
    const mockEl = {
      scrollHeight: 2000,
      scrollTop: 0,
      clientHeight: 200,
      scrollTo: scrollToMock,
    };
    // @ts-expect-error partial mock
    result.current.messagesContainerRef.current = mockEl;

    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.isAutoFollow).toBe(false);

    act(() => {
      result.current.enableAutoFollow();
    });
    expect(result.current.isAutoFollow).toBe(true);
    expect(scrollToMock).toHaveBeenCalled();
  });

  it("handleScroll detects near-bottom and updates showScrollToBottom", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    const mockEl = {
      scrollHeight: 1000,
      scrollTop: 800,
      clientHeight: 200,
    };
    // @ts-expect-error partial mock
    result.current.messagesContainerRef.current = mockEl;

    act(() => {
      result.current.handleScroll();
    });

    // distanceToBottom = 1000 - 800 - 200 = 0, which is < 120 (near bottom)
    // showScrollToBottom = 0 > 240 = false
    expect(result.current.showScrollToBottom).toBe(false);
  });

  it("handleScroll shows scroll-to-bottom button when far from bottom", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    const mockEl = {
      scrollHeight: 2000,
      scrollTop: 0,
      clientHeight: 200,
    };
    // @ts-expect-error partial mock
    result.current.messagesContainerRef.current = mockEl;

    act(() => {
      result.current.handleScroll();
    });

    // distanceToBottom = 2000 - 0 - 200 = 1800, > 240 so showScrollToBottom = true
    // 1800 > 120 so isNearBottom = false, and isAutoFollow was true -> sets to false
    expect(result.current.showScrollToBottom).toBe(true);
    expect(result.current.isAutoFollow).toBe(false);
  });

  it("handleScroll does nothing when ref is null", () => {
    const { result } = renderHook(() => useProjectChatPanel());

    // messagesContainerRef.current is null by default
    act(() => {
      result.current.handleScroll();
    });

    // Should not throw, state unchanged
    expect(result.current.showScrollToBottom).toBe(false);
    expect(result.current.isAutoFollow).toBe(true);
  });
});
