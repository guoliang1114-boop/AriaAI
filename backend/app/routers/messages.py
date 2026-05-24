from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import SystemMessage, SystemMessageRead, User
from app.routers.auth import get_current_user, require_admin
from app.services.time_utils import utc_now_naive

router = APIRouter(prefix="/messages", tags=["messages"])


class MessageCreateRequest(BaseModel):
    title: str
    content: str
    level: str = "info"
    link: str = ""
    is_published: bool = True


class MessageUpdateRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    level: Optional[str] = None
    link: Optional[str] = None
    is_published: Optional[bool] = None


class MessageOut(BaseModel):
    id: int
    title: str
    content: str
    level: str
    link: str
    is_published: bool
    created_at: datetime
    updated_at: datetime
    created_by_user_id: Optional[int] = None
    created_by_display_name: str = ""
    is_read: bool = False
    read_at: Optional[datetime] = None


class MessageListResponse(BaseModel):
    items: list[MessageOut]
    unread_count: int


class MessageAdminOut(BaseModel):
    id: int
    title: str
    content: str
    level: str
    link: str
    is_published: bool
    created_at: datetime
    updated_at: datetime
    created_by_user_id: Optional[int] = None
    created_by_display_name: str = ""
    read_count: int = 0


def _validate_level(level: str) -> str:
    allowed = {"info", "success", "warning", "error"}
    normalized = (level or "info").strip().lower()
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail="Invalid message level")
    return normalized


def _build_message_out(
    message: SystemMessage,
    created_by_display_name: str,
    read_record: Optional[SystemMessageRead],
) -> MessageOut:
    return MessageOut(
        id=message.id,
        title=message.title,
        content=message.content,
        level=message.level,
        link=message.link,
        is_published=message.is_published,
        created_at=message.created_at,
        updated_at=message.updated_at,
        created_by_user_id=message.created_by_user_id,
        created_by_display_name=created_by_display_name,
        is_read=read_record is not None,
        read_at=read_record.read_at if read_record else None,
    )


@router.get("", response_model=MessageListResponse)
def list_messages(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    messages = session.exec(
        select(SystemMessage)
        .where(SystemMessage.is_published == True)
        .order_by(SystemMessage.created_at.desc())
    ).all()

    user_ids = {message.created_by_user_id for message in messages if message.created_by_user_id}
    user_map = {}
    if user_ids:
        users = session.exec(select(User).where(User.id.in_(user_ids))).all()
        user_map = {user.id: user.display_name for user in users}

    reads = session.exec(
        select(SystemMessageRead).where(SystemMessageRead.user_id == current_user.id)
    ).all()
    reads_by_message_id = {read.message_id: read for read in reads}

    items = [
        _build_message_out(
            message,
            user_map.get(message.created_by_user_id or 0, ""),
            reads_by_message_id.get(message.id),
        )
        for message in messages
    ]
    unread_count = sum(1 for item in items if not item.is_read)
    return MessageListResponse(items=items, unread_count=unread_count)


@router.get("/unread-count")
def unread_count(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    published_ids = session.exec(
        select(SystemMessage.id).where(SystemMessage.is_published == True)
    ).all()
    if not published_ids:
        return {"unread_count": 0}
    read_ids = set(
        session.exec(
            select(SystemMessageRead.message_id).where(SystemMessageRead.user_id == current_user.id)
        ).all()
    )
    unread = sum(1 for message_id in published_ids if message_id not in read_ids)
    return {"unread_count": unread}


@router.post("/{message_id}/read")
def mark_message_read(
    message_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    message = session.get(SystemMessage, message_id)
    if not message or not message.is_published:
        raise HTTPException(status_code=404, detail="Message not found")

    existing = session.exec(
        select(SystemMessageRead).where(
            SystemMessageRead.message_id == message_id,
            SystemMessageRead.user_id == current_user.id,
        )
    ).first()
    if not existing:
        existing = SystemMessageRead(message_id=message_id, user_id=current_user.id)
        session.add(existing)
        session.commit()
        session.refresh(existing)

    return {"ok": True, "read_at": existing.read_at.isoformat()}


@router.post("/read-all")
def mark_all_messages_read(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    messages = session.exec(select(SystemMessage.id).where(SystemMessage.is_published == True)).all()
    if not messages:
        return {"ok": True, "marked_count": 0}

    read_ids = set(
        session.exec(
            select(SystemMessageRead.message_id).where(SystemMessageRead.user_id == current_user.id)
        ).all()
    )
    created = 0
    for message_id in messages:
        if message_id in read_ids:
            continue
        session.add(SystemMessageRead(message_id=message_id, user_id=current_user.id))
        created += 1
    session.commit()
    return {"ok": True, "marked_count": created}


@router.get("/admin", response_model=list[MessageAdminOut])
def admin_list_messages(
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    messages = session.exec(select(SystemMessage).order_by(SystemMessage.created_at.desc())).all()
    user_ids = {message.created_by_user_id for message in messages if message.created_by_user_id}
    user_map = {}
    if user_ids:
        users = session.exec(select(User).where(User.id.in_(user_ids))).all()
        user_map = {user.id: user.display_name for user in users}

    read_counts: dict[int, int] = {}
    if messages:
        reads = session.exec(select(SystemMessageRead)).all()
        for read in reads:
            read_counts[read.message_id] = read_counts.get(read.message_id, 0) + 1

    return [
        MessageAdminOut(
            id=message.id,
            title=message.title,
            content=message.content,
            level=message.level,
            link=message.link,
            is_published=message.is_published,
            created_at=message.created_at,
            updated_at=message.updated_at,
            created_by_user_id=message.created_by_user_id,
            created_by_display_name=user_map.get(message.created_by_user_id or 0, ""),
            read_count=read_counts.get(message.id, 0),
        )
        for message in messages
    ]


@router.post("/admin", response_model=MessageAdminOut)
def admin_create_message(
    body: MessageCreateRequest,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if not body.title.strip() or not body.content.strip():
        raise HTTPException(status_code=400, detail="Title and content are required")

    message = SystemMessage(
        title=body.title.strip(),
        content=body.content.strip(),
        level=_validate_level(body.level),
        link=(body.link or "").strip(),
        is_published=body.is_published,
        created_by_user_id=admin.id,
        updated_at=utc_now_naive(),
    )
    session.add(message)
    session.commit()
    session.refresh(message)
    return MessageAdminOut(
        id=message.id,
        title=message.title,
        content=message.content,
        level=message.level,
        link=message.link,
        is_published=message.is_published,
        created_at=message.created_at,
        updated_at=message.updated_at,
        created_by_user_id=message.created_by_user_id,
        created_by_display_name=admin.display_name,
        read_count=0,
    )


@router.patch("/admin/{message_id}", response_model=MessageAdminOut)
def admin_update_message(
    message_id: int,
    body: MessageUpdateRequest,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    message = session.get(SystemMessage, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    if body.title is not None:
        if not body.title.strip():
            raise HTTPException(status_code=400, detail="Title is required")
        message.title = body.title.strip()
    if body.content is not None:
        if not body.content.strip():
            raise HTTPException(status_code=400, detail="Content is required")
        message.content = body.content.strip()
    if body.level is not None:
        message.level = _validate_level(body.level)
    if body.link is not None:
        message.link = body.link.strip()
    if body.is_published is not None:
        message.is_published = body.is_published
    message.updated_at = utc_now_naive()
    session.add(message)
    session.commit()
    session.refresh(message)

    read_count = session.exec(
        select(SystemMessageRead).where(SystemMessageRead.message_id == message.id)
    ).all()
    creator = session.get(User, message.created_by_user_id) if message.created_by_user_id else None
    return MessageAdminOut(
        id=message.id,
        title=message.title,
        content=message.content,
        level=message.level,
        link=message.link,
        is_published=message.is_published,
        created_at=message.created_at,
        updated_at=message.updated_at,
        created_by_user_id=message.created_by_user_id,
        created_by_display_name=creator.display_name if creator else "",
        read_count=len(read_count),
    )
