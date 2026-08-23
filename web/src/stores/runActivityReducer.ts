/**
 * Pure reducer that folds a stream of Product Run Event v1 frames into a
 * normalized ``RunActivityTimeline`` — the data shape the
 * ``ProjectChatActivityTimeline`` component renders.
 *
 * Kept as a pure function (no React, no Zustand) so it can be unit-tested
 * without a DOM and reused server-side later if needed.
 */
import type {
  ArtifactType,
  ProductRunEvent,
  RunDisplayMode,
  RunFinalStatus,
  ToolProgressStatus,
} from "../types/productRunEvent";

export type StepStatus = ToolProgressStatus | "completed" | "failed";

export interface ActivityItem {
  tool_name: string;
  status: ToolProgressStatus;
  detail?: string;
}

export interface ActivityStep {
  index: number;
  title: string;
  status: StepStatus;
  duration_ms?: number;
  items: ActivityItem[];
  truncated?: boolean;
}

export interface ActivityArtifact {
  id: string;
  type: ArtifactType;
  download_url?: string;
  preview_url?: string;
  source_tool?: string;
  output_id?: string;
  content_sha256?: string;
}

export interface ActivityMemoryCandidate {
  id: string;
  scope: "user" | "project" | "client";
  candidate_type: string;
  status: "pending_review" | "accepted" | "rejected" | "failed";
  content_sha256?: string;
}

export interface ActivityTaskState {
  task_id: string;
  status: ToolProgressStatus;
  progress_pct?: number;
  current_step?: number;
  total_steps?: number;
  step_title?: string;
}

export interface ActivityConfirmation {
  action: string;
  impact: string;
  params_snapshot?: Record<string, unknown>;
  deadline?: string;
}

export interface ActivityStatus {
  /** Latest user-facing one-liner from a v1 ``status`` event (≤ 50 chars). */
  message: string;
  progress?: number;
}

export interface RunActivityTimeline {
  run_id: string;
  display_mode?: RunDisplayMode;
  skill?: { name: string; id?: string };
  steps: ActivityStep[];
  artifacts: ActivityArtifact[];
  memory_candidates: ActivityMemoryCandidate[];
  task?: ActivityTaskState;
  confirmation?: ActivityConfirmation;
  /** Latest ``status`` event payload. Cleared by ``run_done`` / ``run_failed``. */
  status?: ActivityStatus;
  message_id?: number | string;
  final_status?: RunFinalStatus;
  error?: { code: string; message: string; retryable?: boolean };
  /** Concatenated text deltas — convenient for components that want a single string. */
  text: string;
}

export function emptyTimeline(run_id = ""): RunActivityTimeline {
  return { run_id, steps: [], artifacts: [], memory_candidates: [], text: "" };
}

function upsertStep(steps: ActivityStep[], index: number, patch: Partial<ActivityStep>): ActivityStep[] {
  const next = steps.slice();
  const at = next.findIndex((s) => s.index === index);
  if (at >= 0) {
    next[at] = { ...next[at], ...patch };
  } else {
    next.push({
      index,
      title: patch.title ?? `第 ${index} 步`,
      status: patch.status ?? "running",
      items: patch.items ?? [],
      ...patch,
    } as ActivityStep);
    next.sort((a, b) => a.index - b.index);
  }
  return next;
}

function upsertItem(items: ActivityItem[], tool_name: string, patch: Partial<ActivityItem>): ActivityItem[] {
  const next = items.slice();
  // Match by tool_name; if there are duplicate names within the same step we
  // collapse them, which matches how the agent loop emits one running and one
  // terminal event per tool call.
  const at = next.findIndex((it) => it.tool_name === tool_name);
  if (at >= 0) {
    next[at] = { ...next[at], ...patch };
  } else {
    next.push({ tool_name, status: patch.status ?? "running", ...patch } as ActivityItem);
  }
  return next;
}

function withStepItem(
  steps: ActivityStep[],
  step_index: number,
  tool_name: string,
  patch: Partial<ActivityItem>,
): ActivityStep[] {
  // Ensure the step exists (in case tool_progress arrives before step_started,
  // which shouldn't happen but we stay defensive).
  const ensured = upsertStep(steps, step_index, {});
  return ensured.map((step) =>
    step.index === step_index
      ? { ...step, items: upsertItem(step.items, tool_name, patch) }
      : step,
  );
}

/**
 * Fold a single Product Run Event into the current timeline. Returns a new
 * timeline (or the same one if the event isn't relevant to a timeline that
 * has already been opened for a different run_id).
 */
export function reduceRunActivity(
  current: RunActivityTimeline | null,
  event: ProductRunEvent,
): RunActivityTimeline {
  // run_started opens (or resets) the timeline for this run.
  if (event.type === "run_started") {
    return {
      ...emptyTimeline(event.run_id),
      display_mode: event.display_mode,
      skill: event.skill,
    };
  }

  // If we don't have a timeline yet, refuse to materialise one from a non-start
  // event — the data would be partial. This also handles legacy event noise.
  if (!current) return emptyTimeline();

  // Drop events for a different run_id (race after page nav, stale stream).
  if (event.run_id !== current.run_id) return current;

  switch (event.type) {
    case "text_delta":
      return { ...current, text: current.text + event.content };

    case "step_started":
      return {
        ...current,
        steps: upsertStep(current.steps, event.step_index, {
          title: event.title,
          status: "running",
        }),
      };

    case "step_completed":
      return {
        ...current,
        steps: upsertStep(current.steps, event.step_index, {
          status: event.status,
          duration_ms: event.duration_ms,
          truncated: event.truncated,
        }),
      };

    case "tool_progress":
      return {
        ...current,
        steps: withStepItem(current.steps, event.step_index, event.title, {
          status: event.status,
          detail: event.detail,
        }),
      };

    case "task_update":
      return {
        ...current,
        task: {
          task_id: event.task_id,
          status: event.status,
          progress_pct: event.progress_pct,
          current_step: event.current_step,
          total_steps: event.total_steps,
          step_title: event.step_title,
        },
      };

    case "confirmation_required":
      return {
        ...current,
        confirmation: {
          action: event.action,
          impact: event.impact,
          params_snapshot: event.params_snapshot,
          deadline: event.deadline,
        },
      };

    case "artifact_ready":
      return {
        ...current,
        artifacts: [
          ...current.artifacts.filter(
            (item) =>
              item.id !== event.artifact_id &&
              (!event.output_id || item.output_id !== event.output_id),
          ),
          {
            id: event.artifact_id,
            type: event.artifact_type,
            download_url: event.download_url,
            preview_url: event.preview_url,
            source_tool: event.source_tool,
            output_id: event.output_id,
            content_sha256: event.content_sha256,
          },
        ],
      };

    case "memory_candidate_ready":
      return {
        ...current,
        memory_candidates: [
          ...current.memory_candidates.filter((item) => item.id !== event.candidate_id),
          {
            id: event.candidate_id,
            scope: event.scope,
            candidate_type: event.candidate_type,
            status: event.status,
            content_sha256: event.content_sha256,
          },
        ],
      };

    case "message_persisted":
      return { ...current, message_id: event.message_id };

    case "status":
      return {
        ...current,
        status: { message: event.message, progress: event.progress },
      };

    case "run_done":
      return {
        ...current,
        final_status: event.final_status,
        message_id: event.message_id ?? current.message_id,
        // Once the run is done, the live status is stale and would mislead.
        status: undefined,
      };

    case "run_failed":
      return {
        ...current,
        final_status: "failed",
        status: undefined,
        error: {
          code: event.error_code,
          message: event.error_message,
          retryable: event.retryable,
        },
      };

    // reference_delta intentionally not stored on the timeline yet —
    // it's a follow-up; legacy ``references`` event still drives that UI.
    default:
      return current;
  }
}
