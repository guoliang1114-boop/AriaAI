import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProjectChatActivityTimeline } from "./ProjectChatActivityTimeline";
import type { RunActivityTimeline } from "../../stores/runActivityReducer";

function makeTimeline(overrides: Partial<RunActivityTimeline> = {}): RunActivityTimeline {
  return {
    run_id: "r1",
    steps: [],
    artifacts: [],
    text: "",
    ...overrides,
  };
}

describe("ProjectChatActivityTimeline", () => {
  it("renders the Skill banner when a skill is active", () => {
    render(
      <ProjectChatActivityTimeline
        timeline={makeTimeline({ skill: { name: "数字化战略", id: "digital-strategy" } })}
      />,
    );
    expect(screen.getByText(/Skill：数字化战略/)).toBeInTheDocument();
  });

  it("renders steps with status badges and groups tool items by tool_name", () => {
    const timeline = makeTimeline({
      steps: [
        {
          index: 1,
          title: "读取上下文",
          status: "completed",
          duration_ms: 230,
          items: [
            { tool_name: "读取项目文件", status: "completed" },
            { tool_name: "读取项目文档", status: "completed" },
          ],
        },
        {
          index: 2,
          title: "生成回复",
          status: "running",
          items: [],
        },
      ],
    });
    render(<ProjectChatActivityTimeline timeline={timeline} />);
    expect(screen.getByText("读取上下文")).toBeInTheDocument();
    expect(screen.getByText("生成回复")).toBeInTheDocument();
    expect(screen.getByText(/230ms/)).toBeInTheDocument();
  });

  it("collapses to a completed summary when final_status is completed", () => {
    const timeline = makeTimeline({
      final_status: "completed",
      steps: [
        { index: 1, title: "a", status: "completed", items: [] },
        { index: 2, title: "b", status: "completed", items: [] },
      ],
      artifacts: [{ id: "57", type: "pptx" }],
    });
    render(<ProjectChatActivityTimeline timeline={timeline} />);
    expect(screen.getByText(/已完成 · 2 步/)).toBeInTheDocument();
    expect(screen.getByText(/1 个交付物/)).toBeInTheDocument();
  });

  it("renders the confirmation card when one is pending", () => {
    render(
      <ProjectChatActivityTimeline
        timeline={makeTimeline({
          confirmation: { action: "删除项目文件", impact: "该操作不可恢复" },
        })}
      />,
    );
    expect(screen.getByText(/需要确认：删除项目文件/)).toBeInTheDocument();
    expect(screen.getByText("该操作不可恢复")).toBeInTheDocument();
  });

  it("renders artifacts with a download link when provided", () => {
    render(
      <ProjectChatActivityTimeline
        timeline={makeTimeline({
          artifacts: [
            { id: "57", type: "pptx", download_url: "/files/57" },
          ],
        })}
      />,
    );
    const link = screen.getByRole("link", { name: "下载" });
    expect(link).toHaveAttribute("href", "/files/57");
  });

  it("renders the live status one-liner while no terminal status is set", () => {
    render(
      <ProjectChatActivityTimeline
        timeline={makeTimeline({ status: { message: "正在读取项目文档..." } })}
      />,
    );
    expect(screen.getByText("正在读取项目文档...")).toBeInTheDocument();
  });

  it("renders an error card when run_failed produced an error", () => {
    render(
      <ProjectChatActivityTimeline
        timeline={makeTimeline({
          final_status: "failed",
          error: { code: "MODEL_TIMEOUT", message: "AI 超时，请稍后重试" },
        })}
      />,
    );
    expect(screen.getByText(/失败：MODEL_TIMEOUT/)).toBeInTheDocument();
    expect(screen.getByText("AI 超时，请稍后重试")).toBeInTheDocument();
  });

  it("renders task progress when task_update has set the state", () => {
    render(
      <ProjectChatActivityTimeline
        timeline={makeTimeline({
          task: {
            task_id: "42",
            status: "running",
            progress_pct: 50,
            current_step: 2,
            total_steps: 4,
            step_title: "生成大纲",
          },
        })}
      />,
    );
    expect(screen.getByText(/任务 #42 · 生成大纲/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect(screen.getByText(/2\/4/)).toBeInTheDocument();
  });
});
