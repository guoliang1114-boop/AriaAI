"""Business logic for weekly focus items ("每周重点事项").

Items are scoped to an ISO week via ``week_start`` (the Monday of that week,
``YYYY-MM-DD``), computed in the app timezone. The team board groups every
active user's items for a given week; "my items" filters by owner. Follow-up
is intentionally lightweight — a single ``status`` plus an in-place one-line
``progress_note`` per item (no per-week history).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

try:  # zoneinfo is stdlib on 3.9+, but tz data may be missing on some hosts
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - defensive
    ZoneInfo = None  # type: ignore[assignment]

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, User, WeeklyFocusItem
from app.services.settings_helper import get_setting_value
from app.services.time_utils import utc_now_naive

VALID_STATUSES = {"in_progress", "done", "blocked"}
DEFAULT_STATUS = "in_progress"


# ── Week math ────────────────────────────────────────────────────────────────

def _today_in_app_tz(session: Session) -> date:
    tz_name = get_setting_value(session, "timezone", "Asia/Shanghai") or "Asia/Shanghai"
    if ZoneInfo is not None:
        try:
            return datetime.now(ZoneInfo(tz_name)).date()
        except Exception:
            pass
    return datetime.now(timezone.utc).date()


def monday_of(day: date) -> date:
    """Return the Monday on or before ``day`` (weeks start Monday)."""
    return day - timedelta(days=day.weekday())


def current_week_start(session: Session) -> str:
    return monday_of(_today_in_app_tz(session)).isoformat()


def normalize_week_start(value: Optional[str], session: Session) -> str:
    """Snap any ISO date to its Monday; fall back to the current week."""
    if not value:
        return current_week_start(session)
    try:
        parsed = date.fromisoformat(value.strip())
    except (ValueError, AttributeError):
        return current_week_start(session)
    return monday_of(parsed).isoformat()


def shift_week(week_start: str, weeks: int) -> str:
    return (date.fromisoformat(week_start) + timedelta(weeks=weeks)).isoformat()


# ── Serialization ─────────────────────────────────────────────────────────────

def _project_name_map(session: Session, project_ids: set[int]) -> dict[int, str]:
    ids = [pid for pid in project_ids if pid is not None]
    if not ids:
        return {}
    rows = session.exec(select(Project.id, Project.name).where(Project.id.in_(ids))).all()
    return {row[0]: row[1] for row in rows}


def _user_brief(user: Optional[User]) -> Optional[dict]:
    if user is None:
        return None
    return {"id": user.id, "display_name": user.display_name or user.email}


def serialize_item(item: WeeklyFocusItem, project_names: Optional[dict[int, str]] = None) -> dict:
    project_name = None
    if item.project_id is not None and project_names is not None:
        project_name = project_names.get(item.project_id)
    return {
        "id": item.id,
        "week_start": item.week_start,
        "owner_user_id": item.owner_user_id,
        "owner": _user_brief(item.owner),
        "created_by_user_id": item.created_by_user_id,
        "created_by": _user_brief(item.created_by),
        "content": item.content,
        "status": item.status,
        "progress_note": item.progress_note,
        "project_id": item.project_id,
        "project_name": project_name,
        "sort_order": item.sort_order,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


# ── Queries ───────────────────────────────────────────────────────────────────

def list_items(
    session: Session,
    week_start: str,
    *,
    owner_user_id: Optional[int] = None,
) -> list[WeeklyFocusItem]:
    stmt = select(WeeklyFocusItem).where(WeeklyFocusItem.week_start == week_start)
    if owner_user_id is not None:
        stmt = stmt.where(WeeklyFocusItem.owner_user_id == owner_user_id)
    stmt = stmt.order_by(WeeklyFocusItem.sort_order, WeeklyFocusItem.id)
    return session.exec(stmt).all()


def build_board(session: Session, week_start: str) -> dict:
    """Group a week's items by owner. Every active user appears (even with no
    items) so the board reads as the whole team, not just whoever has filled in."""
    items = list_items(session, week_start)
    project_names = _project_name_map(session, {i.project_id for i in items if i.project_id})

    by_owner: dict[int, list[WeeklyFocusItem]] = {}
    for item in items:
        by_owner.setdefault(item.owner_user_id, []).append(item)

    active_users = session.exec(select(User).where(User.is_active == True)).all()  # noqa: E712
    user_map = {u.id: u for u in active_users}

    owner_ids = list(user_map.keys())
    # Include owners with items who are no longer active (deactivated) at the end.
    for oid in by_owner:
        if oid not in user_map:
            owner_ids.append(oid)

    people = []
    total_items = 0
    done_items = 0
    for uid in owner_ids:
        owner_items = by_owner.get(uid, [])
        done = sum(1 for it in owner_items if it.status == "done")
        total_items += len(owner_items)
        done_items += done
        user = user_map.get(uid)
        if user is not None:
            display_name = user.display_name or user.email
            is_admin = user.is_admin
        else:
            owner_rel = owner_items[0].owner if owner_items else None
            display_name = (owner_rel.display_name if owner_rel else None) or f"用户 #{uid}"
            is_admin = False
        people.append(
            {
                "user": {"id": uid, "display_name": display_name, "is_admin": is_admin},
                "items": [serialize_item(it, project_names) for it in owner_items],
                "total_count": len(owner_items),
                "done_count": done,
            }
        )

    # People with items first, then alphabetical — the frontend pins "me" itself.
    people.sort(key=lambda p: (p["total_count"] == 0, (p["user"]["display_name"] or "").lower()))

    return {
        "week_start": week_start,
        "stats": {
            "total_items": total_items,
            "done": done_items,
            "people": sum(1 for p in people if p["total_count"] > 0),
        },
        "people": people,
    }


# ── Mutations ─────────────────────────────────────────────────────────────────

def _next_sort_order(session: Session, week_start: str, owner_user_id: int) -> int:
    existing = list_items(session, week_start, owner_user_id=owner_user_id)
    return max((i.sort_order for i in existing), default=-1) + 1


def create_item(
    session: Session,
    *,
    week_start: str,
    owner_user_id: int,
    created_by_user_id: Optional[int],
    content: str,
    project_id: Optional[int] = None,
    status: str = DEFAULT_STATUS,
    progress_note: str = "",
) -> WeeklyFocusItem:
    content = (content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="重点事项内容不能为空")
    item = WeeklyFocusItem(
        week_start=week_start,
        owner_user_id=owner_user_id,
        created_by_user_id=created_by_user_id,
        content=content,
        status=status if status in VALID_STATUSES else DEFAULT_STATUS,
        progress_note=(progress_note or "").strip(),
        project_id=project_id,
        sort_order=_next_sort_order(session, week_start, owner_user_id),
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def update_item(session: Session, item: WeeklyFocusItem, changes: dict) -> WeeklyFocusItem:
    if "content" in changes:
        content = (changes["content"] or "").strip()
        if not content:
            raise HTTPException(status_code=400, detail="重点事项内容不能为空")
        item.content = content
    if "status" in changes:
        if changes["status"] not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="无效的状态值")
        item.status = changes["status"]
    if "progress_note" in changes:
        item.progress_note = (changes["progress_note"] or "").strip()
    if "project_id" in changes:
        item.project_id = changes["project_id"]
    if "sort_order" in changes and changes["sort_order"] is not None:
        item.sort_order = int(changes["sort_order"])
    item.updated_at = utc_now_naive()
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def carry_over(
    session: Session,
    *,
    from_week: str,
    to_week: str,
    owner_user_id: int,
    created_by_user_id: Optional[int],
) -> list[WeeklyFocusItem]:
    """Copy a user's unfinished (not ``done``) items from one week to another.

    Skips items whose content already exists in the target week so repeated
    presses are idempotent. Status/progress are preserved so a "blocked" item
    still reads as blocked in the new week."""
    source = [i for i in list_items(session, from_week, owner_user_id=owner_user_id) if i.status != "done"]
    if not source:
        return []
    target = list_items(session, to_week, owner_user_id=owner_user_id)
    existing_contents = {i.content.strip() for i in target}
    next_order = max((i.sort_order for i in target), default=-1) + 1

    created: list[WeeklyFocusItem] = []
    for src in source:
        key = src.content.strip()
        if key in existing_contents:
            continue
        item = WeeklyFocusItem(
            week_start=to_week,
            owner_user_id=owner_user_id,
            created_by_user_id=created_by_user_id,
            content=src.content,
            status=src.status,
            progress_note=src.progress_note,
            project_id=src.project_id,
            sort_order=next_order,
        )
        next_order += 1
        session.add(item)
        created.append(item)
        existing_contents.add(key)

    if created:
        session.commit()
        for item in created:
            session.refresh(item)
    return created
