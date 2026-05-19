"""Context builder — compatibility shim.

This module re-exports the public API from ``app.services.context_builder``
so that existing imports continue to work without modification.

New code should import directly from the focused sub-modules:

.. code-block:: python

    from app.services.context_builder import build_chat_context, ChatContext
"""
from __future__ import annotations

# Public API — canonical location
from app.services.context_builder.chat_context import ChatContext, build_chat_context
from app.services.context_builder.query_classifiers import (
    is_client_project_portfolio_query,
    is_workspace_project_inventory_query,
)

# Internal helpers that tests or other modules may reference
from app.services.context_builder.constants import (
    MAX_FILE_CONTENT_CHARS,
    MAX_PROJECT_ARTIFACTS,
    MAX_PROJECT_NOTES_CHARS,
    MAX_PROJECT_TODOS,
    MAX_SINGLE_FILE_CHARS,
    PROJECT_FILE_QUERY_MARKERS,
    PROJECT_MARKDOWN_TOOL_NAMES,
    PROJECT_MARKDOWN_TOOL_PROMPT,
    PROJECT_OFFICE_TOOL_NAMES,
)
from app.services.context_builder.memory_formatters import (
    _format_client_memory_for_prompt,
    _format_project_memory_for_prompt,
    _memory_items_for_portfolio,
)
from app.services.context_builder.project_context import (
    _content_requests_file_details,
    _safe_project_file_path,
    build_project_context,
    extract_file_text,
)
from app.services.context_builder.query_classifiers import (
    _find_client_name_in_query,
    _is_project_review_query,
    _normalize_client_match_text,
)
from app.services.context_builder.rag_context import build_rag_context
from app.services.context_builder.skill_context import (
    SkillContext,
    _filter_skill_tools,
    _merge_project_chat_tools,
    build_skill_context,
)
from app.services.context_builder.workspace_context import (
    build_client_project_portfolio_context,
    build_global_workspace_context,
    build_lightweight_workspace_context,
    build_workspace_project_inventory_context,
)

__all__ = [
    "build_chat_context",
    "ChatContext",
    "is_client_project_portfolio_query",
    "is_workspace_project_inventory_query",
]
