"""Chat action confirmation endpoints — Human-in-the-Loop tool approval."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import update
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import Message, PendingToolAction
from app.services.chat.action_executor import execute_tool_by_name

router = APIRouter(tags=["chat-actions"])


class ConfirmActionRequest(BaseModel):
    approved: bool = True
    reason: Optional[str] = None


class ConfirmActionResponse(BaseModel):
    status: str
    result: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    message_id: Optional[int] = None


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
        return _existing_action_response(action)
    if action.expires_at and action.expires_at < datetime.utcnow():
        action.status = "failed"
        action.error_message = "Action expired"
        session.commit()
        raise HTTPException(status_code=400, detail="Action expired")

    if not req.approved:
        action.status = "rejected"
        action.confirmed_at = datetime.utcnow()
        session.commit()
        return ConfirmActionResponse(status="rejected")

    try:
        tool_input = _load_tool_input(action)
    except HTTPException:
        action.status = "failed"
        action.error_message = "Invalid stored tool input"
        session.commit()
        raise

    claim = session.execute(
        update(PendingToolAction)
        .where(PendingToolAction.id == action_id)
        .where(PendingToolAction.status == "pending")
        .values(status="executing", confirmed_at=datetime.utcnow())
    )
    session.commit()
    if getattr(claim, "rowcount", 0) != 1:
        latest = session.get(PendingToolAction, action_id)
        if latest is None:
            raise HTTPException(status_code=404, detail="Action not found")
        return _existing_action_response(latest)

    action = session.get(PendingToolAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    result = await execute_tool_by_name(action.tool_name, tool_input)

    action.result_json = json.dumps(result, ensure_ascii=False, default=str)
    if result.get("success"):
        action.status = "completed"
    else:
        action.status = "failed"
        action.error_message = result.get("error", "Unknown error")
    action.confirmed_at = datetime.utcnow()

    result_summary = _format_action_result_message(action, result)
    result_message = Message(
        conversation_id=action.conversation_id,
        role="assistant",
        content=result_summary,
        metadata_json=json.dumps(
            {
                "tool_action_result": {
                    "pending_action_id": action.id,
                    "tool_name": action.tool_name,
                    "status": action.status,
                    "result": result,
                }
            },
            ensure_ascii=False,
            default=str,
        ),
    )
    session.add(result_message)
    session.commit()
    session.refresh(result_message)

    return ConfirmActionResponse(
        status=action.status,
        result=result,
        error_message=action.error_message,
        message_id=result_message.id,
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
        return _existing_action_response(action)

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


def _format_action_result_message(action: PendingToolAction, result: dict[str, Any]) -> str:
    title = action.title or action.tool_name or "工具操作"
    if result.get("success"):
        pieces = [f"已执行：{title}。"]
        output = result.get("output") or result.get("result")
        if isinstance(output, dict):
            message = output.get("message") or output.get("summary")
            if message:
                pieces.append(str(message))
        elif isinstance(output, str) and output.strip():
            pieces.append(output.strip())
        return "\n\n".join(pieces)
    error = result.get("error") or action.error_message or "未知错误"
    return f"{title} 执行失败：{error}"


def _load_json_object(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        loaded = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _load_tool_input(action: PendingToolAction) -> dict[str, Any]:
    try:
        loaded = json.loads(action.tool_input_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid stored tool input") from exc
    if not isinstance(loaded, dict):
        raise HTTPException(status_code=400, detail="Stored tool input must be an object")
    return loaded


def _existing_action_response(action: PendingToolAction) -> ConfirmActionResponse:
    return ConfirmActionResponse(
        status=action.status,
        result=_load_json_object(action.result_json),
        error_message=action.error_message,
    )
