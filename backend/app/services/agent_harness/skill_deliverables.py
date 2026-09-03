"""Structured deliverable contracts extracted from immutable Skill releases."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any

from fastapi import HTTPException


SKILL_DELIVERABLE_CATALOG_SCHEMA_VERSION = 1
MAX_DELIVERABLES_PER_SKILL = 24
MAX_DELIVERABLE_FIELD_CHARS = 800
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_HEADING_RE = re.compile(r"^(?P<marks>#{1,6})\s+(?P<title>.+?)\s*$")
_SEPARATOR_RE = re.compile(r"^:?-{3,}:?$")


def _stable_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def _single_line(value: Any, limit: int = MAX_DELIVERABLE_FIELD_CHARS) -> str:
    return " ".join(str(value or "").replace("\\|", "|").strip().split())[:limit]


def _table_cells(line: str) -> list[str]:
    value = line.strip()
    if not value.startswith("|"):
        return []
    if value.endswith("|"):
        value = value[1:-1]
    else:
        value = value[1:]
    return [_single_line(item) for item in re.split(r"(?<!\\)\|", value)]


def _catalog_rows(prompt: str) -> list[list[str]]:
    lines = str(prompt or "").splitlines()
    heading_index = -1
    heading_level = 0
    for index, line in enumerate(lines):
        match = _HEADING_RE.match(line.strip())
        if not match:
            continue
        normalized = _single_line(match.group("title"), 120).casefold()
        if "deliverable catalog" in normalized or "交付物目录" in normalized:
            heading_index = index
            heading_level = len(match.group("marks"))
            break
    if heading_index < 0:
        return []

    rows: list[list[str]] = []
    for line in lines[heading_index + 1 :]:
        heading = _HEADING_RE.match(line.strip())
        if heading and len(heading.group("marks")) <= heading_level:
            break
        cells = _table_cells(line)
        if cells:
            rows.append(cells)
        elif rows and line.strip():
            break
    return rows


def _canonical_formats(raw: str) -> list[str]:
    text = raw.casefold()
    rules = (
        ("pptx", ("pptx", "ppt", "powerpoint", "deck", "slides")),
        ("xlsx", ("xlsx", "excel", "workbook", "model")),
        ("docx", ("docx", "word")),
        ("pdf", ("pdf",)),
        ("md", ("markdown", "memo", "one-pager", "one pager")),
        ("json", ("json",)),
        ("csv", ("csv",)),
        ("project_tasks", ("task list", "tasks", "backlog")),
        ("project_memory", ("project memory", "memory")),
    )
    found = [canonical for canonical, terms in rules if any(term in text for term in terms)]
    return list(dict.fromkeys(found or ["md"]))[:8]


def _stage(name: str, when_to_use: str) -> str:
    text = f"{name} {when_to_use}".casefold()
    if any(term in text for term in ("board", "committee", "executive", "汇报", "management")):
        return "executive_communication"
    if any(term in text for term in ("tracker", "roadmap", "implementation", "action", "calendar", "执行", "实施")):
        return "execution"
    if any(term in text for term in ("evidence", "workpaper", "register", "checklist", "归档", "底稿")):
        return "evidence_and_archive"
    if any(term in text for term in ("option", "design", "framework", "blueprint", "方案", "设计")):
        return "solution_design"
    return "diagnosis_and_analysis"


def _save_targets(formats: list[str], name: str) -> list[str]:
    targets: list[str] = []
    if any(item in {"md", "pptx", "xlsx", "docx", "pdf", "json", "csv"} for item in formats):
        targets.extend(("project_documents", "knowledge_base"))
    if "project_tasks" in formats:
        targets.append("project_tasks")
    if "project_memory" in formats or "memory" in name.casefold():
        targets.append("project_memory")
    return list(dict.fromkeys(targets or ["project_documents"]))


def _slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized.casefold()).strip("-")
    return normalized[:48] or "deliverable"


def parse_skill_deliverable_catalog(prompt: str) -> list[dict[str, Any]]:
    """Parse one bounded Markdown Deliverable Catalog into stable JSON rows."""

    rows = _catalog_rows(prompt)
    if len(rows) < 3:
        return []
    headers = [cell.casefold() for cell in rows[0]]
    if not (
        any("deliverable" in cell or "交付物" in cell for cell in headers)
        and any("format" in cell or "格式" in cell for cell in headers)
    ):
        return []
    if not all(cell and _SEPARATOR_RE.fullmatch(cell.replace(" ", "")) for cell in rows[1]):
        return []

    items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for raw in rows[2 : 2 + MAX_DELIVERABLES_PER_SKILL]:
        if len(raw) < 4:
            continue
        name, when_to_use, minimum_content, format_label = raw[:4]
        if not name or not format_label:
            continue
        name_identity = hashlib.sha256(name.casefold().encode("utf-8")).hexdigest()[:10]
        deliverable_id = f"{_slug(name)}-{name_identity}"
        if deliverable_id in seen_ids:
            continue
        seen_ids.add(deliverable_id)
        formats = _canonical_formats(format_label)
        core = {
            "schema_version": SKILL_DELIVERABLE_CATALOG_SCHEMA_VERSION,
            "deliverable_id": deliverable_id,
            "name": name,
            "when_to_use": when_to_use,
            "minimum_content": minimum_content,
            "format_label": format_label,
            "formats": formats,
            "default_format": formats[0],
            "stage": _stage(name, when_to_use),
            "save_targets": _save_targets(formats, name),
            "memory_policy": "explicit_user_confirmation",
            "requires_review": True,
            "business_verifiers": [],
        }
        core["contract_sha256"] = _sha256(core)
        items.append(core)
    return items


def build_skill_deliverable_catalog(skill: Any) -> dict[str, Any]:
    items = parse_skill_deliverable_catalog(
        str(getattr(skill, "system_prompt", "") or "")
    )
    package_sha256 = str(getattr(skill, "package_sha256", "") or "").lower()
    if not _SHA256_RE.fullmatch(package_sha256):
        package_sha256 = ""
    catalog_identity = {
        "schema_version": SKILL_DELIVERABLE_CATALOG_SCHEMA_VERSION,
        "skill_id": int(getattr(skill, "id", 0) or 0),
        "skill_name": _single_line(getattr(skill, "name", ""), 160),
        "skill_version": _single_line(getattr(skill, "package_version", ""), 64),
        "skill_release_sha256": package_sha256,
        "items": items,
    }
    return {
        **catalog_identity,
        "catalog_sha256": _sha256(catalog_identity),
        "item_count": len(items),
        "source": "immutable_skill_release_markdown",
    }


def resolve_selected_skill_deliverable(
    skill: Any,
    selection: Any | None,
) -> dict[str, Any]:
    """Verify a UI selection against the exact active Skill release."""

    if selection is None:
        return {}
    raw = selection.model_dump() if hasattr(selection, "model_dump") else selection
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="Invalid deliverable selection")
    catalog = build_skill_deliverable_catalog(skill)
    expected_catalog = str(raw.get("catalog_sha256") or "").lower()
    expected_contract = str(raw.get("contract_sha256") or "").lower()
    deliverable_id = _single_line(raw.get("deliverable_id"), 80)
    if (
        not _SHA256_RE.fullmatch(expected_catalog)
        or expected_catalog != catalog["catalog_sha256"]
    ):
        raise HTTPException(
            status_code=409,
            detail="Skill deliverable catalog changed; reload and choose again.",
        )
    item = next(
        (
            candidate
            for candidate in catalog["items"]
            if candidate["deliverable_id"] == deliverable_id
        ),
        None,
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Skill deliverable not found")
    if (
        not _SHA256_RE.fullmatch(expected_contract)
        or expected_contract != item["contract_sha256"]
    ):
        raise HTTPException(
            status_code=409,
            detail="Skill deliverable contract changed; reload and choose again.",
        )
    return {
        **item,
        "catalog_sha256": catalog["catalog_sha256"],
        "skill_id": catalog["skill_id"],
        "skill_name": catalog["skill_name"],
        "skill_version": catalog["skill_version"],
        "skill_release_sha256": catalog["skill_release_sha256"],
    }


def skill_deliverable_reference(value: dict[str, Any] | None) -> dict[str, Any]:
    """Return a bounded selection receipt safe for Message metadata."""

    if not isinstance(value, dict):
        return {}
    deliverable_id = _single_line(value.get("deliverable_id"), 80)
    name = _single_line(value.get("name"), 160)
    raw_formats = value.get("formats")
    if not isinstance(raw_formats, (list, tuple)):
        return {}
    formats = [
        _single_line(item, 24)
        for item in raw_formats[:8]
        if _single_line(item, 24)
    ]
    default_format = _single_line(value.get("default_format"), 24)
    contract_sha256 = _single_line(value.get("contract_sha256"), 64)
    catalog_sha256 = _single_line(value.get("catalog_sha256"), 64)
    skill_release_sha256 = _single_line(value.get("skill_release_sha256"), 64)
    if (
        not deliverable_id
        or not name
        or not formats
        or default_format not in formats
        or not _SHA256_RE.fullmatch(contract_sha256)
        or not _SHA256_RE.fullmatch(catalog_sha256)
        or (
            skill_release_sha256
            and not _SHA256_RE.fullmatch(skill_release_sha256)
        )
    ):
        return {}
    raw_save_targets = value.get("save_targets")
    save_targets = (
        [
            _single_line(item, 40)
            for item in raw_save_targets[:8]
            if _single_line(item, 40)
        ]
        if isinstance(raw_save_targets, (list, tuple))
        else []
    )
    return {
        "schema_version": SKILL_DELIVERABLE_CATALOG_SCHEMA_VERSION,
        "deliverable_id": deliverable_id,
        "name": name,
        "formats": formats,
        "default_format": default_format,
        "stage": _single_line(value.get("stage"), 48),
        "save_targets": save_targets,
        "requires_review": bool(value.get("requires_review", True)),
        "contract_sha256": contract_sha256,
        "catalog_sha256": catalog_sha256,
        "skill_release_sha256": skill_release_sha256,
    }


def format_skill_deliverable_for_prompt(value: dict[str, Any] | None) -> str:
    """Render the selected release-bound output contract for the provider."""

    if not isinstance(value, dict) or not value.get("deliverable_id"):
        return ""
    formats = ", ".join(str(item) for item in list(value.get("formats") or [])[:8])
    return (
        "## Selected Skill Deliverable Contract\n"
        f"- Deliverable: {value.get('name')}\n"
        f"- Use when: {value.get('when_to_use')}\n"
        f"- Minimum content: {value.get('minimum_content')}\n"
        f"- Allowed formats: {formats}\n"
        "- Generate this deliverable for the current turn. Do not silently switch to a "
        "different catalog item.\n"
        "- Saving, memory updates, external delivery, and business acceptance remain "
        "separate Aria-authorized actions."
    )
