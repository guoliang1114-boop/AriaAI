"""Templates router — upload, manage, assign to projects."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import get_session
from app.models.db import Template

router = APIRouter(prefix="/templates", tags=["templates"])

TEMPLATE_UPLOADS = UPLOADS_DIR / "templates"
TEMPLATE_UPLOADS.mkdir(parents=True, exist_ok=True)


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None


@router.get("")
def list_templates(category: Optional[str] = None, session: Session = Depends(get_session)):
    stmt = select(Template).order_by(Template.uploaded_at.desc())
    if category:
        stmt = stmt.where(Template.category == category)
    return session.exec(stmt).all()


@router.post("", status_code=201)
async def upload_template(
    file: UploadFile = File(...),
    category: str = "",
    session: Session = Depends(get_session),
):
    suffix = Path(file.filename or "file").suffix.lower()
    if suffix not in (".pptx", ".docx", ".pdf"):
        raise HTTPException(400, "Only PPTX, DOCX, and PDF templates are supported")

    dest_name = f"{uuid.uuid4().hex}{suffix}"
    dest_file = TEMPLATE_UPLOADS / dest_name

    with dest_file.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    template = Template(
        name=file.filename or dest_name,
        category=category or "General",
        file_type=suffix.lstrip("."),
        path=str(dest_file.relative_to(UPLOADS_DIR)),
    )
    session.add(template)
    session.commit()
    session.refresh(template)
    return template


@router.patch("/{template_id}")
def update_template(template_id: int, data: TemplateUpdate, session: Session = Depends(get_session)):
    template = session.get(Template, template_id)
    if not template:
        raise HTTPException(404, "Template not found")
    payload = data.model_dump(exclude_none=True)
    if "tags" in payload:
        template.tags = payload.pop("tags")
    for k, v in payload.items():
        setattr(template, k, v)
    session.add(template)
    session.commit()
    session.refresh(template)
    return template


@router.delete("/{template_id}")
def delete_template(template_id: int, session: Session = Depends(get_session)):
    template = session.get(Template, template_id)
    if not template:
        raise HTTPException(404, "Template not found")
    full_path = UPLOADS_DIR / template.path
    if full_path.exists():
        full_path.unlink()
    session.delete(template)
    session.commit()
    return {"ok": True}
