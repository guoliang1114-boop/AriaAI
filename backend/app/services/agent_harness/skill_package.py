"""Parse and load portable ``SKILL.md`` packages for AriaAI.

Frontmatter validation and conservative scalar repair are adapted from OpenAI
Codex's ``codex-rs/skills/src/parser.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-22: translated to Python/PyYAML, returns the
instruction body, and safely assembles selected bundled references for Aria's
DB-backed Skill prompts. No Codex process or protocol is involved.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import yaml

MAX_SKILL_NAME_LENGTH = 64


class SkillPackageError(ValueError):
    """Raised when a file-backed Skill package violates its contract."""


@dataclass(frozen=True)
class SkillPackageDocument:
    name: str
    description: str
    short_description: Optional[str]
    instructions: str
    metadata: dict[str, Any]


def _single_line(value: Any) -> str:
    return " ".join(str(value or "").split())


def _extract_frontmatter(contents: str) -> tuple[str, str]:
    lines = contents.splitlines()
    if not lines or lines[0].strip() != "---":
        raise SkillPackageError("missing YAML frontmatter delimited by ---")
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            frontmatter = "\n".join(lines[1:index])
            if not frontmatter.strip():
                raise SkillPackageError("empty YAML frontmatter")
            return frontmatter, "\n".join(lines[index + 1 :]).lstrip()
    raise SkillPackageError("missing closing YAML frontmatter delimiter")


def _repair_scalar_fields(frontmatter: str) -> Optional[str]:
    """Quote only plain scalar values whose ``: `` makes YAML ambiguous."""

    changed = False
    repaired: list[str] = []
    block_scalar_indent: Optional[int] = None

    for line in frontmatter.splitlines():
        indent = len(line) - len(line.lstrip(" "))
        if block_scalar_indent is not None:
            if not line.strip() or indent > block_scalar_indent:
                repaired.append(line)
                continue
            block_scalar_indent = None

        if ":" not in line:
            repaired.append(line)
            continue
        key, value = line.split(":", 1)
        if not key.strip() or (value and not value[0].isspace()):
            repaired.append(line)
            continue

        leading = value[: len(value) - len(value.lstrip())]
        scalar_and_comment = value.lstrip()
        scalar = scalar_and_comment
        comment = ""
        for index, character in enumerate(scalar_and_comment):
            if character == "#" and (index == 0 or scalar_and_comment[index - 1].isspace()):
                scalar = scalar_and_comment[:index].rstrip()
                comment = scalar_and_comment[len(scalar) :]
                break
        scalar = scalar.rstrip()
        if not scalar:
            repaired.append(line)
            continue
        if scalar[0] in "|>":
            block_scalar_indent = indent
            repaired.append(line)
            continue
        if scalar[0] in "'\"":
            repaired.append(line)
            continue
        if ": " not in scalar:
            repaired.append(line)
            continue

        quoted = "'" + scalar.replace("'", "''") + "'"
        repaired.append(f"{key}:{leading}{quoted}{comment}")
        changed = True

    return "\n".join(repaired) if changed else None


def _load_frontmatter(frontmatter: str) -> dict[str, Any]:
    try:
        parsed = yaml.safe_load(frontmatter)
    except yaml.YAMLError as original_error:
        repaired = _repair_scalar_fields(frontmatter)
        if repaired is None:
            raise SkillPackageError(
                f"invalid YAML frontmatter: {original_error}"
            ) from original_error
        try:
            parsed = yaml.safe_load(repaired)
        except yaml.YAMLError as repaired_error:
            raise SkillPackageError(
                f"invalid YAML frontmatter: {original_error}"
            ) from repaired_error
    if not isinstance(parsed, dict):
        raise SkillPackageError("YAML frontmatter must be a mapping")
    return parsed


def parse_skill_document(contents: str, *, default_name: str) -> SkillPackageDocument:
    frontmatter, instructions = _extract_frontmatter(contents)
    metadata = _load_frontmatter(frontmatter)

    name = _single_line(metadata.get("name")) or _single_line(default_name)
    description = _single_line(metadata.get("description"))
    nested_metadata = metadata.get("metadata")
    short_description = None
    if isinstance(nested_metadata, dict):
        short_description = _single_line(nested_metadata.get("short-description")) or None

    if not name:
        raise SkillPackageError("missing field `name`")
    if len(name) > MAX_SKILL_NAME_LENGTH:
        raise SkillPackageError(
            f"invalid name: exceeds maximum length of {MAX_SKILL_NAME_LENGTH} characters"
        )
    if not description:
        raise SkillPackageError("missing field `description`")
    if not instructions.strip():
        raise SkillPackageError("SKILL.md instruction body is empty")

    return SkillPackageDocument(
        name=name,
        description=description,
        short_description=short_description,
        instructions=instructions.strip(),
        metadata=metadata,
    )


def load_skill_package_prompt(
    skill_dir: Path,
    reference_files: list[str] | None = None,
) -> str:
    """Load one validated Skill package and explicitly selected references."""

    root = skill_dir.resolve()
    skill_path = root / "SKILL.md"
    if not skill_path.is_file():
        return ""

    document = parse_skill_document(
        skill_path.read_text(encoding="utf-8"),
        default_name=root.name,
    )
    parts = [document.instructions]
    for reference_name in reference_files or []:
        relative = Path(reference_name)
        if relative.is_absolute() or ".." in relative.parts:
            raise SkillPackageError(
                f"reference escapes skill package root: {reference_name}"
            )
        candidates = (root / relative, root / "references" / relative)
        reference_path = next((path for path in candidates if path.is_file()), None)
        if reference_path is None:
            continue
        resolved = reference_path.resolve()
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise SkillPackageError(
                f"reference escapes skill package root: {reference_name}"
            ) from exc
        parts.append(
            f"## Bundled Reference: {reference_name}\n\n"
            f"{resolved.read_text(encoding='utf-8').strip()}"
        )
    return "\n\n---\n\n".join(part for part in parts if part)
