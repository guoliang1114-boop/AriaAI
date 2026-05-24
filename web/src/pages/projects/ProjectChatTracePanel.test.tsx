import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectChatTracePanel } from "./ProjectChatTracePanel";
import type { ChatTrace } from "../../types/api";

const trace: ChatTrace = {
  trace_id: "trace-one",
  conversation_id: 12,
  message_id: 34,
  chat_mode: "project_deep_dive",
  action_policy: "read_only_tool",
  intent_method: "policy_guard",
  intent_reason: "project risk analysis",
  model_used: "glm-5.1",
  stage_timings: { total_stream_ms: 42 },
  prompt_layers: [{ name: "system", chars: 120 }],
  tool_decisions: [
    {
      tool_name: "update_project_markdown_document",
      status: "error",
      error: "policy_blocked: need=write_artifact got=read_only_tool",
    },
  ],
  artifacts: [{ name: "风险清单.md", file_type: "md", path: "projects/27/风险清单.md" }],
  fallback_events: [
    {
      type: "tool_input_repaired",
      stage: "p2",
      tool_name: "read_project_markdown_document",
      changes: ["补齐 Markdown 读取动作：list"],
    },
  ],
};

describe("ProjectChatTracePanel", () => {
  it("summarizes routing policy and expands execution details", async () => {
    const user = userEvent.setup();
    render(<ProjectChatTracePanel trace={trace} isZh />);

    expect(screen.getByText("项目深问答")).toBeInTheDocument();
    expect(screen.getByText("只读工具")).toBeInTheDocument();
    expect(screen.getByText("glm-5.1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /执行依据/ }));

    expect(screen.getByText("路由原因")).toBeInTheDocument();
    expect(screen.getByText(/project risk analysis/)).toBeInTheDocument();
    expect(screen.getByText("已阻止的工具调用")).toBeInTheDocument();
    expect(screen.getByText(/policy_blocked/)).toBeInTheDocument();
    expect(screen.getByText("系统保护记录")).toBeInTheDocument();
    expect(screen.getByText(/tool_input_repaired/)).toBeInTheDocument();
    expect(screen.getByText("风险清单.md")).toBeInTheDocument();
  });
});
