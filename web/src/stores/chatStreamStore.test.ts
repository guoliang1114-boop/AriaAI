import { describe, it, expect, beforeEach } from "vitest";
import { useChatStreamStore } from "./chatStreamStore";

describe("chatStreamStore", () => {
  beforeEach(() => {
    useChatStreamStore.getState().reset();
  });

  it("should initialize with default state", () => {
    const state = useChatStreamStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.streamingContent).toBe("");
    expect(state.streamingToolCalls).toEqual([]);
    expect(state.streamingArtifacts).toEqual([]);
    expect(state.streamingTruncated).toBe(false);
  });

  it("should set loading state", () => {
    useChatStreamStore.getState().setIsLoading(true);
    expect(useChatStreamStore.getState().isLoading).toBe(true);
    useChatStreamStore.getState().setIsLoading(false);
    expect(useChatStreamStore.getState().isLoading).toBe(false);
  });

  it("should append text", () => {
    useChatStreamStore.getState().appendText("Hello");
    expect(useChatStreamStore.getState().streamingContent).toBe("Hello");
    useChatStreamStore.getState().appendText(" world");
    expect(useChatStreamStore.getState().streamingContent).toBe("Hello world");
  });

  it("should set status", () => {
    useChatStreamStore.getState().setStatus("thinking");
    expect(useChatStreamStore.getState().streamingStatus).toBe("thinking");
  });

  it("should upsert tool calls", () => {
    useChatStreamStore.getState().upsertToolCall({
      tool_name: "test_tool",
      status: "running",
      message: "working",
    });
    const calls = useChatStreamStore.getState().streamingToolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe("test_tool");
    expect(calls[0].status).toBe("running");

    // Update existing
    useChatStreamStore.getState().upsertToolCall({
      tool_name: "test_tool",
      status: "completed",
      message: "done",
    });
    const updated = useChatStreamStore.getState().streamingToolCalls;
    expect(updated).toHaveLength(1);
    expect(updated[0].status).toBe("completed");
  });

  it("should set streaming tool calls", () => {
    const calls = [
      { tool_name: "a", status: "completed" as const, message: "done" },
      { tool_name: "b", status: "error" as const, message: "failed" },
    ];
    useChatStreamStore.getState().setStreamingToolCalls(calls);
    expect(useChatStreamStore.getState().streamingToolCalls).toHaveLength(2);
  });

  it("should set references", () => {
    const refs = [{ type: "doc" as const, id: 1, title: "Doc" }];
    useChatStreamStore.getState().setReferences(refs);
    expect(useChatStreamStore.getState().streamingReferences).toEqual(refs);
  });

  it("should add artifacts", () => {
    const artifact = {
      name: "report.pdf",
      file_type: "pdf",
      path: "/tmp/report.pdf",
    };
    useChatStreamStore.getState().addArtifact(artifact);
    expect(useChatStreamStore.getState().streamingArtifacts).toHaveLength(1);
  });

  it("should set truncated", () => {
    useChatStreamStore.getState().setTruncated(true);
    expect(useChatStreamStore.getState().streamingTruncated).toBe(true);
  });

  it("should upsert agent steps by index", () => {
    useChatStreamStore.getState().upsertStep({
      index: 0,
      tool_names: ["read_project_markdown_document"],
      duration_ms: 1200,
      truncated: false,
    });
    expect(useChatStreamStore.getState().streamingSteps).toHaveLength(1);

    useChatStreamStore.getState().upsertStep({
      index: 0,
      tool_names: ["read_project_markdown_document", "write_project_office_document"],
      duration_ms: 2400,
      truncated: false,
    });
    const steps = useChatStreamStore.getState().streamingSteps;
    expect(steps).toHaveLength(1);
    expect(steps[0].tool_names).toHaveLength(2);
    expect(steps[0].duration_ms).toBe(2400);

    useChatStreamStore.getState().upsertStep({
      index: 1,
      tool_names: ["summarize"],
      duration_ms: 600,
      truncated: false,
    });
    expect(useChatStreamStore.getState().streamingSteps).toHaveLength(2);
  });

  it("should set streaming steps", () => {
    const steps = [
      { index: 0, tool_names: ["a"], duration_ms: 100, truncated: false },
      { index: 1, tool_names: ["b"], duration_ms: 200, truncated: true },
    ];
    useChatStreamStore.getState().setStreamingSteps(steps);
    expect(useChatStreamStore.getState().streamingSteps).toHaveLength(2);
    expect(useChatStreamStore.getState().streamingSteps[1].truncated).toBe(true);
  });

  it("should reset agent steps along with other state", () => {
    useChatStreamStore.getState().upsertStep({
      index: 0,
      tool_names: ["t"],
      duration_ms: 10,
      truncated: false,
    });
    useChatStreamStore.getState().reset();
    expect(useChatStreamStore.getState().streamingSteps).toEqual([]);
  });

  it("should reset to initial state", () => {
    useChatStreamStore.getState().appendText("some content");
    useChatStreamStore.getState().upsertToolCall({
      tool_name: "t",
      status: "running",
    });
    useChatStreamStore.getState().setTruncated(true);
    useChatStreamStore.getState().reset();

    const state = useChatStreamStore.getState();
    expect(state.streamingContent).toBe("");
    expect(state.streamingToolCalls).toEqual([]);
    expect(state.streamingTruncated).toBe(false);
  });
});
