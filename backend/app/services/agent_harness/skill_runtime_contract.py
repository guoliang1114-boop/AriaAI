"""Build the exact, content-safe Skill contract used by one Aria turn.

The selected-only prompt loading boundary and explicit load outcomes are Python
adaptations of OpenAI Codex's ``codex-rs/skills/src/selection.rs`` and
``codex-rs/ext/skills/src/host_prompt.rs`` at upstream commit
``5e26f7621c1c470fe62350d61c9eb4d6c772a0da`` (Apache License 2.0).

Modified for AriaAI on 2026-09-03: Aria resolves one immutable database Skill
release, inventories only the instruction/resources already frozen into that
release, intersects declared tools with Aria's policy-filtered tool set, and
emits a bounded receipt plus a provider-neutral runtime boundary. It does not
read a Codex skill, execute package scripts, or use a Codex process/protocol.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Iterable


_BUNDLED_REFERENCE_RE = re.compile(
    r"^##\s+Bundled Reference:\s*(?P<name>[^\r\n]+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_HEADING_RE = re.compile(r"^(?P<level>#{1,6})\s+(?P<title>.+?)\s*$")
_CHECKBOX_RE = re.compile(r"^\s*[-*+]\s+\[[ xX]\]\s+\S")
_BULLET_RE = re.compile(r"^\s*[-*+]\s+\S")
_VERIFICATION_HEADING_TERMS = (
    "quality checklist",
    "verification",
    "acceptance criteria",
    "completion criteria",
    "delivery checklist",
    "质量检查",
    "质量清单",
    "验证步骤",
    "验收标准",
    "完成标准",
    "交付前检查",
)
_MAX_RESOURCE_NAMES = 16
_MAX_RESOURCE_NAME_CHARS = 160


def _single_line(value: Any, *, limit: int = _MAX_RESOURCE_NAME_CHARS) -> str:
    return " ".join(str(value or "").split())[:limit]


def _tool_name(tool: Any) -> str:
    if not isinstance(tool, dict):
        return ""
    direct = _single_line(tool.get("name"), limit=120)
    if direct:
        return direct
    function = tool.get("function")
    return _single_line(function.get("name"), limit=120) if isinstance(function, dict) else ""


def _declared_tool_names(value: Any) -> tuple[tuple[str, ...], bool]:
    raw = str(getattr(value, "tools_definition_json", "[]") or "[]")
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return (), False
    if not isinstance(parsed, list):
        return (), False
    names = tuple(
        dict.fromkeys(name for item in parsed if (name := _tool_name(item)))
    )
    return names, True


def _loaded_resource_names(prompt: str) -> tuple[str, ...]:
    names: list[str] = []
    for match in _BUNDLED_REFERENCE_RE.finditer(prompt or ""):
        name = _single_line(match.group("name"))
        if name and name not in names:
            names.append(name)
        if len(names) >= _MAX_RESOURCE_NAMES:
            break
    return tuple(names)


def _verification_section_steps(prompt: str) -> tuple[tuple[str, ...], bool]:
    """Return bounded normalized items under declared verification headings."""

    lines = (prompt or "").splitlines()
    steps: list[str] = []
    declared = False
    active_level: int | None = None
    for line in lines:
        heading = _HEADING_RE.match(line.strip())
        if heading:
            level = len(heading.group("level"))
            title = _single_line(heading.group("title")).casefold()
            if active_level is not None and level <= active_level:
                active_level = None
            if any(term in title for term in _VERIFICATION_HEADING_TERMS):
                declared = True
                active_level = level
            continue
        if active_level is None:
            continue
        if _CHECKBOX_RE.match(line) or _BULLET_RE.match(line):
            normalized = _single_line(
                re.sub(r"^\s*[-*+]\s+(?:\[[ xX]\]\s+)?", "", line),
                limit=240,
            )
            if normalized and normalized not in steps and len(steps) < 99:
                steps.append(normalized)
    return tuple(steps), declared


def _verification_plan_sha256(
    steps: tuple[str, ...],
    resources: tuple[str, ...],
) -> str:
    if not steps and not resources:
        return ""
    payload = json.dumps(
        {"schema_version": 1, "steps": list(steps), "resources": list(resources)},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_skill_runtime_contract(
    skill: Any | None,
    *,
    release_id: int | None = None,
    granted_tools: Iterable[dict] | None = None,
) -> dict[str, Any]:
    """Return a bounded manifest for the exact selected Skill release.

    The manifest deliberately excludes prompt text, tool schemas, tool inputs,
    hidden reasoning, filesystem paths, and project/customer content.
    """

    if skill is None:
        return {}

    prompt = str(getattr(skill, "system_prompt", "") or "")
    resource_names = _loaded_resource_names(prompt)
    declared_tool_names, tool_contract_valid = _declared_tool_names(skill)
    granted_tool_names = {
        name for item in list(granted_tools or ()) if (name := _tool_name(item))
    }
    granted_declared_count = sum(
        name in granted_tool_names for name in declared_tool_names
    )
    verification_steps, inline_verification = _verification_section_steps(prompt)
    verification_resources = tuple(
        name
        for name in resource_names
        if any(
            term in name.casefold()
            for term in (
                "quality-checklist",
                "quality_checklist",
                "verification",
                "验收",
                "质量",
            )
        )
    )
    instruction_loaded = bool(prompt.strip())
    verification_available = inline_verification or bool(verification_resources)
    verification_plan_sha256 = _verification_plan_sha256(
        verification_steps,
        verification_resources,
    )
    release_sha256 = str(getattr(skill, "package_sha256", "") or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", release_sha256):
        release_sha256 = ""

    contract: dict[str, Any] = {
        "schema_version": 1,
        "load_status": (
            "loaded" if instruction_loaded and tool_contract_valid else "degraded"
        ),
        "package_kind": "bundled" if str(getattr(skill, "builtin_key", "") or "") else "custom",
        "version": _single_line(getattr(skill, "package_version", ""), limit=64),
        "release_status": _single_line(getattr(skill, "package_status", ""), limit=32),
        "release_sha256": release_sha256,
        "instruction_loaded": instruction_loaded,
        "instruction_complete": instruction_loaded,
        "progressive_loading": True,
        "resource_count": len(resource_names),
        "resource_names": list(resource_names),
        "script_resource_count": sum(
            name.replace("\\", "/").casefold().startswith("scripts/")
            for name in resource_names
        ),
        "scripts_executable": False,
        "tool_contract_valid": tool_contract_valid,
        "declared_tool_count": len(declared_tool_names),
        "granted_tool_count": granted_declared_count,
        "policy_filtered_tool_count": max(
            0, len(declared_tool_names) - granted_declared_count
        ),
        "verification_status": "available" if verification_available else "not_declared",
        "verification_step_count": len(verification_steps),
        "verification_source_count": (
            len(verification_resources) + int(inline_verification)
        ),
        "verification_context_complete": instruction_loaded and verification_available,
    }
    if verification_plan_sha256:
        contract["verification_plan_sha256"] = verification_plan_sha256
    if release_id is not None and int(release_id) > 0:
        contract["release_id"] = str(int(release_id))
    return contract


def finalize_skill_runtime_contract(
    contract: dict[str, Any] | None,
    *,
    instruction_complete: bool,
) -> dict[str, Any]:
    """Bind the prepared contract to the final budgeted Provider system text."""

    if not contract:
        return {}
    finalized = dict(contract)
    complete = bool(instruction_complete and finalized.get("instruction_loaded"))
    finalized["instruction_complete"] = complete
    finalized["verification_context_complete"] = bool(
        complete and finalized.get("verification_status") == "available"
    )
    if not complete and finalized.get("load_status") == "loaded":
        finalized["load_status"] = "compacted"
    return finalized


def skill_runtime_contract_warnings(contract: dict[str, Any] | None) -> list[str]:
    if not contract:
        return []
    warnings: list[str] = []
    if not bool(contract.get("instruction_loaded")):
        warnings.append("skill_instructions_missing")
    if not bool(contract.get("tool_contract_valid", True)):
        warnings.append("skill_tool_contract_invalid")
    if (
        bool(contract.get("instruction_loaded"))
        and not bool(contract.get("instruction_complete", True))
    ):
        warnings.append("skill_instructions_compacted")
    if str(contract.get("verification_status") or "") == "not_declared":
        warnings.append("skill_verification_not_declared")
    return warnings


def format_skill_runtime_contract_for_prompt(contract: dict[str, Any] | None) -> str:
    """Render only behavioral boundaries; release hashes remain receipt-only."""

    if not contract:
        return ""
    version = _single_line(contract.get("version"), limit=64) or "unversioned"
    resource_count = max(0, int(contract.get("resource_count") or 0))
    declared_tools = max(0, int(contract.get("declared_tool_count") or 0))
    granted_tools = max(0, int(contract.get("granted_tool_count") or 0))
    verification_status = str(contract.get("verification_status") or "not_declared")
    verification_steps = max(0, int(contract.get("verification_step_count") or 0))
    verification_line = (
        f"A completion checklist is declared ({verification_steps} structured items detected). "
        "Apply it before final delivery and disclose any unresolved checks."
        if verification_status == "available"
        else "No package completion checklist is declared; do not claim package-level verification."
    )
    return (
        "## Active Skill Runtime Boundary\n"
        f"- Aria selected immutable Skill release version `{version}` for this turn only.\n"
        f"- Aria prepared the Skill instructions and {resource_count} explicitly "
        "bundled resource(s); unlisted package resources were not added to context. "
        "The Context Receipt records whether "
        "the complete package survived final context budgeting.\n"
        f"- {granted_tools} of {declared_tools} Skill-declared tool(s) remain available after "
        "Aria authorization and turn-policy filtering.\n"
        "- Package scripts are never executable merely because a Skill mentions or bundles them; "
        "only the Aria tools actually exposed for this turn may run.\n"
        f"- {verification_line} If the complete Skill context was compacted, do not claim "
        "package-level verification."
    )
