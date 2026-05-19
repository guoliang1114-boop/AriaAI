"""Chat streaming service — compatibility shim.

This module re-exports the public API from ``app.services.chat`` (and its
sub-modules) so that existing imports continue to work without modification.

New code should import directly from the focused sub-modules:

.. code-block:: python

    from app.services.chat import prepare_chat_runtime, stream_chat_events
    from app.services.chat_tools import ChatRuntime
    from app.services.chat_artifacts import _extract_artifact
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Public API — new canonical location
# ---------------------------------------------------------------------------
from app.services.chat import prepare_chat_runtime, stream_chat_events
from app.services.chat.state import ChatSessionState

# ---------------------------------------------------------------------------
# Re-export runtime helpers (moved to chat.runtime)
# ---------------------------------------------------------------------------
from app.services.chat.runtime import (
    _cap_max_tokens_for_model,
    _has_deepseek_api_key,
    _is_standalone_fast_path,
    _resolve_runtime_model_and_tokens,
    _should_apply_skill,
)

# ---------------------------------------------------------------------------
# Re-export SSE helpers (moved to chat.sse)
# ---------------------------------------------------------------------------
from app.services.chat.sse import (
    _await_with_heartbeat,
    _iter_with_heartbeat,
    _task_stream_flush_pause,
    sse_event as _sse_event,
)

# ---------------------------------------------------------------------------
# Re-export truncation helpers (moved to chat.truncation)
# ---------------------------------------------------------------------------
from app.services.chat.truncation import (
    OUTPUT_TRUNCATED_MARKER,
    strip_truncation_marker as _strip_truncation_marker,
)

# ---------------------------------------------------------------------------
# Re-export tool-repair helpers (moved to chat.tool_repair)
# ---------------------------------------------------------------------------
from app.services.chat.tool_repair import (
    _default_xlsx_sheets_for_request,
    _extract_tool_use_json_blocks,
    _infer_office_file_type,
    _slugify_deliverable_name,
    _try_extract_tool_use_json,
    extract_tool_use_json_blocks,
    repair_project_office_tool_input as _repair_project_office_tool_input,
)

# ---------------------------------------------------------------------------
# Re-export workflow helpers (moved to chat.workflow)
# ---------------------------------------------------------------------------
from app.services.chat.workflow import (
    _task_event_detail,
    _task_event_payload_summary,
    _task_event_time,
    _task_payload_tool_calls,
    _task_step_output_details,
    _workflow_plan_events,
    _workflow_status,
    _workflow_status_from_task_event,
)

# ---------------------------------------------------------------------------
# Re-export chat_tools helpers (unchanged home module)
# ---------------------------------------------------------------------------
from app.services.chat_tools import (
    ChatRuntime,
    _build_completed_skill_progress,
    _summarize_tool_result,
    _to_user_friendly_error,
    _tool_progress_payload,
    _tool_start_progress_payload,
)

# ---------------------------------------------------------------------------
# Re-export chat_artifacts helpers (unchanged home module)
# ---------------------------------------------------------------------------
from app.services.chat_artifacts import (
    _build_artifact_notice,
    _build_slides_from_strategy_text,
    _clean_slide_line,
    _extract_artifact,
    _has_ppt_artifact,
    _is_digital_strategy_runtime,
    _looks_like_digital_strategy_tool_input,
    _repair_digital_strategy_ppt_tool_input,
    _route_ppt_tool_for_skill,
    _should_auto_generate_digital_strategy_ppt,
)

__all__ = [
    "prepare_chat_runtime",
    "stream_chat_events",
    "ChatSessionState",
]
