from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.database import get_session
from app.routers.chat_schemas import (
    ConversationOut,
    CreateConversationRequest,
    MessageOut,
    UpdateConversationRequest,
)
from app.services.chat_store import (
    create_conversation_record,
    delete_conversation_with_messages,
    get_conversation_messages,
    get_conversation_or_404,
    list_conversations_cached,
    update_conversation_title,
)

router = APIRouter()


@router.get("/conversations", response_model=List[ConversationOut])
def list_conversations(
    project_id: Optional[int] = None,
    standalone: bool = False,
    session: Session = Depends(get_session),
):
    return list_conversations_cached(session, project_id=project_id, standalone=standalone)


@router.get("/conversations/{conv_id}", response_model=ConversationOut)
def get_conversation(conv_id: int, session: Session = Depends(get_session)):
    return get_conversation_or_404(session, conv_id)


@router.post("/conversations", response_model=ConversationOut)
def create_conversation(
    req: CreateConversationRequest,
    session: Session = Depends(get_session),
):
    return create_conversation_record(
        session,
        project_id=req.project_id,
        skill_id=req.skill_id,
        title=req.title or "",
    )


@router.get("/conversations/{conv_id}/messages", response_model=List[MessageOut])
def get_messages(
    conv_id: int,
    limit: int = 30,
    before_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    return get_conversation_messages(session, conv_id, limit=limit, before_id=before_id)


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: int, session: Session = Depends(get_session)):
    delete_conversation_with_messages(session, conv_id)
    return {"ok": True}


@router.patch("/conversations/{conv_id}", response_model=ConversationOut)
def patch_conversation(
    conv_id: int,
    req: UpdateConversationRequest,
    session: Session = Depends(get_session),
):
    conv = get_conversation_or_404(session, conv_id)
    title = (req.title or "").strip()
    if not title:
        return conv
    return update_conversation_title(session, conv_id, title)
