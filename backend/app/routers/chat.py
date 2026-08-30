"""Chat router — SSE chat entrypoints and diagnostics."""
from __future__ import annotations

import json
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.database import get_session
from app.routers.chat_conversations import router as conversations_router
from app.routers.chat_diagnostics import router as diagnostics_router
from app.routers.chat_async import router as async_router
from app.routers.chat_export import router as export_router
from app.routers.chat_feedback import router as feedback_router
from app.routers.chat_mentions import router as mentions_router
from app.routers.chat_models import router as models_router
from app.routers.chat_plan import router as plan_router
from app.routers.chat_actions import router as actions_router
from app.routers.auth import get_current_user
from app.routers.chat_security import require_chat_request_access, require_conversation_access
from app.routers.chat_schemas import SendMessageRequest, SteerChatRunRequest
from app.models.db import Conversation, Message, User
from app.services.chat.sse import sse_event
from app.services.chat.product_run_events import make_run_id
from app.services.agent_harness.run_rollout import reserve_prepared_chat_rollout
from app.services.chat_store import persist_assistant_message
from app.services.cache import conversations_cache
from app.services.chat_tools import _to_user_friendly_error
from app.services.chat.turn_recovery import (
    TurnRecoveryConflict,
    TurnRecoveryError,
    find_existing_recovery_child,
)
from app.services.chat_streaming import prepare_chat_runtime_async, stream_chat_events
from app.services.agent_harness.turn_interrupt import (
    InterruptStatus,
    SteeringStatus,
    get_active_turn,
    interrupt_active_turn,
)
from app.services.agent_harness.durable_run_inputs import (
    DurableRunInputRejected,
    accept_cancel_run_input,
    accept_steering_run_input,
    content_sha256,
    durable_run_accepts_cancel,
    durable_run_accepts_local_cancel,
    durable_run_accepts_steering,
    resolve_active_durable_run,
)
from app.services.time_utils import utc_now_naive

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)
router.include_router(conversations_router)
router.include_router(diagnostics_router)
router.include_router(export_router)
router.include_router(feedback_router)
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


@router.post("/runs/{run_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
async def cancel_chat_run(
    run_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Cancel one active SSE turn after authorizing its conversation."""

    try:
        durable_run = resolve_active_durable_run(session, run_id=run_id)
    except DurableRunInputRejected as exc:
        if exc.code == "run_not_found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    conversation_id = int(durable_run.conversation_id)
    require_conversation_access(
        session,
        conversation_id,
        current_user,
        require_write=True,
    )
    active = get_active_turn(run_id)
    if active is not None and active.conversation_id != conversation_id:
        raise HTTPException(status_code=409, detail="Chat run conversation mismatch")
    accepts_cancel = (
        durable_run_accepts_local_cancel(durable_run)
        if active is not None
        else durable_run_accepts_cancel(durable_run)
    )
    if not accepts_cancel:
        raise HTTPException(
            status_code=409,
            detail="Chat run is no longer accepting cancellation at this phase",
        )
    try:
        durable_input = accept_cancel_run_input(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
            allow_closed_phase=active is not None,
        )
        session.commit()
    except DurableRunInputRejected as exc:
        session.rollback()
        if exc.code == "run_not_found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.exception("[run cancel] failed to persist intent run_id=%s", run_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to persist chat run cancellation",
        ) from exc

    immediate = False
    if active is not None:
        outcome = interrupt_active_turn(
            run_id,
            conversation_id=conversation_id,
        )
        immediate = outcome.status is InterruptStatus.ACCEPTED
    return {
        "run_id": run_id,
        "status": "cancellation_requested",
        "conversation_id": conversation_id,
        "input_id": durable_input.id,
        "sequence": durable_input.sequence,
        "delivery": "immediate" if immediate else "durable_boundary",
    }


_STEERING_CONFLICT_DETAILS = {
    SteeringStatus.EXPECTED_RUN_MISMATCH: "Expected run id does not match the target run",
    SteeringStatus.NOT_STEERABLE: "Chat run is not accepting steering at this phase",
    SteeringStatus.INTERRUPT_REQUESTED: "Chat run is already stopping",
    SteeringStatus.QUEUE_FULL: "Chat run steering queue is full",
    SteeringStatus.EMPTY_INPUT: "Steering content is empty",
    SteeringStatus.INPUT_TOO_LARGE: "Steering content is too large",
    SteeringStatus.CONVERSATION_MISMATCH: "Chat run conversation mismatch",
}


@router.post("/runs/{run_id}/steer", status_code=status.HTTP_202_ACCEPTED)
async def steer_chat_run(
    run_id: str,
    req: SteerChatRunRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Add one user instruction to the exact active run after authorization."""

    if req.expected_run_id.strip() != run_id.strip():
        raise HTTPException(
            status_code=409,
            detail=_STEERING_CONFLICT_DETAILS[SteeringStatus.EXPECTED_RUN_MISMATCH],
        )
    try:
        durable_run = resolve_active_durable_run(session, run_id=run_id)
    except DurableRunInputRejected as exc:
        if exc.code == "run_not_found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    conversation_id = int(durable_run.conversation_id)
    require_conversation_access(
        session,
        conversation_id,
        current_user,
        require_write=True,
    )
    active = get_active_turn(run_id)
    if not durable_run_accepts_steering(durable_run):
        raise HTTPException(
            status_code=409,
            detail=_STEERING_CONFLICT_DETAILS[SteeringStatus.NOT_STEERABLE],
        )
    if active is not None:
        if active.conversation_id != conversation_id:
            raise HTTPException(status_code=409, detail="Chat run conversation mismatch")
        if active.interrupt_requested:
            raise HTTPException(
                status_code=409,
                detail=_STEERING_CONFLICT_DETAILS[SteeringStatus.INTERRUPT_REQUESTED],
            )
        if not active.steerable:
            raise HTTPException(
                status_code=409,
                detail=_STEERING_CONFLICT_DETAILS[SteeringStatus.NOT_STEERABLE],
            )

    # The message and content-free mailbox row commit atomically. No process
    # registry is needed: another worker can accept this exact Run input.
    message = Message(
        conversation_id=conversation_id,
        role="user",
        content=req.content.strip(),
        metadata_json="{}",
    )
    session.add(message)
    conversation = session.get(Conversation, conversation_id)
    if conversation is not None:
        conversation.updated_at = utc_now_naive()
        session.add(conversation)
    session.flush()

    try:
        durable_input = accept_steering_run_input(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
            message_id=message.id,
            content_digest=content_sha256(message.content),
        )
    except DurableRunInputRejected as exc:
        session.rollback()
        if exc.code == "run_not_found":
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        session.rollback()
        logger.exception("[run steering] failed to persist durable input run_id=%s", run_id)
        raise HTTPException(status_code=500, detail="Failed to persist steering input") from exc

    steering_id = f"steer_{uuid4().hex}"
    message.metadata_json = json.dumps(
        {
            "run_steering": {
                "schema_version": "aria.run_steering.v1",
                "status": "accepted",
                "run_id": run_id,
                "expected_run_id": req.expected_run_id,
                "steering_id": steering_id,
                "sequence": durable_input.sequence,
                "input_id": durable_input.id,
            }
        },
        ensure_ascii=False,
    )
    session.add(message)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("[run steering] failed to persist steering message run_id=%s", run_id)
        raise HTTPException(status_code=500, detail="Failed to persist steering input")
    conversations_cache.delete_prefix("list:")

    return {
        "run_id": run_id,
        "expected_run_id": req.expected_run_id,
        "status": "steering_accepted",
        "conversation_id": conversation_id,
        "steering_id": steering_id,
        "sequence": durable_input.sequence,
        "message_id": message.id,
        "input_id": durable_input.id,
    }


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
    except TurnRecoveryConflict as exc:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except TurnRecoveryError as exc:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("[chat prepare error] %s", exc, exc_info=True)
        session.rollback()
        if req.turn_recovery is not None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Turn recovery preparation failed before a child run was reserved",
            ) from exc
        return StreamingResponse(
            _prepare_error_stream(bind=session.get_bind(), req=req, exc=exc),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    recovery_contract = (
        runtime.prepare_metrics.get("turn_recovery")
        if isinstance(runtime.prepare_metrics, dict)
        and isinstance(runtime.prepare_metrics.get("turn_recovery"), dict)
        else {}
    )
    if recovery_contract:
        prepared_run_id = make_run_id()
        try:
            prepared_task_id = reserve_prepared_chat_rollout(
                session,
                runtime,
                req.content,
                prepared_run_id,
            )
            session.commit()
            conversations_cache.delete_prefix("list:")
        except IntegrityError as exc:
            session.rollback()
            existing_child = find_existing_recovery_child(
                session,
                conversation_id=int(runtime.conv_id),
                contract=recovery_contract,
            )
            if existing_child is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This recovery contract has already started a child run",
                ) from exc
            logger.error("[recovery reservation integrity error] %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Recovery child reservation failed integrity validation",
            ) from exc
        except Exception:
            session.rollback()
            raise
        runtime.prepared_run_id = prepared_run_id
        runtime.prepared_rollout_task_id = prepared_task_id
    return StreamingResponse(
        stream_chat_events(runtime, req, session.get_bind()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
