"""Async chat router — background task execution for long-running chat requests."""
from __future__ import annotations

import asyncio
import json
import logging
import traceback
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import ChatRun, TaskEvent, TaskRun, User
from app.routers.auth import get_current_user
from app.routers.chat_security import require_chat_request_access, require_conversation_access
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_streaming import prepare_chat_runtime_async, stream_chat_events
from app.services.chat.product_run_events import make_run_id
from app.services.time_utils import utc_now_naive

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory registry of running background chat tasks
_background_chat_tasks: dict[int, asyncio.Task] = {}
_background_chat_status: dict[int, dict[str, str]] = {}


class SendAsyncResponse(BaseModel):
    conversation_id: int
    task_run_id: int | None = None
    status: str


class ChatTaskStatusResponse(BaseModel):
    conversation_id: int
    task_run_id: int | None = None
    status: str  # running | completed | failed
    message_count: Optional[int] = None
    error: Optional[str] = None
    updated_at: Optional[str] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_json(value) -> str:
    return json.dumps(value or {}, ensure_ascii=False, default=str)


def _parse_sse_payload(event: str) -> dict:
    line = next((item.strip() for item in str(event or "").splitlines() if item.strip().startswith("data: ")), "")
    if not line:
        return {}
    try:
        return json.loads(line.removeprefix("data: ").strip())
    except json.JSONDecodeError:
        return {}


def _append_task_event(session: Session, task_id: int, event_type: str, message: str, payload: dict | None = None) -> None:
    session.add(
        TaskEvent(
            task_run_id=task_id,
            event_type=event_type,
            message=message,
            payload_json=_safe_json(payload or {}),
        )
    )


def _create_background_chat_run(session: Session, runtime, req: SendMessageRequest) -> TaskRun:
    input_payload = req.model_dump(mode="json")
    assigned_run_id = str(getattr(runtime, "prepared_run_id", "") or "")
    if assigned_run_id:
        input_payload["chat_run_id"] = assigned_run_id
    task = TaskRun(
        project_id=req.project_id,
        conversation_id=runtime.conv_id,
        task_type="background_chat",
        goal=(req.content or "")[:240],
        status="pending",
        input_json=_safe_json(input_payload),
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    session.add(task)
    session.flush()
    _append_task_event(
        session,
        task.id,
        "task_created",
        "后台对话任务已创建",
        {
            "conversation_id": runtime.conv_id,
            "chat_run_id": assigned_run_id or None,
        },
    )
    session.commit()
    session.refresh(task)
    return task


def _mark_background_chat_run(bind, task_id: int | None, status: str, message: str, error: str = "") -> None:
    if not task_id:
        return
    with Session(bind) as session:
        task = session.get(TaskRun, task_id)
        if not task:
            return
        now = utc_now_naive()
        task.status = status
        task.updated_at = now
        if status == "running" and task.started_at is None:
            task.started_at = now
        if status in {"completed", "failed", "canceled"}:
            task.completed_at = now
        if error:
            task.error_message = error
        _append_task_event(
            session,
            task.id,
            f"task_{status}",
            message,
            {"error": error} if error else {},
        )
        session.add(task)
        session.commit()


def _link_background_chat_run(bind, task_id: int | None, run_id: str) -> None:
    if not task_id or not run_id:
        return
    with Session(bind) as session:
        task = session.get(TaskRun, int(task_id))
        if task is None:
            return
        try:
            payload = json.loads(task.input_json or "{}")
        except (TypeError, json.JSONDecodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        if payload.get("chat_run_id") == run_id:
            return
        payload["chat_run_id"] = run_id
        task.input_json = _safe_json(payload)
        task.updated_at = utc_now_naive()
        session.add(task)
        session.commit()


def _background_chat_run_id(task: TaskRun | None) -> str:
    if task is None:
        return ""
    try:
        payload = json.loads(task.input_json or "{}")
    except (TypeError, json.JSONDecodeError):
        return ""
    return str(payload.get("chat_run_id") or "") if isinstance(payload, dict) else ""


def _chat_run_has_live_lease(run: ChatRun, *, now: datetime | None = None) -> bool:
    """Return cross-worker liveness only while the durable lease is valid."""

    expires_at = run.lease_expires_at
    return bool(
        run.completed_at is None
        and run.lease_token
        and run.lease_owner
        and expires_at is not None
        and expires_at > (now or utc_now_naive())
    )


def _latest_background_chat_run(session: Session, conversation_id: int) -> TaskRun | None:
    return session.exec(
        select(TaskRun)
        .where(TaskRun.conversation_id == conversation_id, TaskRun.task_type == "background_chat")
        .order_by(TaskRun.created_at.desc(), TaskRun.id.desc())
    ).first()


async def _execute_chat_in_background(runtime, req: SendMessageRequest, bind, task_run_id: int | None = None):
    """Execute a chat stream in the background and consume all events."""
    _background_chat_status[runtime.conv_id] = {
        "status": "running",
        "task_run_id": str(task_run_id or ""),
        "updated_at": _now_iso(),
    }
    _mark_background_chat_run(bind, task_run_id, "running", "后台对话任务开始执行")
    try:
        phase_error: dict | None = None
        terminal_failure: dict | None = None
        linked_run_id = ""
        async for event in stream_chat_events(runtime, req, bind):
            # Events are consumed but not streamed to any client.
            # persist_assistant_message inside stream_chat_events saves the result.
            payload = _parse_sse_payload(event)
            metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else payload
            if isinstance(metadata, dict) and isinstance(metadata.get("phase_error"), dict):
                phase_error = metadata["phase_error"]
            event_type = str(payload.get("type") or "")
            event_run_id = str(payload.get("run_id") or "")
            if event_run_id and not linked_run_id:
                linked_run_id = event_run_id
                _link_background_chat_run(bind, task_run_id, linked_run_id)
            if event_type == "run_failed":
                terminal_failure = payload
        if phase_error or terminal_failure:
            error_message = str(
                (phase_error or {}).get("friendly_message")
                or (phase_error or {}).get("message")
                or (terminal_failure or {}).get("message")
                or "后台对话任务执行失败"
            )
            _background_chat_status[runtime.conv_id] = {
                "status": "failed",
                "task_run_id": str(task_run_id or ""),
                "error": error_message,
                "updated_at": _now_iso(),
            }
            _mark_background_chat_run(bind, task_run_id, "failed", "后台对话任务执行失败", error_message)
            return
        _background_chat_status[runtime.conv_id] = {
            "status": "completed",
            "task_run_id": str(task_run_id or ""),
            "updated_at": _now_iso(),
        }
        _mark_background_chat_run(bind, task_run_id, "completed", "后台对话任务已完成")
    except asyncio.CancelledError:
        _background_chat_status[runtime.conv_id] = {
            "status": "cancelled",
            "task_run_id": str(task_run_id or ""),
            "updated_at": _now_iso(),
        }
        _mark_background_chat_run(bind, task_run_id, "canceled", "后台对话任务已取消")
        raise
    except Exception as exc:
        logger.error(f"[background_chat error] {exc}\n{traceback.format_exc()}")
        _background_chat_status[runtime.conv_id] = {
            "status": "failed",
            "task_run_id": str(task_run_id or ""),
            "error": str(exc),
            "updated_at": _now_iso(),
        }
        _mark_background_chat_run(bind, task_run_id, "failed", "后台对话任务执行失败", str(exc))
    finally:
        _background_chat_tasks.pop(runtime.conv_id, None)


@router.post("/send-async", response_model=SendAsyncResponse)
async def send_message_async(
    req: SendMessageRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Submit a chat request to run in the background.

    Returns immediately with a conversation_id. The assistant message will be
    saved to the conversation once the stream completes. Poll
    /chat/conversations/{conv_id}/messages to retrieve the result.
    """
    conversation = require_chat_request_access(
        session,
        conversation_id=req.conversation_id,
        project_id=req.project_id,
        current_user=current_user,
        require_write=True,
    )
    if conversation and req.project_id is None and conversation.project_id is not None:
        req.project_id = conversation.project_id
    if req.turn_recovery is not None:
        # Background submission cannot return the reviewed recovery stream and
        # owns a second durable TaskRun whose crash reconciliation is separate
        # from the recovery-child CAS. Reject before runtime preparation so no
        # user Message, recovery child, or background TaskRun can be persisted.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Turn recovery requires the interactive /chat/send endpoint",
        )
    runtime = await prepare_chat_runtime_async(session, req, owner_user_id=current_user.id)
    if not str(getattr(runtime, "prepared_run_id", "") or ""):
        runtime.prepared_run_id = make_run_id()
    bind = session.get_bind()
    task_run = _create_background_chat_run(session, runtime, req)

    # Cancel any existing background task for this conversation
    existing = _background_chat_tasks.pop(runtime.conv_id, None)
    if existing and not existing.done():
        existing.cancel()
        _background_chat_status[runtime.conv_id] = {
            "status": "cancelled",
            "updated_at": _now_iso(),
        }

    task = asyncio.create_task(_execute_chat_in_background(runtime, req, bind, task_run.id))
    _background_chat_tasks[runtime.conv_id] = task

    return SendAsyncResponse(conversation_id=runtime.conv_id, task_run_id=task_run.id, status="running")


@router.get("/tasks/{conversation_id}", response_model=ChatTaskStatusResponse)
def get_chat_task_status(
    conversation_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Check whether a background chat task is still running.

    Uses in-memory registry for live tasks and falls back to TaskRun DB state.
    If a task is marked "running" in DB but not in memory (e.g. after service restart),
    it is reported as "stale" so the client can decide whether to retry.
    """
    from app.services.chat_store import get_conversation_messages

    require_conversation_access(session, conversation_id, current_user)
    is_running = conversation_id in _background_chat_tasks
    status_record = _background_chat_status.get(conversation_id, {})
    task_run = _latest_background_chat_run(session, conversation_id)
    messages = get_conversation_messages(session, conversation_id, limit=1)
    persisted_status = task_run.status if task_run else None
    chat_run_id = _background_chat_run_id(task_run)
    chat_run = (
        session.exec(select(ChatRun).where(ChatRun.run_id == chat_run_id)).first()
        if chat_run_id
        else None
    )

    if is_running:
        status = "running"
    elif chat_run is not None and _chat_run_has_live_lease(chat_run):
        # Cross-worker authoritative liveness. The local registry is only the
        # fast path; the ChatRun lease identifies an active remote worker.
        status = "running"
    elif chat_run is not None and chat_run.completed_at is not None:
        status = chat_run.status
    elif chat_run is not None:
        # An expired, missing, or malformed lease is not worker liveness. The
        # scheduled reaper will persist the exact interrupted reason shortly.
        status = "stale"
    elif status_record.get("status"):
        status = status_record.get("status")
    elif persisted_status == "running":
        # DB says running but not in memory → likely stale after restart
        status = "stale"
    else:
        status = persisted_status or "completed"

    if status == "canceled":
        status = "cancelled"

    return ChatTaskStatusResponse(
        conversation_id=conversation_id,
        task_run_id=task_run.id if task_run else None,
        status=status,
        message_count=len(messages),
        error=status_record.get("error") or (task_run.error_message if task_run else None),
        updated_at=status_record.get("updated_at") or (task_run.updated_at.isoformat() if task_run else None),
    )
