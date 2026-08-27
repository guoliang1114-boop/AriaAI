from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import ChatRun, Message, User
from app.routers.auth import get_current_user, require_admin
from app.routers.chat_schemas import TestConnectionRequest, TestModelRequest
from app.routers.chat_security import require_conversation_access
from app.routers.chat_security import require_project_access
from app.services.chat.trace import get_latest_chat_trace
from app.services.agent_harness.run_rollout import get_chat_rollout
from app.services.agent_harness.turn_interrupt import get_active_turn
from app.services.chat.turn_recovery import build_turn_recovery_preview
from app.services.chat_diagnostics import run_model_test, test_provider_connection

router = APIRouter()


def _chat_run_payload(run: ChatRun) -> dict:
    return {
        "run_id": run.run_id,
        "conversation_id": run.conversation_id,
        "project_id": run.project_id,
        "source_message_id": run.source_message_id,
        "assistant_message_id": run.assistant_message_id,
        "skill": {
            "id": run.skill_id,
            "name": run.skill_name,
            "version": run.skill_version or None,
            "release_status": run.skill_release_status or None,
            "release_sha256": run.skill_release_sha256 or None,
            "activation_source": run.skill_activation_source or None,
        } if run.skill_id or run.skill_name else None,
        "model": run.model,
        "chat_mode": run.chat_mode,
        "action_policy": run.action_policy,
        "display_mode": run.display_mode,
        "status": run.status,
        "phase": run.phase,
        "step_count": run.step_count,
        "tool_call_count": run.tool_call_count,
        "output_count": run.output_count,
        "duration_ms": run.duration_ms,
        "error_code": run.error_code or None,
        "retryable": run.retryable,
        "started_at": run.started_at.isoformat(),
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "updated_at": run.updated_at.isoformat(),
    }


@router.get("/projects/{project_id}/runs")
def list_project_chat_runs(
    project_id: int,
    limit: int = 50,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user)
    safe_limit = max(1, min(limit, 200))
    runs = session.exec(
        select(ChatRun)
        .where(ChatRun.project_id == project_id)
        .order_by(ChatRun.started_at.desc(), ChatRun.id.desc())
        .limit(safe_limit)
    ).all()
    return {"project_id": project_id, "runs": [_chat_run_payload(run) for run in runs]}


@router.get("/runs/{run_id}")
def get_chat_run(
    run_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Chat run not found")
    require_conversation_access(session, run.conversation_id, current_user)
    return _chat_run_payload(run)


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
