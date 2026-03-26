"""Projects router — CRUD for projects, milestones, file uploads."""
from __future__ import annotations

import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlmodel import Session, select

import json
from app.config import UPLOADS_DIR
from app.database import get_session
from app.models.db import Project, Milestone, ProjectFile, ProjectFolder, ProjectPayment
from app.services.claude import complete

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
    stmt = select(Project).order_by(Project.updated_at.desc())
    if status:
        stmt = stmt.where(Project.status == status)
    return session.exec(stmt).all()


@router.post("", status_code=201)
def create_project(data: ProjectCreate, session: Session = Depends(get_session)):
    project = Project(**data.model_dump())
    session.add(project)
    session.commit()
    session.refresh(project)
    _init_default_folders(project.id, session)
    return project


@router.get("/{project_id}")
def get_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


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
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    session.delete(project)
    session.commit()
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
    return ms


@router.delete("/{project_id}/milestones/{ms_id}")
def delete_milestone(project_id: int, ms_id: int, session: Session = Depends(get_session)):
    ms = session.get(Milestone, ms_id)
    if not ms or ms.project_id != project_id:
        raise HTTPException(404, "Milestone not found")
    session.delete(ms)
    session.commit()
    return {"ok": True}


# ── Files ─────────────────────────────────────────────────────────────────────

@router.get("/{project_id}/files")
def list_files(project_id: int, session: Session = Depends(get_session)):
    return session.exec(select(ProjectFile).where(ProjectFile.project_id == project_id)).all()


@router.post("/{project_id}/files", status_code=201)
async def upload_file(
    project_id: int,
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
    return payment


@router.delete("/{project_id}/financials/{payment_id}")
def delete_payment(project_id: int, payment_id: int, session: Session = Depends(get_session)):
    payment = session.get(ProjectPayment, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, "Payment not found")
    session.delete(payment)
    session.commit()
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
        raw = await complete(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=600,
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
