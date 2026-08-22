from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import engine
from app.models.db import Project, ProjectFile, ProjectFileVersion, ProjectFolder
from app.services.agent_harness.structured_patch import (
    StructuredPatchConflict,
    StructuredPatchError,
    StructuredPatchPlan,
    atomic_write_text,
    content_sha256,
    locked_text_path,
    plan_content_transition,
    plan_structured_patch,
)
from app.services.cache import projects_cache
from app.services.deliverable_naming import file_name_for_deliverable, normalize_deliverable_title
from app.services.project_files import active_project_files_stmt
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_core import init_default_project_folders
from app.services.project_documents import (
    create_project_document_record,
    get_project_document_file_or_404,
    read_project_document_content,
    update_project_document_record,
)
from app.services.project_file_versions import (
    create_project_file_version_snapshot,
    latest_project_file_version,
)
from app.services.time_utils import utc_now_naive
from app.services.tool_descriptions import tool_description
from app.tools import registry

PROJECT_MARKDOWN_TOOL_NAME = "update_project_markdown_document"
_STRUCTURED_MODES = frozenset({"patch", "rollback"})
_PATCH_PREFLIGHT_KEY = "_aria_patch_preflight"
_PATCH_PREVIEW_MAX_CHARS = 24_000


def _first_non_empty_string(*values: object) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _normalize_markdown_update_input(
    *,
    mode: str | None,
    content: str | None,
    extra: dict,
) -> tuple[str, str]:
    normalized_mode = _first_non_empty_string(
        mode,
        extra.get("action"),
        extra.get("operation"),
        extra.get("update_mode"),
    ).lower()
    mode_aliases = {
        "write": "replace",
        "update": "replace",
        "edit": "replace",
        "rewrite": "replace",
        "correct": "replace",
        "modify": "replace",
        "save": "replace",
        "overwrite": "replace",
        "add": "append",
        "insert": "append",
        "new": "create",
        "apply_patch": "patch",
        "restore": "rollback",
        "revert": "rollback",
    }
    normalized_mode = mode_aliases.get(normalized_mode, normalized_mode)

    normalized_content = _first_non_empty_string(
        content,
        extra.get("markdown"),
        extra.get("markdown_content"),
        extra.get("new_content"),
        extra.get("updated_content"),
        extra.get("body"),
        extra.get("text"),
    )
    return normalized_mode, normalized_content


def _find_markdown_file(session: Session, project_id: int, file_name: str | None) -> ProjectFile | None:
    if not file_name:
        return None
    normalized = file_name.strip().lower()
    if not normalized:
        return None
    candidates = session.exec(active_project_files_stmt(project_id).where(ProjectFile.file_type == "md")).all()
    for candidate in candidates:
        if candidate.name.strip().lower() == normalized:
            return candidate
    if not normalized.endswith(".md"):
        with_suffix = f"{normalized}.md"
        for candidate in candidates:
            if candidate.name.strip().lower() == with_suffix:
                return candidate
    return None


def _bust_project_cache(project_id: int) -> None:
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")


def _init_default_folders(session: Session, project_id: int):
    return init_default_project_folders(session, project_id)


def _patch_http_error(exc: StructuredPatchError) -> HTTPException:
    if isinstance(exc, StructuredPatchConflict):
        return HTTPException(409, str(exc))
    if exc.code in {"patch_too_large", "document_too_large"}:
        return HTTPException(413, str(exc))
    return HTTPException(400, str(exc))


def _require_base_sha256(base_sha256: object, current_content: str) -> str:
    expected = str(base_sha256 or "").strip().lower()
    if len(expected) != 64 or any(char not in "0123456789abcdef" for char in expected):
        raise HTTPException(
            400,
            "base_sha256 is required for patch/rollback. Read the document again and use its content_sha256.",
        )
    current = content_sha256(current_content)
    if expected != current:
        raise HTTPException(
            409,
            f"base_version_conflict: expected {expected}, current {current}; read and re-plan before confirming",
        )
    return current


def _structured_action_plan(
    session: Session,
    project_file: ProjectFile,
    *,
    mode: str,
    base_sha256: object,
    patch: object = None,
    version_id: object = None,
) -> tuple[StructuredPatchPlan, ProjectFileVersion | None]:
    current_content = read_project_document_content(project_file, uploads_dir=UPLOADS_DIR)
    _require_base_sha256(base_sha256, current_content)
    try:
        if mode == "patch":
            if not isinstance(patch, str) or not patch.strip():
                raise HTTPException(400, "patch is required when mode='patch'")
            return (
                plan_structured_patch(
                    patch,
                    base_content=current_content,
                    expected_path=project_file.name,
                ),
                None,
            )

        try:
            target_version_id = int(version_id)
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "version_id is required when mode='rollback'") from exc
        version = session.get(ProjectFileVersion, target_version_id)
        if (
            version is None
            or version.project_id != project_file.project_id
            or version.project_file_id != project_file.id
        ):
            raise HTTPException(404, "Rollback version not found")
        return (
            plan_content_transition(
                target_path=project_file.name,
                base_content=current_content,
                result_content=version.content_snapshot,
            ),
            version,
        )
    except StructuredPatchError as exc:
        raise _patch_http_error(exc) from exc


def _bounded_patch_preview(unified_diff: str) -> tuple[str, bool]:
    if len(unified_diff) <= _PATCH_PREVIEW_MAX_CHARS:
        return unified_diff, False
    half = (_PATCH_PREVIEW_MAX_CHARS - 80) // 2
    return (
        f"{unified_diff[:half]}\n... Aria diff preview truncated ...\n{unified_diff[-half:]}",
        True,
    )


def _structured_project_file_path(project_file: ProjectFile):
    root = UPLOADS_DIR.resolve()
    candidate = root / project_file.path
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise HTTPException(404, "File not found on disk") from exc
    if root not in resolved.parents or resolved != candidate.absolute():
        raise HTTPException(400, "unsafe_artifact_path: structured patch target must be a regular file inside uploads")
    if not resolved.is_file():
        raise HTTPException(400, "Structured patch target must be a regular file")
    return resolved


def prepare_project_markdown_action_input(tool_input: dict[str, Any]) -> dict[str, Any]:
    """Validate a structured mutation and freeze its server-derived preview."""

    prepared = dict(tool_input or {})
    prepared.pop(_PATCH_PREFLIGHT_KEY, None)
    mode = str(prepared.get("mode") or "").strip().lower()
    if mode not in _STRUCTURED_MODES:
        return prepared
    try:
        project_id = int(prepared.get("project_id"))
        file_id = int(prepared.get("file_id"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "project_id and file_id are required for patch/rollback") from exc

    with Session(engine) as session:
        project_file = get_project_document_file_or_404(session, project_id, file_id)
        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents are supported")
        _structured_project_file_path(project_file)
        plan, version = _structured_action_plan(
            session,
            project_file,
            mode=mode,
            base_sha256=prepared.get("base_sha256"),
            patch=prepared.get("patch"),
            version_id=prepared.get("version_id"),
        )
        preview, truncated = _bounded_patch_preview(plan.unified_diff)
        prepared[_PATCH_PREFLIGHT_KEY] = {
            "schema_version": 1,
            "mode": mode,
            "project_file_id": project_file.id,
            "target_name": project_file.name,
            "base_sha256": plan.base_sha256,
            "result_sha256": plan.result_sha256,
            "replacement_count": plan.replacement_count,
            "preview_diff": preview,
            "preview_truncated": truncated,
            "rollback_target_version_id": version.id if version else None,
        }
    return prepared


def _apply_structured_markdown_action(
    *,
    project_id: int,
    file_id: int,
    mode: str,
    base_sha256: object,
    patch: object,
    version_id: object,
    preflight: object,
) -> dict[str, Any]:
    with Session(engine) as session:
        project_file = get_project_document_file_or_404(session, project_id, file_id)
        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents are supported")
        full_path = _structured_project_file_path(project_file)

        with locked_text_path(full_path):
            plan, rollback_target = _structured_action_plan(
                session,
                project_file,
                mode=mode,
                base_sha256=base_sha256,
                patch=patch,
                version_id=version_id,
            )
            frozen = preflight if isinstance(preflight, dict) else {}
            if (
                frozen.get("schema_version") != 1
                or frozen.get("project_file_id") != project_file.id
                or frozen.get("base_sha256") != plan.base_sha256
                or frozen.get("result_sha256") != plan.result_sha256
                or frozen.get("mode") != mode
            ):
                raise HTTPException(
                    409,
                    "patch_preflight_conflict: frozen preview does not match the current deterministic plan",
                )

            before_version = create_project_file_version_snapshot(
                session,
                project_file,
                plan.original_content,
                change_source="before_structured_patch",
            )
            session.flush()
            wrote_file = False
            try:
                project_file.size_bytes = atomic_write_text(full_path, plan.result_content)
                wrote_file = True
                session.add(project_file)
                applied_version = create_project_file_version_snapshot(
                    session,
                    project_file,
                    plan.result_content,
                    change_source=(
                        f"structured_patch_rollback:{rollback_target.id}"
                        if rollback_target is not None
                        else "structured_patch"
                    ),
                )
                project = session.get(Project, project_id)
                if project is not None:
                    project.memory_stale = True
                    if project.memory_rebuild_status != "rebuilding":
                        project.memory_rebuild_status = "idle"
                    project.updated_at = utc_now_naive()
                    session.add(project)
                session.commit()
            except Exception as exc:
                session.rollback()
                if wrote_file:
                    try:
                        atomic_write_text(full_path, plan.original_content)
                    except Exception as compensation_exc:
                        raise RuntimeError(
                            "Structured patch database commit failed and file compensation also failed; "
                            "manual verification is required"
                        ) from compensation_exc
                raise exc

            session.refresh(project_file)
            preview, preview_truncated = _bounded_patch_preview(plan.unified_diff)
            return {
                "ok": True,
                "success": True,
                "action": "rolled_back" if mode == "rollback" else "patched",
                "id": project_file.id,
                "project_file_id": project_file.id,
                "name": project_file.name,
                "file_type": project_file.file_type,
                "path": project_file.path,
                "folder_id": project_file.folder_id,
                "size_bytes": project_file.size_bytes,
                "base_sha256": plan.base_sha256,
                "result_sha256": plan.result_sha256,
                "unified_diff": preview,
                "diff_truncated": preview_truncated,
                "replacement_count": plan.replacement_count,
                "rollback_available": before_version is not None,
                "rollback_version_id": before_version.id if before_version else None,
                "applied_version_id": applied_version.id if applied_version else None,
                "restored_from_version_id": rollback_target.id if rollback_target else None,
                "message": (
                    f"已将 {project_file.name} 回滚到版本 {rollback_target.version_number}"
                    if rollback_target
                    else f"已将结构化 Patch 应用于 {project_file.name}"
                ),
            }


@registry.register(
    name=PROJECT_MARKDOWN_TOOL_NAME,
    description=tool_description(
        PROJECT_MARKDOWN_TOOL_NAME,
        "Create or update a Markdown document in the current project. "
        "Use only when the user explicitly asks to save, write, create, append, replace, rewrite, or modify a project Markdown file. "
        "Do not use for analysis-only requests such as risk identification, project summaries, recommendations, or advice. "
        "For a targeted edit, prefer patch mode after reading the file; provide the returned content_sha256 and an Aria structured patch. "
        "Patch and rollback are previewed and require confirmation before an atomic, version-checked write."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "file_id": {
                "type": "integer",
                "description": "Existing project Markdown file id. Prefer this when the target file is known.",
            },
            "file_name": {
                "type": "string",
                "description": "Markdown file name to create or match, for example project-summary.md.",
            },
            "mode": {
                "type": "string",
                "enum": ["replace", "append", "create", "patch", "rollback"],
                "description": "patch applies a targeted structured diff; rollback restores a saved version. Both require file_id and base_sha256.",
            },
            "content": {
                "type": "string",
                "description": "Markdown content to write. In replace mode this must be the full final document.",
            },
            "patch": {
                "type": "string",
                "description": "For patch mode: *** Begin Patch / *** Update File / @@ / +/- lines / *** End Patch.",
            },
            "base_sha256": {
                "type": "string",
                "description": "Exact content_sha256 returned by the latest document read; required for patch and rollback.",
            },
            "version_id": {
                "type": "integer",
                "description": "Saved project file version id to restore in rollback mode.",
            },
            "summary": {
                "type": "string",
                "description": "Short summary for a newly created document.",
            },
            "folder_id": {
                "type": "integer",
                "description": "Optional target folder id for newly created documents.",
            },
        },
        "required": [],
    },
)
async def update_project_markdown_document(
    *,
    project_id: int,
    mode: Literal["replace", "append", "create", "patch", "rollback"] | None = None,
    content: str | None = None,
    file_id: int | None = None,
    file_name: str | None = None,
    summary: str | None = None,
    folder_id: int | None = None,
    **extra,
) -> dict:
    mode, content = _normalize_markdown_update_input(mode=mode, content=content, extra=extra)
    if not project_id:
        raise HTTPException(400, "Project id is required")
    if mode not in {"replace", "append", "create", "patch", "rollback"}:
        raise HTTPException(400, "Markdown update mode is required. Use replace, append, create, patch, or rollback.")
    if mode in _STRUCTURED_MODES:
        if file_id is None:
            raise HTTPException(400, "file_id is required for patch/rollback")
        result = _apply_structured_markdown_action(
            project_id=project_id,
            file_id=file_id,
            mode=mode,
            base_sha256=extra.get("base_sha256"),
            patch=extra.get("patch"),
            version_id=extra.get("version_id"),
            preflight=extra.get(_PATCH_PREFLIGHT_KEY),
        )
        _bust_project_cache(project_id)
        return result
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(400, "Markdown content is required")

    with Session(engine) as session:
        project_file: ProjectFile | None = None
        if file_id is not None:
            project_file = get_project_document_file_or_404(session, project_id, file_id)
        elif mode != "create":
            project_file = _find_markdown_file(session, project_id, file_name)

        if mode == "create":
            default_title = normalize_deliverable_title(content=content, file_type="md")
            created = create_project_document_record(
                session,
                project_id,
                name=file_name or file_name_for_deliverable(default_title, "md"),
                content=content,
                uploads_dir=UPLOADS_DIR,
                init_default_folders=_init_default_folders,
                folder_id=folder_id,
                summary=summary or "Updated from project chat",
                auto_assign_folder=True,
            )
            mark_project_memory_stale(session, project_id, trigger="markdown_tool_create")
            _bust_project_cache(project_id)
            return {
                "ok": True,
                "action": "created",
                "id": created.id,
                "project_file_id": created.id,
                "name": created.name,
                "file_type": created.file_type,
                "path": created.path,
                "folder_id": created.folder_id,
                "size_bytes": created.size_bytes,
                "message": f"Created {created.name}",
            }

        if project_file is None:
            raise HTTPException(404, "Markdown document not found")

        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents are supported")

        original_content = read_project_document_content(project_file, uploads_dir=UPLOADS_DIR)
        next_content = content
        if mode == "append":
            separator = "\n\n" if original_content and not original_content.endswith("\n") else "\n"
            next_content = f"{original_content}{separator}{content}"

        updated = update_project_document_record(
            session,
            project_id,
            project_file.id,
            uploads_dir=UPLOADS_DIR,
            init_default_folders=_init_default_folders,
            content=next_content,
            name=file_name,
            folder_id=folder_id,
        )
        mark_project_memory_stale(session, project_id, trigger="markdown_tool_update")
        _bust_project_cache(project_id)
        return {
            "ok": True,
            "action": "appended" if mode == "append" else "updated",
            "id": updated["id"],
            "project_file_id": updated["project_file_id"],
            "name": updated["name"],
            "file_type": updated["file_type"],
            "path": updated["path"],
            "size_bytes": updated["size_bytes"],
            "message": f"Updated {updated['name']}",
            "original_content": original_content,
            "new_content": next_content,
        }


READ_MARKDOWN_TOOL_NAME = "read_project_markdown_document"
_READ_MAX_CHARS = 12000


def _read_project_markdown_document_sync(
    *,
    project_id: int,
    action: Literal["list", "read"] | None = None,
    file_id: int | None = None,
    file_name: str | None = None,
    max_chars: int = _READ_MAX_CHARS,
) -> dict:
    if not project_id:
        raise HTTPException(400, "Project id is required")
    if not action:
        action = "read" if file_id is not None or file_name else "list"

    with Session(engine) as session:
        if action == "list":
            files = session.exec(active_project_files_stmt(project_id).where(ProjectFile.file_type == "md")).all()

            folder_names: dict[int, str] = {}
            folder_ids = {f.folder_id for f in files if f.folder_id is not None}
            if folder_ids:
                folders = session.exec(
                    select(ProjectFolder).where(ProjectFolder.id.in_(folder_ids))
                ).all()
                folder_names = {folder.id: folder.name for folder in folders}

            return {
                "ok": True,
                "count": len(files),
                "files": [
                    {
                        "id": f.id,
                        "name": f.name,
                        "folder": folder_names.get(f.folder_id, "") if f.folder_id else "",
                        "summary": f.summary or "",
                        "size_bytes": f.size_bytes,
                    }
                    for f in files
                ],
            }

        # action == "read"
        project_file: ProjectFile | None = None
        if file_id is not None:
            project_file = get_project_document_file_or_404(session, project_id, file_id)
        elif file_name:
            project_file = _find_markdown_file(session, project_id, file_name)

        if project_file is None:
            raise HTTPException(404, "Markdown document not found. Use action='list' to see available files.")

        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents are supported")

        content = read_project_document_content(project_file, uploads_dir=UPLOADS_DIR)
        current_hash = content_sha256(content)
        latest_version = latest_project_file_version(session, project_file.id)
        read_max_chars = max(1000, min(max_chars or _READ_MAX_CHARS, 60000))
        truncated = len(content) > read_max_chars
        if truncated:
            content = content[:read_max_chars]

        return {
            "ok": True,
            "id": project_file.id,
            "name": project_file.name,
            "size_bytes": project_file.size_bytes,
            "truncated": truncated,
            "max_chars": read_max_chars,
            "content_sha256": current_hash,
            "version_id": latest_version.id if latest_version and latest_version.content_hash == current_hash else None,
            "version_number": (
                latest_version.version_number if latest_version and latest_version.content_hash == current_hash else None
            ),
            "snapshot_in_sync": bool(latest_version and latest_version.content_hash == current_hash),
            "content": content,
        }


@registry.register(
    name=READ_MARKDOWN_TOOL_NAME,
    description=tool_description(
        READ_MARKDOWN_TOOL_NAME,
        "List or read Markdown documents in the current project. "
        "Call with action='list' to see all available MD files (returns id, name, folder, summary). "
        "Call with action='read' and a file_id or file_name to read the full content of a specific file. "
        "Use this for read-only file questions or before an explicitly requested edit."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "read"],
                "description": "list returns the file index; read returns the content of a specific file.",
            },
            "file_id": {
                "type": "integer",
                "description": "File id to read. Prefer this when the id is known.",
            },
            "file_name": {
                "type": "string",
                "description": "File name to read, e.g. project-summary.md. Used when file_id is unknown.",
            },
            "max_chars": {
                "type": "integer",
                "description": "Maximum characters returned for read. Default 12000.",
            },
        },
        "required": [],
    },
)
async def read_project_markdown_document(
    *,
    project_id: int,
    action: Literal["list", "read"] | None = None,
    file_id: int | None = None,
    file_name: str | None = None,
    max_chars: int = _READ_MAX_CHARS,
) -> dict:
    """Read Markdown off the event loop for safe parallel tool batches."""

    return await asyncio.to_thread(
        _read_project_markdown_document_sync,
        project_id=project_id,
        action=action,
        file_id=file_id,
        file_name=file_name,
        max_chars=max_chars,
    )
