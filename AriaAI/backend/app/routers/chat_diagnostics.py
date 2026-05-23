from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.database import get_session
from app.models.db import User
from app.routers.auth import get_current_user, require_admin
from app.routers.chat_schemas import TestConnectionRequest, TestModelRequest
from app.routers.chat_security import require_conversation_access
from app.services.chat.trace import get_latest_chat_trace
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


@router.get("/messages/{message_id}/trace")
def get_message_trace(
    message_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return the structured trace bound to a specific assistant message."""
    from app.models.db import Message

    message = session.get(Message, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    require_conversation_access(session, message.conversation_id, current_user)
    trace = get_latest_chat_trace(session, message.conversation_id, message_id=message_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Chat trace not found")
    return trace
