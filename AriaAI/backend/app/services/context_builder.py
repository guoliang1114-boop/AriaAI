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
    GeneratedFile,
    KnowledgeDocument,
    Milestone,
    Project,
    ProjectFile,
    ProjectPayment,
    ProjectTodo,
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
from app.tools import project_markdown as _project_markdown  # noqa: F401 - register project Markdown tools
from app.tools.office_documents import WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME

MAX_FILE_CONTENT_CHARS = 40000  # cap total injected content to ~10k tokens
MAX_SINGLE_FILE_CHARS = 8000
MAX_PROJECT_NOTES_CHARS = 6000
MAX_PROJECT_TODOS = 12
MAX_PROJECT_ARTIFACTS = 8
PROJECT_MARKDOWN_TOOL_NAMES = ["update_project_markdown_document", "read_project_markdown_document"]
PROJECT_OFFICE_TOOL_NAMES = [WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME]
PROJECT_MARKDOWN_TOOL_PROMPT = """

Project space document tools:
- Use `read_project_markdown_document` with action='list' to discover which MD files exist in this project (returns id, name, folder, summary).
- Use `read_project_markdown_document` with action='read' and a file_id or file_name to read a specific file's content before answering questions about it.
- Use `update_project_markdown_document` to create, append to, or replace an MD file.
- Use `write_project_office_document` whenever the user asks you to create a PPT/PPTX, Word/DOCX, Excel/XLSX, or PDF deliverable. This tool creates the file and saves it into the current project space.
- For PPT/PPTX requests, call `write_project_office_document` with file_type='pptx', a clear file_name ending in .pptx, a title, summary, and a slides array. Use slide objects with type/title/content or type='two_column' with left_content/right_content.
- For DOCX/PDF requests, provide title plus sections/content. For XLSX requests, provide sheets. Do NOT merely describe that a file can be created.
- CRITICAL: When the user asks you to edit, update, rewrite, correct, create, modify, adjust, fix, or change a project document — OR when the user says they want to "矫正", "修改", "调整", "重写" a file — you MUST call `update_project_markdown_document` with mode='replace' and the complete new content.
- DO NOT just describe the changes in your text reply. DO NOT say "I will update it" or "Now I will write" without actually calling the tool. The user cannot see your draft until you save it via the tool. You MUST invoke the tool IMMEDIATELY after reading the file if the user asked you to modify it.
- ABSOLUTELY DO NOT output tool_use JSON as plain text in your response. If you need to call update_project_markdown_document, use the actual function calling API. Text that looks like {"type": "tool_use", ...} will NOT execute and the user will think you failed.
- BREAK THE PATTERN: After receiving a tool_result, if the user's request still requires a write operation, you MUST call update_project_markdown_document in your follow-up response. The follow-up is NOT just for summaries — it can and SHOULD contain new tool calls when needed.
- If the user's message contains both a read request and a write request (e.g. "我先读取，确认后再矫正"), you MUST perform BOTH in the SAME turn: first read the file, then immediately call update_project_markdown_document with the corrected content. Do NOT split this into multiple messages.
- Prefer using file_id (from a prior list call) when targeting a file. If the target is ambiguous, call list first, then read.
- For replace mode, send the complete final Markdown content, not a diff.
- MAXIMUM 2 READS: When asked to correct a file, read AT MOST 2 files (the target file + optionally one reference file). Do NOT keep reading additional files. After reading, call update_project_markdown_document immediately.
- STOP READING LOOP: If you have already read the target file, do NOT read more files. Proceed directly to update_project_markdown_document. The user prefers an imperfect correction now over a perfect correction later.
""".strip()
PROJECT_FILE_QUERY_MARKERS = (
    "file",
    "files",
    "document",
    "documents",
    "attachment",
    "attachments",
    "source",
    "\u6587\u4ef6",
    "\u6587\u6863",
    "\u9644\u4ef6",
    "\u6750\u6599",
    "\u539f\u6587",
    "\u4e0a\u4f20",
)


def _safe_project_file_path(uploads_dir: _Path, file_path: str | None) -> _Path | None:
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


def _filter_skill_tools(skill: Skill, tool_defs: list[dict]) -> list[dict]:
    """Keep deliverable-only tool scopes for skills with strict output contracts."""
    skill_text = f"{skill.name}\n{skill.system_prompt or ''}".lower()
    if "digital-strategy" not in skill_text and "数字化战略" not in skill_text:
        return tool_defs
    return [tool for tool in tool_defs if tool.get("name") == "generate_ppt_from_skill"]


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
                    tool_defs = __import__("json").loads(skill.tools_definition_json)
                    tools = format_tools_for_claude(_filter_skill_tools(skill, tool_defs))
                except Exception:
                    pass
    
    return SkillContext(
        skill_prompt=skill_prompt,
        tools=tools,
        max_tokens=max_tokens,
    )


def _merge_project_chat_tools(tools: Optional[list], project_id: Optional[int]) -> Optional[list]:
    if project_id is None:
        return tools
    project_tools = format_tools_for_claude(PROJECT_MARKDOWN_TOOL_NAMES + PROJECT_OFFICE_TOOL_NAMES)
    if not project_tools:
        return tools
    if not tools:
        return project_tools
    existing = {tool.get("name") for tool in tools if isinstance(tool, dict)}
    merged = list(tools)
    for tool in project_tools:
        if tool.get("name") not in existing:
            merged.append(tool)
    return merged


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
    """Build a memory-first workspace brief for standalone chat."""
    all_projects = session.exec(
        select(Project).where(Project.status != "archived").order_by(Project.updated_at.desc())
    ).all()

    if not all_projects:
        return ""

    today_str = utc_now_naive().strftime("%Y-%m-%d")
    active_projects = [project for project in all_projects if project.status not in {"completed", "archived"}]

    ws_lines = [
        f"# Workspace Brief ({today_str})",
        f"- Active projects: {len(active_projects)}",
        f"- Total tracked projects: {len(all_projects)}",
        "- This brief is memory-first and lists every non-archived project so standalone chat can answer portfolio questions quickly.",
        "- Use project memory fields as the first source of truth. If details are missing, say which project is missing memory rather than inventing facts.",
        "- Do not claim that only a partial project snapshot is available.",
        "",
        "## Project Memory Index",
    ]

    for index, project in enumerate(all_projects, start=1):
        memory = get_project_memory_payload(project)
        line = f"- {project.name} | client={project.client} | status={project.status}"
        if project.contract_amount:
            line += f" | amount={project.contract_amount:,.0f}"
        if project.memory_version:
            line += f" | memory=v{project.memory_version}"
        ws_lines.append(f"{index}. {line}")

        brief = str(memory.get("project_brief") or project.context_summary or project.description or "").strip()
        if brief:
            ws_lines.append(f"   brief: {brief[:180]}")
        risks = _memory_items_for_portfolio(memory, "key_risks", limit=2)
        if risks:
            ws_lines.append("   risks: " + "; ".join(risks))
        next_actions = _memory_items_for_portfolio(memory, "next_actions", limit=2)
        if next_actions:
            ws_lines.append("   next: " + "; ".join(next_actions))

    return "\n".join(ws_lines)


def _normalize_client_match_text(value: str) -> str:
    return "".join(str(value or "").lower().split())


def is_client_project_portfolio_query(content: str) -> bool:
    text = _normalize_client_match_text(content)
    if not text:
        return False
    all_project_markers = (
        "\u5168\u90e8\u9879\u76ee",
        "\u6240\u6709\u9879\u76ee",
        "\u5168\u90e8\u7684\u9879\u76ee",
        "\u6240\u6709\u7684\u9879\u76ee",
        "全部项目",
        "所有项目",
        "全部的项目",
        "所有的项目",
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
        "\u9879\u76ee\u60c5\u51b5",
        "\u9879\u76ee\u72b6\u6001",
        "\u9879\u76ee\u98ce\u9669",
        "\u60c5\u51b5\u53ca\u98ce\u9669",
        "\u60c5\u51b5\u548c\u98ce\u9669",
        "\u603b\u7ed3",
        "\u6c47\u603b",
        "\u98ce\u9669",
        "项目情况",
        "项目状态",
        "项目风险",
        "情况及风险",
        "情况和风险",
        "总结",
        "汇总",
        "风险",
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


def is_workspace_project_inventory_query(content: str) -> bool:
    text = _normalize_client_match_text(content)
    if not text:
        return False
    all_project_markers = (
        "\u5168\u90e8\u9879\u76ee",
        "\u6240\u6709\u9879\u76ee",
        "\u5168\u90e8\u7684\u9879\u76ee",
        "\u6240\u6709\u7684\u9879\u76ee",
        "\u5168\u91cf\u9879\u76ee",
        "\u6240\u670921\u4e2a\u9879\u76ee",
        "\u6240\u670922\u4e2a\u9879\u76ee",
        "全部项目",
        "所有项目",
        "全部的项目",
        "所有的项目",
        "全量项目",
        "所有21个项目",
        "所有22个项目",
        "allprojects",
        "allproject",
        "entireprojectportfolio",
        "workspaceprojects",
    )
    summary_markers = (
        "\u9879\u76ee\u60c5\u51b5",
        "\u9879\u76ee\u72b6\u6001",
        "\u9879\u76ee\u98ce\u9669",
        "\u60c5\u51b5\u53ca\u98ce\u9669",
        "\u60c5\u51b5\u548c\u98ce\u9669",
        "\u9879\u76ee\u6e05\u5355",
        "\u9879\u76ee\u5217\u8868",
        "\u603b\u7ed3",
        "\u6c47\u603b",
        "\u98ce\u9669",
        "项目情况",
        "项目状态",
        "项目风险",
        "情况及风险",
        "情况和风险",
        "项目清单",
        "项目列表",
        "总结",
        "汇总",
        "风险",
        "summary",
        "summarize",
        "inventory",
        "status",
        "risk",
        "risks",
    )
    return any(marker in text for marker in all_project_markers) and any(marker in text for marker in summary_markers)


def _is_project_review_query(content: str) -> bool:
    text = _normalize_client_match_text(content)
    if not text:
        return False
    project_markers = (
        "\u9879\u76ee",
        "project",
        "projects",
    )
    review_markers = (
        "\u60c5\u51b5",
        "\u72b6\u6001",
        "\u98ce\u9669",
        "\u603b\u7ed3",
        "\u6c47\u603b",
        "\u6e05\u5355",
        "\u5217\u8868",
        "summary",
        "summarize",
        "status",
        "risk",
        "risks",
        "inventory",
    )
    return any(marker in text for marker in project_markers) and any(marker in text for marker in review_markers)


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
    client_name = _find_client_name_in_query(session, content) or fallback_client_name.strip()
    if not is_client_project_portfolio_query(content) and not (client_name and _is_project_review_query(content)):
        return ""
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
        "- Mandatory answer rule: start with the exact matched project count and a compact inventory table, one row per listed project.",
        "- Keep the answer concise: inventory first, then only the top portfolio risks and immediate actions.",
        "- Do not summarize only representative projects. If a project has limited details, still include its name, ID, status, and a brief best-effort risk note.",
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


def build_workspace_project_inventory_context(session: Session, content: str) -> str:
    """Build a complete workspace project inventory for all-project questions."""
    if not is_workspace_project_inventory_query(content):
        return ""

    projects = session.exec(select(Project).order_by(Project.updated_at.desc())).all()
    if not projects:
        return ""

    today_str = utc_now_naive().strftime("%Y-%m-%d")
    active_projects = [project for project in projects if project.status != "archived"]
    lines = [
        f"# Workspace Project Inventory Context ({today_str})",
        f"- Total projects listed below: {len(projects)}",
        f"- Non-archived projects: {len(active_projects)}",
        "- Coverage rule: every project below must be considered in the answer.",
        "- Mandatory answer rule: start with the exact project count and a compact inventory table, one row per listed project.",
        "- Do not say that only a partial snapshot is available. This context is the complete workspace project inventory available to chat for this question.",
        "- If a project has limited details, still include its ID, name, client, status, and a brief best-effort risk note.",
        "- After the complete inventory, summarize only the top cross-project risks and immediate actions.",
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
            lines.append(f"- Description: {project.description[:220]}")
        if project.context_summary:
            lines.append(f"- Existing summary: {project.context_summary[:320]}")
        if memory.get("project_brief"):
            lines.append(f"- Memory brief: {str(memory['project_brief'])[:320]}")
        if memory.get("current_stage"):
            lines.append(f"- Memory stage: {memory['current_stage']}")
        if memory.get("financial_status"):
            lines.append(f"- Financial status: {str(memory['financial_status'])[:220]}")

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
    content: str = "",
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
        lines.append("\n**Milestones:**")
        for m in milestones:
            status_icon = "✓" if m.is_done else "○"
            due = f" (due: {m.due_date})" if m.due_date else ""
            priority = f" [{m.priority} priority]" if m.priority == "high" else ""
            lines.append(f"  {status_icon} {m.title}{priority}{due}")

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
    
    should_inject_file_text = bool(file_ids) or _content_requests_file_details(content)

    # Files
    files = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project.id)
    ).all()
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
                if full_path:
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
            if pf and pf.project_id == project.id:
                full_path = _safe_project_file_path(UPLOADS_DIR, pf.path)
                if full_path:
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
    # Perform structured retrieval. In a project chat, the selected knowledge scope
    # should behave like ambient workspace context: if scoped vectorized documents
    # exist, retrieve from them without requiring the user to type #doc.
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

    should_retrieve = bool(rag_doc_ids) or (auto_trigger and "#doc" in query)
    if not should_retrieve and auto_trigger and project_id is not None and knowledge_scope in {"project", "client"}:
        scoped_docs_stmt = select(KnowledgeDocument.id).where(KnowledgeDocument.vector_status == "synced")
        if effective_project_id is not None:
            scoped_docs_stmt = scoped_docs_stmt.where(KnowledgeDocument.project_id == effective_project_id)
        elif client_id is not None:
            scoped_docs_stmt = scoped_docs_stmt.where(KnowledgeDocument.client_id == client_id)
        else:
            scoped_docs_stmt = scoped_docs_stmt.where(KnowledgeDocument.project_id == project_id)
        should_retrieve = session.exec(scoped_docs_stmt.limit(1)).first() is not None

    if not should_retrieve:
        return {"text": "", "sources": []}

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
    normalized_scope = (knowledge_scope or "project").strip().lower()
    current_project_only = project_id is not None and normalized_scope == "project"
    portfolio_context = ""
    workspace_inventory_context = ""
    if not current_project_only:
        portfolio_context = build_client_project_portfolio_context(
            session,
            content,
            fallback_client_name=project.client if project and project.client and normalized_scope == "client" else "",
        )
        if not portfolio_context and (project_id is None or normalized_scope == "global"):
            workspace_inventory_context = build_workspace_project_inventory_context(session, content)
    if current_project_only and project_id:
        project_context = build_project_context(session, project_id, file_ids, content=content)
    elif portfolio_context:
        project_context = portfolio_context
    elif workspace_inventory_context:
        project_context = workspace_inventory_context
    elif project_id:
        project_context = build_project_context(session, project_id, file_ids, content=content)
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

    if project_id:
        skill_ctx.skill_prompt = "\n\n".join(
            part for part in ((skill_ctx.skill_prompt or "").strip(), PROJECT_MARKDOWN_TOOL_PROMPT) if part
        )
    
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
        tools=_merge_project_chat_tools(skill_ctx.tools, project_id),
        max_tokens=skill_ctx.max_tokens or default_max_tokens,
    )
