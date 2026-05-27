"""Chat router — SSE chat entrypoints and diagnostics."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.database import get_session
from app.routers.chat_conversations import router as conversations_router
from app.routers.chat_diagnostics import router as diagnostics_router
from app.routers.chat_async import router as async_router
from app.routers.chat_export import router as export_router
from app.routers.chat_mentions import router as mentions_router
from app.routers.chat_models import router as models_router
from app.routers.chat_plan import router as plan_router
from app.routers.chat_actions import router as actions_router
from app.routers.auth import get_current_user
from app.routers.chat_security import require_chat_request_access
from app.routers.chat_schemas import SendMessageRequest
from app.models.db import Conversation, Message, User
from app.services.chat.sse import sse_event
from app.services.chat_store import persist_assistant_message
from app.services.chat_tools import _to_user_friendly_error
from app.services.chat_streaming import prepare_chat_runtime_async, stream_chat_events

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)
router.include_router(conversations_router)
router.include_router(diagnostics_router)
router.include_router(export_router)
router.include_router(models_router)
router.include_router(async_router)
router.include_router(plan_router)
router.include_router(mentions_router)
router.include_router(actions_router)


async def prepare_chat_runtime(session: Session, req: SendMessageRequest, owner_user_id: int | None = None):
    """Router-level async prepare hook kept patchable for legacy tests."""

    return await prepare_chat_runtime_async(session, req, owner_user_id=owner_user_id)


def _persist_prepare_error_turn(bind, req: SendMessageRequest, exc: Exception) -> tuple[int | None, dict, str, int | None]:
    """Persist failures that happen before the SSE phase engine starts."""
    conversation_id = req.conversation_id
    friendly = _to_user_friendly_error(str(exc))
    full_text = (
        "这轮对话在准备上下文时遇到问题，没有完成。\n\n"
        f"错误信息：{friendly}\n\n"
        "我已经保存这次失败状态，刷新或重新打开链接后仍可看到原因。"
    )
    metadata = {
        "project_id": req.project_id,
        "skill_id": req.skill_id,
        "delivery_failed": True,
        "phase_error": {
            "phase": "prepare_runtime",
            "type": exc.__class__.__name__,
            "message": str(exc)[:800],
            "friendly_message": friendly,
        },
    }

    if not conversation_id:
        return None, metadata, full_text, None

    with Session(bind) as recovery_session:
        latest = recovery_session.exec(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(1)
        ).first()
        if not latest or latest.role != "user" or latest.content != req.content:
            recovery_session.add(
                Message(
                    conversation_id=conversation_id,
                    role="user",
                    content=req.content,
                    metadata_json=json.dumps(
                        {k: v for k, v in {"project_id": req.project_id, "skill_id": req.skill_id}.items() if v},
                        ensure_ascii=False,
                    ),
                )
            )
            conv = recovery_session.get(Conversation, conversation_id)
            if conv:
                recovery_session.add(conv)
            recovery_session.commit()

    _, assistant_message_id = persist_assistant_message(bind, conversation_id, full_text, req.content, metadata)
    return conversation_id, metadata, full_text, assistant_message_id


async def _prepare_error_stream(
    *,
    bind,
    req: SendMessageRequest,
    exc: Exception,
):
    try:
        conversation_id, metadata, full_text, assistant_message_id = _persist_prepare_error_turn(bind, req, exc)
    except Exception as persist_exc:
        logger.error("[chat prepare error persist failed] %s", persist_exc, exc_info=True)
        friendly = _to_user_friendly_error(str(exc))
        yield sse_event({"type": "error", "message": friendly})
        return

    if conversation_id:
        yield sse_event({"type": "conversation_id", "id": conversation_id})
    yield sse_event({"type": "text", "content": full_text})
    yield sse_event(
        {
            "type": "done",
            "metadata": metadata,
            "assistant_message_id": assistant_message_id,
        }
    )


@router.post("/send")
async def send_message(
    req: SendMessageRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Stream Claude response via SSE. Creates conversation if needed."""
    conversation = require_chat_request_access(
        session,
        conversation_id=req.conversation_id,
        project_id=req.project_id,
        current_user=current_user,
        require_write=True,
    )
    if conversation and req.project_id is None and conversation.project_id is not None:
        req.project_id = conversation.project_id
    try:
        runtime = await prepare_chat_runtime(session, req, owner_user_id=current_user.id)
    except Exception as exc:
        logger.error("[chat prepare error] %s", exc, exc_info=True)
        session.rollback()
        return StreamingResponse(
            _prepare_error_stream(bind=session.get_bind(), req=req, exc=exc),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    return StreamingResponse(
        stream_chat_events(runtime, req, session.get_bind()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
