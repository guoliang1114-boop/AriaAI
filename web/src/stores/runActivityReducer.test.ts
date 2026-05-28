import { describe, expect, it } from "vitest";
import type { ProductRunEvent } from "../types/productRunEvent";
import {
  emptyTimeline,
  reduceRunActivity,
  type RunActivityTimeline,
} from "./runActivityReducer";

function fold(events: ProductRunEvent[]): RunActivityTimeline {
  let t: RunActivityTimeline | null = null;
  for (const e of events) {
    t = reduceRunActivity(t, e);
  }
  return t ?? emptyTimeline();
}

describe("reduceRunActivity", () => {
  it("opens a timeline on run_started with skill + display_mode", () => {
    const t = fold([
      {
        type: "run_started",
        run_id: "run_a",
        timestamp: "2026-05-28T00:00:00.000Z",
        display_mode: "skill",
        skill: { name: "数字化战略", id: "digital-strategy" },
      },
    ]);
    expect(t.run_id).toBe("run_a");
    expect(t.display_mode).toBe("skill");
    expect(t.skill).toEqual({ name: "数字化战略", id: "digital-strategy" });
    expect(t.steps).toEqual([]);
    expect(t.text).toBe("");
  });

  it("appends text_delta chunks into a single text string", () => {
    const t = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      { type: "text_delta", run_id: "r", content: "Hello " },
      { type: "text_delta", run_id: "r", content: "world!" },
    ]);
    expect(t.text).toBe("Hello world!");
  });

  it("builds steps and groups tool_progress under the right step", () => {
    const t = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      { type: "step_started", run_id: "r", step_index: 1, title: "读取" },
      {
        type: "tool_progress",
        run_id: "r",
        step_index: 1,
        title: "读取项目文件",
        status: "running",
      },
      {
        type: "tool_progress",
        run_id: "r",
        step_index: 1,
        title: "读取项目文件",
        status: "completed",
      },
      {
        type: "step_completed",
        run_id: "r",
        step_index: 1,
        status: "completed",
        duration_ms: 230,
      },
      { type: "step_started", run_id: "r", step_index: 2, title: "整理" },
      {
        type: "step_completed",
        run_id: "r",
        step_index: 2,
        status: "completed",
        duration_ms: 50,
      },
    ]);
    expect(t.steps).toHaveLength(2);
    expect(t.steps[0].title).toBe("读取");
    expect(t.steps[0].status).toBe("completed");
    expect(t.steps[0].duration_ms).toBe(230);
    expect(t.steps[0].items).toEqual([
      { tool_name: "读取项目文件", status: "completed" },
    ]);
    expect(t.steps[1].index).toBe(2);
  });

  it("captures confirmation_required + artifact_ready + final_status", () => {
    const t = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      {
        type: "confirmation_required",
        run_id: "r",
        action: "删除文件",
        impact: "不可恢复",
        params_snapshot: { id: 1 },
      },
      {
        type: "artifact_ready",
        run_id: "r",
        artifact_id: "57",
        artifact_type: "pptx",
        download_url: "/files/57",
      },
      { type: "message_persisted", run_id: "r", message_id: 100 },
      { type: "run_done", run_id: "r", final_status: "completed" },
    ]);
    expect(t.confirmation).toEqual({
      action: "删除文件",
      impact: "不可恢复",
      params_snapshot: { id: 1 },
      deadline: undefined,
    });
    expect(t.artifacts).toHaveLength(1);
    expect(t.artifacts[0]).toMatchObject({ id: "57", type: "pptx", download_url: "/files/57" });
    expect(t.message_id).toBe(100);
    expect(t.final_status).toBe("completed");
  });

  it("captures task_update progress", () => {
    const t = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      {
        type: "task_update",
        run_id: "r",
        task_id: "42",
        status: "running",
        total_steps: 4,
        current_step: 2,
        progress_pct: 25,
        step_title: "生成大纲",
      },
    ]);
    expect(t.task).toEqual({
      task_id: "42",
      status: "running",
      total_steps: 4,
      current_step: 2,
      progress_pct: 25,
      step_title: "生成大纲",
    });
  });

  it("run_failed sets final_status=failed and error payload", () => {
    const t = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      {
        type: "run_failed",
        run_id: "r",
        error_code: "MODEL_TIMEOUT",
        error_message: "AI 超时，请重试",
        retryable: true,
      },
    ]);
    expect(t.final_status).toBe("failed");
    expect(t.error).toEqual({
      code: "MODEL_TIMEOUT",
      message: "AI 超时，请重试",
      retryable: true,
    });
  });

  it("drops events whose run_id does not match the open timeline", () => {
    const t = fold([
      { type: "run_started", run_id: "r1", timestamp: "" },
      { type: "text_delta", run_id: "r2", content: "stale" },
      { type: "text_delta", run_id: "r1", content: "ok" },
    ]);
    expect(t.text).toBe("ok");
  });

  it("captures live status and clears it on run_done", () => {
    const before = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      { type: "status", run_id: "r", message: "正在生成回复..." },
    ]);
    expect(before.status).toEqual({ message: "正在生成回复...", progress: undefined });

    const after = reduceRunActivity(before, {
      type: "run_done",
      run_id: "r",
      final_status: "completed",
    });
    expect(after.status).toBeUndefined();
    expect(after.final_status).toBe("completed");
  });

  it("run_failed clears live status alongside setting the error", () => {
    const t = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      { type: "status", run_id: "r", message: "拉取上下文..." },
      {
        type: "run_failed",
        run_id: "r",
        error_code: "MODEL_TIMEOUT",
        error_message: "AI 超时",
      },
    ]);
    expect(t.status).toBeUndefined();
    expect(t.error?.code).toBe("MODEL_TIMEOUT");
  });

  it("ignores non-start events when no timeline is open", () => {
    const t = reduceRunActivity(null, {
      type: "text_delta",
      run_id: "r",
      content: "x",
    });
    expect(t.text).toBe("");
    expect(t.run_id).toBe("");
  });
});
