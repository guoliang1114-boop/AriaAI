from __future__ import annotations

from sqlmodel import Session, select

from app.models.db import (
    ArtifactVerification,
    ChatRun,
    ChatTrace,
    Conversation,
    ConversationState,
    DocumentChunk,
    GeneratedFile,
    KnowledgeDocument,
    MemoryCandidate,
    Message,
    Milestone,
    PendingToolAction,
    Project,
    ProjectFile,
    ProjectFileVersion,
    ProjectFolder,
    ProjectMember,
    ProjectMemoryFact,
    ProjectMemorySnapshot,
    ProjectMemorySlot,
    ProjectMemorySummary,
    ProjectPayment,
    ProjectProgressUpdate,
    ProjectTodo,
    ScheduledTask,
    TaskArtifact,
    TaskEvent,
    TaskRun,
    TaskStep,
    ToolCall,
    WeeklyFocusItem,
)
from app.services.project_core import lock_and_require_project_write


def delete_project_cascade(
    session: Session,
    project_id: int,
    *,
    actor_user_id: int,
) -> tuple[int | None, str]:
    # Use the same owner -> child lock order as memory save/stale paths. Without
    # this lock, deletion could flush ProjectMemorySlot/Fact deletes first while
    # a concurrent rebuild held the project row and waited on those children.
    project, _actor = lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    client_name = str(project.client or "")
    client_id = project.client_id

    for candidate in session.exec(
        select(MemoryCandidate).where(MemoryCandidate.project_id == project_id)
    ).all():
        session.delete(candidate)
    session.flush()

    conversations = session.exec(
        select(Conversation).where(Conversation.project_id == project_id)
    ).all()
    conversation_ids = [conversation.id for conversation in conversations if conversation.id is not None]

    chat_runs: dict[int, ChatRun] = {}
    for chat_run in session.exec(select(ChatRun).where(ChatRun.project_id == project_id)).all():
        chat_runs[chat_run.id] = chat_run
    if conversation_ids:
        for chat_run in session.exec(
            select(ChatRun).where(ChatRun.conversation_id.in_(conversation_ids))
        ).all():
            chat_runs[chat_run.id] = chat_run
    for chat_run in chat_runs.values():
        session.delete(chat_run)
    session.flush()

    # ChatTrace, ConversationState, and ProjectFileVersion were added after this
    # cascade was first written and were never included. They carry FKs to
    # conversation / message / project_file / project, so deleting those parents
    # below raises an IntegrityError (surfaced to the client as a 500). They are
    # leaf tables (nothing references them), so delete them up front. Dedupe by
    # id since a row can match both the project_id and conversation_id filters.
    traces: dict[int, ChatTrace] = {}
    for trace in session.exec(select(ChatTrace).where(ChatTrace.project_id == project_id)).all():
        traces[trace.id] = trace
    if conversation_ids:
        for trace in session.exec(
            select(ChatTrace).where(ChatTrace.conversation_id.in_(conversation_ids))
        ).all():
            traces[trace.id] = trace
    for trace in traces.values():
        session.delete(trace)

    conversation_states: dict[int, ConversationState] = {}
    for state in session.exec(select(ConversationState).where(ConversationState.project_id == project_id)).all():
        conversation_states[state.id] = state
    if conversation_ids:
        for state in session.exec(
            select(ConversationState).where(ConversationState.conversation_id.in_(conversation_ids))
        ).all():
            conversation_states[state.id] = state
    for state in conversation_states.values():
        session.delete(state)

    for version in session.exec(
        select(ProjectFileVersion).where(ProjectFileVersion.project_id == project_id)
    ).all():
        session.delete(version)
    session.flush()

    task_runs_by_id: dict[int, TaskRun] = {
        task.id: task
        for task in session.exec(
            select(TaskRun).where(TaskRun.project_id == project_id)
        ).all()
        if task.id is not None
    }
    if conversation_ids:
        for task in session.exec(
            select(TaskRun).where(TaskRun.conversation_id.in_(conversation_ids))
        ).all():
            if task.id is not None:
                task_runs_by_id[task.id] = task
    task_runs = list(task_runs_by_id.values())
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
    for verification in session.exec(
        select(ArtifactVerification).where(
            ArtifactVerification.generated_file_id.in_(generated_file_ids)
        )
    ).all() if generated_file_ids else []:
        session.delete(verification)
    session.flush()
    for tool_call in session.exec(
        select(ToolCall).where(ToolCall.conversation_id.in_(conversation_ids))
    ).all() if conversation_ids else []:
        session.delete(tool_call)
    for tool_call in session.exec(
        select(ToolCall).where(ToolCall.output_file_id.in_(generated_file_ids))
    ).all() if generated_file_ids else []:
        session.delete(tool_call)
    session.flush()

    pending_actions = []
    if conversation_ids:
        pending_actions.extend(
            session.exec(
                select(PendingToolAction).where(PendingToolAction.conversation_id.in_(conversation_ids))
            ).all()
        )
    pending_actions.extend(
        session.exec(select(PendingToolAction).where(PendingToolAction.project_id == project_id)).all()
    )
    for action in {action.id: action for action in pending_actions if action.id is not None}.values():
        session.delete(action)
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

    for slot in session.exec(
        select(ProjectMemorySlot).where(ProjectMemorySlot.project_id == project_id)
    ).all():
        session.delete(slot)
    session.flush()

    for fact in session.exec(
        select(ProjectMemoryFact).where(ProjectMemoryFact.project_id == project_id)
    ).all():
        session.delete(fact)
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

    todos = session.exec(
        select(ProjectTodo).where(ProjectTodo.project_id == project_id)
    ).all()
    todo_ids = [todo.id for todo in todos if todo.id is not None]
    focus_items: dict[int, WeeklyFocusItem] = {
        item.id: item
        for item in session.exec(
            select(WeeklyFocusItem).where(WeeklyFocusItem.project_id == project_id)
        ).all()
        if item.id is not None
    }
    if todo_ids:
        for item in session.exec(
            select(WeeklyFocusItem).where(WeeklyFocusItem.source_todo_id.in_(todo_ids))
        ).all():
            if item.id is not None:
                focus_items[item.id] = item
    for item in focus_items.values():
        if item.project_id == project_id:
            item.project_id = None
        if item.source_todo_id in todo_ids:
            item.source_todo_id = None
        session.add(item)
    session.flush()

    for todo in todos:
        session.delete(todo)
    session.flush()

    for update in session.exec(select(ProjectProgressUpdate).where(ProjectProgressUpdate.project_id == project_id)).all():
        session.delete(update)
    session.flush()

    for member in session.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).all():
        session.delete(member)
    session.flush()

    session.delete(project)
    session.commit()
    return client_id, client_name
