from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectQuestionRemediationExecution, ProjectTodo
from app.services.time_utils import utc_now_naive


def ensure_project_exists(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


def serialize_todo(todo: ProjectTodo, project_name: str | None = None) -> dict:
    data = {
        "id": todo.id,
        "project_id": todo.project_id,
        "content": todo.content,
        "is_done": todo.is_done,
        "due_date": todo.due_date,
        "assigned_to_user_id": todo.assigned_to_user_id,
        "assigned_user": (
            {"id": todo.assigned_user.id, "display_name": todo.assigned_user.display_name}
            if todo.assigned_user else None
        ),
        "created_at": todo.created_at,
        "updated_at": todo.updated_at,
    }
    if project_name is not None:
        data["project_name"] = project_name
    return data


def list_project_todos(session: Session, project_id: int) -> list[ProjectTodo]:
    ensure_project_exists(session, project_id)
    return session.exec(
        select(ProjectTodo)
        .where(ProjectTodo.project_id == project_id)
        .order_by(ProjectTodo.is_done, ProjectTodo.updated_at.desc())
    ).all()


def get_project_todo_or_404(session: Session, project_id: int, todo_id: int) -> ProjectTodo:
    todo = session.exec(
        select(ProjectTodo).where(ProjectTodo.id == todo_id, ProjectTodo.project_id == project_id)
    ).first()
    if not todo:
        raise HTTPException(404, "Todo not found")
    return todo


def create_project_todo(
    session: Session,
    project_id: int,
    *,
    content: str,
    is_done: bool = False,
    due_date: str | None = None,
    assigned_to_user_id: int | None = None,
) -> ProjectTodo:
    ensure_project_exists(session, project_id)
    todo = ProjectTodo(
        project_id=project_id,
        content=content,
        is_done=is_done,
        due_date=due_date,
        assigned_to_user_id=assigned_to_user_id,
    )
    session.add(todo)
    session.commit()
    session.refresh(todo)
    return todo


def update_project_todo(
    session: Session,
    project_id: int,
    todo_id: int,
    changes: dict,
) -> ProjectTodo:
    todo = get_project_todo_or_404(session, project_id, todo_id)
    execution = session.exec(
        select(ProjectQuestionRemediationExecution).where(
            ProjectQuestionRemediationExecution.project_id == project_id,
            ProjectQuestionRemediationExecution.target_todo_id == todo_id,
        )
    ).first()
    if (
        execution is not None
        and "is_done" in changes
        and bool(changes["is_done"]) != bool(todo.is_done)
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "This remediation todo must be completed through its evidence-governed "
                "execution lifecycle."
            ),
        )
    for key, value in changes.items():
        setattr(todo, key, value)
    todo.updated_at = utc_now_naive()
    session.add(todo)
    session.commit()
    session.refresh(todo)
    return todo


def delete_project_todo(session: Session, project_id: int, todo_id: int) -> None:
    todo = get_project_todo_or_404(session, project_id, todo_id)
    execution = session.exec(
        select(ProjectQuestionRemediationExecution).where(
            ProjectQuestionRemediationExecution.project_id == project_id,
            ProjectQuestionRemediationExecution.target_todo_id == todo_id,
        )
    ).first()
    if execution is not None:
        raise HTTPException(
            status_code=409,
            detail="A remediation todo with an audit ledger cannot be deleted.",
        )
    session.delete(todo)
    session.commit()


def list_user_pending_todos(session: Session, user_id: int) -> list[dict]:
    rows = session.exec(
        select(ProjectTodo, Project)
        .join(Project, ProjectTodo.project_id == Project.id)
        .where(
            ProjectTodo.assigned_to_user_id == user_id,
            ProjectTodo.is_done == False,
        )
        .order_by(ProjectTodo.updated_at.desc())
    ).all()
    return [serialize_todo(todo, project_name=project.name) for todo, project in rows]
