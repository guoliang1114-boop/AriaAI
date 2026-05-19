/** Chat-specific types that extend or refine the base API types. */

import type {
  GeneratedArtifact,
  Reference,
  TaskRun,
  ToolCallEvent,
} from "./api";

// ---------------------------------------------------------------------------
// Discriminated union for SSE stream events
// ---------------------------------------------------------------------------

export interface StreamConversationIdEvent {
  type: "conversation_id";
  id: number;
}

export interface StreamTextEvent {
  type: "text";
  content: string;
}

export interface StreamChunkEvent {
  type: "chunk";
  content: string;
}

export interface StreamStatusEvent {
  type: "status";
  stage: string;
  message: string;
  step_index?: number;
  step_total?: number;
  step_title?: string;
  step_status?: "pending" | "running" | "completed" | "error";
}

export interface StreamReferencesEvent {
  type: "references";
  references: Reference[];
}

export interface StreamToolExecutingEvent {
  type: "tool_executing";
  tool_name: string;
  message?: string;
  total?: number;
  current?: number;
}

export interface StreamToolResultEvent {
  type: "tool_result";
  result: Record<string, unknown>;
}

export interface StreamTaskRunEvent {
  type: "task_run";
  task: TaskRun;
}

export interface StreamTimingEvent {
  type: "timing";
  key: string;
  duration_ms: number;
}

export interface StreamTruncatedEvent {
  type: "truncated";
  can_continue: boolean;
}

export interface StreamDoneEvent {
  type: "done";
  references?: Reference[];
  tool_calls?: ToolCallEvent[];
  artifacts?: GeneratedArtifact[];
  task?: TaskRun;
  task_run?: TaskRun;
  task_run_id?: number;
  task_type?: string;
  stage_timings?: Record<string, number | string>;
  truncated?: boolean;
  project_id?: number;
  skill_id?: number;
  skill_progress?: unknown;
  pending_markdown_saves?: Array<{
    tool_use_id?: string;
    project_id?: number;
    file_id?: number | null;
    file_name?: string | null;
    mode?: "replace" | "append" | "create" | string;
    content?: string;
    summary?: string | null;
    folder_id?: number | null;
    saved?: boolean;
    original_content?: string;
  }>;
}

export interface StreamErrorEvent {
  type: "error";
  message: string;
  error?: string;
}

export type StreamEvent =
  | StreamConversationIdEvent
  | StreamTextEvent
  | StreamChunkEvent
  | StreamStatusEvent
  | StreamReferencesEvent
  | StreamToolExecutingEvent
  | StreamToolResultEvent
  | StreamTaskRunEvent
  | StreamTimingEvent
  | StreamTruncatedEvent
  | StreamDoneEvent
  | StreamErrorEvent;

// ---------------------------------------------------------------------------
// Type guards for discriminated union
// ---------------------------------------------------------------------------

export function isStreamTextEvent(e: StreamEvent): e is StreamTextEvent {
  return e.type === "text";
}

export function isStreamStatusEvent(e: StreamEvent): e is StreamStatusEvent {
  return e.type === "status";
}

export function isStreamDoneEvent(e: StreamEvent): e is StreamDoneEvent {
  return e.type === "done";
}

export function isStreamErrorEvent(e: StreamEvent): e is StreamErrorEvent {
  return e.type === "error";
}

export function isStreamTruncatedEvent(e: StreamEvent): e is StreamTruncatedEvent {
  return e.type === "truncated";
}

export function isStreamToolResultEvent(e: StreamEvent): e is StreamToolResultEvent {
  return e.type === "tool_result";
}

export function isStreamTaskRunEvent(e: StreamEvent): e is StreamTaskRunEvent {
  return e.type === "task_run";
}

export function isStreamTimingEvent(e: StreamEvent): e is StreamTimingEvent {
  return e.type === "timing";
}

// ---------------------------------------------------------------------------
// Chat domain types
// ---------------------------------------------------------------------------

export type KnowledgeScope = "project" | "client" | "global";

export interface StakeholderCandidate {
  name: string;
  role: string;
  influence_type?: string;
  relationship_status?: string;
  note?: string;
}

export interface ChatMention {
  type: "file" | "stakeholder" | "milestone";
  id: number;
  name: string;
  raw: string;
}

export interface MentionContext {
  file_ids?: number[];
  stakeholder_ids?: number[];
  milestone_ids?: number[];
}
