"""Artifacts router — download and list generated files (GeneratedFile model)."""
from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import get_session
from app.models.db import ArtifactVerification, GeneratedFile, ProjectFile, User
from app.models.knowledge import (
    ArtifactKnowledgeArchive,
    KnowledgeJob,
    KnowledgeSource,
    KnowledgeV1Document,
)
from app.jobs.knowledge_jobs import (
    enqueue_knowledge_job,
    process_knowledge_job_by_id,
)
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
from app.services.cache import projects_cache
from app.services.knowledge_ingestion import (
    SUPPORTED_SOURCE_FILE_TYPES,
    normalize_file_type,
    register_document_from_bytes,
)
from app.services.knowledge_permissions import (
    can_access_source,
    lock_and_require_source_write,
)
from app.services.project_contexts import mark_project_memory_stale
from app.services.time_utils import utc_now_naive

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class ArtifactOut(BaseModel):
    id: int
    conversation_id: int
    project_id: Optional[int]
    project_file_id: Optional[int] = None
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
    deliverable_id: str = ""
    deliverable_name: str = ""
    deliverable_contract_sha256: str = ""
    deliverable_catalog_sha256: str = ""
    deliverable_skill_release_sha256: str = ""
    deliverable_business_verifiers_json: str = "[]"
    saved_to_project_by_user_id: Optional[int] = None
    saved_to_project_at: Optional[datetime] = None
    created_at: datetime


class ArtifactAcceptanceRequest(BaseModel):
    decision: str = Field(min_length=1, max_length=40)
    expected_revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=600)


class ArtifactProjectSaveRequest(BaseModel):
    expected_content_sha256: str = Field(
        min_length=64,
        max_length=64,
        pattern=r"^[a-f0-9]{64}$",
    )


class ArtifactKnowledgeArchiveRequest(BaseModel):
    source_id: int = Field(ge=1)
    confirm_archive: Literal[True]
    expected_content_sha256: str = Field(
        min_length=64,
        max_length=64,
        pattern=r"^[a-f0-9]{64}$",
    )


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verified_artifact_file(
    session: Session,
    artifact: GeneratedFile,
    expected_sha256: str,
) -> tuple[Path, ArtifactVerification, dict]:
    expected_sha256 = str(expected_sha256 or "").lower()
    if expected_sha256 != str(artifact.content_sha256 or "").lower():
        raise HTTPException(409, "Artifact content changed; reload before saving")
    verification = session.exec(
        select(ArtifactVerification)
        .where(ArtifactVerification.generated_file_id == artifact.id)
        .order_by(
            ArtifactVerification.created_at.desc(),
            ArtifactVerification.id.desc(),
        )
    ).first()
    evidence = (
        artifact_verification_evidence_payload(verification)
        if verification is not None
        else {}
    )
    if (
        not evidence
        or evidence.get("content_sha256") != expected_sha256
        or evidence.get("technical_status") != "passed"
    ):
        raise HTTPException(
            409,
            "Artifact technical verification must pass before this action",
        )
    file_path = resolve_upload_path(UPLOADS_DIR, artifact.path, must_exist=True)
    if _file_sha256(file_path) != expected_sha256:
        raise HTTPException(409, "Artifact bytes changed; regenerate or verify again")
    return file_path, verification, evidence


def _knowledge_archive_payload(
    session: Session,
    archive: ArtifactKnowledgeArchive,
) -> dict:
    document = (
        session.get(KnowledgeV1Document, archive.knowledge_document_id)
        if archive.knowledge_document_id is not None
        else None
    )
    job = None
    if document is not None:
        job = session.exec(
            select(KnowledgeJob)
            .where(KnowledgeJob.document_id == document.id)
            .order_by(KnowledgeJob.created_at.desc(), KnowledgeJob.id.desc())
        ).first()
    return {
        "schema_version": 1,
        "archive_id": int(archive.id or 0),
        "artifact_id": int(archive.generated_file_id),
        "source_id": archive.knowledge_source_id,
        "source_name": archive.source_name,
        "source_scope_type": archive.source_scope_type,
        "source_scope_id": archive.source_scope_id,
        "document_id": archive.knowledge_document_id,
        "document_status": document.status if document is not None else "unavailable",
        "job_id": job.id if job is not None else None,
        "job_status": job.status if job is not None else None,
        "content_sha256": archive.content_sha256,
        "deliverable_contract_sha256": archive.deliverable_contract_sha256,
        "requested_by_user_id": archive.requested_by_user_id,
        "created_at": archive.created_at,
        "writes_project_memory": False,
        "writes_client_memory": False,
        "sends_external_messages": False,
    }


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


@router.post("/{artifact_id}/save-to-project")
def save_artifact_to_project(
    artifact_id: int,
    body: ArtifactProjectSaveRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Explicitly expose one verified generated file in project documents."""

    artifact = session.exec(
        select(GeneratedFile)
        .where(GeneratedFile.id == artifact_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if artifact is None:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user, require_write=True)
    if artifact.project_id is None:
        raise HTTPException(409, "Artifact is not bound to a project")
    expected_sha256 = body.expected_content_sha256.lower()
    file_path, verification, _ = _verified_artifact_file(
        session,
        artifact,
        expected_sha256,
    )

    project_file = None
    if artifact.project_file_id is not None:
        candidate = session.get(ProjectFile, artifact.project_file_id)
        if (
            candidate is not None
            and candidate.project_id == artifact.project_id
            and candidate.path == artifact.path
            and candidate.deleted_at is None
        ):
            project_file = candidate
    if project_file is None:
        project_file = session.exec(
            select(ProjectFile).where(
                ProjectFile.project_id == artifact.project_id,
                ProjectFile.path == artifact.path,
                ProjectFile.deleted_at.is_(None),
            )
        ).first()

    created = project_file is None
    if project_file is None:
        project_file = ProjectFile(
            project_id=int(artifact.project_id),
            name=artifact.name,
            file_type=artifact.file_type,
            path=artifact.path,
            size_bytes=file_path.stat().st_size,
            summary=str(artifact.description or "")[:2000],
            origin="ai_generated",
        )
        session.add(project_file)
        session.flush()

    now = utc_now_naive()
    artifact.project_file_id = project_file.id
    if artifact.saved_to_project_at is None:
        artifact.saved_to_project_by_user_id = current_user.id
        artifact.saved_to_project_at = now
    session.add(artifact)
    if created:
        # Registering a new source does not rewrite memory, but any existing
        # derived memory must no longer claim to cover the complete project.
        mark_project_memory_stale(
            session,
            int(artifact.project_id),
            trigger="generated_artifact_saved_to_project",
            commit=False,
        )
    session.commit()
    if created:
        projects_cache.delete(f"detail:{artifact.project_id}")
        projects_cache.delete_prefix("list:")
    session.refresh(project_file)
    acceptance = artifact_acceptance_projection(session, artifact, verification)
    return {
        "schema_version": 1,
        "artifact_id": int(artifact.id),
        "project_id": int(artifact.project_id),
        "project_file_id": int(project_file.id),
        "target": "project_documents",
        "created": created,
        "content_sha256": expected_sha256,
        "saved_by_user_id": artifact.saved_to_project_by_user_id,
        "saved_at": artifact.saved_to_project_at,
        "delivery_status": acceptance["delivery_status"],
        "final_delivery_allowed": acceptance["final_delivery_allowed"],
        "writes_memory": False,
        "invalidates_derived_project_memory": created,
        "writes_knowledge_base": False,
        "sends_external_messages": False,
    }


@router.get("/{artifact_id}/knowledge-archives")
def list_artifact_knowledge_archives(
    artifact_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    artifact = session.get(GeneratedFile, artifact_id)
    if artifact is None:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user)
    archives = session.exec(
        select(ArtifactKnowledgeArchive)
        .where(ArtifactKnowledgeArchive.generated_file_id == artifact_id)
        .order_by(
            ArtifactKnowledgeArchive.created_at.desc(),
            ArtifactKnowledgeArchive.id.desc(),
        )
    ).all()
    visible = []
    for archive in archives:
        source = (
            session.get(KnowledgeSource, archive.knowledge_source_id)
            if archive.knowledge_source_id is not None
            else None
        )
        if source is not None and can_access_source(current_user, source, session):
            visible.append(_knowledge_archive_payload(session, archive))
    return visible


@router.post("/{artifact_id}/archive-to-knowledge", status_code=202)
def archive_artifact_to_knowledge(
    artifact_id: int,
    body: ArtifactKnowledgeArchiveRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Explicitly register and independently index a delivery-ready artifact."""

    artifact = session.exec(
        select(GeneratedFile)
        .where(GeneratedFile.id == artifact_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if artifact is None:
        raise HTTPException(404, "Artifact not found")
    _authorize_artifact(session, artifact, current_user, require_write=True)
    expected_sha256 = body.expected_content_sha256.lower()
    file_path, verification, _ = _verified_artifact_file(
        session,
        artifact,
        expected_sha256,
    )
    acceptance = artifact_acceptance_projection(session, artifact, verification)
    if not acceptance["final_delivery_allowed"]:
        raise HTTPException(
            409,
            "Artifact final delivery gate must be ready before knowledge archive",
        )

    source, actor = lock_and_require_source_write(
        session,
        body.source_id,
        current_user,
    )
    if source.status != "active":
        raise HTTPException(409, "Knowledge source is not active")
    existing = session.exec(
        select(ArtifactKnowledgeArchive)
        .where(
            ArtifactKnowledgeArchive.generated_file_id == artifact_id,
            ArtifactKnowledgeArchive.knowledge_source_id == source.id,
            ArtifactKnowledgeArchive.content_sha256 == expected_sha256,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if existing is not None:
        return {
            **_knowledge_archive_payload(session, existing),
            "archive_created": False,
            "document_created": False,
            "indexing_enqueued": False,
        }

    file_type = normalize_file_type(artifact.name)
    if file_type not in SUPPORTED_SOURCE_FILE_TYPES:
        raise HTTPException(
            409,
            f"Artifact type cannot be indexed in knowledge: {file_type}",
        )
    content = file_path.read_bytes()
    document, document_created = register_document_from_bytes(
        session=session,
        source=source,
        file_name=artifact.name,
        content=content,
        source_metadata={
            "origin": "generated_artifact",
            "generated_file_id": int(artifact.id),
            "project_id": artifact.project_id,
            "content_sha256": expected_sha256,
            "deliverable_id": str(artifact.deliverable_id or "")[:80],
            "deliverable_contract_sha256": str(
                artifact.deliverable_contract_sha256 or ""
            )[:64],
            "deliverable_catalog_sha256": str(
                artifact.deliverable_catalog_sha256 or ""
            )[:64],
            "skill_release_sha256": str(
                artifact.deliverable_skill_release_sha256 or ""
            )[:64],
            "archive_authority": "explicit_user_action",
        },
    )
    archive = ArtifactKnowledgeArchive(
        generated_file_id=int(artifact.id),
        knowledge_source_id=int(source.id),
        knowledge_document_id=int(document.id),
        content_sha256=expected_sha256,
        deliverable_contract_sha256=str(
            artifact.deliverable_contract_sha256 or ""
        )[:64],
        source_name=str(source.name or "")[:255],
        source_scope_type=str(source.scope_type or "")[:50],
        source_scope_id=source.scope_id,
        requested_by_user_id=actor.id,
    )
    session.add(archive)
    session.flush()
    job = None
    if document.status != "indexed":
        job = enqueue_knowledge_job(
            session,
            job_type="index_document",
            document_id=int(document.id),
            source_id=int(source.id),
            requested_by_user_id=int(actor.id),
        )
    session.commit()
    session.refresh(archive)
    if job is not None:
        background_tasks.add_task(
            process_knowledge_job_by_id,
            int(job.id),
            session.get_bind(),
        )
    return {
        **_knowledge_archive_payload(session, archive),
        "archive_created": True,
        "document_created": document_created,
        "indexing_enqueued": job is not None,
    }


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
