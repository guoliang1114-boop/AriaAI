"""Chat router — SSE chat entrypoints and diagnostics."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlmodel import Session

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
from app.models.db import User
from app.services.chat_streaming import prepare_chat_runtime_async, stream_chat_events

router = APIRouter(prefix="/chat", tags=["chat"])
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
    runtime = await prepare_chat_runtime(session, req, owner_user_id=current_user.id)
    return StreamingResponse(
        stream_chat_events(runtime, req, session.get_bind()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
