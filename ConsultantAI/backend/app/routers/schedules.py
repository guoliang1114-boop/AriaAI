"""Schedules router — CRUD + APScheduler integration."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import ScheduledTask
from app.services import scheduler as scheduler_service

router = APIRouter(prefix="/schedules", tags=["schedules"])


class TaskCreate(BaseModel):
    name: str
    project_id: Optional[int] = None
    skill_id: Optional[int] = None
    prompt: str = ""
    frequency: str
    cron_expr: str = ""
    is_enabled: bool = True


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    frequency: Optional[str] = None
    cron_expr: Optional[str] = None
    is_enabled: Optional[bool] = None


@router.get("")
def list_tasks(session: Session = Depends(get_session)):
    return session.exec(select(ScheduledTask).order_by(ScheduledTask.created_at.desc())).all()


@router.post("", status_code=201)
def create_task(data: TaskCreate, session: Session = Depends(get_session)):
    task = ScheduledTask(**data.model_dump())
    task.next_run = scheduler_service.next_run_from_frequency(data.frequency, data.cron_expr)
    session.add(task)
    session.commit()
    session.refresh(task)
    scheduler_service.register_task(task)
    return task


@router.patch("/{task_id}")
def update_task(task_id: int, data: TaskUpdate, session: Session = Depends(get_session)):
    task = session.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(task, k, v)
    if data.frequency or data.cron_expr is not None:
        task.next_run = scheduler_service.next_run_from_frequency(task.frequency, task.cron_expr)
    session.add(task)
    session.commit()
    session.refresh(task)
    scheduler_service.update_task(task)
    return task


@router.delete("/{task_id}")
def delete_task(task_id: int, session: Session = Depends(get_session)):
    task = session.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    scheduler_service.remove_task(task_id)
    session.delete(task)
    session.commit()
    return {"ok": True}


@router.post("/{task_id}/run")
def run_now(task_id: int, session: Session = Depends(get_session)):
    task = session.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    scheduler_service.trigger_now(task)
    return {"ok": True, "message": f"Task '{task.name}' triggered"}
