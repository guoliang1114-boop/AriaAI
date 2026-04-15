from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import (
    Conversation,
    Message,
    Milestone,
    Project,
    ProjectFile,
    ProjectFolder,
    ProjectMember,
    ProjectPayment,
    ProjectTodo,
)


def delete_project_cascade(session: Session, project_id: int) -> None:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    conversations = session.exec(
        select(Conversation).where(Conversation.project_id == project_id)
    ).all()
    for conversation in conversations:
        messages = session.exec(
            select(Message).where(Message.conversation_id == conversation.id)
        ).all()
        for message in messages:
            session.delete(message)
    session.flush()

    for conversation in conversations:
        session.delete(conversation)
    session.flush()

    for file in session.exec(select(ProjectFile).where(ProjectFile.project_id == project_id)).all():
        session.delete(file)
    session.flush()

    for folder in session.exec(select(ProjectFolder).where(ProjectFolder.project_id == project_id)).all():
        session.delete(folder)
    session.flush()

    for milestone in session.exec(select(Milestone).where(Milestone.project_id == project_id)).all():
        session.delete(milestone)
    session.flush()

    for payment in session.exec(select(ProjectPayment).where(ProjectPayment.project_id == project_id)).all():
        session.delete(payment)
    session.flush()

    for todo in session.exec(select(ProjectTodo).where(ProjectTodo.project_id == project_id)).all():
        session.delete(todo)
    session.flush()

    for member in session.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).all():
        session.delete(member)
    session.flush()

    session.delete(project)
    session.commit()
