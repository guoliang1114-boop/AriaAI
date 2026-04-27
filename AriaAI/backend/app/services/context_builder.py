"""Context builder — assemble AI context from projects, files, RAG, and skills."""
from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
from typing import Optional

from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.models.db import (
    ClientRecord,
    Milestone,
    Project,
    ProjectFile,
    ProjectPayment,
    Skill,
)
from app.services.document_text import extract_text_from_file
from app.services.project_contexts import get_project_memory_payload
from app.services.rag import retrieve_structured
from app.services.stakeholder_contexts import (
    find_client_by_name,
    format_client_stakeholders_for_prompt,
    list_client_stakeholder_dicts,
)
from app.services.time_utils import utc_now_naive
from app.services.tool_executor import format_tools_for_claude

MAX_FILE_CONTENT_CHARS = 40000  # cap total injected content to ~10k tokens
MAX_SINGLE_FILE_CHARS = 8000


def _format_project_memory_for_prompt(project: Project) -> str:
    memory = get_project_memory_payload(project)
    if not memory or (project.memory_version or 0) <= 0:
        return ""

    lines: list[str] = []
    if memory.get("project_brief"):
        lines.append(f"- Project brief: {memory['project_brief']}")
    if memory.get("current_stage"):
        lines.append(f"- Current stage: {memory['current_stage']}")
    if memory.get("current_objective"):
        lines.append(f"- Current objective: {memory['current_objective']}")

    for key, label in (
        ("recent_progress", "Recent progress"),
        ("key_risks", "Key risks"),
        ("open_questions", "Open questions"),
        ("next_actions", "Next actions"),
    ):
        items = [str(item).strip() for item in (memory.get(key) or []) if str(item).strip()]
        if items:
            lines.append(f"- {label}: " + "; ".join(items[:4]))

    important_documents = memory.get("important_documents") or []
    document_bits: list[str] = []
    for document in important_documents[:4]:
        if isinstance(document, dict):
            name = str(document.get("name") or "").strip()
            summary = str(document.get("summary") or "").strip()
            if name and summary:
                document_bits.append(f"{name}: {summary}")
            elif name:
                document_bits.append(name)
        elif document:
            document_bits.append(str(document).strip())
    if document_bits:
        lines.append("- Important documents: " + "; ".join(document_bits))

    if memory.get("financial_status"):
        lines.append(f"- Financial status: {memory['financial_status']}")

    structured = memory.get("client_stakeholders") or []
    if isinstance(structured, list):
        structured_context = format_client_stakeholders_for_prompt(
            [item for item in structured if isinstance(item, dict)],
            title="Client stakeholders",
        )
        if structured_context:
            lines.append(structured_context)

    if not lines:
        return ""
    return "**Structured Project Memory:**\n" + "\n".join(lines)


def _format_client_memory_for_prompt(client: ClientRecord) -> str:
    try:
        memory = json.loads(client.client_memory_json or "{}")
        if not isinstance(memory, dict):
            memory = {}
    except Exception:
        memory = {}

    if not memory or (client.client_memory_version or 0) <= 0:
        return ""

    lines: list[str] = []
    if memory.get("client_profile"):
        lines.append(f"- Client profile: {memory['client_profile']}")
    for key, label in (
        ("decision_patterns", "Decision patterns"),
        ("lessons_learned", "Lessons learned"),
        ("sensitive_topics", "Sensitive topics"),
    ):
        items = [str(item).strip() for item in (memory.get(key) or []) if str(item).strip()]
        if items:
            lines.append(f"- {label}: " + "; ".join(items[:4]))

    contacts = memory.get("key_contacts") or []
    contact_bits: list[str] = []
    for item in contacts[:4]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        role = str(item.get("role") or "").strip()
        note = str(item.get("note") or "").strip()
        bit = " / ".join(part for part in (name, role, note) if part)
        if bit:
            contact_bits.append(bit)
    if contact_bits:
        lines.append("- Key contacts: " + "; ".join(contact_bits))

    structured = memory.get("structured_stakeholders") or []
    if isinstance(structured, list):
        structured_context = format_client_stakeholders_for_prompt(
            [item for item in structured if isinstance(item, dict)],
            title="Structured stakeholders",
        )
        if structured_context:
            lines.append(structured_context)

    if not lines:
        return ""
    return "**Structured Client Memory:**\n" + "\n".join(lines)


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


class SkillContext:
    """Context for a skill including prompt, tools, and max_tokens."""
    def __init__(
        self,
        skill_prompt: str = "",
        tools: Optional[list] = None,
        max_tokens: Optional[int] = None,
    ):
        self.skill_prompt = skill_prompt
        self.tools = tools
        self.max_tokens = max_tokens


def build_skill_context(
    session: Session,
    skill_id: Optional[int],
    default_max_tokens: int = 4096,
) -> SkillContext:
    """Build context from a skill definition."""
    skill_prompt = ""
    tools = None
    max_tokens = default_max_tokens
    
    if skill_id:
        skill = session.get(Skill, skill_id)
        if skill:
            skill_prompt = skill.system_prompt
            max_tokens = skill.max_tokens or max_tokens
            # Load tools from skill
            if skill.tools_definition_json and skill.tools_definition_json.strip():
                try:
                    tools = format_tools_for_claude(
                        __import__("json").loads(skill.tools_definition_json)
                    )
                except Exception:
                    pass
    
    return SkillContext(
        skill_prompt=skill_prompt,
        tools=tools,
        max_tokens=max_tokens,
    )


def build_global_workspace_context(session: Session) -> str:
    """Build global workspace context with all non-archived projects."""
    all_projects = session.exec(
        select(Project).where(Project.status != "archived").order_by(Project.updated_at.desc())
    ).all()
    
    if not all_projects:
        return ""
    
    today_str = utc_now_naive().strftime("%Y-%m-%d")
    ws_lines = [
        f"# 工作台全局数据（截至 {today_str}）",
        f"当前共有 {len(all_projects)} 个活跃项目。以下是每个项目的详细信息：\n",
    ]
    
    for p in all_projects:
        ws_lines.append(f"## 项目：{p.name}")
        ws_lines.append(f"- 客户：{p.client}")
        ws_lines.append(f"- 阶段：{p.status}")
        if p.contract_amount:
            ws_lines.append(f"- 合同金额：¥{p.contract_amount:,.0f}")
        if p.description:
            ws_lines.append(f"- 简介：{p.description[:200]}")
        memory_preview = _format_project_memory_for_prompt(p)
        if memory_preview:
            ws_lines.append("- Structured memory: ready")
        elif p.context_summary:
            ws_lines.append(f"- AI 摘要：{p.context_summary[:300]}")
        if p.notes:
            ws_lines.append(f"- 项目笔记：{p.notes[:200]}")
        
        # Milestones
        milestones = session.exec(
            select(Milestone).where(Milestone.project_id == p.id)
        ).all()
        if milestones:
            done = sum(1 for m in milestones if m.is_done)
            overdue = [
                m for m in milestones
                if not m.is_done and m.due_date and m.due_date < today_str
            ]
            ws_lines.append(
                f"- 里程碑：{done}/{len(milestones)} 已完成" +
                (f"，{len(overdue)} 个已逾期" if overdue else "")
            )
            for m in milestones:
                status_icon = "✓" if m.is_done else (
                    "⚠ 逾期" if m.due_date and m.due_date < today_str else "○"
                )
                due = f"（截止 {m.due_date}）" if m.due_date else ""
                priority = "【高优先级】" if m.priority == "high" else ""
                ws_lines.append(f"  {status_icon} {m.title}{priority}{due}")
        
        # Financials
        payments = session.exec(
            select(ProjectPayment).where(ProjectPayment.project_id == p.id)
        ).all()
        if payments:
            received = sum(pay.amount for pay in payments if pay.payment_type == "received")
            expense = sum(pay.amount for pay in payments if pay.payment_type == "expense")
            if received or expense:
                ws_lines.append(f"- 财务：已收款 ¥{received:,.0f}，支出 ¥{abs(expense):,.0f}")
        ws_lines.append("")
    
    return "\n".join(ws_lines)


def build_lightweight_workspace_context(session: Session) -> str:
    """Build a compact workspace brief for standalone chat."""
    all_projects = session.exec(
        select(Project).where(Project.status != "archived").order_by(Project.updated_at.desc())
    ).all()

    if not all_projects:
        return ""

    today_str = utc_now_naive().strftime("%Y-%m-%d")
    active_projects = [project for project in all_projects if project.status not in {"completed", "archived"}]
    recent_projects = all_projects[:5]

    ws_lines = [
        f"# Workspace Brief ({today_str})",
        f"- Active projects: {len(active_projects)}",
        f"- Total tracked projects: {len(all_projects)}",
        "- Use this brief only as lightweight operating context for standalone chat.",
        "- If the user asks about a specific project, ask for or switch into that project context before making detailed claims.",
        "",
        "## Recent project snapshot",
    ]

    for project in recent_projects:
        line = f"- {project.name} | client={project.client} | status={project.status}"
        if project.contract_amount:
            line += f" | amount={project.contract_amount:,.0f}"
        ws_lines.append(line)
        if project.context_summary:
            ws_lines.append(f"  summary: {project.context_summary[:120]}")

    return "\n".join(ws_lines)


def _normalize_client_match_text(value: str) -> str:
    return "".join(str(value or "").lower().split())


def is_client_project_portfolio_query(content: str) -> bool:
    text = _normalize_client_match_text(content)
    if not text:
        return False
    all_project_markers = (
        "全部项目",
        "所有项目",
        "全部的项目",
        "所有的项目",
        "allprojects",
        "allproject",
        "projectportfolio",
        "portfolio",
    )
    summary_markers = (
        "项目情况",
        "项目状态",
        "项目风险",
        "情况及风险",
        "总结",
        "汇总",
        "风险",
        "summary",
        "summarize",
        "risk",
        "risks",
    )
    return any(marker in text for marker in all_project_markers) and any(marker in text for marker in summary_markers)


def _find_client_name_in_query(session: Session, content: str) -> str:
    query_text = _normalize_client_match_text(content)
    if not query_text:
        return ""

    client_names: set[str] = set()
    for client in session.exec(select(Project.client).where(Project.client != "")).all():
        if client:
            client_names.add(client.strip())
    for name in session.exec(select(ClientRecord.name).where(ClientRecord.name != "")).all():
        if name:
            client_names.add(name.strip())

    matches = [
        name
        for name in client_names
        if _normalize_client_match_text(name) and _normalize_client_match_text(name) in query_text
    ]
    if not matches:
        return ""
    return max(matches, key=len)


def _memory_items_for_portfolio(memory: dict, key: str, limit: int = 4) -> list[str]:
    raw = memory.get(key)
    if isinstance(raw, dict):
        values = []
        for slot in ("pinned", "ai"):
            slot_value = raw.get(slot)
            if isinstance(slot_value, list):
                values.extend(slot_value)
        raw = values
    if not isinstance(raw, list):
        return []
    items = []
    for item in raw:
        text = str(item or "").strip()
        if text:
            items.append(text[:180])
        if len(items) >= limit:
            break
    return items


def build_client_project_portfolio_context(
    session: Session,
    content: str,
    fallback_client_name: str = "",
) -> str:
    """Build a complete per-client project inventory for portfolio questions."""
    if not is_client_project_portfolio_query(content):
        return ""

    client_name = _find_client_name_in_query(session, content) or fallback_client_name.strip()
    if not client_name:
        return ""

    normalized_client = _normalize_client_match_text(client_name)
    projects = [
        project
        for project in session.exec(select(Project).order_by(Project.updated_at.desc())).all()
        if _normalize_client_match_text(project.client) == normalized_client
    ]
    if not projects:
        return ""

    today_str = utc_now_naive().strftime("%Y-%m-%d")
    lines = [
        f"# Client Project Portfolio Context ({today_str})",
        f"- Client requested by user: {client_name}",
        f"- Matched projects: {len(projects)}",
        "- Coverage rule: every project listed below belongs to this client and must be considered in the answer.",
        "- When the user asks for all project status and risks, include an inventory/checklist so no listed project is omitted.",
        "- Archived projects are included because the user asked for all projects.",
        "",
    ]

    for index, project in enumerate(projects, start=1):
        memory = get_project_memory_payload(project)
        lines.append(f"## {index}. {project.name}")
        lines.append(f"- Project ID: {project.id}")
        lines.append(f"- Client: {project.client}")
        lines.append(f"- Status: {project.status}")
        if project.contract_amount:
            lines.append(f"- Contract amount: {project.contract_amount:,.0f}")
        if project.description:
            lines.append(f"- Description: {project.description[:240]}")
        if project.context_summary:
            lines.append(f"- Existing summary: {project.context_summary[:360]}")
        if memory.get("project_brief"):
            lines.append(f"- Memory brief: {str(memory['project_brief'])[:360]}")
        if memory.get("current_stage"):
            lines.append(f"- Memory stage: {memory['current_stage']}")
        if memory.get("financial_status"):
            lines.append(f"- Financial status: {str(memory['financial_status'])[:240]}")

        for key, label in (
            ("key_risks", "Known risks"),
            ("open_questions", "Open questions"),
            ("next_actions", "Next actions"),
            ("delivery_signals", "Delivery signals"),
        ):
            items = _memory_items_for_portfolio(memory, key)
            if items:
                lines.append(f"- {label}: " + "; ".join(items))

        milestones = session.exec(select(Milestone).where(Milestone.project_id == project.id)).all()
        if milestones:
            done = sum(1 for milestone in milestones if milestone.is_done)
            overdue = [
                milestone
                for milestone in milestones
                if not milestone.is_done and milestone.due_date and milestone.due_date < today_str
            ]
            lines.append(f"- Milestones: {done}/{len(milestones)} completed" + (f"; {len(overdue)} overdue" if overdue else ""))
            for milestone in milestones[:8]:
                status = "done" if milestone.is_done else "pending"
                due = f" due={milestone.due_date}" if milestone.due_date else ""
                priority = f" priority={milestone.priority}" if milestone.priority == "high" else ""
                lines.append(f"  - {status}: {milestone.title}{priority}{due}")

        payments = session.exec(select(ProjectPayment).where(ProjectPayment.project_id == project.id)).all()
        if payments:
            received = sum(payment.amount for payment in payments if payment.payment_type == "received")
            expense = sum(payment.amount for payment in payments if payment.payment_type == "expense")
            lines.append(f"- Financials: received={received:,.0f}; expenses={abs(expense):,.0f}")
        lines.append("")

    return "\n".join(lines)


def build_project_context(
    session: Session,
    project_id: int,
    file_ids: Optional[list[int]] = None,
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
        "",
        f"**Project Name:** {project.name}",
        f"**Client:** {project.client}",
        f"**Status:** {project.status}",
    ]
    if project.description:
        lines.append(f"**Description:** {project.description}")
    if project.contract_amount:
        lines.append(f"**Contract Amount:** ¥{project.contract_amount:,.0f}")
    client = find_client_by_name(session, project.client)
    if client and client.id is not None:
        stakeholder_context = format_client_stakeholders_for_prompt(
            list_client_stakeholder_dicts(session, client.id),
            title="**Structured Client Stakeholders**",
        )
        if stakeholder_context:
            lines.append(f"\n{stakeholder_context}")

    # Prefer structured project memory over legacy free-form summary
    memory_context = _format_project_memory_for_prompt(project)
    if memory_context:
        lines.append(f"\n{memory_context}")
    elif project.context_summary:
        lines.append(f"\n**Project Context Summary:**\n{project.context_summary}")
    
    # Accumulated project notes
    if project.notes:
        lines.append(f"\n**Project Notes:**\n{project.notes}")
    
    # Milestones
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project.id)
    ).all()
    if milestones:
        lines.append("\n**Milestones:**")
        for m in milestones:
            status_icon = "✓" if m.is_done else "○"
            due = f" (due: {m.due_date})" if m.due_date else ""
            priority = f" [{m.priority} priority]" if m.priority == "high" else ""
            lines.append(f"  {status_icon} {m.title}{priority}{due}")
    
    # Files
    files = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project.id)
    ).all()
    file_content_sections = []
    if files:
        lines.append("\n**Uploaded Documents (full content auto-injected below):**")
        total_chars = 0
        for f in files:
            summary_hint = f" — {f.summary[:80]}" if f.summary else ""
            lines.append(f"  - {f.name} ({f.file_type.upper()}){summary_hint}")
            # Auto-inject readable file content
            if (
                f.file_type.lower() in ("pdf", "docx", "pptx", "xlsx", "xls", "txt", "md", "csv", "json")
                and total_chars < MAX_FILE_CONTENT_CHARS
            ):
                full_path = UPLOADS_DIR / f.path
                text = extract_file_text(
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
    
    project_context = "\n".join(lines)
    
    # Append auto-injected file contents
    if file_content_sections:
        project_context += "\n\n## Project File Contents\n" + "\n\n---\n\n".join(file_content_sections)
    
    # Inject selected project file contents
    if file_ids:
        file_sections = []
        for fid in file_ids:
            pf = session.get(ProjectFile, fid)
            if pf and pf.project_id == project.id:
                full_path = UPLOADS_DIR / pf.path
                text = extract_file_text(full_path, pf.file_type)
                file_sections.append(f"### {pf.name}\n{text}")
        if file_sections:
            attachment_block = "\n\n---\n\n".join(file_sections)
            project_context += "\n\n## Attached Files\n" + attachment_block
    
    return project_context


def build_rag_context(
    session: Session,
    query: str,
    rag_doc_ids: Optional[list[int]] = None,
    project_id: Optional[int] = None,
    knowledge_scope: str = "global",
    auto_trigger: bool = True,
) -> dict:
    """
    Build RAG context from knowledge documents.
    
    Returns structured dict with both text for LLM and sources for citations.
    """
    # Check if RAG should trigger
    should_retrieve = bool(rag_doc_ids) or (auto_trigger and "#doc" in query)
    
    if not should_retrieve:
        return {"text": "", "sources": []}
    
    # Perform structured retrieval
    client_id = None
    effective_project_id = None
    if not rag_doc_ids and knowledge_scope == "project" and project_id is not None:
        effective_project_id = project_id
    elif not rag_doc_ids and knowledge_scope == "client" and project_id is not None:
        project = session.get(Project, project_id)
        if project and project.client.strip():
            client = session.exec(
                select(ClientRecord).where(ClientRecord.name.ilike(project.client.strip()))
            ).first()
            if client:
                client_id = client.id
            else:
                # Fall back to the current project instead of widening to global retrieval.
                effective_project_id = project_id

    ctx = retrieve_structured(
        query,
        session,
        rag_doc_ids,
        project_id=effective_project_id,
        client_id=client_id,
    )
    
    return {
        "text": ctx.to_text(),
        "sources": [r.to_dict() for r in ctx.results],
        "query": ctx.query,
    }


class ChatContext:
    """Complete context for a chat session."""
    def __init__(
        self,
        skill_prompt: str = "",
        project_context: str = "",
        rag_context: str = "",
        rag_sources: Optional[list] = None,
        tools: Optional[list] = None,
        max_tokens: int = 4096,
    ):
        self.skill_prompt = skill_prompt
        self.project_context = project_context
        self.rag_context = rag_context
        self.rag_sources = rag_sources or []
        self.tools = tools
        self.max_tokens = max_tokens


def build_chat_context(
    session: Session,
    skill_id: Optional[int] = None,
    project_id: Optional[int] = None,
    knowledge_scope: str = "global",
    rag_doc_ids: Optional[list[int]] = None,
    file_ids: Optional[list[int]] = None,
    content: str = "",
    default_max_tokens: int = 4096,
) -> ChatContext:
    """Build complete chat context including skill, project, and RAG."""
    # Build skill context
    skill_ctx = build_skill_context(session, skill_id, default_max_tokens)
    
    project = session.get(Project, project_id) if project_id else None
    portfolio_context = build_client_project_portfolio_context(
        session,
        content,
        fallback_client_name=project.client if project and project.client else "",
    )
    if portfolio_context:
        project_context = portfolio_context
    elif project_id:
        project_context = build_project_context(session, project_id, file_ids)
    else:
        project_context = build_lightweight_workspace_context(session)

    if knowledge_scope == "client" and project is not None and not portfolio_context:
        if project and project.client.strip():
            client = session.exec(
                select(ClientRecord).where(ClientRecord.name.ilike(project.client.strip()))
            ).first()
            if client:
                client_memory_context = _format_client_memory_for_prompt(client)
                if client_memory_context:
                    project_context = client_memory_context + "\n\n" + project_context

    if skill_id and project_context.strip():
        skill_briefing = (
            "\n\nCurrent workspace briefing:\n"
            "Use the project/client context below as the default operating context for this skill run. "
            "Prefer these facts over generic assumptions, and keep outputs grounded in the current workspace."
        )
        skill_ctx.skill_prompt = (skill_ctx.skill_prompt or "").strip() + skill_briefing
    
    # Build RAG context
    rag_data = build_rag_context(
        session,
        content,
        rag_doc_ids,
        project_id=project_id,
        knowledge_scope=knowledge_scope,
        auto_trigger=True,
    )
    
    return ChatContext(
        skill_prompt=skill_ctx.skill_prompt,
        project_context=project_context,
        rag_context=rag_data["text"],
        rag_sources=rag_data["sources"],
        tools=skill_ctx.tools,
        max_tokens=skill_ctx.max_tokens or default_max_tokens,
    )
