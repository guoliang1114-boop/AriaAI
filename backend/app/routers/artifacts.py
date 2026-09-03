"""Artifacts router — download and list generated files (GeneratedFile model)."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import get_session
from app.models.db import ArtifactVerification, GeneratedFile, User
from app.routers.auth import get_current_user
from app.routers.chat_security import require_conversation_access, require_project_access
from app.services.upload_paths import normalize_relative_upload_path, resolve_upload_path
from app.services.agent_harness.artifact_verification import (
    artifact_verification_evidence_payload,
)
from app.services.agent_harness.artifact_acceptance import (
    artifact_acceptance_projection,
    build_artifact_acceptance_contract,
    registered_artifact_business_verifiers,
    review_artifact_acceptance,
)

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
    run_id: str = ""
    output_id: str = ""
    source_tool: str = ""
    content_sha256: str = ""
    output_record_version: int = 1
    created_at: datetime


class ArtifactAcceptanceRequest(BaseModel):
    decision: str = Field(min_length=1, max_length=40)
    expected_revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=600)


def _authorize_artifact(
    session: Session,
    artifact: GeneratedFile,
    current_user: User,
    *,
    require_write: bool = False,
) -> None:
    if artifact.conversation_id:
        require_conversation_access(
            session,
            artifact.conversation_id,
            current_user,
            require_write=require_write,
        )
        return
    if artifact.project_id:
        require_project_access(
            session,
            artifact.project_id,
            current_user,
            require_write=require_write,
        )
        return
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Artifact owner required")


@router.get("", response_model=List[ArtifactOut])
def list_artifacts(
    conversation_id: Optional[int] = None,
    project_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """List generated files (artifacts)."""
    if conversation_id:
        require_conversation_access(session, conversation_id, current_user)
    if project_id:
        require_project_access(session, project_id, current_user)

    stmt = select(GeneratedFile).order_by(GeneratedFile.created_at.desc())
    if conversation_id:
        stmt = stmt.where(GeneratedFile.conversation_id == conversation_id)
    if project_id:
        stmt = stmt.where(GeneratedFile.project_id == project_id)
    artifacts = session.exec(stmt).all()
    if conversation_id or project_id or current_user.is_admin:
        return artifacts

    visible_artifacts: list[GeneratedFile] = []
    for artifact in artifacts:
        try:
            _authorize_artifact(session, artifact, current_user)
        except HTTPException:
            continue
        visible_artifacts.append(artifact)
    return visible_artifacts


@router.get("/download-by-path")
def download_by_path(
    path: str = Query(..., description="Relative path under uploads dir"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Download a generated file by its relative path (e.g. generated/xxx.pptx)."""
    relative_path = normalize_relative_upload_path(UPLOADS_DIR, path)
    artifact = session.exec(select(GeneratedFile).where(GeneratedFile.path == relative_path)).first()
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user)
    file_path = resolve_upload_path(UPLOADS_DIR, relative_path)

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


@router.get("/verification/business-verifiers")
def get_artifact_business_verifier_registry(
    current_user: User = Depends(get_current_user),
):
    """List safe Aria-owned declarative artifact verifiers."""

    del current_user
    return registered_artifact_business_verifiers()


@router.get("/acceptance/contract")
def get_artifact_acceptance_contract(
    current_user: User = Depends(get_current_user),
):
    """Return the content-free human sign-off safety contract."""

    del current_user
    return build_artifact_acceptance_contract()


@router.get("/{artifact_id}")
def get_artifact(
    artifact_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Get artifact details."""
    artifact = session.get(GeneratedFile, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user)
    return artifact


@router.get("/{artifact_id}/download")
def download_artifact(
    artifact_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Download the artifact file."""
    artifact = session.get(GeneratedFile, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user)
    file_path = resolve_upload_path(UPLOADS_DIR, artifact.path)
    
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


@router.get("/{artifact_id}/verification")
def get_artifact_verification(
    artifact_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Return bounded verification evidence after normal artifact authorization."""

    artifact = session.get(GeneratedFile, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user)
    verification = session.exec(
        select(ArtifactVerification)
        .where(ArtifactVerification.generated_file_id == artifact_id)
        .order_by(
            ArtifactVerification.created_at.desc(),
            ArtifactVerification.id.desc(),
        )
    ).first()
    if verification is None:
        raise HTTPException(404, "Artifact verification not found")
    payload = artifact_verification_evidence_payload(verification)
    if not payload:
        raise HTTPException(409, "Artifact verification evidence is invalid")
    return payload


@router.get("/{artifact_id}/acceptance")
def get_artifact_acceptance(
    artifact_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Return the delivery gate combining evidence and human sign-off."""

    artifact = session.get(GeneratedFile, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user)
    return artifact_acceptance_projection(session, artifact)


@router.post("/{artifact_id}/acceptance")
def decide_artifact_acceptance(
    artifact_id: int,
    body: ArtifactAcceptanceRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Accept or reject one exact artifact verification with CAS and audit."""

    artifact = session.exec(
        select(GeneratedFile)
        .where(GeneratedFile.id == artifact_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user, require_write=True)
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return review_artifact_acceptance(
        session,
        artifact=artifact,
        actor_user_id=int(current_user.id),
        decision=body.decision,
        expected_revision=body.expected_revision,
        reason=body.reason,
    )


@router.delete("/{artifact_id}")
def delete_artifact(
    artifact_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Delete an artifact and its file."""
    artifact = session.get(GeneratedFile, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user, require_write=True)
    
    # Delete file if exists
    if artifact.path:
        file_path = resolve_upload_path(UPLOADS_DIR, artifact.path, must_exist=False)
        if file_path.exists():
            file_path.unlink()
    
    for verification in session.exec(
        select(ArtifactVerification).where(
            ArtifactVerification.generated_file_id == artifact_id
        )
    ).all():
        session.delete(verification)
    session.flush()
    session.delete(artifact)
    session.commit()
    return {"ok": True}
