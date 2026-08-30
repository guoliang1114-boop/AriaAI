"""Project-level context builder including files, milestones, and financials."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.models.db import (
    ClientRecord,
    ClientStakeholder,
    GeneratedFile,
    Milestone,
    Project,
    ProjectFile,
    ProjectPayment,
    ProjectProgressUpdate,
    ProjectTodo,
)
from app.services.project_files import active_project_files_stmt
from app.services.document_text import extract_text_from_file
from app.services.stakeholder_contexts import (
    format_client_stakeholders_for_prompt,
    list_client_stakeholder_dicts,
    serialize_client_stakeholder,
)
from app.services.project_clients import find_client_for_project
from app.services.context_builder.constants import (
    MAX_FILE_CONTENT_CHARS,
    MAX_SINGLE_FILE_CHARS,
    MAX_PROJECT_NOTES_CHARS,
    MAX_PROJECT_TODOS,
    MAX_PROJECT_ARTIFACTS,
    PROJECT_FILE_QUERY_MARKERS,
)
from app.services.context_builder.memory_formatters import _format_project_memory_for_prompt
from app.services.context_builder.query_classifiers import _normalize_client_match_text


def _safe_project_file_path(uploads_dir: Path, file_path: str | None) -> Path | None:
    """Validate and resolve a file path, preventing directory traversal attacks."""
    if not file_path:
        return None
    try:
        target = (uploads_dir / file_path).resolve()
        base = uploads_dir.resolve()
        # Ensure resolved path is within uploads_dir
        target.relative_to(base)
        return target
    except (ValueError, RuntimeError, OSError):
        return None


def _content_requests_file_details(content: str) -> bool:
    text = _normalize_client_match_text(content)
    return any(marker in text for marker in PROJECT_FILE_QUERY_MARKERS)


def extract_file_text(path: Path, file_type: str, max_chars: int = 4000) -> str:
    text = extract_text_from_file(
        path,
        file_type,
        max_chars=max_chars,
        empty_placeholder="[File appears to be empty]",
        unsupported_placeholder="[Binary file — text extraction not supported for this format]",
        error_prefix="[Could not extract text: ",
    )
    if text.startswith("[Could not extract text: ") and not text.endswith("]"):
        return f"{text}]"
    return text


def _current_extract_file_text():
    package = sys.modules.get("app.services.context_builder")
    return getattr(package, "extract_file_text", extract_file_text) if package else extract_file_text


def build_project_context(
    session: Session,
    project_id: int,
    file_ids: Optional[list[int]] = None,
    content: str = "",
    mention_context: Optional[dict] = None,
    memory_evidence_bundle: Optional[dict] = None,
) -> str:
    """Build context for a specific project including files, milestones, financials."""
    project = session.get(Project, project_id)
    if not project:
        return ""
    
    lines = [
        "## Scope Guard",
        "Use only the current project's context as the primary source of truth.",
        "Do not assume facts from other projects under the same client unless the user explicitly asks for cross-project comparison.",
        "If outside context is mentioned, label it as a hypothesis or reference rather than current-project fact.",
        "Context layering: structured project memory is the durable synthesized memory; notes, todos, files, financials, and artifacts are raw operational signals; RAG excerpts are cited knowledge references. Do not merge these layers into new facts unless the user asks you to update memory or documents.",
        "",
        f"**Project Name:** {project.name}",
        f"**Client:** {project.client}",
        f"**Status:** {project.status}",
    ]
    if project.description:
        lines.append(f"**Description:** {project.description}")
    if project.contract_amount:
        lines.append(f"**Contract Amount:** ¥{project.contract_amount:,.0f}")
    client = find_client_for_project(session, project)
    mention = mention_context or {}
    mentioned_stakeholder_ids = mention.get("stakeholder_ids") or []
    mentioned_milestone_ids = mention.get("milestone_ids") or []

    if client and client.id is not None:
        all_stakeholders = list_client_stakeholder_dicts(session, client.id)
        # If specific stakeholders are mentioned, bring them to the front
        if mentioned_stakeholder_ids and all_stakeholders:
            prioritized = []
            rest = []
            for s in all_stakeholders:
                if s.get("id") in mentioned_stakeholder_ids:
                    prioritized.append(s)
                else:
                    rest.append(s)
            all_stakeholders = prioritized + rest
        stakeholder_context = format_client_stakeholders_for_prompt(
            all_stakeholders,
            title="**Structured Client Stakeholders**",
        )
        if stakeholder_context:
            lines.append(f"\n{stakeholder_context}")
    
    # Mentioned stakeholders get extra focus
    if mentioned_stakeholder_ids and client and client.id is not None:
        focused = session.exec(
            select(ClientStakeholder).where(
                ClientStakeholder.id.in_(mentioned_stakeholder_ids),
                ClientStakeholder.client_id == client.id,
            )
        ).all()
        if focused:
            focused_dicts = [serialize_client_stakeholder(s) for s in focused]
            focus_context = format_client_stakeholders_for_prompt(
                focused_dicts,
                title="**Focused Stakeholders (mentioned by user)**",
            )
            if focus_context:
                lines.append(f"\n{focus_context}")

    # Prefer structured project memory over legacy free-form summary
    memory_context = _format_project_memory_for_prompt(
        project,
        content,
        evidence_bundle=memory_evidence_bundle,
    )
    if memory_context:
        lines.append(f"\n{memory_context}")
    elif project.context_summary:
        lines.append(f"\n**Project Context Summary:**\n{project.context_summary}")
    
    # Accumulated project notes
    if project.notes:
        notes = project.notes[:MAX_PROJECT_NOTES_CHARS]
        lines.append(f"\n**Project Notes:**\n{notes}")

    if project.md_notes:
        md_notes = project.md_notes[:MAX_PROJECT_NOTES_CHARS]
        lines.append(f"\n**Project Markdown Notes:**\n{md_notes}")
    
    # Milestones
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project.id)
    ).all()
    if milestones:
        # Prioritize mentioned milestones
        if mentioned_milestone_ids:
            prioritized = []
            rest = []
            for m in milestones:
                if m.id in mentioned_milestone_ids:
                    prioritized.append(m)
                else:
                    rest.append(m)
            milestones = prioritized + rest
        lines.append("\n**Milestones:**")
        for m in milestones:
            status_icon = "✓" if m.is_done else "○"
            due = f" (due: {m.due_date})" if m.due_date else ""
            priority = f" [{m.priority} priority]" if m.priority == "high" else ""
            mention_marker = " **[User Mentioned]**" if m.id in mentioned_milestone_ids else ""
            lines.append(f"  {status_icon} {m.title}{priority}{due}{mention_marker}")

    todos = session.exec(
        select(ProjectTodo)
        .where(ProjectTodo.project_id == project.id)
        .order_by(ProjectTodo.is_done, ProjectTodo.due_date, ProjectTodo.updated_at.desc())
        .limit(MAX_PROJECT_TODOS)
    ).all()
    if todos:
        lines.append("\n**Current Todos:**")
        for todo in todos:
            status_icon = "✓" if todo.is_done else "○"
            due = f" (due: {todo.due_date})" if todo.due_date else ""
            lines.append(f"  {status_icon} {todo.content}{due}")

    progress_updates = session.exec(
        select(ProjectProgressUpdate)
        .where(ProjectProgressUpdate.project_id == project.id)
        .order_by(ProjectProgressUpdate.created_at.desc())
        .limit(8)
    ).all()
    if progress_updates:
        lines.append("\n**Recent Progress Updates:**")
        for update in progress_updates:
            by = update.created_by.display_name if update.created_by else "unknown"
            lines.append(f"  - {by}: {update.content}")
            if update.next_step:
                lines.append(f"    next: {update.next_step}")
            if update.risk:
                lines.append(f"    risk: {update.risk}")
    
    should_inject_file_text = bool(file_ids) or _content_requests_file_details(content)

    # Files
    files = session.exec(active_project_files_stmt(project.id)).all()
    file_content_sections = []
    if files:
        lines.append("\n**Uploaded Documents:**")
        total_chars = 0
        for f in files:
            summary_hint = f" — {f.summary[:80]}" if f.summary else ""
            file_id_hint = f"id={f.id}, " if f.id is not None else ""
            lines.append(f"  - [{file_id_hint}{f.file_type.upper()}] {f.name}{summary_hint}")
            # Keep chat fast by default: project memory is the primary context.
            # Full file text is injected only when the user explicitly asks about files/documents.
            if (
                should_inject_file_text
                and f.file_type.lower() in ("pdf", "docx", "pptx", "xlsx", "xls", "txt", "md", "csv", "json")
                and total_chars < MAX_FILE_CONTENT_CHARS
            ):
                full_path = _safe_project_file_path(UPLOADS_DIR, f.path)
                text = ""
                if full_path:
                    text = _current_extract_file_text()(
                        full_path,
                        f.file_type,
                        max_chars=min(MAX_SINGLE_FILE_CHARS, MAX_FILE_CONTENT_CHARS - total_chars)
                    )
                if text and not text.startswith("["):
                    file_content_sections.append(f"### {f.name}\n{text}")
                    total_chars += len(text)
    
    # Financials
    payments = session.exec(
        select(ProjectPayment).where(ProjectPayment.project_id == project.id)
    ).all()
    if payments:
        received = sum(p.amount for p in payments if p.payment_type == "received")
        expense = sum(p.amount for p in payments if p.payment_type == "expense")
        if received or expense:
            lines.append(f"\n**Financials:** Received ¥{received:,.0f} | Expenses ¥{abs(expense):,.0f}")

    artifacts = session.exec(
        select(GeneratedFile)
        .where(GeneratedFile.project_id == project.id)
        .order_by(GeneratedFile.created_at.desc())
        .limit(MAX_PROJECT_ARTIFACTS)
    ).all()
    if artifacts:
        lines.append("\n**Recent Generated Artifacts:**")
        for artifact in artifacts:
            description = f" — {artifact.description[:120]}" if artifact.description else ""
            lines.append(f"  - [{artifact.file_type.upper()}] {artifact.name}{description}")
    
    # If the project is essentially empty (no memory, no notes, no milestones, no files, no financials),
    # explicitly tell the AI not to look for deeper material and to work with what it has.
    has_substantive_data = bool(
        memory_context
        or project.context_summary
        or project.notes
        or project.md_notes
        or milestones
        or todos
        or files
        or payments
        or artifacts
    )
    if not has_substantive_data:
        lines.append(
            "\n**Project Data Status:** This is a newly created project. "
            "Only the basic fields above are available. "
            "Do not ask the user to upload files or fill forms before producing deliverables. "
            "Base your response on the project basics and the user's current request."
        )
    
    project_context = "\n".join(lines)
    
    # Append auto-injected file contents
    if file_content_sections:
        project_context += "\n\n## Project File Contents\n" + "\n\n---\n\n".join(file_content_sections)
    
    # Inject selected project file contents
    if file_ids:
        file_sections = []
        for fid in file_ids:
            pf = session.get(ProjectFile, fid)
            if pf and pf.project_id == project.id and pf.deleted_at is None:
                full_path = _safe_project_file_path(UPLOADS_DIR, pf.path)
                if full_path:
                    text = _current_extract_file_text()(full_path, pf.file_type)
                    file_sections.append(f"### {pf.name}\n{text}")
        if file_sections:
            attachment_block = "\n\n---\n\n".join(file_sections)
            project_context += "\n\n## Attached Files\n" + attachment_block
    
    return project_context
