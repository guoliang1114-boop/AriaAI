"""Projects sub-router: files, documents, folders."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

# UPLOADS_DIR imported below via projects_deps
from app.routers.projects_deps import get_session
from app.models.db import Conversation, Message, Project, ProjectFile, ProjectFileVersion
from app.routers.projects_deps import (
    UPLOADS_DIR,
    _bust_project,
    _refresh_instance,
    _mark_project_memory_stale,
    _extract_file_text,
    _auto_summarize_file,
    SaveConversationMarkdownRequest,
    SaveMessageToDocumentRequest,
    ConfirmMarkdownSaveRequest,
    ProjectDocumentCreate,
    ProjectDocumentUpdate,
    FolderCreate,
)
from app.services.chat_exports import build_markdown_export_content
from app.services.project_core import (
    get_project_or_404,
    init_default_project_folders,
)
from app.services.project_documents import (
    build_markdown_export_header,
    build_timestamped_markdown_filename,
    create_markdown_project_file,
    create_project_document_record,
    get_project_document_file_or_404,
    get_project_document_payload,
    ensure_markdown_filename,
    resolve_project_folder,
    update_project_document_record,
    write_project_markdown_file,
)
from app.services.project_files import (
    archive_project_file,
    create_project_upload,
    get_project_file_or_404 as get_uploaded_project_file_or_404,
    list_archived_project_files,
    list_project_files,
    resolve_project_file_path,
    restore_project_file,
)
from app.services.project_file_versions import (
    create_project_file_version_snapshot,
    ensure_initial_project_file_version,
    list_project_file_versions,
)
from app.services.project_folders import (
    create_project_folder,
    delete_project_folder,
    list_project_folders,
)
from app.services.time_utils import utc_now_naive
from app.tools.project_markdown import update_project_markdown_document
from app.routers.projects_deps import get_current_user

logger = logging.getLogger(__name__)

from app.routers.chat_security import maybe_require_project_access

router = APIRouter(
    tags=["projects"],
    # Router-level membership gate: every endpoint here has
    # ``project_id`` in its path, so the dep raises 403 for
    # non-members before the handler runs.
    dependencies=[Depends(maybe_require_project_access)],
)


class ProjectFileListResponse(BaseModel):
    items: list[ProjectFile]
    total: int
    limit: int
    offset: int
    source_counts: dict[str, int]
    recent: list[ProjectFile]


class ProjectFileMoveRequest(BaseModel):
    folder_id: Optional[int] = None


def _project_file_origin(file: ProjectFile) -> str:
    origin = (file.origin or "").lower()
    if "knowledge" in origin or "kb" in origin:
        return "knowledge"
    if "skill" in origin:
        return "skill"
    if "auto" in origin or "memory" in origin or "generated" in origin:
        return "auto"
    return "manual"


# ── Files ─────────────────────────────────────────────────────────────────────

@router.get("/{project_id}/files")
def list_files(project_id: int, session: Session = Depends(get_session)):
    return list_project_files(session, project_id)


@router.get("/{project_id}/files/list", response_model=ProjectFileListResponse)
def list_files_paginated(
    project_id: int,
    origin: str = "all",
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    files = sorted(
        list_project_files(session, project_id),
        key=lambda item: item.uploaded_at,
        reverse=True,
    )
    source_counts = {"manual": 0, "knowledge": 0, "skill": 0, "auto": 0}
    for file in files:
        source_counts[_project_file_origin(file)] += 1
    filtered = files if origin == "all" else [file for file in files if _project_file_origin(file) == origin]
    return ProjectFileListResponse(
        items=filtered[offset : offset + limit],
        total=len(filtered),
        limit=limit,
        offset=offset,
        source_counts=source_counts,
        recent=files[:3],
    )


@router.get("/{project_id}/files/trash")
def list_trashed_files(project_id: int, session: Session = Depends(get_session)):
    return list_archived_project_files(session, project_id)


@router.post("/{project_id}/files/{file_id}/restore")
def restore_file(project_id: int, file_id: int, session: Session = Depends(get_session)):
    restored = restore_project_file(session, project_id, file_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, restored)


@router.post("/{project_id}/documents", status_code=201)
def create_project_document(
    project_id: int,
    data: ProjectDocumentCreate,
    session: Session = Depends(get_session),
):
    project_file = create_project_document_record(
        session=session,
        project_id=project_id,
        folder_id=data.folder_id,
        name=data.name,
        content=data.content,
        uploads_dir=UPLOADS_DIR,
        init_default_folders=init_default_project_folders,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, project_file)


@router.get("/{project_id}/documents/{file_id}")
def get_project_document(project_id: int, file_id: int, session: Session = Depends(get_session)):
    return get_project_document_payload(session, project_id, file_id, uploads_dir=UPLOADS_DIR)


@router.patch("/{project_id}/documents/{file_id}")
def update_project_document(
    project_id: int,
    file_id: int,
    data: ProjectDocumentUpdate,
    session: Session = Depends(get_session),
):
    result = update_project_document_record(
        session,
        project_id,
        file_id,
        uploads_dir=UPLOADS_DIR,
        init_default_folders=init_default_project_folders,
        content=data.content,
        name=data.name,
        folder_id=data.folder_id,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, result)


@router.post("/{project_id}/conversations/{conv_id}/save-markdown", status_code=201)
def save_conversation_markdown(
    project_id: int,
    conv_id: int,
    data: SaveConversationMarkdownRequest,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    conv = session.get(Conversation, conv_id)
    if not conv or conv.project_id != project_id:
        raise HTTPException(404, "Conversation not found")

    messages = session.exec(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at)
    ).all()
    if not messages:
        raise HTTPException(400, "Conversation has no messages")

    markdown_content = build_markdown_export_content(conv, messages)

    if data.action == "merge":
        if not data.file_id:
            raise HTTPException(400, "file_id is required for merge action")
        project_file = get_project_document_file_or_404(session, project_id, data.file_id)
        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents can be merged")

        full_path = UPLOADS_DIR / project_file.path
        if not full_path.is_file():
            raise HTTPException(404, "File not found on disk")

        existing_content = full_path.read_text(encoding="utf-8", errors="replace")
        ensure_initial_project_file_version(
            session,
            project_file,
            existing_content,
            change_source="before_conversation_markdown_merge",
        )
        project_file.size_bytes = write_project_markdown_file(
            project_file,
            build_markdown_export_header() + markdown_content,
            uploads_dir=UPLOADS_DIR,
            append=True,
        )
        session.add(project_file)
        session.commit()
        session.refresh(project_file)
        merged_content = (UPLOADS_DIR / project_file.path).read_text(encoding="utf-8", errors="replace")
        create_project_file_version_snapshot(
            session,
            project_file,
            merged_content,
            change_source="conversation_markdown_merge",
        )
        session.commit()
        _mark_project_memory_stale(session, project_id)
        _bust_project(project_id)
        return {
            "ok": True,
            "action": "merge",
            "id": project_file.id,
            "name": project_file.name,
            "folder_id": project_file.folder_id,
            "size_bytes": project_file.size_bytes,
        }

    # action == "new"
    target_folder = (
        resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_project_folders,
            preferred_folder_id=data.folder_id,
        )
        if data.folder_id is not None
        else None
    )
    filename = build_timestamped_markdown_filename(data.file_name or conv.title or "conversation")

    new_file = create_markdown_project_file(
        session=session,
        project_id=project_id,
        folder_id=target_folder.id if target_folder else None,
        name=filename,
        content=markdown_content,
        uploads_dir=UPLOADS_DIR,
        summary=f"Saved from conversation: {conv.title or 'Untitled Conversation'}",
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {
        "ok": True,
        "action": "new",
        "id": new_file.id,
        "name": new_file.name,
        "folder_id": new_file.folder_id,
        "size_bytes": new_file.size_bytes,
    }


@router.post("/{project_id}/messages/{message_id}/save-to-document", status_code=201)
def save_message_to_document(
    project_id: int,
    message_id: int,
    data: SaveMessageToDocumentRequest,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    message = session.get(Message, message_id)
    if not message:
        raise HTTPException(404, "Message not found")

    conv = session.get(Conversation, message.conversation_id)
    if not conv or conv.project_id != project_id:
        raise HTTPException(404, "Message does not belong to this project")

    content_block = build_markdown_export_header() + message.content if data.prepend_header else message.content

    if data.action == "merge":
        if not data.file_id:
            raise HTTPException(400, "file_id is required for merge action")
        project_file = get_project_document_file_or_404(session, project_id, data.file_id)
        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents can be merged")

        full_path = UPLOADS_DIR / project_file.path
        if not full_path.exists():
            raise HTTPException(404, "File not found on disk")

        existing_content = full_path.read_text(encoding="utf-8", errors="replace")
        ensure_initial_project_file_version(
            session,
            project_file,
            existing_content,
            change_source="before_message_markdown_merge",
        )
        project_file.size_bytes = write_project_markdown_file(
            project_file,
            content_block,
            uploads_dir=UPLOADS_DIR,
            append=True,
        )
        session.add(project_file)
        session.commit()
        session.refresh(project_file)
        merged_content = (UPLOADS_DIR / project_file.path).read_text(encoding="utf-8", errors="replace")
        create_project_file_version_snapshot(
            session,
            project_file,
            merged_content,
            change_source="message_markdown_merge",
        )
        session.commit()
        _mark_project_memory_stale(session, project_id)
        _bust_project(project_id)
        return {
            "ok": True,
            "action": "merge",
            "id": project_file.id,
            "name": project_file.name,
            "size_bytes": project_file.size_bytes,
        }

    # action == "new"
    target_folder = (
        resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_project_folders,
            preferred_folder_id=data.folder_id,
        )
        if data.folder_id is not None
        else None
    )
    base_name = ensure_markdown_filename(
        data.file_name or f"message_{utc_now_naive().strftime('%Y%m%d_%H%M%S')}"
    )

    new_file = create_markdown_project_file(
        session=session,
        project_id=project_id,
        folder_id=target_folder.id if target_folder else None,
        name=base_name,
        content=message.content,
        uploads_dir=UPLOADS_DIR,
        summary=f"Saved from conversation: {conv.title or 'Untitled Conversation'}",
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {
        "ok": True,
        "action": "new",
        "id": new_file.id,
        "name": new_file.name,
        "folder_id": new_file.folder_id,
        "size_bytes": new_file.size_bytes,
    }


@router.post("/{project_id}/messages/{message_id}/confirm-markdown-save", status_code=201)
async def confirm_message_markdown_save(
    project_id: int,
    message_id: int,
    data: ConfirmMarkdownSaveRequest,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    message = session.get(Message, message_id)
    if not message:
        raise HTTPException(404, "Message not found")

    conv = session.get(Conversation, message.conversation_id)
    if not conv or conv.project_id != project_id:
        raise HTTPException(404, "Message does not belong to this project")

    try:
        metadata = json.loads(message.metadata_json or "{}")
        if not isinstance(metadata, dict):
            metadata = {}
    except json.JSONDecodeError:
        metadata = {}

    pending = metadata.get("pending_markdown_saves") or []
    if not isinstance(pending, list) or data.pending_index < 0 or data.pending_index >= len(pending):
        raise HTTPException(404, "Pending markdown save not found")

    item = pending[data.pending_index]
    if not isinstance(item, dict):
        raise HTTPException(400, "Invalid pending markdown save")
    if item.get("saved"):
        raise HTTPException(400, "Markdown save already confirmed")

    result = await update_project_markdown_document(
        project_id=project_id,
        mode=item.get("mode") or "append",
        content=item.get("content") or message.content,
        file_id=item.get("file_id"),
        file_name=item.get("file_name"),
        summary=item.get("summary"),
        folder_id=item.get("folder_id"),
    )

    item["saved"] = True
    item["saved_result"] = result
    pending[data.pending_index] = item
    metadata["pending_markdown_saves"] = pending
    message.metadata_json = json.dumps(metadata, ensure_ascii=False, default=str)
    session.add(message)
    session.commit()

    return result


@router.get("/{project_id}/files/{file_id}/versions")
def list_file_versions(project_id: int, file_id: int, session: Session = Depends(get_session)):
    project_file = get_project_document_file_or_404(session, project_id, file_id)
    versions = list_project_file_versions(session, project_id=project_id, project_file_id=project_file.id)
    return {
        "file_id": project_file.id,
        "name": project_file.name,
        "versions": [
            {
                "id": version.id,
                "version_number": version.version_number,
                "name": version.name,
                "file_type": version.file_type,
                "size_bytes": version.size_bytes,
                "content_hash": version.content_hash,
                "change_source": version.change_source,
                "message_id": version.message_id,
                "created_at": version.created_at,
            }
            for version in versions
        ],
    }


@router.patch("/{project_id}/files/{file_id}/folder")
def move_project_file(
    project_id: int,
    file_id: int,
    data: ProjectFileMoveRequest,
    session: Session = Depends(get_session),
):
    project_file = get_uploaded_project_file_or_404(session, project_id, file_id)
    if data.folder_id is None:
        project_file.folder_id = None
    else:
        folder = resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_project_folders,
            preferred_folder_id=data.folder_id,
        )
        project_file.folder_id = folder.id if folder else None
    session.add(project_file)
    session.commit()
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, project_file)


@router.post("/{project_id}/files/{file_id}/versions/{version_id}/restore")
def restore_file_version(project_id: int, file_id: int, version_id: int, session: Session = Depends(get_session)):
    project_file = get_project_document_file_or_404(session, project_id, file_id)
    version = session.get(ProjectFileVersion, version_id)
    if not version or version.project_id != project_id or version.project_file_id != file_id:
        raise HTTPException(404, "Version not found")
    result = update_project_document_record(
        session,
        project_id,
        project_file.id,
        uploads_dir=UPLOADS_DIR,
        init_default_folders=init_default_project_folders,
        content=version.content_snapshot,
        name=version.name,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True, "restored_version_id": version_id, "file": result}


@router.post("/{project_id}/files", status_code=201)
async def upload_file(
    project_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    folder_id: Optional[int] = Form(None),
    session: Session = Depends(get_session),
):
    pf, dest_file, file_type = create_project_upload(
        session,
        project_id,
        upload=file,
        uploads_dir=UPLOADS_DIR,
        folder_id=folder_id,
    )

    # Auto-generate file summary and companion markdown in the background
    background_tasks.add_task(
        _auto_summarize_file, pf.id, str(dest_file), file_type, project_id, folder_id
    )

    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, pf)


@router.delete("/{project_id}/files/{file_id}")
def delete_file(project_id: int, file_id: int, session: Session = Depends(get_session)):
    archive_project_file(session, project_id, file_id, reason="Manual project file delete")
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True, "archived": True}


@router.get("/{project_id}/files/{file_id}/download")
def download_file(project_id: int, file_id: int, session: Session = Depends(get_session)):
    """Download a project file."""
    pf = get_uploaded_project_file_or_404(session, project_id, file_id)
    full_path = resolve_project_file_path(pf, UPLOADS_DIR)

    return FileResponse(
        path=str(full_path),
        filename=pf.name,
        media_type="application/octet-stream"
    )


# ── Folders ───────────────────────────────────────────────────────────────────

@router.get("/{project_id}/folders")
def list_folders(project_id: int, session: Session = Depends(get_session)):
    return list_project_folders(session, project_id, init_default_folders=init_default_project_folders)


@router.post("/{project_id}/folders", status_code=201)
def create_folder(project_id: int, data: FolderCreate, session: Session = Depends(get_session)):
    folder = create_project_folder(
        session,
        project_id,
        name=data.name,
        sort_order=data.sort_order,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, folder)


@router.delete("/{project_id}/folders/{folder_id}")
def delete_folder(project_id: int, folder_id: int, session: Session = Depends(get_session)):
    delete_project_folder(session, project_id, folder_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}
