"""Workspace-level context builders."""
from __future__ import annotations

from typing import Optional

from sqlmodel import Session, select

from app.models.db import ClientRecord, Milestone, Project, ProjectPayment
from app.services.project_clients import (
    clients_matching_name,
    list_projects_for_client,
)
from app.services.project_contexts import get_project_memory_payload
from app.services.memory_slots import load_project_memory_slot_value_views
from app.services.time_utils import utc_now_naive
from app.services.context_builder.memory_formatters import (
    _format_project_memory_for_prompt,
    _memory_items_for_portfolio,
)
from app.services.context_builder.query_classifiers import (
    is_client_project_portfolio_query,
    is_workspace_project_inventory_query,
    _is_project_review_query,
    _find_client_name_in_query,
    _normalize_client_match_text,
)


def _restrict_to_accessible(projects, accessible_project_ids: Optional[list[int]]):
    """Filter a project list to the user's accessible (member) projects.

    ``None`` means "no restriction" — used by internal/system callers that
    pass no user. A list (possibly empty) restricts to those project ids, so
    workspace/portfolio context never leaks memory from projects the user is
    not a member of. Conversations and project memory are isolated per-user.
    """
    if accessible_project_ids is None:
        return list(projects)
    allowed = set(accessible_project_ids)
    return [project for project in projects if project.id in allowed]


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


def build_lightweight_workspace_context(
    session: Session, accessible_project_ids: Optional[list[int]] = None
) -> str:
    """Build a memory-first workspace brief for standalone chat."""
    all_projects = session.exec(
        select(Project).where(Project.status != "archived").order_by(Project.updated_at.desc())
    ).all()
    all_projects = _restrict_to_accessible(all_projects, accessible_project_ids)

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

    memory_by_project = load_project_memory_slot_value_views(
        session,
        {
            int(project.id): get_project_memory_payload(project)
            for project in all_projects
            if project.id is not None
        },
    )

    for index, project in enumerate(all_projects, start=1):
        memory = memory_by_project.get(
            int(project.id or 0),
            get_project_memory_payload(project),
        )
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


def build_client_project_portfolio_context(
    session: Session,
    content: str,
    fallback_client_name: str = "",
    fallback_client_id: int | None = None,
    *,
    force: bool = False,
    accessible_project_ids: Optional[list[int]] = None,
) -> str:
    """Build a complete per-client project inventory for portfolio questions."""
    client_name = _find_client_name_in_query(session, content) or fallback_client_name.strip()
    if not force and not is_client_project_portfolio_query(content) and not (client_name and _is_project_review_query(content)):
        return ""
    if not client_name:
        return ""

    client = (
        session.get(ClientRecord, fallback_client_id)
        if fallback_client_id is not None
        else None
    )
    if client is None:
        matches = clients_matching_name(session, client_name)
        if len(matches) > 1:
            return ""
        client = matches[0] if matches else None
    if client is not None:
        projects = list_projects_for_client(session, client)
        client_name = client.name
    else:
        normalized_client = _normalize_client_match_text(client_name)
        projects = [
            project
            for project in session.exec(
                select(Project).where(Project.client_id.is_(None)).order_by(
                    Project.updated_at.desc()
                )
            ).all()
            if _normalize_client_match_text(project.client) == normalized_client
        ]
    projects = _restrict_to_accessible(projects, accessible_project_ids)
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

    memory_by_project = load_project_memory_slot_value_views(
        session,
        {
            int(project.id): get_project_memory_payload(project)
            for project in projects
            if project.id is not None
        },
    )

    for index, project in enumerate(projects, start=1):
        memory = memory_by_project.get(
            int(project.id or 0),
            get_project_memory_payload(project),
        )
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


def build_workspace_project_inventory_context(
    session: Session,
    content: str,
    *,
    force: bool = False,
    accessible_project_ids: Optional[list[int]] = None,
) -> str:
    """Build a complete workspace project inventory for all-project questions."""
    if not force and not is_workspace_project_inventory_query(content):
        return ""

    projects = session.exec(select(Project).order_by(Project.updated_at.desc())).all()
    projects = _restrict_to_accessible(projects, accessible_project_ids)
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

    memory_by_project = load_project_memory_slot_value_views(
        session,
        {
            int(project.id): get_project_memory_payload(project)
            for project in projects
            if project.id is not None
        },
    )

    for index, project in enumerate(projects, start=1):
        memory = memory_by_project.get(
            int(project.id or 0),
            get_project_memory_payload(project),
        )
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
