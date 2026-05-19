import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./chatStore";

describe("chatStore", () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      conversations: [],
      activeConvId: null,
      selectedModel: "",
      selectedSkillId: null,
      isBackgroundMode: false,
      isPlanMode: false,
      planResult: null,
      isGeneratingPlan: false,
      planPendingContent: "",
      skills: [],
    });
  });

  it("should initialize with default state", () => {
    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.conversations).toEqual([]);
    expect(state.activeConvId).toBeNull();
    expect(state.isBackgroundMode).toBe(false);
    expect(state.isPlanMode).toBe(false);
    expect(state.planResult).toBeNull();
  });

  it("should set messages", () => {
    const msgs = [
      { id: 1, conversation_id: 1, role: "user" as const, content: "hi", metadata_json: "{}", created_at: "2024-01-01" },
    ];
    useChatStore.getState().setMessages(msgs);
    expect(useChatStore.getState().messages).toEqual(msgs);
  });

  it("should append a message", () => {
    const msg = { id: 2, conversation_id: 1, role: "assistant" as const, content: "hello", metadata_json: "{}", created_at: "2024-01-01" };
    useChatStore.getState().appendMessage(msg);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].role).toBe("assistant");
  });

  it("should set active conversation", () => {
    useChatStore.getState().setActiveConvId(42);
    expect(useChatStore.getState().activeConvId).toBe(42);
  });

  it("should toggle background mode", () => {
    useChatStore.getState().setIsBackgroundMode(true);
    expect(useChatStore.getState().isBackgroundMode).toBe(true);
    useChatStore.getState().setIsBackgroundMode(false);
    expect(useChatStore.getState().isBackgroundMode).toBe(false);
  });

  it("should toggle plan mode", () => {
    useChatStore.getState().setIsPlanMode(true);
    expect(useChatStore.getState().isPlanMode).toBe(true);
    useChatStore.getState().setIsPlanMode(false);
    expect(useChatStore.getState().isPlanMode).toBe(false);
  });

  it("should set plan result", () => {
    const plan = { plan_text: "Step 1", planned_tools: [] };
    useChatStore.getState().setPlanResult(plan);
    expect(useChatStore.getState().planResult).toEqual(plan);
  });

  it("should reset plan state", () => {
    useChatStore.getState().setPlanResult({ plan_text: "x", planned_tools: [] });
    useChatStore.getState().setIsGeneratingPlan(true);
    useChatStore.getState().setPlanPendingContent("test");
    useChatStore.getState().resetPlanState();

    const state = useChatStore.getState();
    expect(state.planResult).toBeNull();
    expect(state.isGeneratingPlan).toBe(false);
    expect(state.planPendingContent).toBe("");
  });

  it("should set selected model", () => {
    useChatStore.getState().setSelectedModel("kimi-k2.6");
    expect(useChatStore.getState().selectedModel).toBe("kimi-k2.6");
  });

  it("should set skills", () => {
    const skills = [{ id: 1, name: "Analysis", system_prompt: "" }] as unknown as Parameters<typeof useChatStore.getState>["setSkills"];
    useChatStore.getState().setSkills(skills as any);
    expect(useChatStore.getState().skills).toEqual(skills as any);
  });
});
