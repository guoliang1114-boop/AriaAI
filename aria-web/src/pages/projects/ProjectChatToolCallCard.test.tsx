import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

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
});
