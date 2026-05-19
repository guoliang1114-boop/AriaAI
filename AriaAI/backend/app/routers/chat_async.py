"""Async chat router — background task execution for long-running chat requests."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import TaskEvent, TaskRun
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_streaming import prepare_chat_runtime, stream_chat_events
from app.services.time_utils import utc_now_naive

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
    task = TaskRun(
        project_id=req.project_id,
        conversation_id=runtime.conv_id,
        task_type="background_chat",
        goal=(req.content or "")[:240],
        status="pending",
        input_json=_safe_json(req.model_dump(mode="json")),
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
        {"conversation_id": runtime.conv_id},
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
        async for event in stream_chat_events(runtime, req, bind):
            # Events are consumed but not streamed to any client.
            # persist_assistant_message inside stream_chat_events saves the result.
            pass
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
        import traceback

        print(f"[background_chat error] {exc}\n{traceback.format_exc()}", flush=True)
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
async def send_message_async(req: SendMessageRequest, session: Session = Depends(get_session)):
    """Submit a chat request to run in the background.

    Returns immediately with a conversation_id. The assistant message will be
    saved to the conversation once the stream completes. Poll
    /chat/conversations/{conv_id}/messages to retrieve the result.
    """
    runtime = prepare_chat_runtime(session, req)
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
def get_chat_task_status(conversation_id: int, session: Session = Depends(get_session)):
    """Check whether a background chat task is still running."""
    from app.services.chat_store import get_conversation_messages

    is_running = conversation_id in _background_chat_tasks
    status_record = _background_chat_status.get(conversation_id, {})
    task_run = _latest_background_chat_run(session, conversation_id)
    messages = get_conversation_messages(session, conversation_id, limit=1)
    persisted_status = task_run.status if task_run else None
    status = "running" if is_running else status_record.get("status") or persisted_status or "completed"
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
