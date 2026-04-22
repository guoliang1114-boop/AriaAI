"""Unified memory operations dashboard endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.database import get_session
from app.routers import clients as clients_router
from app.routers import projects as projects_router
from app.services.memory_operations import summarize_memory_operations

router = APIRouter(prefix="/memory/operations", tags=["memory-operations"])


@router.get("/summary")
def get_memory_operations_summary(session: Session = Depends(get_session)):
    project_jobs = projects_router.list_project_memory_jobs(session)
    client_jobs = clients_router.list_client_memory_jobs(session)
    client_jobs_payload = client_jobs.model_dump() if hasattr(client_jobs, "model_dump") else dict(client_jobs)
    return summarize_memory_operations(
        project_jobs=project_jobs,
        client_jobs=client_jobs_payload,
    )
