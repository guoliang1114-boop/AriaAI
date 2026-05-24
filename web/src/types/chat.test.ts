import { describe, it, expect } from "vitest";
import {
  isStreamTextEvent,
  isStreamStatusEvent,
  isStreamDoneEvent,
  isStreamErrorEvent,
  isStreamTruncatedEvent,
  isStreamToolResultEvent,
  isStreamTaskRunEvent,
  isStreamTimingEvent,
} from "./chat";

describe("StreamEvent type guards", () => {
  it("isStreamTextEvent identifies text events", () => {
    expect(isStreamTextEvent({ type: "text", content: "hello" })).toBe(true);
    expect(isStreamTextEvent({ type: "status", stage: "x", message: "y" })).toBe(false);
  });

  it("isStreamStatusEvent identifies status events", () => {
    expect(isStreamStatusEvent({ type: "status", stage: "thinking", message: "wait" })).toBe(true);
    expect(isStreamStatusEvent({ type: "text", content: "x" })).toBe(false);
  });

  it("isStreamDoneEvent identifies done events", () => {
    expect(isStreamDoneEvent({ type: "done" })).toBe(true);
    expect(isStreamDoneEvent({ type: "error", message: "x" })).toBe(false);
  });

  it("isStreamErrorEvent identifies error events", () => {
    expect(isStreamErrorEvent({ type: "error", message: "fail" })).toBe(true);
    expect(isStreamErrorEvent({ type: "done" })).toBe(false);
  });

  it("isStreamTruncatedEvent identifies truncated events", () => {
    expect(isStreamTruncatedEvent({ type: "truncated", can_continue: true })).toBe(true);
    expect(isStreamTruncatedEvent({ type: "text", content: "x" })).toBe(false);
  });

  it("isStreamToolResultEvent identifies tool result events", () => {
    expect(isStreamToolResultEvent({ type: "tool_result", result: {} })).toBe(true);
    expect(isStreamToolResultEvent({ type: "status", stage: "x", message: "y" })).toBe(false);
  });

  it("isStreamTaskRunEvent identifies task run events", () => {
    expect(isStreamTaskRunEvent({ type: "task_run", task: { id: 1, task_type: "x", goal: "y" } })).toBe(true);
    expect(isStreamTaskRunEvent({ type: "text", content: "x" })).toBe(false);
  });

  it("isStreamTimingEvent identifies timing events", () => {
    expect(isStreamTimingEvent({ type: "timing", key: "planning_ms", duration_ms: 100 })).toBe(true);
    expect(isStreamTimingEvent({ type: "text", content: "x" })).toBe(false);
  });
});
