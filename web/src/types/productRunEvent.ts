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
  | "turn_receipt"
  | "context_receipt"
  | "steering_applied"
  | "status"
  | "text_delta"
  | "reference_delta"
  | "step_started"
  | "step_completed"
  | "tool_progress"
  | "task_update"
  | "confirmation_required"
  | "artifact_ready"
  | "memory_candidate_ready"
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

export type RunSkillSource = "explicit" | "auto" | "conversation";

export type ToolProgressStatus = "pending" | "running" | "completed" | "failed";

export type StepCompletedStatus = "completed" | "failed";

export type ArtifactType = "pptx" | "docx" | "xlsx" | "pdf" | "markdown";

export type RunFinalStatus = "completed" | "waiting_confirmation" | "failed" | "cancelled";

export type RunErrorCode =
  | "TOOL_EXECUTION_FAILED"
  | "MODEL_TIMEOUT"
  | "PERSISTENCE_ERROR"
  | "POLICY_REJECTED"
  | "CONTEXT_PREPARATION_FAILED"
  | "TURN_BUDGET_EXCEEDED"
  | "RUN_EVALUATION_FAILED"
  | "UNKNOWN"
  | string; // tolerate forward-compatible codes

export interface RunStartedEvent {
  type: "run_started";
  run_id: string;
  timestamp: string;
  display_mode?: RunDisplayMode;
  skill?: { name: string; id?: string; source?: RunSkillSource };
}

export interface TurnReceiptEvent {
  type: "turn_receipt";
  run_id: string;
  summary: string;
  user_constraints: string[];
  mode: "answer_only" | "plan_only" | "execute_now" | "plan_then_execute";
  target_scope: "chat" | "project" | "workspace";
  execution_scope:
    | "chat_only"
    | "injected_project_context"
    | "read_tools"
    | "project_write"
    | "workspace_write";
  expected_response: string;
  write_allowed: boolean;
  requires_confirmation: boolean;
  steering_supported: boolean;
}

export type ContextReceiptScope = "chat" | "project" | "client_portfolio" | "workspace";
export type ContextMemoryStatus = "not_applicable" | "missing" | "stale" | "ready";
export type ContextMemoryLayerScope = "user" | "client" | "project";
export type ContextMemoryOverrideDimension = "language" | "tone" | "format" | "verbosity";
export type ContextSkillStatus = "applied" | "ambiguous" | "not_used";
export type ContextSkillUsageMode = "none" | "advisory" | "workflow";
export type ContextWarningCode =
  | "project_memory_missing"
  | "project_memory_stale"
  | "client_memory_stale"
  | "user_preference_overridden"
  | "memory_retrieval_truncated"
  | "skill_match_ambiguous"
  | "context_compacted"
  | "project_world_state_changed"
  | "project_world_state_truncated";

export interface ContextMemoryLayer {
  scope: ContextMemoryLayerScope;
  status: ContextMemoryStatus;
  version: number;
  retrieval_mode: "none" | "overview" | "focused" | "full";
  query_facets: string[];
  selected_slots: string[];
  /** Optional for persisted v1 receipts created before slot-level freshness shipped. */
  stale_slots?: string[];
  selected_slot_count: number;
  stale_slot_count?: number;
  available_slot_count: number;
  omitted_slot_count: number;
  selected_item_count: number;
  evidence_ref_count?: number;
  truncated: boolean;
  overridden_dimensions: ContextMemoryOverrideDimension[];
}

export interface ContextReceiptEvent {
  type: "context_receipt";
  schema_version: 1;
  run_id: string;
  scope: ContextReceiptScope;
  project?: { id: string; name: string };
  memory: {
    status: ContextMemoryStatus;
    version: number;
    raw_context_available: boolean;
    retrieval_mode: "none" | "overview" | "focused" | "full";
    query_facets: string[];
    selected_slots: string[];
    stale_slots?: string[];
    selected_slot_count: number;
    stale_slot_count?: number;
    available_slot_count: number;
    omitted_slot_count: number;
    selected_item_count: number;
    evidence_ref_count?: number;
    truncated: boolean;
    /** Optional for persisted v1 receipts created before layered routing shipped. */
    layers?: ContextMemoryLayer[];
  };
  skill: {
    status: ContextSkillStatus;
    usage_mode: ContextSkillUsageMode;
    id?: string;
    name?: string;
    source?: string;
    reason: string;
    confidence: number;
    candidates?: Array<{ id?: string; name: string; score: number }>;
  };
  evidence: {
    workspace_context: boolean;
    attached_file_count: number;
    knowledge_reference_count: number;
    history_message_count: number;
    conversation_capsule: boolean;
    user_preferences: boolean;
    compacted: boolean;
  };
  world_state?: {
    current_version: string;
    previous_version: string | null;
    baseline: boolean;
    changed: boolean;
    changed_categories: Array<
      | "project"
      | "milestones"
      | "todos"
      | "files"
      | "progress"
      | "financials"
      | "stakeholders"
      | "deliverables"
    >;
    categories: Record<string, {
      added: number;
      removed: number;
      updated: number;
      current_count: number;
    }>;
    truncated: boolean;
  };
  warnings: ContextWarningCode[];
}

export interface SteeringAppliedEvent {
  type: "steering_applied";
  run_id: string;
  steering_id: string;
  sequence: number;
  content_preview: string;
  message_id?: number;
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
  source_tool?: string;
  output_id?: string;
  content_sha256?: string;
}

export interface MemoryCandidateReadyEvent {
  type: "memory_candidate_ready";
  run_id: string;
  candidate_id: string;
  scope: "user" | "project" | "client";
  candidate_type: string;
  status: "pending_review";
  content_sha256?: string;
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
  | TurnReceiptEvent
  | ContextReceiptEvent
  | SteeringAppliedEvent
  | StatusEvent
  | TextDeltaEvent
  | ReferenceDeltaEvent
  | StepStartedEvent
  | StepCompletedEvent
  | ToolProgressEvent
  | TaskUpdateEvent
  | ConfirmationRequiredEvent
  | ArtifactReadyEvent
  | MemoryCandidateReadyEvent
  | MessagePersistedEvent
  | RunDoneEvent
  | RunFailedEvent;

/** Type guard for the union — handy at the SSE consumer boundary. */
export function isProductRunEvent(value: unknown): value is ProductRunEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  const runId = (value as { run_id?: unknown }).run_id;
  return (
    typeof type === "string" &&
    typeof runId === "string" &&
    Boolean(runId.trim()) &&
    PRODUCT_RUN_EVENT_TYPES.has(type as ProductRunEventType)
  );
}

const PRODUCT_RUN_EVENT_TYPES = new Set<string>([
  "run_started",
  "turn_receipt",
  "context_receipt",
  "steering_applied",
  "status",
  "text_delta",
  "reference_delta",
  "step_started",
  "step_completed",
  "tool_progress",
  "task_update",
  "confirmation_required",
  "artifact_ready",
  "memory_candidate_ready",
  "message_persisted",
  "run_done",
  "run_failed",
]);
