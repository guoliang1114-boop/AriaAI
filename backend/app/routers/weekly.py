"""Weekly focus items router ("每周重点事项").

Endpoints under ``/weekly``:
  - ``GET  /weekly/board``       team board for a week (everyone's items)
  - ``GET  /weekly/my``          the current user's items for a week
  - ``POST /weekly``             create an item (self, or any user if admin)
  - ``PATCH /weekly/{id}``       update status / progress / content / project
  - ``DELETE /weekly/{id}``      delete an item
  - ``POST /weekly/carry-over``  roll a user's unfinished items into a week

Visibility is intentionally team-wide: any authenticated user can read the
board. Writes are gated to the item's owner, with an admin super-user bypass
(admins act as the "manager" who can assign/adjust anyone's items).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.database import get_session
from app.models.db import User, WeeklyFocusItem
from app.routers.auth import get_current_user
from app.routers.chat_security import require_project_access
from app.services.weekly_focus import (
    build_board,
    carry_over,
    create_item,
    list_items,
    normalize_week_start,
    serialize_item,
    shift_week,
    _project_name_map,
    update_item,
)

router = APIRouter(prefix="/weekly", tags=["weekly"])


class WeeklyItemCreate(BaseModel):
    content: str
    week_start: Optional[str] = None
    owner_user_id: Optional[int] = None
    project_id: Optional[int] = None
    status: Optional[str] = None
    progress_note: Optional[str] = ""


class WeeklyItemUpdate(BaseModel):
    content: Optional[str] = None
    status: Optional[str] = None
    progress_note: Optional[str] = None
    project_id: Optional[int] = None
    sort_order: Optional[int] = None


class CarryOverRequest(BaseModel):
    to_week: Optional[str] = None
    from_week: Optional[str] = None
    owner_user_id: Optional[int] = None


def _can_manage(current_user: User, owner_user_id: int) -> bool:
    """Owner of the item, or an admin acting as manager."""
    return bool(current_user.is_admin) or current_user.id == owner_user_id


def _serialize_one(session: Session, item: WeeklyFocusItem) -> dict:
    names = _project_name_map(session, {item.project_id} if item.project_id else set())
    return serialize_item(item, names)


@router.get("/board")
def get_board(
    week_start: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    ws = normalize_week_start(week_start, session)
    return build_board(session, ws)


@router.get("/my")
def get_my_items(
    week_start: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    ws = normalize_week_start(week_start, session)
    items = list_items(session, ws, owner_user_id=current_user.id)
    names = _project_name_map(session, {i.project_id for i in items if i.project_id})
    return {"week_start": ws, "items": [serialize_item(i, names) for i in items]}


@router.post("", status_code=201)
def create_weekly_item(
    body: WeeklyItemCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    owner_id = body.owner_user_id or current_user.id
    if not _can_manage(current_user, owner_id):
        raise HTTPException(status_code=403, detail="无权为其他成员创建重点事项")
    owner = session.get(User, owner_id)
    if owner is None or not owner.is_active:
        raise HTTPException(status_code=404, detail="指定的成员不存在")
    if body.project_id is not None:
        require_project_access(session, body.project_id, current_user)
    ws = normalize_week_start(body.week_start, session)
    item = create_item(
        session,
        week_start=ws,
        owner_user_id=owner_id,
        created_by_user_id=current_user.id,
        content=body.content,
        project_id=body.project_id,
        status=body.status or "in_progress",
        progress_note=body.progress_note or "",
    )
    return _serialize_one(session, item)


@router.patch("/{item_id}")
def update_weekly_item(
    item_id: int,
    body: WeeklyItemUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    item = session.get(WeeklyFocusItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="重点事项不存在")
    if not _can_manage(current_user, item.owner_user_id):
        raise HTTPException(status_code=403, detail="无权修改该成员的重点事项")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("project_id") is not None:
        require_project_access(session, changes["project_id"], current_user)
    updated = update_item(session, item, changes)
    return _serialize_one(session, updated)


@router.delete("/{item_id}", status_code=204)
def delete_weekly_item(
    item_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    item = session.get(WeeklyFocusItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="重点事项不存在")
    if not _can_manage(current_user, item.owner_user_id):
        raise HTTPException(status_code=403, detail="无权删除该成员的重点事项")
    session.delete(item)
    session.commit()


@router.post("/carry-over")
def carry_over_items(
    body: CarryOverRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    owner_id = body.owner_user_id or current_user.id
    if not _can_manage(current_user, owner_id):
        raise HTTPException(status_code=403, detail="无权为其他成员滚动重点事项")
    to_week = normalize_week_start(body.to_week, session)
    from_week = normalize_week_start(body.from_week, session) if body.from_week else shift_week(to_week, -1)
    created = carry_over(
        session,
        from_week=from_week,
        to_week=to_week,
        owner_user_id=owner_id,
        created_by_user_id=current_user.id,
    )
    names = _project_name_map(session, {i.project_id for i in created if i.project_id})
    return {
        "from_week": from_week,
        "to_week": to_week,
        "created_count": len(created),
        "items": [serialize_item(i, names) for i in created],
    }
