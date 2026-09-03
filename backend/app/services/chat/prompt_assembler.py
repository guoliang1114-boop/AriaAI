"""Prompt-as-data assembler for chat providers.

Providers should not own chat behavior. They only transport messages to a model.
This assembler is the single place that selects prompt templates and appends
runtime context layers.
"""
from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.services.chat.mode_registry import MODE_CONFIG, ChatMode, mode_config_for

PROMPT_ROOT = Path(__file__).resolve().parents[2] / "prompts"

PROMPT_LAYER_MANIFEST_VERSION = 1
MAX_PROMPT_LAYER_MANIFEST_ITEMS = 32
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_PROMPT_PATH_RE = re.compile(r"^[A-Za-z0-9_./-]{1,160}$")
_CONTENT_LAYER_TEMPLATES = {
    "skill": "layers/skill_context.md",
    "project": "layers/project_context.md",
    "knowledge": "layers/knowledge_context.md",
}


@lru_cache(maxsize=32)
def _read_prompt(relative_path: str) -> str:
    path = PROMPT_ROOT / relative_path
    return path.read_text(encoding="utf-8").strip()


def load_prompt_fragment(relative_path: str) -> str:
    """Load a reviewable static prompt fragment from the prompt package."""

    return _read_prompt(relative_path)


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
    if mode is not None:
        return not mode_config_for(mode).include_identity_preamble
    return template_path in {
        "modes/cross_project_portfolio.md",
        "modes/workspace_inventory.md",
    }


def _render_content_layer(template_path: str, content: str) -> str:
    template = _read_prompt(template_path)
    marker = "{{content}}"
    if template.count(marker) != 1:
        raise ValueError(f"prompt content layer must contain one {marker}: {template_path}")
    return template.replace(marker, content.strip())


def prompt_layer_paths(
    *,
    skill_prompt: str = "",
    rag_context: str = "",
    project_context: str = "",
    chat_mode: ChatMode | str | None = None,
) -> tuple[str, ...]:
    """Return the exact ordered file-backed layers used for one prompt."""

    template_path = resolve_template_path(chat_mode, project_context or "")
    paths: list[str] = []
    if not _should_skip_identity_preamble(chat_mode, template_path):
        paths.append("base/identity.md")
    paths.extend((template_path, "base/response_discipline.md"))
    if skill_prompt:
        paths.append(_CONTENT_LAYER_TEMPLATES["skill"])
    if project_context:
        paths.append(_CONTENT_LAYER_TEMPLATES["project"])
    if rag_context:
        paths.append(_CONTENT_LAYER_TEMPLATES["knowledge"])
    return tuple(paths)


def build_prompt_layer_manifest(
    *,
    skill_prompt: str = "",
    rag_context: str = "",
    project_context: str = "",
    chat_mode: ChatMode | str | None = None,
    runtime_fragment_paths: tuple[str, ...] = (),
) -> dict[str, Any]:
    """Build a content-free identity manifest for file-backed prompt layers."""

    layers = []
    paths = (
        *prompt_layer_paths(
            skill_prompt=skill_prompt,
            rag_context=rag_context,
            project_context=project_context,
            chat_mode=chat_mode,
        ),
        *runtime_fragment_paths,
    )
    for order, relative_path in enumerate(paths):
        contents = _read_prompt(relative_path)
        layers.append(
            {
                "order": order,
                "path": relative_path,
                "sha256": hashlib.sha256(contents.encode("utf-8")).hexdigest(),
            }
        )
    canonical = json.dumps(layers, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "schema_version": PROMPT_LAYER_MANIFEST_VERSION,
        "layer_count": len(layers),
        "layers": layers,
        "manifest_sha256": hashlib.sha256(canonical).hexdigest(),
    }


def validate_prompt_layer_manifest(value: Any) -> tuple[bool, str]:
    """Validate a stored, content-free file-layer identity envelope."""

    if not isinstance(value, dict):
        return False, "prompt_layer_manifest_missing"
    if value.get("schema_version") != PROMPT_LAYER_MANIFEST_VERSION:
        return False, "prompt_layer_manifest_schema_invalid"
    layers = value.get("layers")
    if not isinstance(layers, list) or not (1 <= len(layers) <= MAX_PROMPT_LAYER_MANIFEST_ITEMS):
        return False, "prompt_layer_manifest_layers_invalid"
    if value.get("layer_count") != len(layers):
        return False, "prompt_layer_manifest_count_mismatch"
    normalized_layers: list[dict[str, Any]] = []
    for expected_order, layer in enumerate(layers):
        if not isinstance(layer, dict) or set(layer) != {"order", "path", "sha256"}:
            return False, "prompt_layer_manifest_entry_invalid"
        relative_path = str(layer.get("path") or "")
        if (
            layer.get("order") != expected_order
            or not _PROMPT_PATH_RE.fullmatch(relative_path)
            or relative_path.startswith("/")
            or ".." in Path(relative_path).parts
            or not _SHA256_RE.fullmatch(str(layer.get("sha256") or ""))
        ):
            return False, "prompt_layer_manifest_entry_invalid"
        normalized_layers.append(
            {
                "order": expected_order,
                "path": relative_path,
                "sha256": str(layer["sha256"]),
            }
        )
    canonical = json.dumps(
        normalized_layers,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    expected_sha256 = hashlib.sha256(canonical).hexdigest()
    if value.get("manifest_sha256") != expected_sha256:
        return False, "prompt_layer_manifest_sha256_mismatch"
    return True, "valid"


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
    parts.append(_read_prompt("base/response_discipline.md"))

    if skill_prompt:
        parts.append(_render_content_layer(_CONTENT_LAYER_TEMPLATES["skill"], skill_prompt))
    if project_context:
        parts.append(_render_content_layer(_CONTENT_LAYER_TEMPLATES["project"], project_context))
    if rag_context:
        parts.append(_render_content_layer(_CONTENT_LAYER_TEMPLATES["knowledge"], rag_context))

    return "\n\n".join(part for part in parts if part.strip())
