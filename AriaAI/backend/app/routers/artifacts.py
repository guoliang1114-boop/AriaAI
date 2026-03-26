"""Artifacts router — download and list generated files (GeneratedFile model)."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import get_session
from app.models.db import GeneratedFile

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class ArtifactOut(BaseModel):
    id: int
    conversation_id: int
    project_id: Optional[int]
    name: str
    file_type: str
    path: str
    size_bytes: int
    description: str
    created_at: datetime


@router.get("", response_model=List[ArtifactOut])
def list_artifacts(
    conversation_id: Optional[int] = None,
    project_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    """List generated files (artifacts)."""
    stmt = select(GeneratedFile).order_by(GeneratedFile.created_at.desc())
    if conversation_id:
        stmt = stmt.where(GeneratedFile.conversation_id == conversation_id)
    if project_id:
        stmt = stmt.where(GeneratedFile.project_id == project_id)
    return session.exec(stmt).all()


@router.get("/download-by-path")
def download_by_path(path: str = Query(..., description="Relative path under uploads dir")):
    """Download a generated file by its relative path (e.g. generated/xxx.pptx)."""
    # Prevent path traversal
    safe_path = Path(path).parts
    if ".." in safe_path:
        raise HTTPException(400, "Invalid path")
    file_path = UPLOADS_DIR / path
    if not file_path.exists():
        raise HTTPException(404, "File not found")

    ext = file_path.suffix.lstrip(".")
    mime_types = {
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pdf": "application/pdf",
        "json": "application/json",
        "txt": "text/plain",
        "md": "text/markdown",
    }
    media_type = mime_types.get(ext, "application/octet-stream")
    return FileResponse(path=file_path, media_type=media_type, filename=file_path.name)


@router.get("/{artifact_id}")
def get_artifact(artifact_id: int, session: Session = Depends(get_session)):
    """Get artifact details."""
    artifact = session.get(GeneratedFile, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    return artifact


@router.get("/{artifact_id}/download")
def download_artifact(artifact_id: int, session: Session = Depends(get_session)):
    """Download the artifact file."""
    artifact = session.get(GeneratedFile, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    
    file_path = UPLOADS_DIR / artifact.path
    if not file_path.exists():
        raise HTTPException(404, "File not found on server")
    
    # Map file types to MIME types
    mime_types = {
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pdf": "application/pdf",
        "json": "application/json",
        "txt": "text/plain",
        "md": "text/markdown",
        "csv": "text/csv",
        "html": "text/html",
    }
    
    media_type = mime_types.get(artifact.file_type, "application/octet-stream")
    
    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=artifact.name,
    )


@router.delete("/{artifact_id}")
def delete_artifact(artifact_id: int, session: Session = Depends(get_session)):
    """Delete an artifact and its file."""
    artifact = session.get(GeneratedFile, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    
    # Delete file if exists
    if artifact.path:
        file_path = UPLOADS_DIR / artifact.path
        if file_path.exists():
            file_path.unlink()
    
    session.delete(artifact)
    session.commit()
    return {"ok": True}
