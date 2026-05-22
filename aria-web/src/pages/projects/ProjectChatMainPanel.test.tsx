import { describe, expect, it } from "vitest";

import type { Message } from "../../types/api";
import { findPendingAction } from "./ProjectChatMainPanel";

function message(
  role: "user" | "assistant",
  content: string,
  metadata?: Record<string, unknown>,
  id = Math.floor(Math.random() * 100000),
): Message {
  return {
    id,
    conversation_id: 1,
    role,
    content,
    metadata_json: metadata ? JSON.stringify(metadata) : undefined,
    created_at: new Date(0).toISOString(),
  };
}

describe("findPendingAction", () => {
  it("keeps the latest unresolved approval visible after a follow-up assistant reply", () => {
    const token = "tool:manage_project_files:delete:abc123";
    const action = findPendingAction({
      streamingToolCalls: [],
      messages: [
        message("user", "现在空间里面有特别多的垃圾文件，清除", undefined, 1),
        message(
          "assistant",
          "确认执行吗？",
          {
            tool_calls: [
              {
                tool_name: "manage_project_files",
                status: "confirmation_required",
                confirmation_token: token,
              },
            ],
            pending_tool_confirmations: [
              {
                confirmation_token: token,
                tool_name: "manage_project_files",
                tool_input: { action: "delete", file_ids: [130, 131] },
              },
            ],
          },
          2,
        ),
        message("user", "执行", undefined, 3),
        message("assistant", "抱歉，我只有读取权限。", undefined, 4),
      ],
    });

    expect(action?.call.confirmation_token).toBe(token);
    expect(action?.canConfirm).toBe(true);
    expect(action?.sourceContent).toBe("现在空间里面有特别多的垃圾文件，清除");
  });

  it("does not resurface an approval after its token has been consumed", () => {
    const token = "tool:manage_project_files:delete:abc123";
    const action = findPendingAction({
      streamingToolCalls: [],
      messages: [
        message("user", "现在空间里面有特别多的垃圾文件，清除", undefined, 1),
        message(
          "assistant",
          "确认执行吗？",
          {
            tool_calls: [
              {
                tool_name: "manage_project_files",
                status: "confirmation_required",
                confirmation_token: token,
              },
            ],
            pending_tool_confirmations: [
              {
                confirmation_token: token,
                tool_name: "manage_project_files",
                tool_input: { action: "delete", file_ids: [130, 131] },
              },
            ],
          },
          2,
        ),
        message("user", "确认并执行", undefined, 3),
        message(
          "assistant",
          "操作已完成。",
          {
            resolved_action_confirmations: [token],
            tool_calls: [{ tool_name: "manage_project_files", status: "completed" }],
          },
          4,
        ),
      ],
    });

    expect(action).toBeNull();
  });
});
