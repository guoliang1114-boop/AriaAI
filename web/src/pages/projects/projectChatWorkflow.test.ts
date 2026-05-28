import { describe, expect, it } from "vitest";

import {
  artifactFromResult,
  artifactFromTaskRunArtifact,
  attachToolDetailToActiveStep,
  formatTaskEventTime,
  mergeArtifacts,
  normalizeArtifactFileType,
  upsertWorkflowStep,
  workflowStepsFromTask,
  workflowStepsFromToolCalls,
} from "./projectChatWorkflow";
import type { ToolCallEvent } from "../../types/api";

describe("formatTaskEventTime", () => {
  it("formats backend UTC timestamps with the app timezone", () => {
    localStorage.setItem("aria-timezone", "Asia/Shanghai");

    expect(formatTaskEventTime("2026-05-27T03:51:17")).toBe("11:51:17");
  });
});

describe("workflowStepsFromToolCalls", () => {
  it("restores persisted raw tool logs into readable workflow steps", () => {
    const calls: ToolCallEvent[] = [
      {
        tool_name: "read_project_file",
        status: "completed",
        message: "Executing read_project_file…",
      },
      {
        tool_name: "read_project_markdown_document",
        status: "completed",
        message: "工具 read_project_markdown_document 执行完成。",
        summary: "工具 read_project_markdown_document 执行完成",
      },
      {
        tool_name: "update_project_markdown_document",
        status: "completed",
        message: "已写入项目 Markdown 文件。",
        summary: "Created 项目背景.md",
      },
    ];

    const steps = workflowStepsFromToolCalls(calls);

    // One real step per distinct tool that actually ran — no canned template.
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.step_title)).toEqual([
      "读取项目文件",
      "读取项目文档",
      "写入项目 Markdown 文档",
    ]);
    expect(steps.map((step) => step.step_index)).toEqual([1, 2, 3]);
    expect(steps.every((step) => step.step_total === 3)).toBe(true);
    // Low-value boilerplate is filtered out of the per-tool message.
    expect(steps[0].message).toBe("已完成");
    expect(steps[2].message).toBe("Created 项目背景.md；已写入项目 Markdown 文件。");
    expect(JSON.stringify(steps)).not.toContain("Executing read_project_file");
    expect(JSON.stringify(steps)).not.toContain("理解需求与上下文");
  });

  it("preserves existing workflow steps without wrapping again", () => {
    const calls: ToolCallEvent[] = [
      {
        tool_name: "步骤 1/4：理解需求与上下文",
        status: "completed",
        step_index: 1,
        step_total: 4,
        step_title: "理解需求与上下文",
      },
    ];

    expect(workflowStepsFromToolCalls(calls)).toBe(calls);
  });
});

describe("workflowStepsFromTask", () => {
  it("maps task steps, outputs and events into visible workflow calls", () => {
    const steps = workflowStepsFromTask({
      id: 7,
      task_type: "project_doc",
      goal: "生成项目文档",
      status: "running",
      created_at: "2026-05-27T03:51:17",
      updated_at: "2026-05-27T03:51:17",
      steps: [
        {
          id: 11,
          key: "context",
          title: "读取上下文",
          step_type: "tool",
          sort_order: 1,
          status: "completed",
          output: { project: { name: "蓝图项目", client: "客户A" }, file_name: "brief.md" },
        },
        {
          id: 12,
          key: "write",
          title: "生成文档",
          step_type: "tool",
          sort_order: 2,
          status: "failed",
          error_message: "模型超时",
          output: { sheets: [{ name: "访谈计划" }], slide_count: 8 },
        },
      ],
      events: [
        {
          id: 99,
          task_run_id: 7,
          step_id: 11,
          event_type: "step_completed",
          message: "读取完成",
          payload: { file_name: "客户材料.pdf", retryable: false },
          created_at: "2026-05-27T03:51:17",
        },
      ],
    });

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      status: "completed",
      step_index: 1,
      step_total: 2,
      step_title: "读取上下文",
      message: "该步骤已完成。",
    });
    expect(steps[0].details?.join("；")).toContain("上下文：蓝图项目 / 客户A");
    expect(steps[0].details?.join("；")).toContain("文件：客户材料.pdf");
    expect(steps[1]).toMatchObject({
      status: "error",
      error: "模型超时",
      has_recoverable_task: true,
    });
    expect(steps[1].details?.join("；")).toContain("工作表：访谈计划");
    expect(steps[1].details?.join("；")).toContain("页数：8");
  });
});

describe("project chat workflow artifact helpers", () => {
  it("normalizes markdown artifacts and ignores incomplete records", () => {
    expect(normalizeArtifactFileType(".PDF")).toBe("pdf");
    expect(normalizeArtifactFileType("txt", "项目纪要.md")).toBe("md");
    expect(
      artifactFromTaskRunArtifact({
        id: 5,
        name: "项目纪要.md",
        file_type: "txt",
        path: "projects/7/项目纪要.md",
        metadata: { summary: "会议纪要" },
      }),
    ).toMatchObject({
      id: 5,
      file_type: "md",
      description: "会议纪要",
    });
    expect(artifactFromTaskRunArtifact({ id: 6, name: "", file_type: "pdf", path: "" })).toBeNull();
  });

  it("extracts result artifacts from nested output and de-duplicates by path", () => {
    const artifact = artifactFromResult({
      output: {
        id: 42,
        file_name: "方案.pptx",
        file_type: "pptx",
        file_path: "projects/32/方案.pptx",
        message: "已生成",
      },
    });

    expect(artifact).toMatchObject({
      name: "方案.pptx",
      file_type: "pptx",
      path: "projects/32/方案.pptx",
      project_file_id: 42,
      description: "已生成",
    });
    expect(artifactFromResult({ output: { file_name: "missing-path.pdf", file_type: "pdf" } })).toBeNull();
    expect(mergeArtifacts([artifact!], [artifact!])).toHaveLength(1);
  });
});

describe("project chat workflow mutable list helpers", () => {
  it("upserts workflow steps and preserves existing detail fields when absent", () => {
    const current: ToolCallEvent[] = [
      {
        tool_name: "步骤 1/2：读取",
        status: "running",
        step_index: 1,
        step_total: 2,
        details: ["开始读取"],
      },
    ];

    expect(upsertWorkflowStep(current, { tool_name: "普通工具", status: "running" })).toHaveLength(2);
    const updated = upsertWorkflowStep(current, {
      tool_name: "步骤 1/2：读取",
      status: "completed",
      step_index: 1,
      step_total: 2,
      message: "完成",
    });
    expect(updated[0]).toMatchObject({ status: "completed", message: "完成", details: ["开始读取"] });
  });

  it("attaches tool detail to the active running workflow step only", () => {
    const calls: ToolCallEvent[] = [
      { tool_name: "步骤 1/2：读取", status: "completed", step_index: 1 },
      { tool_name: "步骤 2/2：生成", status: "running", step_index: 2, details: ["开始"] },
    ];

    const updated = attachToolDetailToActiveStep(calls, "调用 read_project_file", "completed", {
      summary: "读取完成",
    });
    expect(updated[1]).toMatchObject({
      status: "completed",
      summary: "读取完成",
      details: ["开始", "调用 read_project_file"],
    });
    expect(attachToolDetailToActiveStep([{ tool_name: "x", status: "running" }], "ignored")).toEqual([
      { tool_name: "x", status: "running" },
    ]);
  });
});
