"""Complete chat context builder combining skill, project, and RAG contexts."""
from typing import Optional

from sqlmodel import Session, select

from app.models.db import ClientRecord, Project, Skill
from app.services.agent_harness.project_memory_evidence import (
    build_project_memory_evidence,
)
from app.services.context_builder.assembly import ContextSourceInput
from app.services.context_builder.memory_formatters import build_client_memory_prompt_bundle
from app.services.context_builder.project_context import build_project_context
from app.services.context_builder.rag_context import build_rag_context
from app.services.context_builder.skill_context import (
    SkillContext,
    build_skill_context,
    _merge_project_chat_tools,
)
from app.services.context_builder.workspace_context import (
    build_client_project_portfolio_context,
    build_lightweight_workspace_context,
    build_workspace_project_inventory_context,
)


class ChatContext:
    """Complete context for a chat session."""
    def __init__(
        self,
        skill_prompt: str = "",
        project_context: str = "",
        rag_context: str = "",
        rag_sources: Optional[list] = None,
        knowledge_evidence_manifest: Optional[dict] = None,
        project_memory_evidence_manifest: Optional[dict] = None,
        tools: Optional[list] = None,
        max_tokens: int = 4096,
        context_sources: Optional[list[ContextSourceInput]] = None,
        context_receipt: Optional[dict] = None,
    ):
        self.skill_prompt = skill_prompt
        self.project_context = project_context
        self.rag_context = rag_context
        self.rag_sources = rag_sources or []
        self.knowledge_evidence_manifest = knowledge_evidence_manifest or {}
        self.project_memory_evidence_manifest = project_memory_evidence_manifest or {}
        self.tools = tools
        self.max_tokens = max_tokens
        self.context_sources = tuple(context_sources or ())
        self.context_receipt = dict(context_receipt or {})


def build_chat_context(
    session: Session,
    skill_id: Optional[int] = None,
    project_id: Optional[int] = None,
    knowledge_scope: str = "global",
    rag_doc_ids: Optional[list[int]] = None,
    file_ids: Optional[list[int]] = None,
    content: str = "",
    default_max_tokens: int = 4096,
    mention_context: Optional[dict] = None,
    context_mode: str = "",
    accessible_project_ids: Optional[list[int]] = None,
    skill_override: Optional[Skill] = None,
) -> ChatContext:
    """Build complete chat context including skill, project, and RAG.

    ``accessible_project_ids`` scopes the workspace/portfolio/inventory memory
    builders to projects the user is a member of. ``None`` means no restriction
    (internal/system callers); a list (possibly empty) prevents cross-project
    memory leaks in standalone / portfolio / inventory chat modes.
    """
    # Merge mention_context file_ids into file_ids so @-mentioned files get injected
    _mention = mention_context or {}
    _mentioned_file_ids = _mention.get("file_ids") or []
    if _mentioned_file_ids:
        merged_file_ids = list(dict.fromkeys((file_ids or []) + _mentioned_file_ids))
        file_ids = merged_file_ids

    # Build skill context
    skill_ctx = build_skill_context(
        session,
        skill_id,
        default_max_tokens,
        skill_override=skill_override,
    )
    
    project = session.get(Project, project_id) if project_id else None
    client = None
    if project is not None and project.client.strip():
        client = session.exec(
            select(ClientRecord).where(ClientRecord.name.ilike(project.client.strip()))
        ).first()
    normalized_scope = (knowledge_scope or "project").strip().lower()
    normalized_context_mode = (context_mode or "").strip().lower()
    explicit_context_mode = bool(normalized_context_mode)
    force_portfolio = normalized_context_mode == "client_portfolio"
    force_inventory = normalized_context_mode == "workspace_inventory"
    current_project_only = project_id is not None and normalized_scope == "project" and not (force_portfolio or force_inventory)
    portfolio_context = ""
    workspace_inventory_context = ""
    if force_portfolio or (not explicit_context_mode and not current_project_only):
        portfolio_context = build_client_project_portfolio_context(
            session,
            content,
            fallback_client_name=project.client if project and project.client and (force_portfolio or normalized_scope == "client") else "",
            force=force_portfolio,
            accessible_project_ids=accessible_project_ids,
        )
    if force_inventory or (
        not explicit_context_mode
        and not portfolio_context
        and not current_project_only
        and (project_id is None or normalized_scope == "global")
    ):
        workspace_inventory_context = build_workspace_project_inventory_context(
            session, content, force=force_inventory, accessible_project_ids=accessible_project_ids
        )
    project_memory_bundle = (
        build_project_memory_evidence(project, content)
        if project is not None and not portfolio_context and not workspace_inventory_context
        else {"prompt": "", "manifest": {}, "selection": {}}
    )
    if current_project_only and project_id:
        project_context = build_project_context(
            session,
            project_id,
            file_ids,
            content=content,
            mention_context=mention_context,
            memory_evidence_bundle=project_memory_bundle,
        )
    elif portfolio_context:
        project_context = portfolio_context
    elif workspace_inventory_context:
        project_context = workspace_inventory_context
    elif project_id:
        project_context = build_project_context(
            session,
            project_id,
            file_ids,
            content=content,
            mention_context=mention_context,
            memory_evidence_bundle=project_memory_bundle,
        )
    else:
        project_context = build_lightweight_workspace_context(session, accessible_project_ids)

    client_memory_bundle = (
        build_client_memory_prompt_bundle(
            client,
            content if not (portfolio_context or workspace_inventory_context) else "",
            force=normalized_scope == "client" and not portfolio_context,
        )
        if client is not None
        else {
            "prompt": "",
            "selection": {
                "scope": "client",
                "status": "missing",
                "version": 0,
                "retrieval_mode": "none",
                "query_facets": [],
                "selected_slots": [],
                "selected_slot_count": 0,
                "available_slot_count": 0,
                "omitted_slot_count": 0,
                "selected_item_count": 0,
                "truncated": False,
                "overridden_dimensions": [],
            },
        }
    )
    client_memory_context = str(client_memory_bundle.get("prompt") or "")
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
        accessible_project_ids=accessible_project_ids,
    )

    if portfolio_context:
        context_scope = "client_portfolio"
    elif workspace_inventory_context or (not project_id and project_context.strip()):
        context_scope = "workspace"
    elif project_id:
        context_scope = "project"
    else:
        context_scope = "chat"

    if context_scope == "project" and project is not None:
        if int(project.memory_version or 0) <= 0:
            memory_status = "missing"
        elif project.memory_stale:
            memory_status = "stale"
        else:
            memory_status = "ready"
        memory_version = int(project.memory_version or 0)
    else:
        memory_status = "not_applicable"
        memory_version = 0

    project_memory_layer = {
        "scope": "project",
        "status": memory_status,
        "version": memory_version,
        **dict(project_memory_bundle.get("selection") or {}),
        "overridden_dimensions": [],
    }
    memory_layers = [project_memory_layer]
    if client is not None or normalized_scope == "client":
        memory_layers.append(dict(client_memory_bundle.get("selection") or {}))

    context_receipt = {
        "scope": context_scope,
        "project": (
            {"id": int(project.id or 0), "name": project.name}
            if project is not None and project.id is not None
            else None
        ),
        "memory": {
            "status": memory_status,
            "version": memory_version,
            "raw_context_available": bool(project_context.strip()),
            **dict(project_memory_bundle.get("selection") or {}),
            "layers": memory_layers,
        },
        "evidence": {
            "workspace_context": bool(project_context.strip()),
            "attached_file_count": len(file_ids or []),
            "knowledge_reference_count": len(rag_data["sources"] or []),
        },
    }
    
    context_sources = [
        ContextSourceInput(
            source_id="skill_instructions",
            kind="instructions",
            trust="workspace",
            content=skill_ctx.skill_prompt or "",
            metadata={"skill_selected": bool(skill_id)},
        ),
        ContextSourceInput(
            source_id="workspace_context",
            kind="workspace",
            trust="workspace",
            content=project_context or "",
            metadata={
                "context_mode": normalized_context_mode or "auto",
                "knowledge_scope": normalized_scope,
                "project_scoped": bool(project_id),
                "context_scope": context_scope,
                "memory_status": memory_status,
                "memory_version": memory_version,
                "memory_retrieval": dict(project_memory_bundle.get("selection") or {}),
            },
        ),
    ]
    if client_memory_context:
        context_sources.append(
            ContextSourceInput(
                source_id="client_memory",
                kind="memory",
                trust="workspace",
                content=client_memory_context,
                metadata={"selection": dict(client_memory_bundle.get("selection") or {})},
            )
        )
    context_sources.append(
        ContextSourceInput(
            source_id="retrieved_knowledge",
            kind="retrieval",
            trust="retrieved",
            content=rag_data["text"] or "",
            metadata={"reference_count": len(rag_data["sources"] or [])},
        )
    )

    return ChatContext(
        skill_prompt=skill_ctx.skill_prompt,
        project_context=project_context,
        rag_context=rag_data["text"],
        rag_sources=rag_data["sources"],
        knowledge_evidence_manifest=rag_data.get("evidence_manifest") or {},
        project_memory_evidence_manifest=project_memory_bundle.get("manifest") or {},
        tools=_merge_project_chat_tools(skill_ctx.tools, project_id),
        max_tokens=skill_ctx.max_tokens or default_max_tokens,
        context_receipt=context_receipt,
        context_sources=context_sources,
    )
