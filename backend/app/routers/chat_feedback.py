from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import Conversation, Message, User
from app.routers.auth import get_current_user
from app.routers.chat_security import require_conversation_access, require_project_access
from app.services.chat.interaction_feedback import (
    FEEDBACK_REASONS,
    aggregate_interaction_metrics,
    build_message_feedback,
    parse_message_metadata,
)

router = APIRouter()


class MessageFeedbackRequest(BaseModel):
    rating: str = Field(min_length=1, max_length=20)
    reasons: list[str] = Field(default_factory=list, max_length=3)


@router.post("/messages/{message_id}/feedback")
def save_message_feedback(
    message_id: int,
    req: MessageFeedbackRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    message = session.get(Message, message_id)
    if message is None or message.role != "assistant":
        raise HTTPException(status_code=404, detail="Assistant message not found")
    require_conversation_access(session, message.conversation_id, current_user, require_write=True)
    unknown_reasons = [reason for reason in req.reasons if reason not in FEEDBACK_REASONS]
    if unknown_reasons:
        raise HTTPException(status_code=422, detail="Unsupported feedback reason")
    try:
        feedback = build_message_feedback(req.rating, req.reasons)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    metadata = parse_message_metadata(message.metadata_json)
    metadata["interaction_feedback"] = feedback
    message.metadata_json = json.dumps(metadata, ensure_ascii=False)
    session.add(message)
    session.commit()
    return {"message_id": message_id, "feedback": feedback}


@router.get("/projects/{project_id}/interaction-metrics")
def get_project_interaction_metrics(
    project_id: int,
    limit: int = Query(2_000, ge=1, le=10_000),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user)
    messages = session.exec(
        select(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Conversation.project_id == project_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(limit)
    ).all()
    return {
        "project_id": project_id,
        "sample_limit": limit,
        **aggregate_interaction_metrics(messages),
    }
