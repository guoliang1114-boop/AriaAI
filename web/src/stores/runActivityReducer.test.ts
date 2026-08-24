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

  it("captures the turn receipt and ordered steering acknowledgements", () => {
    const t = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      {
        type: "turn_receipt",
        run_id: "r",
        summary: "生成十页董事会汇报",
        mode: "execute_now",
        target_scope: "project",
        execution_scope: "project_write",
        expected_response: "pptx_deliverable",
        write_allowed: true,
        requires_confirmation: false,
        steering_supported: true,
      },
      {
        type: "context_receipt",
        run_id: "r",
        scope: "project",
        project: { id: "26", name: "Project" },
        memory: { status: "stale", version: 4, raw_context_available: true },
        skill: {
          status: "applied",
          usage_mode: "advisory",
          id: "7",
          name: "舞弊风险评估",
          source: "auto",
          reason: "auto_skill_advisory_match",
          confidence: 0.9,
        },
        evidence: {
          workspace_context: true,
          attached_file_count: 1,
          knowledge_reference_count: 2,
          history_message_count: 8,
          conversation_capsule: true,
          user_preferences: false,
          compacted: false,
        },
        warnings: ["project_memory_stale"],
      },
      {
        type: "steering_applied",
        run_id: "r",
        steering_id: "steer_2",
        sequence: 2,
        content_preview: "改成中文",
      },
      {
        type: "steering_applied",
        run_id: "r",
        steering_id: "steer_1",
        sequence: 1,
        content_preview: "控制在十页",
        message_id: 91,
      },
    ]);
    expect(t.receipt?.summary).toBe("生成十页董事会汇报");
    expect(t.context_receipt?.memory.status).toBe("stale");
    expect(t.context_receipt?.skill.usage_mode).toBe("advisory");
    expect(t.steering.map((item) => item.sequence)).toEqual([1, 2]);
    expect(t.steering[0].message_id).toBe(91);
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
        source_tool: "generate_ppt_from_skill",
      },
      { type: "message_persisted", run_id: "r", message_id: 100 },
      { type: "run_done", run_id: "r", final_status: "waiting_confirmation" },
    ]);
    expect(t.confirmation).toEqual({
      action: "删除文件",
      impact: "不可恢复",
      params_snapshot: { id: 1 },
      deadline: undefined,
    });
    expect(t.artifacts).toHaveLength(1);
    expect(t.artifacts[0]).toMatchObject({
      id: "57",
      type: "pptx",
      download_url: "/files/57",
      source_tool: "generate_ppt_from_skill",
    });
    expect(t.message_id).toBe(100);
    expect(t.final_status).toBe("waiting_confirmation");
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

  it("captures source-linked memory candidates separately from artifacts", () => {
    const t = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      {
        type: "memory_candidate_ready",
        run_id: "r",
        candidate_id: "18",
        scope: "project",
        candidate_type: "project_risk",
        status: "pending_review",
        content_sha256: "b".repeat(64),
      },
    ]);
    expect(t.memory_candidates).toEqual([
      {
        id: "18",
        scope: "project",
        candidate_type: "project_risk",
        status: "pending_review",
        content_sha256: "b".repeat(64),
      },
    ]);
    expect(t.artifacts).toEqual([]);
  });

  it("upserts repeated artifact lifecycle events instead of duplicating cards", () => {
    const digest = "a".repeat(64);
    const event: ProductRunEvent = {
      type: "artifact_ready",
      run_id: "r",
      artifact_id: "57",
      artifact_type: "pptx",
      output_id: "out_artifact_57",
      content_sha256: digest,
    };
    const t = fold([
      { type: "run_started", run_id: "r", timestamp: "" },
      event,
      event,
    ]);
    expect(t.artifacts).toHaveLength(1);
    expect(t.artifacts[0].output_id).toBe("out_artifact_57");
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
