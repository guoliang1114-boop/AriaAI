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

from app.services.chat import runtime as _chat_runtime_module
from app.tools import registry

# ---------------------------------------------------------------------------
# Public API — new canonical location
# ---------------------------------------------------------------------------
from app.services.chat import prepare_chat_runtime as _prepare_chat_runtime
from app.services.chat import prepare_chat_runtime_async as _prepare_chat_runtime_async
from app.services.chat import stream_chat_events
from app.services.chat.state import ChatSessionState

# ---------------------------------------------------------------------------
# Re-export runtime helpers (moved to chat.runtime)
# ---------------------------------------------------------------------------
from app.services.chat.runtime import (
    CHAT_HISTORY_WINDOW,
    CLIENT_PORTFOLIO_FAST_MODEL,
    CLIENT_PORTFOLIO_MAX_TOKENS,
    STANDALONE_CHAT_MAX_TOKENS,
    STANDALONE_FAST_PATH_MAX_TOKENS,
    STANDALONE_FAST_PATH_MODEL,
    WORKSPACE_INVENTORY_MAX_TOKENS,
    _cap_max_tokens_for_model,
    _load_provider_module,
    build_chat_context,
    decide_skill_activation,
    get_selected_model,
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
    _user_requested_project_markdown_write,
)

# ---------------------------------------------------------------------------
# Re-export chat_artifacts helpers (unchanged home module)
# ---------------------------------------------------------------------------
from app.services.chat_artifacts import (
    _build_artifact_notice,
    _build_slides_from_strategy_text,
    _clean_slide_line,
    _extract_artifact,
    _is_digital_strategy_runtime,
    _looks_like_digital_strategy_tool_input,
    _repair_digital_strategy_ppt_tool_input,
    _route_ppt_tool_for_skill,
)


def prepare_chat_runtime(session, req, **kwargs):
    """Compatibility wrapper for the legacy ``chat_streaming`` module.

    Some older tests and integrations patch provider/context helpers on this
    shim. The focused implementation lives in ``chat.runtime``, so this wrapper
    forwards the shim-level patched helpers for the duration of one call.
    """

    original_build_context = _chat_runtime_module.build_chat_context
    original_load_provider = _chat_runtime_module._load_provider_module
    original_get_model = _chat_runtime_module.get_selected_model
    try:
        _chat_runtime_module.build_chat_context = build_chat_context
        _chat_runtime_module._load_provider_module = _load_provider_module
        _chat_runtime_module.get_selected_model = get_selected_model
        return _prepare_chat_runtime(session, req, **kwargs)
    finally:
        _chat_runtime_module.build_chat_context = original_build_context
        _chat_runtime_module._load_provider_module = original_load_provider
        _chat_runtime_module.get_selected_model = original_get_model


async def prepare_chat_runtime_async(session, req, **kwargs):
    """Async compatibility wrapper that performs full pre-routing before prepare."""

    original_build_context = _chat_runtime_module.build_chat_context
    original_load_provider = _chat_runtime_module._load_provider_module
    original_get_model = _chat_runtime_module.get_selected_model
    try:
        _chat_runtime_module.build_chat_context = build_chat_context
        _chat_runtime_module._load_provider_module = _load_provider_module
        _chat_runtime_module.get_selected_model = get_selected_model
        return await _prepare_chat_runtime_async(session, req, **kwargs)
    finally:
        _chat_runtime_module.build_chat_context = original_build_context
        _chat_runtime_module._load_provider_module = original_load_provider
        _chat_runtime_module.get_selected_model = original_get_model


__all__ = [
    "prepare_chat_runtime",
    "prepare_chat_runtime_async",
    "stream_chat_events",
    "ChatSessionState",
]
