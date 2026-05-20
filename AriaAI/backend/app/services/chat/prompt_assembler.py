"""Prompt-as-data assembler for chat providers.

Providers should not own chat behavior. They only transport messages to a model.
This assembler is the single place that selects prompt templates and appends
runtime context layers.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from app.services.chat.mode_registry import MODE_CONFIG, ChatMode

PROMPT_ROOT = Path(__file__).resolve().parents[2] / "prompts"

# Modes that intentionally skip the identity preamble (their templates already
# carry strong, mode-specific role descriptions and we want the model's
# attention on those).
MODES_WITHOUT_IDENTITY_PREAMBLE = {
    ChatMode.CROSS_PROJECT_PORTFOLIO,
    ChatMode.WORKSPACE_INVENTORY,
}


@lru_cache(maxsize=32)
def _read_prompt(relative_path: str) -> str:
    path = PROMPT_ROOT / relative_path
    return path.read_text(encoding="utf-8").strip()


def _mode_template_for_context(project_context: str) -> str:
    """Fallback template selection when chat_mode is not provided.

    Used by callers that have not yet been threaded through the explicit mode
    pipeline (e.g. task_runner, legacy tests). Real chat runtime passes
    chat_mode explicitly via ``resolve_template_path``.
    """
    if project_context.startswith("# Client Project Portfolio Context"):
        return "modes/cross_project_portfolio.md"
    if project_context.startswith("# Workspace Project Inventory Context"):
        return "modes/workspace_inventory.md"
    if project_context.startswith("# 工作台全局数据"):
        return "modes/workspace_global.md"
    if project_context.strip():
        return "modes/project_deep_dive.md"
    return "modes/standalone_qa.md"


def _coerce_chat_mode(value: ChatMode | str | None) -> ChatMode | None:
    if value is None:
        return None
    if isinstance(value, ChatMode):
        return value
    try:
        return ChatMode(value)
    except ValueError:
        return None


def resolve_template_path(
    chat_mode: ChatMode | str | None,
    project_context: str,
) -> str:
    """Resolve which mode template to use.

    Prefers the explicit ``chat_mode`` (single source of truth: the upstream
    intent decision). Falls back to ``project_context`` prefix matching only if
    chat_mode is missing or maps to a mode without a template (e.g.
    ``TASK_ORCHESTRATION``).
    """
    mode = _coerce_chat_mode(chat_mode)
    if mode is not None:
        config = MODE_CONFIG.get(mode)
        if config and config.prompt_template:
            return config.prompt_template
    return _mode_template_for_context(project_context or "")


def _should_skip_identity_preamble(
    chat_mode: ChatMode | str | None,
    template_path: str,
) -> bool:
    mode = _coerce_chat_mode(chat_mode)
    if mode is not None and mode in MODES_WITHOUT_IDENTITY_PREAMBLE:
        return True
    return template_path in {
        "modes/cross_project_portfolio.md",
        "modes/workspace_inventory.md",
    }


def build_system_prompt_from_templates(
    skill_prompt: str = "",
    rag_context: str = "",
    project_context: str = "",
    *,
    chat_mode: ChatMode | str | None = None,
) -> str:
    """Build a system prompt from data files plus runtime context layers.

    ``chat_mode`` is the preferred input — it carries the explicit routing
    decision made upstream. When omitted (legacy callers / tests), we fall
    back to inferring the template from the ``project_context`` prefix.
    """

    template_path = resolve_template_path(chat_mode, project_context or "")
    parts: list[str] = []

    if not _should_skip_identity_preamble(chat_mode, template_path):
        parts.append(_read_prompt("base/identity.md"))
    parts.append(_read_prompt(template_path))

    if skill_prompt:
        parts.append(f"## Skill Context\n{skill_prompt.strip()}")
    if project_context:
        parts.append(f"## Project Context\n{project_context.strip()}")
    if rag_context:
        parts.append(f"## Relevant Knowledge Base Excerpts\n{rag_context.strip()}")

    return "\n\n".join(part for part in parts if part.strip())
