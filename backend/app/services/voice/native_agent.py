"""Voice transport glue; authorization, tools and persistence remain native.

This adapter never creates its own model client or approval path. Iteration must
happen in a dedicated turn task: the native harness registers current_task().
"""
from __future__ import annotations

import asyncio
import json
from contextlib import aclosing
from dataclasses import dataclass
from datetime import timedelta
from typing import AsyncIterator

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import UserToken
from app.routers.auth import get_current_user
from app.routers.chat_security import require_chat_request_access
from app.services.voice.protocol import VoiceError
from app.services.time_utils import utc_now_naive


@dataclass(frozen=True)
class VoiceActor:
    user_id: int
    conversation_id: int | None
    project_id: int | None = None


def parse_native_sse(frame: str) -> list[dict]:
    """Parse data frames, never eval provider or tool content."""
    events = []
    for block in frame.split("\n\n"):
        data = "\n".join(line[5:].lstrip() for line in block.splitlines() if line.startswith("data:"))
        if not data or data == "[DONE]":
            continue
        event = json.loads(data)
        if isinstance(event, dict) and isinstance(event.get("type"), str):
            events.append(event)
    return events


class NativeVoiceAgent:
    def __init__(self, bind, token: str | None, *, token_max_age_seconds: int):
        self.bind = bind
        self._token = token
        self._token_max_age_seconds = token_max_age_seconds
        self._owner_id: int | None = None

    def _authorize_in_session(self, session: Session, conversation_id: int | None):
        try:
            # HTTP middleware does not cover WebSockets. Always invoke real auth.
            user = get_current_user(x_auth_token=self._token, session=session)
            native_token = session.exec(select(UserToken).where(UserToken.token == self._token)).first()
            if native_token is not None:
                expires = native_token.created_at + timedelta(seconds=self._token_max_age_seconds)
                if expires <= utc_now_naive():
                    raise VoiceError("session_expired", retryable=False, fatal=True)
            # Legacy tokens have no issuance time. Revalidate their native active
            # user/token mapping, with the independently bounded socket lifetime.
            if self._owner_id is not None and user.id != self._owner_id:
                raise VoiceError("permission_denied", retryable=False, fatal=True)
            conversation = require_chat_request_access(
                session, conversation_id=conversation_id, project_id=None,
                current_user=user, require_write=True,
            ) if conversation_id is not None else None
            self._owner_id = int(user.id)
            return user, VoiceActor(int(user.id), conversation_id,
                                    conversation.project_id if conversation else None)
        except HTTPException as exc:
            code = "session_expired" if exc.status_code == 401 else "permission_denied"
            raise VoiceError(code, retryable=False, fatal=True) from None

    async def authorize(self, conversation_id: int | None) -> VoiceActor:
        def check():
            with Session(self.bind) as session:
                return self._authorize_in_session(session, conversation_id)[1]
        return await asyncio.to_thread(check)

    async def events(self, conversation_id: int, text: str, locale: str) -> AsyncIterator[dict]:
        from app.routers.chat_schemas import SendMessageRequest
        from app.services.chat import prepare_chat_runtime_async, stream_chat_events

        # Use a fresh session per final turn. No client owner, recovery, tools or
        # approval inputs are accepted by this transport.
        with Session(self.bind) as session:
            user, actor = self._authorize_in_session(session, conversation_id)
            request = SendMessageRequest(
                conversation_id=conversation_id, project_id=actor.project_id,
                content=text, language=locale,
            )
            try:
                runtime = await prepare_chat_runtime_async(session, request, owner_user_id=user.id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # Match native /chat/send's durable failure transcript instead
                # of leaving a user-only message when context preparation fails.
                # The transport never exposes the underlying exception.
                from app.routers.chat import _persist_prepare_error_turn
                try:
                    session.rollback()
                    _persist_prepare_error_turn(self.bind, request, exc)
                except Exception:
                    pass
                raise VoiceError("agent_unavailable") from None
            # Preparation can await classification. Recheck token/ACL before
            # starting native execution if membership changed while waiting.
            session.expire_all()
            self._authorize_in_session(session, conversation_id)
        async with aclosing(stream_chat_events(runtime, request, self.bind)) as stream:
            async for frame in stream:
                for event in parse_native_sse(frame):
                    yield event

    async def cancel(self, run_id: str, conversation_id: int) -> dict:
        from app.routers.chat import cancel_chat_run
        from app.services.agent_harness.durable_run_inputs import resolve_active_durable_run

        with Session(self.bind) as session:
            user, _ = self._authorize_in_session(session, conversation_id)
            # An approved user cannot use a response ID to cancel another room.
            try:
                run = resolve_active_durable_run(session, run_id=run_id)
                if int(run.conversation_id) != conversation_id:
                    raise VoiceError("permission_denied", retryable=False, fatal=True)
                return await cancel_chat_run(run_id=run_id, session=session, current_user=user)
            except HTTPException as exc:
                if exc.status_code in (404, 409):
                    return {"status": "already_terminal"}
                raise VoiceError("permission_denied" if exc.status_code in (401, 403)
                                 else "agent_unavailable", retryable=False,
                                 fatal=exc.status_code in (401, 403)) from None
