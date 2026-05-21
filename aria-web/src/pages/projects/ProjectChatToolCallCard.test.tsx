import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectChatToolCallCard } from "./ProjectChatToolCallCard";

describe("ProjectChatToolCallCard", () => {
  it("renders blocked and skipped tool statuses without falling back to error copy", () => {
    render(
      <div>
        <ProjectChatToolCallCard
          isZh
          call={{
            tool_name: "update_project_markdown_document",
            status: "blocked",
            message: "工具调用已被本轮 ActionPolicy 阻止。",
          }}
        />
        <ProjectChatToolCallCard
          isZh
          call={{
            tool_name: "read_project_markdown_document",
            status: "skipped",
            message: "本轮无需继续调用工具。",
          }}
        />
      </div>,
    );

    expect(screen.getByText("已拦截")).toBeInTheDocument();
    expect(screen.getByText("已跳过")).toBeInTheDocument();
    expect(screen.queryByText("失败")).not.toBeInTheDocument();
  });

  it("renders confirmation actions for workflow steps", async () => {
    const user = userEvent.setup();
    const onConfirmAction = vi.fn();

    render(
      <ProjectChatToolCallCard
        isZh
        onConfirmAction={onConfirmAction}
        call={{
          tool_name: "步骤 3/4：执行 Skill / 工具",
          status: "confirmation_required",
          message: "等待确认后再执行。",
          confirmation_token: "tool:manage_project_files:delete:abc123",
          step_index: 3,
          step_total: 4,
          step_title: "执行 Skill / 工具",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "确认并执行" }));

    expect(onConfirmAction).toHaveBeenCalledWith("tool:manage_project_files:delete:abc123");
  });
});
