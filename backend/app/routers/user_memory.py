"""User memory router (V0.0.4 main track B).

Minimal read/write API for the per-user cross-project preference store. This is
the foundation only — prompt injection and the conversational "记住这个偏好"
flow land in later commits.

Endpoints:
- ``GET /user-memory``: return the current user's preferences (decoded JSON).
- ``PUT /user-memory``: replace the current user's preferences with the provided
  JSON object (whole-object PUT; merge semantics can be added later).
- ``DELETE /user-memory``: remove all preferences for the current user.

Guard rails:
- Always scoped to ``current_user`` — a user can only see/edit their own row.
- We accept arbitrary JSON-object preferences for v1, but explicitly reject
  values that look like client/project facts (see ``_DISALLOWED_TOP_KEYS``) so
  the user-memory layer cannot accidentally absorb facts that belong elsewhere.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import User, UserMemory
from app.routers.auth import get_current_user
from app.services.time_utils import utc_now_naive

router = APIRouter(prefix="/user-memory", tags=["user-memory"])

# Top-level keys that are forbidden in user memory — they belong to the client
# or project memory layers (see docs/12 §4.4). Listed as a guard rail to keep
# the v1 API from accidentally becoming a kitchen-sink for project facts.
_DISALLOWED_TOP_KEYS = frozenset(
    {
        "client",
        "client_id",
        "clients",
        "project",
        "project_id",
        "projects",
        "milestones",
        "stakeholders",
        "contract_amount",
        "financial_status",
    }
)


class UserMemoryOut(BaseModel):
    preferences: dict[str, Any]
    version: int
    updated_at: str


class UserMemoryUpdate(BaseModel):
    preferences: dict[str, Any]


def _validate_preferences(preferences: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(preferences, dict):
        raise HTTPException(400, "preferences must be a JSON object")
    bad = sorted(k for k in preferences.keys() if k in _DISALLOWED_TOP_KEYS)
    if bad:
        raise HTTPException(
            400,
            f"these keys are not allowed in user memory (they belong to client/project memory): {bad}",
        )
    return preferences


def _row_to_out(row: UserMemory | None) -> UserMemoryOut:
    if row is None:
        return UserMemoryOut(preferences={}, version=0, updated_at="")
    try:
        prefs = json.loads(row.preferences_json or "{}")
    except json.JSONDecodeError:
        prefs = {}
    if not isinstance(prefs, dict):
        prefs = {}
    return UserMemoryOut(
        preferences=prefs,
        version=row.version,
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


@router.get("", response_model=UserMemoryOut)
def get_user_memory(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UserMemoryOut:
    row = session.exec(
        select(UserMemory).where(UserMemory.user_id == current_user.id)
    ).first()
    return _row_to_out(row)


@router.put("", response_model=UserMemoryOut)
def upsert_user_memory(
    data: UserMemoryUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UserMemoryOut:
    preferences = _validate_preferences(data.preferences)
    row = session.exec(
        select(UserMemory).where(UserMemory.user_id == current_user.id)
    ).first()
    now = utc_now_naive()
    if row is None:
        row = UserMemory(
            user_id=current_user.id,
            preferences_json=json.dumps(preferences, ensure_ascii=False),
            version=1,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
    else:
        row.preferences_json = json.dumps(preferences, ensure_ascii=False)
        row.version += 1
        row.updated_at = now
        session.add(row)
    session.commit()
    session.refresh(row)
    return _row_to_out(row)


@router.delete("", response_model=UserMemoryOut)
def clear_user_memory(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UserMemoryOut:
    row = session.exec(
        select(UserMemory).where(UserMemory.user_id == current_user.id)
    ).first()
    if row is None:
        return UserMemoryOut(preferences={}, version=0, updated_at="")
    row.preferences_json = "{}"
    row.version += 1
    row.updated_at = utc_now_naive()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _row_to_out(row)
