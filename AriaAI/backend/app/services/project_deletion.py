from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import (
    Conversation,
    DocumentChunk,
    GeneratedFile,
    KnowledgeDocument,
    Message,
    Milestone,
    Project,
    ProjectFile,
    ProjectFolder,
    ProjectMember,
    ProjectMemorySnapshot,
    ProjectMemorySummary,
    ProjectPayment,
    ProjectTodo,
    ScheduledTask,
    TaskArtifact,
    TaskEvent,
    TaskRun,
    TaskStep,
    ToolCall,
)


def delete_project_cascade(session: Session, project_id: int) -> None:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    conversations = session.exec(
        select(Conversation).where(Conversation.project_id == project_id)
    ).all()
    conversation_ids = [conversation.id for conversation in conversations if conversation.id is not None]

    task_runs = session.exec(
        select(TaskRun).where(TaskRun.project_id == project_id)
    ).all()
    task_run_ids = [task.id for task in task_runs if task.id is not None]
    task_steps = session.exec(
        select(TaskStep).where(TaskStep.task_run_id.in_(task_run_ids))
    ).all() if task_run_ids else []
    task_step_ids = [step.id for step in task_steps if step.id is not None]
    for artifact in session.exec(
        select(TaskArtifact).where(TaskArtifact.task_run_id.in_(task_run_ids))
    ).all() if task_run_ids else []:
        session.delete(artifact)
    session.flush()

    for event in session.exec(
        select(TaskEvent).where(TaskEvent.task_run_id.in_(task_run_ids))
    ).all() if task_run_ids else []:
        session.delete(event)
    for event in session.exec(
        select(TaskEvent).where(TaskEvent.step_id.in_(task_step_ids))
    ).all() if task_step_ids else []:
        session.delete(event)
    session.flush()

    for step in task_steps:
        session.delete(step)
    session.flush()

    for task in task_runs:
        session.delete(task)
    session.flush()

    generated_files = session.exec(
        select(GeneratedFile).where(GeneratedFile.project_id == project_id)
    ).all()
    if conversation_ids:
        generated_files.extend(
            session.exec(select(GeneratedFile).where(GeneratedFile.conversation_id.in_(conversation_ids))).all()
        )
    generated_file_ids = [file.id for file in generated_files if file.id is not None]
    for tool_call in session.exec(
        select(ToolCall).where(ToolCall.conversation_id.in_(conversation_ids))
    ).all() if conversation_ids else []:
        session.delete(tool_call)
    for tool_call in session.exec(
        select(ToolCall).where(ToolCall.output_file_id.in_(generated_file_ids))
    ).all() if generated_file_ids else []:
        session.delete(tool_call)
    session.flush()

    for generated_file in {file.id: file for file in generated_files if file.id is not None}.values():
        session.delete(generated_file)
    session.flush()

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

    knowledge_documents = session.exec(
        select(KnowledgeDocument).where(KnowledgeDocument.project_id == project_id)
    ).all()
    knowledge_document_ids = [document.id for document in knowledge_documents if document.id is not None]
    for chunk in session.exec(
        select(DocumentChunk).where(DocumentChunk.document_id.in_(knowledge_document_ids))
    ).all() if knowledge_document_ids else []:
        session.delete(chunk)
    session.flush()

    for document in knowledge_documents:
        session.delete(document)
    session.flush()

    for summary in session.exec(select(ProjectMemorySummary).where(ProjectMemorySummary.project_id == project_id)).all():
        session.delete(summary)
    session.flush()

    for snapshot in session.exec(select(ProjectMemorySnapshot).where(ProjectMemorySnapshot.project_id == project_id)).all():
        session.delete(snapshot)
    session.flush()

    for scheduled_task in session.exec(select(ScheduledTask).where(ScheduledTask.project_id == project_id)).all():
        session.delete(scheduled_task)
    session.flush()

    project_files = session.exec(select(ProjectFile).where(ProjectFile.project_id == project_id)).all()
    for file in project_files:
        file.source_file_id = None
        session.add(file)
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
