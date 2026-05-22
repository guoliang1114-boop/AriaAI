from __future__ import annotations

from typing import List, Optional
import json

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.database import get_session
from app.routers.chat_schemas import (
    ConversationOut,
    CreateConversationRequest,
    MessageOut,
    PendingChatActionOut,
    UpdateConversationRequest,
)
from app.services.chat_store import (
    create_conversation_record,
    delete_conversation_with_messages,
    get_conversation_messages,
    get_conversation_or_404,
    list_conversations_cached,
    update_conversation_title,
)
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.pending_actions import build_project_file_cleanup_pending_action, user_requested_project_file_cleanup

router = APIRouter()


def _json_loads(value: str | None) -> dict:
    try:
        loaded = json.loads(value or "{}")
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def _confirmation_call(metadata: dict, item: dict) -> dict:
    token = str(item.get("confirmation_token") or "")
    for call in metadata.get("tool_calls") or []:
        if isinstance(call, dict) and str(call.get("confirmation_token") or "") == token:
            return call
    return {
        "tool_name": str(item.get("tool_name") or ""),
        "status": "confirmation_required",
        "message": str(item.get("summary") or "需要用户确认后才能执行修改或危险操作。"),
        "summary": str(item.get("summary") or "需要用户确认后才能执行修改或危险操作。"),
        "confirmation_token": token,
        "details": item.get("details") if isinstance(item.get("details"), list) else [],
    }


def _latest_pending_action(messages: list) -> PendingChatActionOut | None:
    resolved_tokens: set[str] = set()
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if getattr(message, "role", "") != "assistant":
            continue
        metadata = _json_loads(getattr(message, "metadata_json", "{}"))
        for token in metadata.get("resolved_action_confirmations") or []:
            if token:
                resolved_tokens.add(str(token))
        pending_items = metadata.get("pending_tool_confirmations") or []
        if not isinstance(pending_items, list):
            continue
        for item in reversed(pending_items):
            if not isinstance(item, dict):
                continue
            token = str(item.get("confirmation_token") or "")
            if not token or token in resolved_tokens:
                continue
            source_content = ""
            for previous in range(index - 1, -1, -1):
                if getattr(messages[previous], "role", "") == "user":
                    source_content = getattr(messages[previous], "content", "") or ""
                    break
            if not source_content:
                continue
            can_confirm = item.get("can_confirm")
            return PendingChatActionOut(
                can_confirm=bool(item.get("tool_name") and isinstance(item.get("tool_input"), dict))
                if can_confirm is None
                else bool(can_confirm),
                source_content=source_content,
                call=_confirmation_call(metadata, item),
            )
    return None


def _synthesized_pending_action(session: Session, messages: list, *, project_id: int | None) -> PendingChatActionOut | None:
    if project_id is None:
        return None
    latest_resolved_index = -1
    for index, message in enumerate(messages):
        if getattr(message, "role", "") != "assistant":
            continue
        metadata = _json_loads(getattr(message, "metadata_json", "{}"))
        if metadata.get("resolved_action_confirmations"):
            latest_resolved_index = index
    for index in range(len(messages) - 1, -1, -1):
        if index < latest_resolved_index:
            return None
        message = messages[index]
        if getattr(message, "role", "") != "user":
            continue
        source_content = getattr(message, "content", "") or ""
        if not user_requested_project_file_cleanup(source_content):
            continue
        pending = build_project_file_cleanup_pending_action(
            session,
            project_id=project_id,
            user_content=source_content,
            action_policy=ActionPolicy.DESTRUCTIVE_ACTION,
            require_candidates=False,
        )
        if not pending:
            continue
        return PendingChatActionOut(
            can_confirm=bool(pending.get("can_confirm")),
            source_content=source_content,
            call=_confirmation_call({}, pending),
        )
    return None


@router.get("/conversations", response_model=List[ConversationOut])
def list_conversations(
    project_id: Optional[int] = None,
    standalone: bool = False,
    session: Session = Depends(get_session),
):
    return list_conversations_cached(session, project_id=project_id, standalone=standalone)


@router.get("/conversations/{conv_id}", response_model=ConversationOut)
def get_conversation(conv_id: int, session: Session = Depends(get_session)):
    return get_conversation_or_404(session, conv_id)


@router.post("/conversations", response_model=ConversationOut)
def create_conversation(
    req: CreateConversationRequest,
    session: Session = Depends(get_session),
):
    return create_conversation_record(
        session,
        project_id=req.project_id,
        skill_id=req.skill_id,
        title=req.title or "",
    )


@router.get("/conversations/{conv_id}/messages", response_model=List[MessageOut])
def get_messages(
    conv_id: int,
    limit: int = 30,
    before_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    return get_conversation_messages(session, conv_id, limit=limit, before_id=before_id)


@router.get("/conversations/{conv_id}/pending-action", response_model=Optional[PendingChatActionOut])
def get_pending_action(
    conv_id: int,
    session: Session = Depends(get_session),
):
    conversation = get_conversation_or_404(session, conv_id)
    messages = get_conversation_messages(session, conv_id, limit=120)
    return _latest_pending_action(messages) or _synthesized_pending_action(session, messages, project_id=conversation.project_id)


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: int, session: Session = Depends(get_session)):
    delete_conversation_with_messages(session, conv_id)
    return {"ok": True}


@router.patch("/conversations/{conv_id}", response_model=ConversationOut)
def patch_conversation(
    conv_id: int,
    req: UpdateConversationRequest,
    session: Session = Depends(get_session),
):
    conv = get_conversation_or_404(session, conv_id)
    title = (req.title or "").strip()
    if not title:
        return conv
    return update_conversation_title(session, conv_id, title)
