import type { Message, MessageMetadata, PendingToolAction, ToolCallEvent } from "../../types/api";
import type { ProjectChatPendingAction } from "./ProjectChatActionPreviewPanel";

export type PendingToolActionBatch = {
  key: string;
  batchId?: string;
  primaryActionId: number;
  title: string;
  description: string;
  details: string[];
  actions: PendingToolAction[];
};

export function pendingActionBadge(action: PendingToolAction, isZh: boolean) {
  const type = (action.action_type || "").toLowerCase();
  if (type.includes("delete")) return isZh ? "删除需确认" : "Delete approval";
  if (type.includes("modify")) return isZh ? "修改需确认" : "Modify approval";
  if (type.includes("write")) return isZh ? "写入需确认" : "Write approval";
  return isZh ? "高风险操作" : "High-risk action";
}

function pendingActionBatchKey(action: PendingToolAction) {
  if (action.approval_batch_id) return `batch:${action.approval_batch_id}`;
  if (action.tool_input_hash) return `legacy:${action.tool_name}:${action.action_type}:${action.tool_input_hash}`;
  return `action:${action.id}`;
}

export function groupPendingToolActions(actions: PendingToolAction[], isZh: boolean): PendingToolActionBatch[] {
  const grouped = new Map<string, PendingToolAction[]>();
  for (const action of actions) {
    const key = pendingActionBatchKey(action);
    grouped.set(key, [...(grouped.get(key) || []), action]);
  }
  return Array.from(grouped.entries()).map(([key, batchActions]) => {
    const ordered = [...batchActions].sort(
      (a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0) || a.id - b.id,
    );
    const first = ordered[0];
    const details = Array.from(new Set(ordered.flatMap((action) => action.details || [])));
    const title =
      ordered.length > 1
        ? isZh
          ? `${first.title || "待确认操作"}（${ordered.length} 个步骤）`
          : `${first.title || "Pending action"} (${ordered.length} steps)`
        : first.title;
    const description =
      ordered.length > 1
        ? isZh
          ? `这是同一个确认流程中的 ${ordered.length} 个确定性工具动作，确认后将按顺序执行。`
          : `This approval flow contains ${ordered.length} deterministic tool actions and will run in sequence.`
        : first.description;
    return {
      key,
      batchId: first.approval_batch_id || undefined,
      primaryActionId: first.id,
      title,
      description,
      details,
      actions: ordered,
    };
  });
}

function confirmationCallFrom(calls: ToolCallEvent[] | undefined) {
  return [...(calls || [])].reverse().find((call) => call.status === "confirmation_required" && call.confirmation_token);
}

function parseMessageMetadata(message: Message): MessageMetadata {
  try {
    return JSON.parse(message.metadata_json || "{}") as MessageMetadata;
  } catch {
    return {};
  }
}

export function findPendingAction({
  messages,
  streamingToolCalls,
}: {
  messages: Message[];
  streamingToolCalls: ToolCallEvent[];
}): ProjectChatPendingAction | null {
  const streamingCall = confirmationCallFrom(streamingToolCalls);
  if (streamingCall) {
    const sourceContent = [...messages].reverse().find((message) => message.role === "user")?.content || "";
    if (sourceContent) return { canConfirm: false, call: streamingCall, sourceContent };
  }

  const resolvedTokens = new Set<string>();
  let hasNewerToolActionResult = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const metadata = parseMessageMetadata(message);
    if (metadata.tool_action_result || metadata.tool_action_batch_result) {
      hasNewerToolActionResult = true;
    }
    (metadata.resolved_action_confirmations || []).forEach((token) => {
      if (token) resolvedTokens.add(token);
    });
    const call = confirmationCallFrom(metadata.tool_calls);
    if (call && hasNewerToolActionResult) continue;
    if (call?.confirmation_token && resolvedTokens.has(call.confirmation_token)) continue;
    const sourceContent = messages
      .slice(0, index)
      .reverse()
      .find((item) => item.role === "user")?.content || "";
    if (call && sourceContent) return { canConfirm: false, call, sourceContent };
  }

  return null;
}
