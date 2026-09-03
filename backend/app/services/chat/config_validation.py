"""Fail-closed validation for Aria chat modes, prompts, and tool permissions."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

import yaml

from app.services.chat.mode_registry import (
    MODE_CONFIG,
    ActionPolicy,
    ChatMode,
    HistoryStrategy,
    ModelStrategy,
)
from app.services.chat.prompt_assembler import PROMPT_ROOT
from app.tools import ToolDefinition
from app.tools.capabilities import ToolEffect, all_builtin_tool_manifests


CHAT_RUNTIME_CONFIG_SCHEMA_VERSION = 1
_CONTEXT_MODES = {
    "workspace_brief",
    "project",
    "client_portfolio",
    "workspace_inventory",
    "skill",
}
_REQUIRED_PROMPT_FRAGMENTS = (
    "base/identity.md",
    "base/response_discipline.md",
    "frames/recent_tool_history.md",
    "frames/capability_no_tools.md",
    "frames/capability_write_tools.md",
    "frames/turn_contract.md",
)
_CONTENT_PROMPT_LAYERS = (
    "layers/skill_context.md",
    "layers/project_context.md",
    "layers/knowledge_context.md",
)


def _sha256_json(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _mode_issues(known_tools: set[str]) -> list[str]:
    issues: list[str] = []
    configured_modes = set(MODE_CONFIG)
    missing_modes = sorted(mode.value for mode in set(ChatMode) - configured_modes)
    extra_modes = sorted(str(mode) for mode in configured_modes - set(ChatMode))
    if missing_modes:
        issues.append(f"missing_mode_config:{','.join(missing_modes)}")
    if extra_modes:
        issues.append(f"unknown_mode_config:{','.join(extra_modes)}")

    for mode in ChatMode:
        config = MODE_CONFIG.get(mode)
        if config is None:
            continue
        prefix = f"mode:{mode.value}"
        if config.max_tokens <= 0:
            issues.append(f"{prefix}:invalid_max_tokens")
        if config.history_window < 0:
            issues.append(f"{prefix}:invalid_history_window")
        if config.history_strategy is HistoryStrategy.NONE and config.history_window != 0:
            issues.append(f"{prefix}:none_history_requires_zero_window")
        if config.history_strategy is not HistoryStrategy.NONE and config.history_window <= 0:
            issues.append(f"{prefix}:history_window_required")
        if config.context_mode not in _CONTEXT_MODES:
            issues.append(f"{prefix}:invalid_context_mode:{config.context_mode}")
        if config.prompt_template:
            prompt_path = PROMPT_ROOT / config.prompt_template
            if not prompt_path.is_file() or not prompt_path.read_text(encoding="utf-8").strip():
                issues.append(f"{prefix}:missing_prompt:{config.prompt_template}")
        elif mode is not ChatMode.TASK_ORCHESTRATION:
            issues.append(f"{prefix}:prompt_required")
        if len(set(config.tool_pool)) != len(config.tool_pool):
            issues.append(f"{prefix}:duplicate_tool_pool_entry")
        for tool_name in config.tool_pool:
            if tool_name not in known_tools:
                issues.append(f"{prefix}:unknown_tool:{tool_name}")
        if config.model_strategy is ModelStrategy.USER_DEFAULT and (
            config.fast_model or config.fast_max_tokens or config.fast_source_models
        ):
            issues.append(f"{prefix}:unexpected_fast_model_config")
        if config.model_strategy is not ModelStrategy.USER_DEFAULT:
            if not config.fast_model or config.fast_max_tokens <= 0 or not config.fast_source_models:
                issues.append(f"{prefix}:incomplete_fast_model_config")
            if config.fast_max_tokens > config.max_tokens:
                issues.append(f"{prefix}:fast_tokens_exceed_mode_cap")
    return issues


def _tool_issues(registered_tools: Iterable[ToolDefinition]) -> list[str]:
    issues: list[str] = []
    definitions = list(registered_tools)
    registered_names = [tool.name for tool in definitions]
    if len(set(registered_names)) != len(registered_names):
        issues.append("duplicate_registered_tool")
    builtin = {manifest.name: manifest for manifest in all_builtin_tool_manifests()}
    missing = sorted(set(builtin) - set(registered_names))
    unknown = sorted(set(registered_names) - set(builtin))
    if missing:
        issues.append(f"unregistered_builtin_tools:{','.join(missing)}")
    if unknown:
        issues.append(f"tools_without_builtin_manifest:{','.join(unknown)}")

    valid_policies = {policy.value for policy in ActionPolicy}
    for tool in definitions:
        prefix = f"tool:{tool.name}"
        manifest = tool.capability_manifest
        if manifest.name != tool.name:
            issues.append(f"{prefix}:manifest_name_mismatch")
        canonical_manifest = builtin.get(tool.name)
        if (
            canonical_manifest is not None
            and manifest.to_dict() != canonical_manifest.to_dict()
        ):
            issues.append(f"{prefix}:manifest_differs_from_central_registry")
        capabilities = {"default": manifest.default, **dict(manifest.operations)}
        for operation, capability in capabilities.items():
            if capability.required_policy not in valid_policies:
                issues.append(f"{prefix}:{operation}:invalid_policy")
            if capability.parallel_safe and capability.effect is not ToolEffect.READ:
                issues.append(f"{prefix}:{operation}:mutating_parallel_tool")

        if manifest.operations:
            properties = tool.input_schema.get("properties", {})
            discriminator = next(
                (
                    name
                    for name in ("action", "mode")
                    if isinstance(properties.get(name), dict)
                    and isinstance(properties[name].get("enum"), list)
                ),
                "",
            )
            if not discriminator:
                issues.append(f"{prefix}:operation_discriminator_missing")
            else:
                declared = {
                    str(item).strip().lower()
                    for item in properties[discriminator]["enum"]
                    if str(item).strip()
                }
                configured = set(manifest.operations)
                if declared != configured:
                    issues.append(
                        f"{prefix}:operation_mismatch:"
                        f"schema={','.join(sorted(declared))}:"
                        f"manifest={','.join(sorted(configured))}"
                    )
    return issues


def _prompt_spec_issues(registered_names: set[str]) -> list[str]:
    issues: list[str] = []
    for relative_path in _REQUIRED_PROMPT_FRAGMENTS:
        path = PROMPT_ROOT / relative_path
        if not path.is_file() or not path.read_text(encoding="utf-8").strip():
            issues.append(f"prompt_file:{relative_path}:missing")
    for relative_path in _CONTENT_PROMPT_LAYERS:
        path = PROMPT_ROOT / relative_path
        contents = path.read_text(encoding="utf-8") if path.is_file() else ""
        if not contents.strip():
            issues.append(f"prompt_file:{relative_path}:missing")
        elif contents.count("{{content}}") != 1:
            issues.append(f"prompt_file:{relative_path}:content_marker_invalid")
    tool_prompt_names: set[str] = set()
    for path in sorted((PROMPT_ROOT / "tools").glob("*.yaml")):
        value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(value, dict):
            issues.append(f"tool_prompt:{path.name}:not_mapping")
            continue
        tool_name = str(value.get("name") or "").strip()
        if tool_name:
            tool_prompt_names.add(tool_name)
        if tool_name != path.stem:
            issues.append(f"tool_prompt:{path.name}:name_mismatch")
        if tool_name not in registered_names:
            issues.append(f"tool_prompt:{path.name}:unknown_tool")
        for field in ("purpose", "when_to_use", "when_not_to_use", "ui_effect"):
            if not str(value.get(field) or "").strip():
                issues.append(f"tool_prompt:{path.name}:missing_{field}")

    fixed_mode_tools = {
        tool_name
        for config in MODE_CONFIG.values()
        if not config.allow_dynamic_tools
        for tool_name in config.tool_pool
    }
    missing_tool_prompts = sorted(fixed_mode_tools - tool_prompt_names)
    if missing_tool_prompts:
        issues.append(f"missing_tool_prompts:{','.join(missing_tool_prompts)}")

    for path in sorted(PROMPT_ROOT.rglob("*.md")):
        if not path.read_text(encoding="utf-8").strip():
            issues.append(f"prompt_file:{path.relative_to(PROMPT_ROOT)}:empty")
    return issues


def validate_chat_runtime_configuration(
    registered_tools: Iterable[ToolDefinition],
) -> dict[str, Any]:
    """Return a stable validation report; callers fail on any issue."""

    definitions = list(registered_tools)
    registered_names = {tool.name for tool in definitions}
    issues = [
        *_mode_issues(registered_names),
        *_tool_issues(definitions),
        *_prompt_spec_issues(registered_names),
    ]
    modes = {
        mode.value: {
            "prompt_template": config.prompt_template,
            "model_strategy": config.model_strategy.value,
            "max_tokens": config.max_tokens,
            "history_window": config.history_window,
            "history_strategy": config.history_strategy.value,
            "context_mode": config.context_mode,
            "include_identity_preamble": config.include_identity_preamble,
            "allow_dynamic_tools": config.allow_dynamic_tools,
            "fast_model": config.fast_model,
            "fast_max_tokens": config.fast_max_tokens,
            "fast_source_models": list(config.fast_source_models),
            "tool_pool": list(config.tool_pool),
        }
        for mode, config in sorted(MODE_CONFIG.items(), key=lambda item: item[0].value)
    }
    tools = {
        tool.name: tool.to_capability_manifest()
        for tool in sorted(definitions, key=lambda item: item.name)
    }
    prompt_files = {
        str(path.relative_to(PROMPT_ROOT)): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in sorted(
            (
                *PROMPT_ROOT.rglob("*.md"),
                *PROMPT_ROOT.rglob("*.yaml"),
            ),
            key=lambda item: str(item.relative_to(PROMPT_ROOT)),
        )
    }
    fingerprint_input = {
        "modes": modes,
        "tools": tools,
        "prompt_files": prompt_files,
    }
    return {
        "schema_version": CHAT_RUNTIME_CONFIG_SCHEMA_VERSION,
        "valid": not issues,
        "issues": issues,
        "mode_count": len(modes),
        "tool_count": len(tools),
        "prompt_file_count": len(list(PROMPT_ROOT.rglob("*.md"))),
        "config_sha256": _sha256_json(fingerprint_input),
    }


def assert_chat_runtime_configuration(
    registered_tools: Iterable[ToolDefinition],
) -> dict[str, Any]:
    report = validate_chat_runtime_configuration(registered_tools)
    if not report["valid"]:
        raise RuntimeError(
            "invalid chat runtime configuration: " + "; ".join(report["issues"])
        )
    return report
