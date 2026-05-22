import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectChatActionPreviewPanel } from "./ProjectChatActionPreviewPanel";

describe("ProjectChatActionPreviewPanel", () => {
  it("previews destructive actions and replays the exact confirmation token", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ProjectChatActionPreviewPanel
        isZh
        action={{
          sourceContent: "清理空间垃圾文件",
          call: {
            tool_name: "manage_project_files",
            status: "confirmation_required",
            summary: "需要用户确认后才能执行修改或危险操作。",
            confirmation_token: "tool:manage_project_files:delete:abc123",
            details: ["待删除文件 ID：12, 13", "删除原因：疑似重复生成物"],
          },
        }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Action Preview：等待确认")).toBeInTheDocument();
    expect(screen.getByText("删除项目文件 · 影响 2 项")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认并执行" }));

    expect(onConfirm).toHaveBeenCalledWith("清理空间垃圾文件", "tool:manage_project_files:delete:abc123");
  });
});
