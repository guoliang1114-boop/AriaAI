from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.database import get_session
from app.models.db import Message, User
from app.routers.auth import get_current_user, require_admin
from app.routers.chat_schemas import TestConnectionRequest, TestModelRequest
from app.routers.chat_security import require_conversation_access
from app.services.chat.trace import get_latest_chat_trace
from app.services.agent_harness.run_rollout import get_chat_rollout
from app.services.agent_harness.turn_interrupt import get_active_turn
from app.services.chat.turn_recovery import build_turn_recovery_preview
from app.services.chat_diagnostics import run_model_test, test_provider_connection

router = APIRouter()


@router.post("/test-connection")
async def test_connection(
    req: TestConnectionRequest,
    _admin: User = Depends(require_admin),
):
    """Test API key connectivity for a provider."""
    return await test_provider_connection(req.provider, req.model)


@router.post("/test-model")
async def test_model(
    req: TestModelRequest,
    _admin: User = Depends(require_admin),
):
    """Test a model with a simple message."""
    return await run_model_test(
        message=req.message,
        model=req.model,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    )


@router.get("/conversations/{conversation_id}/trace")
def get_conversation_trace(
    conversation_id: int,
    message_id: Optional[int] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return the latest structured trace for a conversation turn."""
    require_conversation_access(session, conversation_id, current_user)
    trace = get_latest_chat_trace(session, conversation_id, message_id=message_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Chat trace not found")
    return trace


@router.get("/conversations/{conversation_id}/rollout")
def get_conversation_rollout(
    conversation_id: int,
    run_id: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Reconstruct a durable Aria run and return its safe recovery decision."""

    require_conversation_access(session, conversation_id, current_user)
    rollout = get_chat_rollout(session, conversation_id, run_id=run_id)
    if not rollout:
        raise HTTPException(status_code=404, detail="Chat rollout not found")
    return rollout


@router.get("/conversations/{conversation_id}/recovery-preview")
def get_conversation_recovery_preview(
    conversation_id: int,
    run_id: str,
    message_id: Optional[int] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Prepare a content-free, server-verified continuation contract."""

    require_conversation_access(session, conversation_id, current_user)
    active_turn = get_active_turn(run_id)
    if active_turn is not None:
        raise HTTPException(status_code=409, detail="Chat run is still active")
    rollout = get_chat_rollout(session, conversation_id, run_id=run_id)
    if not rollout:
        raise HTTPException(status_code=404, detail="Chat rollout not found")
    selected_message_id = message_id or rollout.get("message_id")
    try:
        selected_message_id = int(selected_message_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Recovery message not found") from exc
    message = session.get(Message, selected_message_id)
    if (
        message is None
        or message.role != "assistant"
        or message.conversation_id != conversation_id
    ):
        raise HTTPException(status_code=404, detail="Recovery message not found")
    message_rollout = message.get_metadata().get("run_rollout")
    if (
        not isinstance(message_rollout, dict)
        or str(message_rollout.get("run_id") or "") != run_id
    ):
        raise HTTPException(status_code=409, detail="Message and rollout do not match")
    preview = build_turn_recovery_preview(
        rollout,
        source_message_id=selected_message_id,
    )
    if not preview.get("can_continue"):
        raise HTTPException(status_code=409, detail="This run cannot be continued")
    return preview


@router.get("/messages/{message_id}/trace")
def get_message_trace(
    message_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return the structured trace bound to a specific assistant message."""
    message = session.get(Message, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    require_conversation_access(session, message.conversation_id, current_user)
    trace = get_latest_chat_trace(session, message.conversation_id, message_id=message_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Chat trace not found")
    return trace
