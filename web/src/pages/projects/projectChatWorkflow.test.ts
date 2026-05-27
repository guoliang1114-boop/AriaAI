import { describe, expect, it } from "vitest";

import { formatTaskEventTime, workflowStepsFromToolCalls } from "./projectChatWorkflow";
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
