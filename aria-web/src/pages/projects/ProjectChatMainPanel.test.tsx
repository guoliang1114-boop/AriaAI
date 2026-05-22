import { describe, expect, it } from "vitest";

import type { Message, PendingToolAction } from "../../types/api";
import { findPendingAction, groupPendingToolActions } from "./ProjectChatMainPanel";

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

describe("groupPendingToolActions", () => {
  const baseAction: PendingToolAction = {
    id: 1,
    trace_id: "trace",
    conversation_id: 1,
    tool_name: "manage_project_files",
    tool_input: { action: "delete" },
    action_type: "delete_files",
    risk_level: "destructive",
    title: "删除项目文件",
    description: "删除重复文件",
    details: ["待删除文件 ID：12"],
    status: "pending",
    created_at: new Date(0).toISOString(),
  };

  it("groups actions from the same approval batch into one preview unit", () => {
    const batches = groupPendingToolActions(
      [
        { ...baseAction, id: 2, approval_batch_id: "hitas-1", sequence_index: 1, details: ["删除空文件夹"] },
        { ...baseAction, id: 1, approval_batch_id: "hitas-1", sequence_index: 0, details: ["待删除文件 ID：12"] },
      ],
      true,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0].batchId).toBe("hitas-1");
    expect(batches[0].primaryActionId).toBe(1);
    expect(batches[0].actions.map((action) => action.id)).toEqual([1, 2]);
    expect(batches[0].title).toContain("2 个步骤");
  });

  it("deduplicates legacy identical pending actions by tool input hash", () => {
    const batches = groupPendingToolActions(
      [
        { ...baseAction, id: 1, tool_input_hash: "same-hash" },
        { ...baseAction, id: 2, tool_input_hash: "same-hash", details: ["待删除文件 ID：13"] },
      ],
      true,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0].details).toEqual(["待删除文件 ID：12", "待删除文件 ID：13"]);
  });
});
