"""Projects router — CRUD for projects, milestones, file uploads."""
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

import json
from app.config import UPLOADS_DIR
from app.database import get_session
from app.models.db import Conversation, Message, Project, Milestone, ProjectFile, ProjectFolder, ProjectPayment, ProjectTodo, ProjectMember, User
from app.services import claude as _claude_svc, openai_compat as _kimi_svc
from app.models.db import Setting as _Setting
from app.services.cache import projects_cache
from app.services.chat_exports import build_markdown_export_content
from app.services.document_text import extract_text_from_file
from app.services.project_ai import (
    build_project_ai_suggest_messages,
    parse_project_ai_suggestions,
    summarize_uploaded_project_file,
)
from app.services.project_core import (
    create_project_record,
    get_project_or_404,
    init_default_project_folders,
    list_projects_basic,
    update_project_record,
)
from app.services.project_contexts import (
    build_project_context_data,
    build_project_context_prompt,
    build_project_memory_data,
    build_project_memory_prompt,
    build_project_memory_view_prompt,
    build_project_summary_from_memory_prompt,
    get_project_memory_payload,
    mark_project_memory_stale,
    parse_project_memory,
    save_project_memory,
    save_project_context_summary,
    stream_llm_text_chunks,
)
from app.services.project_deletion import delete_project_cascade
from app.services.project_details import build_project_detail
from app.services.project_documents import (
    build_markdown_export_header,
    build_timestamped_markdown_filename,
    create_markdown_project_file,
    create_project_document_record,
    get_project_document_file_or_404,
    get_project_document_payload,
    ensure_markdown_filename,
    init_presales_template_documents,
    resolve_project_folder,
    update_project_document_record,
    write_project_markdown_file,
)
from app.services.project_financials import (
    add_project_payment,
    delete_project_payment,
    get_project_financials,
    list_project_payments,
    serialize_financials,
)
from app.services.project_files import (
    create_project_upload,
    delete_project_file,
    get_project_file_or_404 as get_uploaded_project_file_or_404,
    list_project_files,
    resolve_project_file_path,
)
from app.services.project_folders import (
    create_project_folder,
    delete_project_folder,
    list_project_folders,
)
from app.services.project_members import (
    add_project_member,
    list_project_members,
    remove_project_member,
    serialize_member,
)
from app.services.project_milestones import (
    create_project_milestone,
    delete_project_milestone,
    list_project_milestones,
    update_project_milestone,
)
from app.services.project_notes import build_project_note_polish_messages, save_project_notes
from app.services.project_llm import complete_with_selected_model, stream_with_selected_model
from app.services.project_todos import (
    create_project_todo,
    delete_project_todo,
    ensure_project_exists,
    list_project_todos,
    list_user_pending_todos,
    serialize_todo,
    update_project_todo,
)
from app.routers.auth import get_current_user

_PROJECTS_TTL = 120.0


def _bust_project(project_id: int) -> None:
    """Invalidate all caches that reference this project."""
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")


def _mark_project_memory_stale(session: Session, project_id: int) -> None:
    mark_project_memory_stale(session, project_id)


async def _rebuild_project_memory(
    session: Session,
    project_id: int,
    project: Optional[Project] = None,
) -> dict:
    project = project or get_project_or_404(session, project_id)
    _, project_memory_data = build_project_memory_data(session, project_id)
    raw_memory = await complete_with_selected_model(
        messages=[{"role": "user", "content": build_project_memory_prompt(project_memory_data)}],
        max_tokens=2200,
    )
    parsed_memory = parse_project_memory(raw_memory, project)
    return save_project_memory(session, project_id, parsed_memory)


async def _ensure_project_memory(
    session: Session,
    project_id: int,
    project: Optional[Project] = None,
) -> tuple[Project, dict]:
    project = project or get_project_or_404(session, project_id)
    memory_payload = get_project_memory_payload(project)
    if project.memory_stale or project.memory_version == 0:
        memory_payload = await _rebuild_project_memory(session, project_id, project)
        project = get_project_or_404(session, project_id)
    return project, memory_payload


# Shared file text extraction


def _extract_file_text(path: Path, file_type: str, max_chars: int = 4000) -> str:
    return extract_text_from_file(path, file_type, max_chars=max_chars)

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    client: str
    description: str = ""
    status: str = "lead"
    contract_amount: float = 0.0
    notes: str = ""
    md_notes: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    client: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    context_freshness: Optional[float] = None
    contract_amount: Optional[float] = None
    context_summary: Optional[str] = None
    notes: Optional[str] = None
    md_notes: Optional[str] = None


class TodoCreate(BaseModel):
    content: str
    is_done: bool = False
    due_date: Optional[str] = None
    assigned_to_user_id: Optional[int] = None


class TodoUpdate(BaseModel):
    content: Optional[str] = None
    is_done: Optional[bool] = None
    due_date: Optional[str] = None
    assigned_to_user_id: Optional[int] = None


class NoteBody(BaseModel):
    content: str
    append: bool = True   # True = append to existing notes; False = overwrite


class NotePolishBody(BaseModel):
    draft: str


class MemberCreate(BaseModel):
    user_id: int


class MemberUserOut(BaseModel):
    id: int
    display_name: str


class MemberOut(BaseModel):
    id: int
    project_id: int
    user_id: int
    user: MemberUserOut
    created_at: datetime


class PaymentCreate(BaseModel):
    amount: float
    payment_date: str               # YYYY-MM-DD
    note: str = ""
    payment_type: str = "received"  # received | expense | milestone_payment


class MilestoneCreate(BaseModel):
    title: str
    priority: str = "medium"
    due_date: Optional[str] = None


class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    is_done: Optional[bool] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None


class FolderCreate(BaseModel):
    name: str
    sort_order: int = 0


class SaveConversationMarkdownRequest(BaseModel):
    action: str = "new"  # merge | new
    folder_id: Optional[int] = None
    file_id: Optional[int] = None
    file_name: Optional[str] = None


class SaveMessageToDocumentRequest(BaseModel):
    action: str  # merge | new
    file_id: Optional[int] = None
    file_name: Optional[str] = None
    folder_id: Optional[int] = None
    prepend_header: bool = True


class ProjectDocumentCreate(BaseModel):
    folder_id: Optional[int] = None
    name: str
    content: str = ""


class ProjectDocumentUpdate(BaseModel):
    content: Optional[str] = None
    name: Optional[str] = None
    folder_id: Optional[int] = None


class InitPresalesTemplateRequest(BaseModel):
    overwrite: bool = False


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("")
def list_projects(
    status: Optional[str] = None,
    member_user_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    cache_key = f"list:{status or ''}:member:{member_user_id or ''}"
    cached = projects_cache.get(cache_key)
    if cached is not None:
        return cached
    result = list_projects_basic(session, status=status, member_user_id=member_user_id)
    projects_cache.set(cache_key, result, _PROJECTS_TTL)
    return result


@router.post("", status_code=201)
def create_project(data: ProjectCreate, session: Session = Depends(get_session)):
    project = create_project_record(session, data.model_dump())
    projects_cache.delete_prefix("list:")   # no detail key yet — project just created
    return project


@router.get("/{project_id}")
def get_project(project_id: int, session: Session = Depends(get_session)):
    return get_project_or_404(session, project_id)


@router.get("/{project_id}/detail")
def get_project_detail(project_id: int, session: Session = Depends(get_session)):
    """Single-request combined endpoint: project + files + milestones + folders + financials.

    Reduces 4-5 round trips to Supabase down to 1 HTTP call with 5 fast local queries.
    """
    cache_key = f"detail:{project_id}"
    cached = projects_cache.get(cache_key)
    if cached is not None:
        return cached

    result = build_project_detail(session, project_id, init_default_folders=init_default_project_folders)
    projects_cache.set(cache_key, result, _PROJECTS_TTL)
    return result


@router.patch("/{project_id}")
def update_project(project_id: int, data: ProjectUpdate, session: Session = Depends(get_session)):
    project = update_project_record(session, project_id, data.model_dump(exclude_none=True))
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, session: Session = Depends(get_session)):
    delete_project_cascade(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── Milestones ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/milestones")
def list_milestones(project_id: int, session: Session = Depends(get_session)):
    return list_project_milestones(session, project_id)


@router.post("/{project_id}/milestones", status_code=201)
def create_milestone(project_id: int, data: MilestoneCreate, session: Session = Depends(get_session)):
    ms = create_project_milestone(
        session,
        project_id,
        title=data.title,
        priority=data.priority,
        due_date=data.due_date,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return ms


@router.patch("/{project_id}/milestones/{ms_id}")
def update_milestone(project_id: int, ms_id: int, data: MilestoneUpdate, session: Session = Depends(get_session)):
    ms = update_project_milestone(session, project_id, ms_id, data.model_dump(exclude_none=True))
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return ms


@router.delete("/{project_id}/milestones/{ms_id}")
def delete_milestone(project_id: int, ms_id: int, session: Session = Depends(get_session)):
    delete_project_milestone(session, project_id, ms_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── Files ─────────────────────────────────────────────────────────────────────

@router.get("/{project_id}/files")
def list_files(project_id: int, session: Session = Depends(get_session)):
    return list_project_files(session, project_id)


@router.post("/{project_id}/notes/templates/presales", status_code=201)
def init_presales_notes_template(
    project_id: int,
    body: InitPresalesTemplateRequest,
    session: Session = Depends(get_session),
):
    result = init_presales_template_documents(
        session,
        project_id,
        uploads_dir=UPLOADS_DIR,
        overwrite=body.overwrite,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return result


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
    return project_file


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
    return result


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
        if not full_path.exists():
            raise HTTPException(404, "File not found on disk")

        project_file.size_bytes = write_project_markdown_file(
            project_file,
            build_markdown_export_header() + markdown_content,
            uploads_dir=UPLOADS_DIR,
            append=True,
        )
        session.add(project_file)
        session.commit()
        session.refresh(project_file)
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

        project_file.size_bytes = write_project_markdown_file(
            project_file,
            content_block,
            uploads_dir=UPLOADS_DIR,
            append=True,
        )
        session.add(project_file)
        session.commit()
        session.refresh(project_file)
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
        data.file_name or f"message_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
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

    # Auto-generate file summary in the background
    background_tasks.add_task(_auto_summarize_file, pf.id, str(dest_file), file_type)

    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return pf


@router.delete("/{project_id}/files/{file_id}")
def delete_file(project_id: int, file_id: int, session: Session = Depends(get_session)):
    delete_project_file(session, project_id, file_id, uploads_dir=UPLOADS_DIR)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


@router.get("/{project_id}/files/{file_id}/download")
def download_file(project_id: int, file_id: int, session: Session = Depends(get_session)):
    """Download a project file."""
    from fastapi.responses import FileResponse

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
    return folder


@router.delete("/{project_id}/folders/{folder_id}")
def delete_folder(project_id: int, folder_id: int, session: Session = Depends(get_session)):
    delete_project_folder(session, project_id, folder_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── Financials ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/financials")
def get_financials(project_id: int, session: Session = Depends(get_session)):
    return get_project_financials(session, project_id)


@router.post("/{project_id}/financials", status_code=201)
def add_payment(project_id: int, data: PaymentCreate, session: Session = Depends(get_session)):
    payment = add_project_payment(
        session,
        project_id,
        amount=data.amount,
        payment_date=data.payment_date,
        note=data.note,
        payment_type=data.payment_type,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return payment


@router.delete("/{project_id}/financials/{payment_id}")
def delete_payment(project_id: int, payment_id: int, session: Session = Depends(get_session)):
    delete_project_payment(session, project_id, payment_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── AI Suggest ────────────────────────────────────────────────────────────────

class ProjectAISuggestQuery(BaseModel):
    query: str             # rough idea the user typed
    client_name: str = ""
    client_industry: str = ""


class ProjectAISuggestion(BaseModel):
    name: str
    description: str


class ProjectMemorySummarizeRequest(BaseModel):
    summary_type: str = "overview"
    rebuild_if_stale: bool = True
    stream: bool = False
    language: Optional[str] = None


class ProjectMemoryBatchRebuildRequest(BaseModel):
    project_ids: list[int] = []
    stale_only: bool = False


@router.post("/ai-suggest", response_model=list[ProjectAISuggestion])
async def ai_suggest_project(body: ProjectAISuggestQuery):
    """Ask Claude to propose 1-3 consulting project names + descriptions."""
    try:
        raw = await complete_with_selected_model(
            messages=build_project_ai_suggest_messages(
                body.query,
                client_name=body.client_name,
                client_industry=body.client_industry,
            ),
            max_tokens=4000,
        )
        suggestions = parse_project_ai_suggestions(raw)
        return [ProjectAISuggestion(**s) for s in suggestions[:3]]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {e}")


# ── Background: auto-summarize uploaded file ──────────────────────────────────

async def _auto_summarize_file(file_id: int, file_path: str, file_type: str) -> None:
    """Generate a 2-3 sentence summary for an uploaded project file and persist it."""
    from app.database import engine
    from sqlmodel import Session as _Session

    await summarize_uploaded_project_file(
        file_id,
        file_path=file_path,
        file_type=file_type,
        extract_file_text=_extract_file_text,
        complete=lambda messages, max_tokens: complete_with_selected_model(messages, max_tokens=max_tokens),
        session_factory=lambda: _Session(engine),
    )


# ── Generate project context summary ──────────────────────────────────────────

class ProjectContextGenerateRequest(BaseModel):
    language: Optional[str] = None


@router.post("/{project_id}/generate-context")
async def generate_project_context(
    project_id: int,
    body: Optional[ProjectContextGenerateRequest] = None,
    session: Session = Depends(get_session),
):
    """Generate overview summary from structured project memory, rebuilding memory when stale."""
    project, memory_payload = await _ensure_project_memory(session, project_id)

    messages = [
        {
            "role": "user",
            "content": build_project_summary_from_memory_prompt(
                memory_payload,
                project.name,
                body.language if body else None,
            ),
        }
    ]

    async def event_stream():
        accumulated: list[str] = []
        try:
            async for chunk in stream_llm_text_chunks(stream_with_selected_model(messages, max_tokens=1400)):
                accumulated.append(chunk)
                yield f"data: {json.dumps({'type': 'text', 'content': chunk}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        summary = "".join(accumulated).strip()

        # Save to DB with a fresh session
        from app.database import engine as _engine
        from sqlmodel import Session as _S
        with _S(_engine) as write_session:
            save_project_context_summary(write_session, project_id, summary)
            _bust_project(project_id)

        yield f"data: {json.dumps({'type': 'done', 'context_summary': summary}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{project_id}/memory")
def get_project_memory(project_id: int, session: Session = Depends(get_session)):
    project = get_project_or_404(session, project_id)
    return {
        "project_id": project_id,
        "memory": get_project_memory_payload(project),
        "memory_version": project.memory_version,
        "memory_stale": project.memory_stale,
        "memory_updated_at": project.memory_updated_at,
    }


@router.get("/{project_id}/memory/status")
def get_project_memory_status(project_id: int, session: Session = Depends(get_session)):
    project = get_project_or_404(session, project_id)
    return {
        "project_id": project_id,
        "has_memory": (project.memory_version or 0) > 0,
        "memory_version": project.memory_version,
        "memory_stale": project.memory_stale,
        "memory_updated_at": project.memory_updated_at,
    }


@router.post("/memory/rebuild-batch")
async def rebuild_project_memory_batch(
    body: ProjectMemoryBatchRebuildRequest,
    session: Session = Depends(get_session),
):
    requested_ids = [int(project_id) for project_id in body.project_ids if int(project_id) > 0]
    if requested_ids:
        candidate_projects = session.exec(
            select(Project).where(Project.id.in_(requested_ids))
        ).all()
        project_lookup = {project.id: project for project in candidate_projects}
        projects_to_process = [project_lookup[project_id] for project_id in requested_ids if project_id in project_lookup]
    elif body.stale_only:
        projects_to_process = session.exec(
            select(Project).where(Project.memory_stale == True)
        ).all()
    else:
        projects_to_process = []

    rebuilt: list[dict] = []
    skipped: list[dict] = []
    for project in projects_to_process:
        if body.stale_only and not project.memory_stale:
            skipped.append(
                {
                    "project_id": project.id,
                    "reason": "not_stale",
                }
            )
            continue

        saved_memory = await _rebuild_project_memory(session, project.id, project)
        _bust_project(project.id)
        rebuilt.append(
            {
                "project_id": project.id,
                "memory": saved_memory,
                "memory_version": saved_memory.get("memory_version", 0),
                "memory_updated_at": saved_memory.get("last_updated_at", ""),
                "memory_stale": False,
            }
        )

    return {
        "ok": True,
        "requested_count": len(requested_ids) if requested_ids else len(projects_to_process),
        "rebuilt_count": len(rebuilt),
        "rebuilt": rebuilt,
        "skipped": skipped,
    }


@router.post("/{project_id}/memory/rebuild")
async def rebuild_project_memory(project_id: int, session: Session = Depends(get_session)):
    saved_memory = await _rebuild_project_memory(session, project_id)
    _bust_project(project_id)
    return {
        "ok": True,
        "project_id": project_id,
        "memory": saved_memory,
        "memory_version": saved_memory.get("memory_version", 0),
        "memory_updated_at": saved_memory.get("last_updated_at", ""),
    }


@router.post("/{project_id}/memory/summarize")
async def summarize_project_memory(
    project_id: int,
    body: ProjectMemorySummarizeRequest,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    if body.rebuild_if_stale:
        project, memory_payload = await _ensure_project_memory(session, project_id, project)
    else:
        memory_payload = get_project_memory_payload(project)

    summary_type = (body.summary_type or "overview").strip() or "overview"
    prompt = build_project_memory_view_prompt(
        memory_payload,
        project.name,
        summary_type,
        body.language,
    )
    if body.stream:
        async def event_stream():
            accumulated: list[str] = []
            try:
                async for chunk in stream_llm_text_chunks(
                    stream_with_selected_model(
                        [{"role": "user", "content": prompt}],
                        max_tokens=900,
                    )
                ):
                    accumulated.append(chunk)
                    yield f"data: {json.dumps({'type': 'text', 'content': chunk}, ensure_ascii=False)}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                return

            content = "".join(accumulated).strip()
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "done",
                        "project_id": project_id,
                        "summary_type": summary_type,
                        "content": content,
                        "source_memory_version": memory_payload.get("memory_version", 0),
                        "memory_stale": memory_payload.get("stale", False),
                        "generated_at": datetime.utcnow().isoformat(),
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    content = await complete_with_selected_model(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=900,
    )
    return {
        "project_id": project_id,
        "summary_type": summary_type,
        "content": content.strip(),
        "source_memory_version": memory_payload.get("memory_version", 0),
        "memory_stale": memory_payload.get("stale", False),
        "generated_at": datetime.utcnow(),
    }


# ── Project notes (沉淀到项目) ─────────────────────────────────────────────────

@router.post("/{project_id}/notes")
def save_project_note(project_id: int, body: NoteBody, session: Session = Depends(get_session)):
    """Append or overwrite project notes."""
    project = save_project_notes(session, project_id, body.content, append=body.append)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"notes": project.notes}

# ── Project Todos ────────────────────────────────────────────────────────────


@router.get("/{project_id}/todos")
def list_todos(project_id: int, session: Session = Depends(get_session)):
    todos = list_project_todos(session, project_id)
    return [serialize_todo(todo) for todo in todos]


@router.post("/{project_id}/todos", status_code=201)
def create_todo(project_id: int, body: TodoCreate, session: Session = Depends(get_session)):
    todo = create_project_todo(
        session,
        project_id,
        content=body.content,
        is_done=body.is_done,
        due_date=body.due_date,
        assigned_to_user_id=body.assigned_to_user_id,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return serialize_todo(todo)


@router.patch("/{project_id}/todos/{todo_id}")
def update_todo(project_id: int, todo_id: int, body: TodoUpdate, session: Session = Depends(get_session)):
    todo = update_project_todo(session, project_id, todo_id, body.model_dump(exclude_none=True))
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return serialize_todo(todo)


@router.delete("/{project_id}/todos/{todo_id}")
def delete_todo(project_id: int, todo_id: int, session: Session = Depends(get_session)):
    delete_project_todo(session, project_id, todo_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── Project Members ───────────────────────────────────────────────────────────

@router.get("/{project_id}/members", response_model=list[MemberOut])
def list_members(project_id: int, session: Session = Depends(get_session)):
    ensure_project_exists(session, project_id)
    members = list_project_members(session, project_id)
    return [
        MemberOut(**serialize_member(member))
        for member in members
        if member.user
    ]


@router.post("/{project_id}/members", status_code=201, response_model=MemberOut)
def add_member(project_id: int, body: MemberCreate, session: Session = Depends(get_session)):
    ensure_project_exists(session, project_id)
    member, user = add_project_member(session, project_id, body.user_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return MemberOut(
        id=member.id,
        project_id=member.project_id,
        user_id=member.user_id,
        user=MemberUserOut(id=user.id, display_name=user.display_name),
        created_at=member.created_at,
    )


@router.delete("/{project_id}/members/{user_id}")
def remove_member(project_id: int, user_id: int, session: Session = Depends(get_session)):
    remove_project_member(session, project_id, user_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── AI Polish for Project Notes ──────────────────────────────────────────────

@router.post("/{project_id}/notes/ai-polish")
async def ai_polish_project_notes(project_id: int, body: NotePolishBody, session: Session = Depends(get_session)):
    """Use the active LLM to polish a rough draft into structured Markdown project notes."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    messages = build_project_note_polish_messages(project, body.draft)
    result = await complete_with_selected_model(messages, max_tokens=4000)
    return {"result": result}


@router.post("/{project_id}/notes/ai-polish-stream")
async def ai_polish_project_notes_stream(project_id: int, body: NotePolishBody, session: Session = Depends(get_session)):
    """Stream the active LLM polishing a rough draft into structured Markdown project notes."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    messages = build_project_note_polish_messages(project, body.draft)

    async def event_stream():
        try:
            async for chunk in stream_llm_text_chunks(stream_with_selected_model(messages, max_tokens=4000)):
                yield f"data: {json.dumps({'type': 'text', 'content': chunk}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return
        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/todos/my")
def list_my_todos(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Return pending todos assigned to the current user across all projects."""
    return list_user_pending_todos(session, current_user.id)
