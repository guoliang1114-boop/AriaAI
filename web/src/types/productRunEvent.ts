/**
 * Product Run Event v1 — protocol shared with the backend module
 * `backend/app/services/chat/product_run_events.py` and documented in
 * `docs/11-Model-Harness产品方案设计.md §8`.
 *
 * These types describe the SSE frames a v1-aware frontend consumes from the
 * chat stream. They are intentionally narrow (no extra fields) so the contract
 * with the backend builders stays tight.
 */

export type ProductRunEventType =
  | "run_started"
  | "status"
  | "text_delta"
  | "reference_delta"
  | "step_started"
  | "step_completed"
  | "tool_progress"
  | "task_update"
  | "confirmation_required"
  | "artifact_ready"
  | "message_persisted"
  | "run_done"
  | "run_failed";

export type RunDisplayMode =
  | "quiet"
  | "contextual"
  | "task"
  | "skill"
  | "confirmation"
  | "debug";

export type ToolProgressStatus = "pending" | "running" | "completed" | "failed";

export type StepCompletedStatus = "completed" | "failed";

export type ArtifactType = "pptx" | "docx" | "xlsx" | "pdf" | "markdown";

export type RunFinalStatus = "completed" | "failed" | "cancelled";

export type RunErrorCode =
  | "TOOL_EXECUTION_FAILED"
  | "MODEL_TIMEOUT"
  | "PERSISTENCE_ERROR"
  | "POLICY_REJECTED"
  | "CONTEXT_PREPARATION_FAILED"
  | "TURN_BUDGET_EXCEEDED"
  | "UNKNOWN"
  | string; // tolerate forward-compatible codes

export interface RunStartedEvent {
  type: "run_started";
  run_id: string;
  timestamp: string;
  display_mode?: RunDisplayMode;
  skill?: { name: string; id?: string };
}

export interface StatusEvent {
  type: "status";
  run_id: string;
  message: string;
  display_mode?: RunDisplayMode;
  progress?: number;
}

export interface TextDeltaEvent {
  type: "text_delta";
  run_id: string;
  content: string;
}

export interface ReferenceDeltaEvent {
  type: "reference_delta";
  run_id: string;
  source: string;
  url?: string;
  title?: string;
}

export interface StepStartedEvent {
  type: "step_started";
  run_id: string;
  step_index: number;
  title: string;
  step_total?: number;
}

export interface StepCompletedEvent {
  type: "step_completed";
  run_id: string;
  step_index: number;
  status: StepCompletedStatus;
  duration_ms: number;
  truncated?: boolean;
}

export interface ToolProgressEvent {
  type: "tool_progress";
  run_id: string;
  step_index: number;
  title: string;
  status: ToolProgressStatus;
  detail?: string;
  progress?: number;
}

export interface TaskUpdateEvent {
  type: "task_update";
  run_id: string;
  task_id: string;
  status: ToolProgressStatus;
  progress_pct?: number;
  current_step?: number;
  total_steps?: number;
  step_title?: string;
}

export interface ConfirmationRequiredEvent {
  type: "confirmation_required";
  run_id: string;
  action: string;
  impact: string;
  params_snapshot?: Record<string, unknown>;
  deadline?: string;
}

export interface ArtifactReadyEvent {
  type: "artifact_ready";
  run_id: string;
  artifact_id: string;
  artifact_type: ArtifactType;
  download_url?: string;
  preview_url?: string;
}

export interface MessagePersistedEvent {
  type: "message_persisted";
  run_id: string;
  message_id: number | string;
  parent_run_id?: string;
}

export interface RunDoneEvent {
  type: "run_done";
  run_id: string;
  final_status: RunFinalStatus;
  message_id?: number | string;
  artifact_ids?: string[];
}

export interface RunFailedEvent {
  type: "run_failed";
  run_id: string;
  error_code: RunErrorCode;
  error_message: string;
  retryable?: boolean;
  fallback_content?: string;
}

export type ProductRunEvent =
  | RunStartedEvent
  | StatusEvent
  | TextDeltaEvent
  | ReferenceDeltaEvent
  | StepStartedEvent
  | StepCompletedEvent
  | ToolProgressEvent
  | TaskUpdateEvent
  | ConfirmationRequiredEvent
  | ArtifactReadyEvent
  | MessagePersistedEvent
  | RunDoneEvent
  | RunFailedEvent;

/** Type guard for the union — handy at the SSE consumer boundary. */
export function isProductRunEvent(value: unknown): value is ProductRunEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    typeof type === "string" &&
    PRODUCT_RUN_EVENT_TYPES.has(type as ProductRunEventType)
  );
}

const PRODUCT_RUN_EVENT_TYPES = new Set<string>([
  "run_started",
  "status",
  "text_delta",
  "reference_delta",
  "step_started",
  "step_completed",
  "tool_progress",
  "task_update",
  "confirmation_required",
  "artifact_ready",
  "message_persisted",
  "run_done",
  "run_failed",
]);
