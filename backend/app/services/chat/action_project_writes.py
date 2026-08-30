"""Prepare and transactionally persist project writes approved through HITAS.

Long-running document generation is deliberately split in two.  Preparation
may call providers or CPU-heavy Office libraries, but may only create a private
temporary artifact.  The durable project write happens later, while the caller
holds the actor, project, membership, pending-action, and target-file locks.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import tempfile
import uuid
from contextlib import ExitStack, contextmanager
from pathlib import Path
from typing import Any, Iterator

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectFile
from app.services.agent_harness.structured_patch import atomic_write_text, locked_text_path
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_core import init_default_project_folders
from app.services.project_documents import (
    create_project_document_record,
    resolve_project_folder,
    sanitize_markdown_filename,
)
from app.services.project_file_versions import (
    create_project_file_version_snapshot,
    ensure_initial_project_file_version,
)
from app.tools import office_documents, project_markdown


FINAL_AUTH_PROJECT_WRITE_TOOLS = frozenset(
    {
        office_documents.WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
        office_documents.EDIT_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
        project_markdown.PROJECT_MARKDOWN_TOOL_NAME,
    }
)


class _FilesystemCompensation:
    """Undo project-space changes when the surrounding DB transaction fails."""

    def __init__(self) -> None:
        self._created: list[Path] = []
        self._replaced: list[tuple[Path, Path]] = []

    def track_created(self, path: Path) -> None:
        self._created.append(path)

    def backup_existing(self, path: Path) -> None:
        descriptor, backup_name = tempfile.mkstemp(
            prefix=f".{path.name}.aria-hitas-backup-",
            dir=str(path.parent),
        )
        os.close(descriptor)
        backup_path = Path(backup_name)
        try:
            shutil.copy2(path, backup_path)
        except Exception:
            backup_path.unlink(missing_ok=True)
            raise
        self._replaced.append((path, backup_path))

    def rollback(self) -> None:
        errors: list[Exception] = []
        for path in reversed(self._created):
            try:
                path.unlink(missing_ok=True)
            except OSError as exc:
                errors.append(exc)
        for target, backup in reversed(self._replaced):
            try:
                if backup.is_file():
                    os.replace(backup, target)
            except OSError as exc:
                errors.append(exc)
        self._cleanup_backups()
        if errors:
            raise RuntimeError(
                "Project write failed and filesystem compensation was incomplete; manual verification is required"
            ) from errors[0]

    def committed(self) -> None:
        self._cleanup_backups()

    def _cleanup_backups(self) -> None:
        for _, backup in self._replaced:
            try:
                backup.unlink(missing_ok=True)
            except OSError:
                pass


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_generated_source_path(raw_path: object) -> Path:
    path = Path(str(raw_path or ""))
    if not path.is_file():
        raise HTTPException(500, "Prepared project artifact not found")
    try:
        resolved = path.resolve()
        resolved.relative_to(office_documents.UPLOADS_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(400, "Prepared project artifact is outside uploads") from exc
    return resolved


def _replace_binary_file(target: Path, prepared: Path) -> int:
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{target.name}.aria-hitas-",
        dir=str(target.parent),
    )
    os.close(descriptor)
    temp_path = Path(temp_name)
    try:
        shutil.copy2(prepared, temp_path)
        os.replace(temp_path, target)
        return target.stat().st_size
    finally:
        temp_path.unlink(missing_ok=True)


def _prepare_office_edit_sync(bind, tool_input: dict[str, Any]) -> dict[str, Any]:
    try:
        project_id = int(tool_input.get("project_id"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Project id is required") from exc
    edits = tool_input.get("edits")
    if not isinstance(edits, list) or not edits:
        raise HTTPException(400, "edits is required")

    with Session(bind) as session:
        locator = office_documents._find_project_file(  # noqa: SLF001 - same tool boundary
            session,
            project_id,
            tool_input.get("file_id"),
            tool_input.get("file_name"),
        )
        source_path = office_documents._file_path(locator)  # noqa: SLF001
        detected_type = str(
            tool_input.get("file_type")
            or locator.file_type
            or source_path.suffix.lstrip(".")
        ).lower()
        if detected_type not in office_documents.EDITABLE_TYPES:
            raise HTTPException(
                400,
                f"Cannot edit file type '{detected_type}'. Supported: "
                f"{', '.join(sorted(office_documents.EDITABLE_TYPES))}",
            )

        generated_dir = office_documents.UPLOADS_DIR / "generated"
        generated_dir.mkdir(parents=True, exist_ok=True)
        prepared_path = generated_dir / f"hitas_edit_{uuid.uuid4().hex}.{detected_type}"
        try:
            with locked_text_path(source_path):
                source_sha256 = _sha256_file(source_path)
                shutil.copy2(source_path, prepared_path)
            if detected_type == "pptx":
                edit_result = office_documents._edit_pptx(prepared_path, edits)  # noqa: SLF001
            elif detected_type == "docx":
                edit_result = office_documents._edit_docx(prepared_path, edits)  # noqa: SLF001
            else:
                edit_result = office_documents._edit_xlsx(prepared_path, edits)  # noqa: SLF001
            if not edit_result.get("success"):
                raise HTTPException(500, edit_result.get("error") or "Failed to edit document")
        except Exception:
            prepared_path.unlink(missing_ok=True)
            raise

        return {
            "kind": "office_edit",
            "cleanup_source": True,
            "source_path": str(prepared_path),
            "source_project_file_id": int(locator.id),
            "source_project_file_path": locator.path,
            "source_sha256": source_sha256,
            "source_name": locator.name,
            "source_file_type": detected_type,
            "source_folder_id": locator.folder_id,
            "output_name": str(tool_input.get("output_name") or "").strip(),
            "changes": list(edit_result.get("changes") or []),
        }


async def prepare_pending_project_write(
    bind,
    tool_name: str,
    tool_input: dict[str, Any],
) -> dict[str, Any]:
    """Run the non-durable half of a HITAS project write."""

    if tool_name == office_documents.WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME:
        result = await office_documents.write_project_office_document(
            **tool_input,
            persist=False,
        )
        prepared = result.get("_prepared_project_file") if isinstance(result, dict) else None
        if not isinstance(prepared, dict):
            raise HTTPException(500, "Office generator did not return a prepared artifact")
        source_path = _safe_generated_source_path(prepared.get("source_path"))
        return {
            "kind": "office_create",
            "cleanup_source": source_path.parent.resolve() == (office_documents.UPLOADS_DIR / "generated").resolve(),
            **prepared,
            "source_path": str(source_path),
        }
    if tool_name == office_documents.EDIT_PROJECT_OFFICE_DOCUMENT_TOOL_NAME:
        return await asyncio.to_thread(_prepare_office_edit_sync, bind, dict(tool_input))
    if tool_name == project_markdown.PROJECT_MARKDOWN_TOOL_NAME:
        return {
            "kind": "markdown",
            "cleanup_source": False,
            "tool_input": dict(tool_input),
        }
    raise HTTPException(400, f"Tool '{tool_name}' is not a final-authorized project writer")


def cleanup_prepared_project_write(prepared: dict[str, Any] | None) -> None:
    if not isinstance(prepared, dict) or not prepared.get("cleanup_source"):
        return
    try:
        source_path = _safe_generated_source_path(prepared.get("source_path"))
    except HTTPException:
        return
    generated_dir = (office_documents.UPLOADS_DIR / "generated").resolve()
    if source_path.parent.resolve() != generated_dir:
        return
    try:
        source_path.unlink(missing_ok=True)
    except OSError:
        pass


def _project_file_path(project_file: ProjectFile) -> Path:
    return office_documents._file_path(project_file)  # noqa: SLF001


def _lock_project_file(session: Session, project_id: int, file_id: int) -> ProjectFile:
    project_file = session.exec(
        select(ProjectFile)
        .where(
            ProjectFile.id == file_id,
            ProjectFile.project_id == project_id,
            ProjectFile.deleted_at.is_(None),
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if project_file is None:
        raise HTTPException(404, "File not found")
    return project_file


def _persist_office_create(
    session: Session,
    project: Project,
    prepared: dict[str, Any],
    compensation: _FilesystemCompensation,
) -> dict[str, Any]:
    project_file = office_documents.persist_prepared_project_office_document(
        session,
        project_id=int(project.id),
        prepared=prepared,
    )
    compensation.track_created(office_documents.UPLOADS_DIR / project_file.path)
    mark_project_memory_stale(
        session,
        int(project.id),
        trigger=f"{project_file.file_type}_hitas_create",
        commit=False,
    )
    return {
        "success": True,
        "ok": True,
        "id": project_file.id,
        "project_file_id": project_file.id,
        "name": project_file.name,
        "file_type": project_file.file_type,
        "folder_id": project_file.folder_id,
        "size_bytes": project_file.size_bytes,
        "path": project_file.path,
        "message": f"Created {project_file.name}",
    }


def _persist_office_edit(
    session: Session,
    project: Project,
    prepared: dict[str, Any],
    compensation: _FilesystemCompensation,
    locks: ExitStack,
) -> dict[str, Any]:
    project_id = int(project.id)
    project_file = _lock_project_file(
        session,
        project_id,
        int(prepared.get("source_project_file_id")),
    )
    if (
        project_file.path != prepared.get("source_project_file_path")
        or project_file.name != prepared.get("source_name")
        or str(project_file.file_type or "").lower() != str(prepared.get("source_file_type") or "").lower()
    ):
        raise HTTPException(409, "Office source changed during preparation; read and retry")
    source_path = _project_file_path(project_file)
    locks.enter_context(locked_text_path(source_path))
    if _sha256_file(source_path) != prepared.get("source_sha256"):
        raise HTTPException(409, "Office source content changed during preparation; read and retry")
    edited_path = _safe_generated_source_path(prepared.get("source_path"))
    output_name = str(prepared.get("output_name") or "").strip()
    changes = [str(item) for item in prepared.get("changes") or []]

    if output_name:
        target = office_documents._register_generated_project_file(  # noqa: SLF001
            session,
            project_id,
            source_path=edited_path,
            file_name=output_name,
            file_type=str(prepared.get("source_file_type") or project_file.file_type),
            folder_id=project_file.folder_id,
            summary=f"Edited copy of {project_file.name}",
            preview_text=f"Edited: {', '.join(changes)}",
            commit=False,
        )
        compensation.track_created(office_documents.UPLOADS_DIR / target.path)
        result = {
            "success": True,
            "ok": True,
            "id": target.id,
            "project_file_id": target.id,
            "name": target.name,
            "file_type": target.file_type,
            "path": target.path,
            "folder_id": target.folder_id,
            "size_bytes": target.size_bytes,
            "changes": changes,
            "message": f"Created edited copy: {target.name}",
        }
    else:
        compensation.backup_existing(source_path)
        project_file.size_bytes = _replace_binary_file(source_path, edited_path)
        project_file.summary = ""
        session.add(project_file)
        result = {
            "success": True,
            "ok": True,
            "id": project_file.id,
            "project_file_id": project_file.id,
            "name": project_file.name,
            "file_type": project_file.file_type,
            "path": project_file.path,
            "folder_id": project_file.folder_id,
            "size_bytes": project_file.size_bytes,
            "changes": changes,
            "message": f"Edited {project_file.name}",
        }

    mark_project_memory_stale(
        session,
        project_id,
        trigger=f"{project_file.file_type}_hitas_edit",
        commit=False,
    )
    return result


def _lock_markdown_target(
    session: Session,
    project_id: int,
    *,
    file_id: object,
    file_name: object,
) -> ProjectFile | None:
    locator: ProjectFile | None = None
    try:
        target_id = int(file_id) if file_id is not None else None
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Invalid file id") from exc
    if target_id is not None:
        return _lock_project_file(session, project_id, target_id)
    if isinstance(file_name, str) and file_name.strip():
        locator = project_markdown._find_markdown_file(session, project_id, file_name)  # noqa: SLF001
    if locator is None:
        return None
    return _lock_project_file(session, project_id, int(locator.id))


def _persist_structured_markdown(
    session: Session,
    project: Project,
    tool_input: dict[str, Any],
    compensation: _FilesystemCompensation,
    locks: ExitStack,
) -> dict[str, Any]:
    project_id = int(project.id)
    try:
        file_id = int(tool_input.get("file_id"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "file_id is required for patch/rollback") from exc
    mode = str(tool_input.get("mode") or "").strip().lower()
    project_file = _lock_project_file(session, project_id, file_id)
    if project_file.file_type.lower() != "md":
        raise HTTPException(400, "Only markdown documents are supported")
    full_path = project_markdown._structured_project_file_path(project_file)  # noqa: SLF001
    locks.enter_context(locked_text_path(full_path))
    plan, rollback_target = project_markdown._structured_action_plan(  # noqa: SLF001
        session,
        project_file,
        mode=mode,
        base_sha256=tool_input.get("base_sha256"),
        patch=tool_input.get("patch"),
        version_id=tool_input.get("version_id"),
    )
    frozen = tool_input.get(project_markdown._PATCH_PREFLIGHT_KEY)  # noqa: SLF001
    if not isinstance(frozen, dict) or (
        frozen.get("schema_version") != 1
        or frozen.get("project_file_id") != project_file.id
        or frozen.get("base_sha256") != plan.base_sha256
        or frozen.get("result_sha256") != plan.result_sha256
        or frozen.get("mode") != mode
    ):
        raise HTTPException(409, "patch_preflight_conflict: frozen preview no longer matches")

    compensation.backup_existing(full_path)
    before_version = create_project_file_version_snapshot(
        session,
        project_file,
        plan.original_content,
        change_source="before_structured_patch",
    )
    project_file.size_bytes = atomic_write_text(full_path, plan.result_content)
    project_file.summary = ""
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
    preview, preview_truncated = project_markdown._bounded_patch_preview(plan.unified_diff)  # noqa: SLF001
    return {
        "success": True,
        "ok": True,
        "action": "rolled_back" if rollback_target else "patched",
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


def _persist_markdown(
    session: Session,
    project: Project,
    prepared: dict[str, Any],
    compensation: _FilesystemCompensation,
    locks: ExitStack,
) -> dict[str, Any]:
    tool_input = dict(prepared.get("tool_input") or {})
    project_id = int(project.id)
    mode, content = project_markdown._normalize_markdown_update_input(  # noqa: SLF001
        mode=tool_input.get("mode"),
        content=tool_input.get("content"),
        extra=tool_input,
    )
    if mode not in {"replace", "append", "create", "patch", "rollback"}:
        raise HTTPException(400, "Markdown update mode is required")
    if mode in project_markdown._STRUCTURED_MODES:  # noqa: SLF001
        result = _persist_structured_markdown(
            session,
            project,
            tool_input,
            compensation,
            locks,
        )
    else:
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(400, "Markdown content is required")
        if mode == "create":
            default_title = project_markdown.normalize_deliverable_title(content=content, file_type="md")
            created = create_project_document_record(
                session,
                project_id,
                name=tool_input.get("file_name")
                or project_markdown.file_name_for_deliverable(default_title, "md"),
                content=content,
                uploads_dir=project_markdown.UPLOADS_DIR,
                init_default_folders=lambda target_session, target_project_id: init_default_project_folders(
                    target_session,
                    target_project_id,
                    commit=False,
                ),
                folder_id=tool_input.get("folder_id"),
                summary=str(tool_input.get("summary") or "Updated from project chat"),
                auto_assign_folder=True,
                commit=False,
            )
            compensation.track_created(project_markdown.UPLOADS_DIR / created.path)
            result = {
                "success": True,
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
        else:
            project_file = _lock_markdown_target(
                session,
                project_id,
                file_id=tool_input.get("file_id"),
                file_name=tool_input.get("file_name"),
            )
            if project_file is None:
                raise HTTPException(404, "Markdown document not found")
            if project_file.file_type.lower() != "md":
                raise HTTPException(400, "Only markdown documents are supported")
            full_path = project_markdown._structured_project_file_path(project_file)  # noqa: SLF001
            locks.enter_context(locked_text_path(full_path))
            original_content = full_path.read_text(encoding="utf-8", errors="replace")
            next_content = content
            if mode == "append":
                separator = "\n\n" if original_content and not original_content.endswith("\n") else "\n"
                next_content = f"{original_content}{separator}{content}"

            if tool_input.get("folder_id") is not None:
                folder = resolve_project_folder(
                    session,
                    project_id,
                    init_default_folders=lambda target_session, target_project_id: init_default_project_folders(
                        target_session,
                        target_project_id,
                        commit=False,
                    ),
                    preferred_folder_id=tool_input.get("folder_id"),
                )
                project_file.folder_id = folder.id if folder else None
            if isinstance(tool_input.get("file_name"), str) and tool_input.get("file_name").strip():
                next_name = sanitize_markdown_filename(tool_input["file_name"])
                project_file.name = next_name if next_name.lower().endswith(".md") else f"{next_name}.md"

            compensation.backup_existing(full_path)
            ensure_initial_project_file_version(
                session,
                project_file,
                original_content,
                change_source="before_document_update",
            )
            project_file.size_bytes = atomic_write_text(full_path, next_content)
            project_file.summary = ""
            session.add(project_file)
            create_project_file_version_snapshot(
                session,
                project_file,
                next_content,
                change_source="document_update",
            )
            result = {
                "success": True,
                "ok": True,
                "action": "appended" if mode == "append" else "updated",
                "id": project_file.id,
                "project_file_id": project_file.id,
                "name": project_file.name,
                "file_type": project_file.file_type,
                "path": project_file.path,
                "folder_id": project_file.folder_id,
                "size_bytes": project_file.size_bytes,
                "message": f"Updated {project_file.name}",
                "original_content": original_content,
                "new_content": next_content,
            }

    mark_project_memory_stale(
        session,
        project_id,
        trigger=f"markdown_hitas_{mode}",
        commit=False,
    )
    return result


@contextmanager
def persist_prepared_project_write(
    session: Session,
    *,
    project: Project,
    tool_name: str,
    prepared: dict[str, Any],
) -> Iterator[dict[str, Any]]:
    """Apply one prepared write while keeping filesystem locks through commit."""

    compensation = _FilesystemCompensation()
    with ExitStack() as locks:
        try:
            if tool_name == office_documents.WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME:
                result = _persist_office_create(session, project, prepared, compensation)
            elif tool_name == office_documents.EDIT_PROJECT_OFFICE_DOCUMENT_TOOL_NAME:
                result = _persist_office_edit(session, project, prepared, compensation, locks)
            elif tool_name == project_markdown.PROJECT_MARKDOWN_TOOL_NAME:
                result = _persist_markdown(session, project, prepared, compensation, locks)
            else:
                raise HTTPException(400, f"Unsupported final-authorized writer: {tool_name}")
            yield result
        except Exception:
            compensation.rollback()
            raise
        else:
            compensation.committed()
            try:
                office_documents._bust_project_cache(int(project.id))  # noqa: SLF001
            except Exception:
                # Cache invalidation is best effort after the durable commit.
                pass
