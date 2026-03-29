"""Projects router — CRUD for projects, milestones, file uploads."""
from __future__ import annotations

import shutil
import uuid
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
from app.models.db import Project, Milestone, ProjectFile, ProjectFolder, ProjectPayment
from app.services import claude as _claude_svc, openai_compat as _kimi_svc
from app.models.db import Setting as _Setting
from app.services.cache import projects_cache

_PROJECTS_TTL = 120.0


def _bust_project(project_id: int) -> None:
    """Invalidate all caches that reference this project."""
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")


async def _complete(messages: list[dict], max_tokens: int = 4000) -> str:
    """Call the active LLM provider using the user's selected model."""
    from app.database import engine
    from sqlmodel import Session as _S
    with _S(engine) as s:
        provider = (s.get(_Setting, "llm_provider") or type("", (), {"value": "claude"})()).value or "claude"
        model_row = s.get(_Setting, "selected_model")
        model = (model_row.value if model_row and model_row.value else None)
    if provider.lower() == "kimi":
        return await _kimi_svc.complete(messages, model=model or "moonshot-v1-32k", max_tokens=max_tokens)
    return await _claude_svc.complete(messages, model=model or "claude-sonnet-4", max_tokens=max_tokens)

async def _stream(messages: list[dict], max_tokens: int = 4000):
    """Stream response chunks from the active LLM provider."""
    from app.database import engine
    from sqlmodel import Session as _S
    with _S(engine) as s:
        provider = (s.get(_Setting, "llm_provider") or type("", (), {"value": "claude"})()).value or "claude"
        model_row = s.get(_Setting, "selected_model")
        model = (model_row.value if model_row and model_row.value else None)
    if provider.lower() == "kimi":
        async for chunk in _kimi_svc.stream_response(messages, model=model or "moonshot-v1-32k", max_tokens=max_tokens):
            yield chunk
    else:
        async for chunk in _claude_svc.stream_response(messages, model=model or "claude-sonnet-4", max_tokens=max_tokens):
            yield chunk


DEFAULT_FOLDER_NAMES = ["项目需求", "方案和报价", "项目交付文档", "项目归档信息"]

# ── Shared file text extraction ────────────────────────────────────────────────

try:
    import pdfplumber as _pdfplumber
    _HAS_PDF = True
except ImportError:
    _HAS_PDF = False

try:
    from docx import Document as _DocxDocument
    _HAS_DOCX = True
except ImportError:
    _HAS_DOCX = False


def _extract_file_text(path: Path, file_type: str, max_chars: int = 4000) -> str:
    """Extract plain text from a project file for AI context injection."""
    if not path.exists():
        return "[File not found]"
    try:
        ft = file_type.lower()
        if ft == "pdf" and _HAS_PDF:
            with _pdfplumber.open(path) as pdf:
                pages = [p.extract_text() or "" for p in pdf.pages[:15]]
            text = "\n".join(pages)
        elif ft == "docx" and _HAS_DOCX:
            doc = _DocxDocument(str(path))
            text = "\n".join(p.text for p in doc.paragraphs)
        elif ft in ("txt", "md", "csv", "json"):
            text = path.read_text(encoding="utf-8", errors="replace")
        else:
            return ""  # Binary — skip auto-summary
        text = text.strip()
        if len(text) > max_chars:
            return text[:max_chars] + "\n…[truncated]"
        return text if text else ""
    except Exception:
        return ""

DEFAULT_FOLDER_NAMES = ["项目需求", "方案和报价", "项目交付文档", "项目归档信息"]


def _init_default_folders(project_id: int, session: Session) -> list[ProjectFolder]:
    """Create the 4 default folders for a project. Safe to call if they already exist."""
    existing = session.exec(
        select(ProjectFolder).where(ProjectFolder.project_id == project_id)
    ).all()
    if existing:
        return existing
    folders = [
        ProjectFolder(project_id=project_id, name=name, sort_order=i)
        for i, name in enumerate(DEFAULT_FOLDER_NAMES)
    ]
    for f in folders:
        session.add(f)
    session.commit()
    for f in folders:
        session.refresh(f)
    return folders

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    client: str
    description: str = ""
    status: str = "lead"


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    client: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    context_freshness: Optional[float] = None
    contract_amount: Optional[float] = None
    context_summary: Optional[str] = None
    notes: Optional[str] = None


class NoteBody(BaseModel):
    content: str
    append: bool = True   # True = append to existing notes; False = overwrite


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


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("")
def list_projects(status: Optional[str] = None, session: Session = Depends(get_session)):
    cache_key = f"list:{status or ''}"
    cached = projects_cache.get(cache_key)
    if cached is not None:
        return cached
    stmt = select(Project).order_by(Project.updated_at.desc())
    if status:
        stmt = stmt.where(Project.status == status)
    result = session.exec(stmt).all()
    projects_cache.set(cache_key, result, _PROJECTS_TTL)
    return result


@router.post("", status_code=201)
def create_project(data: ProjectCreate, session: Session = Depends(get_session)):
    project = Project(**data.model_dump())
    session.add(project)
    session.commit()
    session.refresh(project)
    _init_default_folders(project.id, session)
    projects_cache.delete_prefix("list:")   # no detail key yet — project just created
    return project


@router.get("/{project_id}")
def get_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


@router.get("/{project_id}/detail")
def get_project_detail(project_id: int, session: Session = Depends(get_session)):
    """Single-request combined endpoint: project + files + milestones + folders + financials.

    Reduces 4-5 round trips to Supabase down to 1 HTTP call with 5 fast local queries.
    """
    cache_key = f"detail:{project_id}"
    cached = projects_cache.get(cache_key)
    if cached is not None:
        return cached

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    files = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project_id)
    ).all()
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project_id)
    ).all()
    folders = session.exec(
        select(ProjectFolder)
        .where(ProjectFolder.project_id == project_id)
        .order_by(ProjectFolder.sort_order)
    ).all()
    if not folders:
        folders = _init_default_folders(project_id, session)

    payments = session.exec(
        select(ProjectPayment)
        .where(ProjectPayment.project_id == project_id)
        .order_by(ProjectPayment.payment_date)
    ).all()
    received = sum(p.amount for p in payments if p.payment_type in ("received", "milestone_payment"))
    expenses = sum(abs(p.amount) for p in payments if p.payment_type == "expense")
    invoiced = sum(p.amount for p in payments if p.payment_type == "invoiced")
    contract = project.contract_amount or 0.0

    result = {
        "project": project,
        "files": files,
        "milestones": milestones,
        "folders": folders,
        "financials": {
            "contract_amount": contract,
            "total_received": received,
            "total_expense": expenses,
            "total_invoiced": invoiced,
            "uncollected": invoiced - received,
            "remaining": contract - received,
            "payments": payments,
        },
    }
    projects_cache.set(cache_key, result, _PROJECTS_TTL)
    return result


@router.patch("/{project_id}")
def update_project(project_id: int, data: ProjectUpdate, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(project, k, v)
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    _bust_project(project_id)
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    session.delete(project)
    session.commit()
    _bust_project(project_id)
    return {"ok": True}


# ── Milestones ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/milestones")
def list_milestones(project_id: int, session: Session = Depends(get_session)):
    return session.exec(select(Milestone).where(Milestone.project_id == project_id)).all()


@router.post("/{project_id}/milestones", status_code=201)
def create_milestone(project_id: int, data: MilestoneCreate, session: Session = Depends(get_session)):
    ms = Milestone(project_id=project_id, **data.model_dump())
    session.add(ms)
    session.commit()
    session.refresh(ms)
    _bust_project(project_id)
    return ms


@router.patch("/{project_id}/milestones/{ms_id}")
def update_milestone(project_id: int, ms_id: int, data: MilestoneUpdate, session: Session = Depends(get_session)):
    ms = session.get(Milestone, ms_id)
    if not ms or ms.project_id != project_id:
        raise HTTPException(404, "Milestone not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(ms, k, v)
    session.add(ms)
    session.commit()
    session.refresh(ms)
    _bust_project(project_id)
    return ms


@router.delete("/{project_id}/milestones/{ms_id}")
def delete_milestone(project_id: int, ms_id: int, session: Session = Depends(get_session)):
    ms = session.get(Milestone, ms_id)
    if not ms or ms.project_id != project_id:
        raise HTTPException(404, "Milestone not found")
    session.delete(ms)
    session.commit()
    _bust_project(project_id)
    return {"ok": True}


# ── Files ─────────────────────────────────────────────────────────────────────

@router.get("/{project_id}/files")
def list_files(project_id: int, session: Session = Depends(get_session)):
    return session.exec(select(ProjectFile).where(ProjectFile.project_id == project_id)).all()


@router.post("/{project_id}/files", status_code=201)
async def upload_file(
    project_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    folder_id: Optional[int] = Form(None),
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    suffix = Path(file.filename or "file").suffix.lower()
    dest_name = f"{uuid.uuid4().hex}{suffix}"
    dest_path = UPLOADS_DIR / "projects" / str(project_id)
    dest_path.mkdir(parents=True, exist_ok=True)
    dest_file = dest_path / dest_name

    with dest_file.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    pf = ProjectFile(
        project_id=project_id,
        folder_id=folder_id,
        name=file.filename or dest_name,
        file_type=suffix.lstrip("."),
        path=str(dest_file.relative_to(UPLOADS_DIR)),
        size_bytes=dest_file.stat().st_size,
    )
    session.add(pf)
    session.commit()
    session.refresh(pf)

    # Auto-generate file summary in the background
    background_tasks.add_task(_auto_summarize_file, pf.id, str(dest_file), suffix.lstrip("."))

    _bust_project(project_id)
    return pf


@router.delete("/{project_id}/files/{file_id}")
def delete_file(project_id: int, file_id: int, session: Session = Depends(get_session)):
    pf = session.get(ProjectFile, file_id)
    if not pf or pf.project_id != project_id:
        raise HTTPException(404, "File not found")
    full_path = UPLOADS_DIR / pf.path
    if full_path.exists():
        full_path.unlink()
    session.delete(pf)
    session.commit()
    _bust_project(project_id)
    return {"ok": True}


# ── Folders ───────────────────────────────────────────────────────────────────

@router.get("/{project_id}/folders")
def list_folders(project_id: int, session: Session = Depends(get_session)):
    folders = session.exec(
        select(ProjectFolder)
        .where(ProjectFolder.project_id == project_id)
        .order_by(ProjectFolder.sort_order)
    ).all()
    if not folders:
        folders = _init_default_folders(project_id, session)
    return folders


@router.post("/{project_id}/folders", status_code=201)
def create_folder(project_id: int, data: FolderCreate, session: Session = Depends(get_session)):
    folder = ProjectFolder(project_id=project_id, **data.model_dump())
    session.add(folder)
    session.commit()
    session.refresh(folder)
    _bust_project(project_id)
    return folder


@router.delete("/{project_id}/folders/{folder_id}")
def delete_folder(project_id: int, folder_id: int, session: Session = Depends(get_session)):
    folder = session.get(ProjectFolder, folder_id)
    if not folder or folder.project_id != project_id:
        raise HTTPException(404, "Folder not found")
    # Unlink files from this folder before deleting
    files = session.exec(select(ProjectFile).where(ProjectFile.folder_id == folder_id)).all()
    for f in files:
        f.folder_id = None
        session.add(f)
    session.delete(folder)
    session.commit()
    _bust_project(project_id)
    return {"ok": True}


# ── Financials ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/financials")
def get_financials(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    payments = session.exec(
        select(ProjectPayment)
        .where(ProjectPayment.project_id == project_id)
        .order_by(ProjectPayment.payment_date)
    ).all()
    received = sum(p.amount for p in payments if p.payment_type in ("received", "milestone_payment"))
    expenses = sum(abs(p.amount) for p in payments if p.payment_type == "expense")
    invoiced = sum(p.amount for p in payments if p.payment_type == "invoiced")
    return {
        "contract_amount": project.contract_amount,
        "total_received": received,
        "total_expense": expenses,
        "total_invoiced": invoiced,
        "uncollected": invoiced - received,   # 已开票未收款
        "remaining": project.contract_amount - received,
        "payments": payments,
    }


@router.post("/{project_id}/financials", status_code=201)
def add_payment(project_id: int, data: PaymentCreate, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    amount = -abs(data.amount) if data.payment_type == "expense" else abs(data.amount)
    payment = ProjectPayment(project_id=project_id, amount=amount,
                             payment_date=data.payment_date, note=data.note,
                             payment_type=data.payment_type)
    session.add(payment)
    session.commit()
    session.refresh(payment)
    _bust_project(project_id)
    return payment


@router.delete("/{project_id}/financials/{payment_id}")
def delete_payment(project_id: int, payment_id: int, session: Session = Depends(get_session)):
    payment = session.get(ProjectPayment, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, "Payment not found")
    session.delete(payment)
    session.commit()
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


@router.post("/ai-suggest", response_model=list[ProjectAISuggestion])
async def ai_suggest_project(body: ProjectAISuggestQuery):
    """Ask Claude to propose 1-3 consulting project names + descriptions."""
    client_context = ""
    if body.client_name:
        client_context = f"Client: {body.client_name}"
        if body.client_industry:
            client_context += f" ({body.client_industry})"

    prompt = f"""You are a senior consultant at a top-tier consulting firm.
{f"The project is for: {client_context}" if client_context else ""}
The user described the project as: "{body.query}"

Generate 1 to 3 consulting project name and description suggestions.
- If the idea is specific, return 1 suggestion.
- If the idea is broad or ambiguous, return up to 3 distinct angle variations.

Return ONLY a valid JSON array (no markdown, no extra text):
[
  {{
    "name": "Crisp, professional project title (5-8 words max)",
    "description": "2-3 sentence scope statement: objectives, key workstreams, and expected deliverable"
  }}
]

Rules:
- name: concise, consulting-style (e.g. "China Market Entry Strategy", "Digital Transformation Roadmap")
- description: professional, specific, actionable — no filler phrases
- Return pure JSON array only"""

    try:
        raw = await _complete(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4000,
        )
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        suggestions = json.loads(text)
        return [ProjectAISuggestion(**s) for s in suggestions[:3]]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {e}")


# ── Background: auto-summarize uploaded file ──────────────────────────────────

async def _auto_summarize_file(file_id: int, file_path: str, file_type: str) -> None:
    """Generate a 2-3 sentence summary for an uploaded project file and persist it."""
    from app.database import engine
    from sqlmodel import Session as _Session

    text = _extract_file_text(Path(file_path), file_type, max_chars=3000)
    if not text or text.startswith("["):
        return  # Nothing to summarize

    prompt = (
        "You are a professional consultant analyst. "
        "Read the following document excerpt and write a concise 2-3 sentence summary "
        "covering: what this document is, its main purpose, and the most important information it contains. "
        "Be specific and professional. Return ONLY the summary, no preamble.\n\n"
        f"Document excerpt:\n{text}"
    )
    try:
        summary = await _complete(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
        )
        summary = summary.strip()
        if summary:
            with _Session(engine) as session:
                pf = session.get(ProjectFile, file_id)
                if pf:
                    pf.summary = summary
                    session.add(pf)
                    session.commit()
    except Exception:
        pass  # Best-effort — don't break the upload flow


# ── Generate project context summary ──────────────────────────────────────────

@router.post("/{project_id}/generate-context")
async def generate_project_context(project_id: int, session: Session = Depends(get_session)):
    """Ask LLM to generate a structured context summary (SSE streaming)."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    milestones = session.exec(select(Milestone).where(Milestone.project_id == project_id)).all()
    files = session.exec(select(ProjectFile).where(ProjectFile.project_id == project_id)).all()

    # Build project data block
    lines = [
        f"Project: {project.name}",
        f"Client: {project.client}",
        f"Status: {project.status}",
    ]
    if project.description:
        lines.append(f"Description: {project.description}")
    if milestones:
        lines.append(f"Milestones ({len(milestones)} total, {sum(1 for m in milestones if m.is_done)} completed):")
        for m in milestones:
            status = "✓" if m.is_done else "○"
            lines.append(f"  {status} {m.title}" + (f" [{m.priority}]" if m.priority == "high" else ""))
    if files:
        lines.append(f"Uploaded files ({len(files)}):")
        for f in files:
            lines.append(f"  - {f.name}" + (f": {f.summary[:120]}" if f.summary else ""))

    project_data = "\n".join(lines)

    prompt = (
        "You are an AI consultant assistant. Based on the project data below, "
        "generate a concise context summary of 3-5 bullet points that capture: "
        "the project's core objective, current stage, key risks or open questions, "
        "critical milestones, and important context a consultant should always remember. "
        "Each bullet should be specific and actionable, not generic. "
        "Use **bold** for key terms or milestones within each bullet. "
        "Return ONLY the bullet points, one per line, starting with '•'. "
        "Write in the same language as the project name (Chinese if Chinese, English if English).\n\n"
        f"Project data:\n{project_data}"
    )

    messages = [{"role": "user", "content": prompt}]

    async def event_stream():
        accumulated: list[str] = []
        try:
            async for chunk in _stream(messages, max_tokens=4000):
                # Skip tool_use JSON blobs and TOOL_START markers
                if chunk.startswith('{"type": "tool_use"') or chunk.startswith("[TOOL_START:"):
                    continue
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
            p = write_session.get(Project, project_id)
            if p:
                p.context_summary = summary
                p.updated_at = datetime.utcnow()
                write_session.add(p)
                write_session.commit()
                _bust_project(project_id)

        yield f"data: {json.dumps({'type': 'done', 'context_summary': summary}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Project notes (沉淀到项目) ─────────────────────────────────────────────────

@router.post("/{project_id}/notes")
def save_project_note(project_id: int, body: NoteBody, session: Session = Depends(get_session)):
    """Append or overwrite project notes."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    if body.append and project.notes:
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        project.notes = f"{project.notes}\n\n---\n[{timestamp}]\n{body.content}"
    else:
        project.notes = body.content

    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    _bust_project(project_id)
    return {"notes": project.notes}
