"""Chat action confirmation endpoints — Human-in-the-Loop tool approval."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import PendingToolAction
from app.services.chat.action_executor import execute_tool_by_name

router = APIRouter(prefix="/chat", tags=["chat-actions"])


class ConfirmActionRequest(BaseModel):
    approved: bool = True
    reason: Optional[str] = None


class ConfirmActionResponse(BaseModel):
    status: str
    result: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None


class PendingActionItem(BaseModel):
    id: int
    trace_id: str
    conversation_id: int
    message_id: Optional[int] = None
    project_id: Optional[int] = None
    tool_name: str
    tool_input: dict[str, Any]
    action_type: str
    title: str
    description: str
    details: list[str]
    status: str
    created_at: str
    expires_at: Optional[str] = None


class PendingActionsResponse(BaseModel):
    items: list[PendingActionItem]
    has_pending: bool


@router.get("/conversations/{conversation_id}/pending-actions")
async def list_pending_actions(
    conversation_id: int,
    session: Session = Depends(get_session),
) -> PendingActionsResponse:
    """List all pending tool actions for a conversation."""
    actions = session.exec(
        select(PendingToolAction)
        .where(PendingToolAction.conversation_id == conversation_id)
        .where(PendingToolAction.status == "pending")
        .order_by(PendingToolAction.created_at.desc())
    ).all()

    items: list[PendingActionItem] = []
    for action in actions:
        if action.expires_at and action.expires_at < datetime.utcnow():
            continue  # Skip expired actions
        payload = action.get_payload()
        items.append(PendingActionItem(
            id=payload["id"],
            trace_id=payload["trace_id"],
            conversation_id=payload["conversation_id"],
            message_id=payload.get("message_id"),
            project_id=payload.get("project_id"),
            tool_name=payload["tool_name"],
            tool_input=payload["tool_input"],
            action_type=payload["action_type"],
            title=payload["title"],
            description=payload["description"],
            details=payload["details"],
            status=payload["status"],
            created_at=payload["created_at"] or "",
            expires_at=payload.get("expires_at"),
        ))

    return PendingActionsResponse(items=items, has_pending=len(items) > 0)


@router.post("/actions/{action_id}/confirm")
async def confirm_action(
    action_id: int,
    req: ConfirmActionRequest,
    session: Session = Depends(get_session),
) -> ConfirmActionResponse:
    """Confirm a pending tool action and execute it directly."""
    action = session.get(PendingToolAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.status != "pending":
        raise HTTPException(status_code=400, detail=f"Action already {action.status}")
    if action.expires_at and action.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Action expired")

    if not req.approved:
        action.status = "rejected"
        action.confirmed_at = datetime.utcnow()
        session.commit()
        return ConfirmActionResponse(status="rejected")

    # Execute the tool directly (no LLM re-generation)
    action.status = "executing"
    session.commit()

    import json
    tool_input = json.loads(action.tool_input_json or "{}")
    result = await execute_tool_by_name(action.tool_name, tool_input)

    action.result_json = json.dumps(result, ensure_ascii=False, default=str)
    if result.get("success"):
        action.status = "completed"
    else:
        action.status = "failed"
        action.error_message = result.get("error", "Unknown error")
    action.confirmed_at = datetime.utcnow()
    session.commit()

    return ConfirmActionResponse(
        status=action.status,
        result=result,
        error_message=action.error_message,
    )


@router.post("/actions/{action_id}/reject")
async def reject_action(
    action_id: int,
    req: Optional[ConfirmActionRequest] = None,
    session: Session = Depends(get_session),
) -> ConfirmActionResponse:
    """Reject a pending tool action."""
    action = session.get(PendingToolAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.status != "pending":
        raise HTTPException(status_code=400, detail=f"Action already {action.status}")

    action.status = "rejected"
    action.confirmed_at = datetime.utcnow()
    if req and req.reason:
        action.error_message = req.reason
    session.commit()

    return ConfirmActionResponse(status="rejected")


@router.get("/actions/{action_id}")
async def get_action(
    action_id: int,
    session: Session = Depends(get_session),
) -> PendingActionItem:
    """Get a single pending tool action by ID."""
    action = session.get(PendingToolAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")

    payload = action.get_payload()
    return PendingActionItem(
        id=payload["id"],
        trace_id=payload["trace_id"],
        conversation_id=payload["conversation_id"],
        message_id=payload.get("message_id"),
        project_id=payload.get("project_id"),
        tool_name=payload["tool_name"],
        tool_input=payload["tool_input"],
        action_type=payload["action_type"],
        title=payload["title"],
        description=payload["description"],
        details=payload["details"],
        status=payload["status"],
        created_at=payload["created_at"] or "",
        expires_at=payload.get("expires_at"),
    )
