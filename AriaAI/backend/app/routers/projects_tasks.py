"""Project task-run endpoints.

These endpoints expose durable work orchestration separately from chat.  Chat can
create a task and subscribe to its status; the run itself remains visible and
retryable even if the browser refreshes or a streaming connection drops.
"""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.routers.auth import get_current_user
from app.routers.projects_deps import get_session
from app.models.db import User
from app.services.project_core import get_project_or_404
from app.services.task_orchestrator import (
    cancel_task_run_in_session,
    create_task_run,
    execute_task_run,
    get_task_run_or_none,
    list_project_task_runs,
    pause_task_run_in_session,
    resume_task_run,
    resume_task_run_in_session,
    retry_task_run,
    serialize_task_run,
)

router = APIRouter(tags=["project tasks"])


class ProjectTaskCreate(BaseModel):
    task_type: str = "generate_client_ppt"
    goal: str = ""
    conversation_id: int | None = None
    input: dict = Field(default_factory=dict)
    start: bool = True


@router.get("/{project_id}/task-runs")
def list_task_runs(project_id: int, session: Session = Depends(get_session)):
    get_project_or_404(session, project_id)
    return list_project_task_runs(session, project_id)


@router.post("/{project_id}/task-runs")
def create_project_task_run(
    project_id: int,
    body: ProjectTaskCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    get_project_or_404(session, project_id)
    try:
        task = create_task_run(
            session,
            project_id=project_id,
            task_type=body.task_type,
            goal=body.goal or "生成客户介绍 PPT",
            input_data=body.input,
            conversation_id=body.conversation_id,
            created_by_user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.start:
        background_tasks.add_task(execute_task_run, task.id)
    return serialize_task_run(session, task, include_events=True)


@router.get("/{project_id}/task-runs/{task_id}")
def get_project_task_run(project_id: int, task_id: int, session: Session = Depends(get_session)):
    task = get_task_run_or_none(session, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task run not found")
    return serialize_task_run(session, task, include_events=True)


@router.post("/{project_id}/task-runs/{task_id}/retry")
def retry_project_task_run(
    project_id: int,
    task_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    task = get_task_run_or_none(session, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task run not found")
    if task.status != "failed":
        raise HTTPException(status_code=400, detail="Only failed task runs can be retried")
    background_tasks.add_task(retry_task_run, task.id)
    return serialize_task_run(session, task, include_events=True)


@router.post("/{project_id}/task-runs/{task_id}/cancel")
def cancel_project_task_run(project_id: int, task_id: int, session: Session = Depends(get_session)):
    task = get_task_run_or_none(session, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task run not found")
    if task.status == "completed":
        raise HTTPException(status_code=400, detail="Completed task runs cannot be canceled")
    payload = cancel_task_run_in_session(session, task.id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Task run not found")
    return payload


@router.post("/{project_id}/task-runs/{task_id}/pause")
def pause_project_task_run(project_id: int, task_id: int, session: Session = Depends(get_session)):
    task = get_task_run_or_none(session, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task run not found")
    if task.status in {"completed", "failed", "canceled"}:
        raise HTTPException(status_code=400, detail="Only pending or running task runs can be paused")
    payload = pause_task_run_in_session(session, task.id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Task run not found")
    return payload


@router.post("/{project_id}/task-runs/{task_id}/resume")
def resume_project_task_run(
    project_id: int,
    task_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    task = get_task_run_or_none(session, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task run not found")
    if task.status != "paused":
        raise HTTPException(status_code=400, detail="Only paused task runs can be resumed")
    payload = resume_task_run_in_session(session, task.id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Task run not found")
    background_tasks.add_task(resume_task_run, task.id)
    return payload
