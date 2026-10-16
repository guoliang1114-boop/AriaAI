"""Durable, fail-closed voice quotas using Aria's native Setting store.

Every provider session must acquire a reservation *before* opening a provider
connection. Reservations charge the entire possible session up front; an
unclean exit keeps that charge. A successful close replaces it with measured
usage (or conservative connection duration when audio usage is unavailable).

The per-user row serializes both daily counters and concurrent leases, including
sessions crossing midnight. Session records remain as durable idempotency keys.
No audio, text, credentials, or provider payloads belong in this ledger.
"""

from __future__ import annotations

import asyncio
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
import hashlib
import json
import math
import threading
from typing import Any, Callable, TypeVar
from weakref import WeakKeyDictionary

from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models.db import Setting
from app.services.voice.protocol import VoiceError


_PREFIX = "voice.usage.v1"
_T = TypeVar("_T")
# StaticPool is commonly used for an in-memory SQLite database and shares one
# connection between threads. Serialize it locally as well as taking SQLite's
# database write lock; production PostgreSQL relies on the durable row lock.
_SQLITE_LOCKS: WeakKeyDictionary[Engine, Any] = WeakKeyDictionary()
_SQLITE_LOCKS_GUARD = threading.Lock()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _number(value: Any, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Invalid voice usage number")
    result = float(value)
    if not math.isfinite(result) or result < 0 or (positive and result == 0):
        raise ValueError("Invalid voice usage number")
    return result


def _integer(value: Any, *, positive: bool = False) -> int:
    if type(value) is not int or value < 0 or (positive and value == 0):
        raise ValueError("Invalid voice usage integer")
    return value


def _decode(row: Setting) -> dict[str, Any]:
    data = json.loads(row.value)
    if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != 1:
        raise ValueError("Invalid voice usage record")
    return data


def _save(session: Session, row: Setting, data: dict[str, Any]) -> None:
    row.value = json.dumps(data, separators=(",", ":"), allow_nan=False)
    session.add(row)


def _sqlite_lock(bind: Engine) -> Any:
    with _SQLITE_LOCKS_GUARD:
        lock = _SQLITE_LOCKS.get(bind)
        if lock is None:
            lock = threading.RLock()
            _SQLITE_LOCKS[bind] = lock
        return lock


@dataclass(frozen=True)
class VoiceUsageReservation:
    """A committed reservation; close is idempotent across workers and retries."""

    _ledger: VoiceUsageLedger = field(repr=False)
    user_id: int
    session_id: str
    max_session_seconds: float
    max_text_characters: int
    expires_at: float

    async def close(self, audio_seconds: float, tts_characters: int) -> None:
        """Settle actual usage; callers must count all billable provider input.

        Use conservative connection duration if measured input audio is not
        available. Counts exceeding the reservation are charged in full rather
        than silently capped. Invalid counts retain the original reservation.
        """
        await asyncio.to_thread(
            self._ledger._close_sync, self.user_id, self.session_id,
            audio_seconds, tts_characters,
        )


class VoiceUsageLedger:
    """Cross-worker quota accounting; does not connect until acquire/close.

    ``bind`` is a synchronous SQLAlchemy engine. For in-memory SQLite tests use
    a shared, thread-safe pool and ``check_same_thread=False``. Runtime limits
    come from VoiceConfig; this module has no provider or database singleton.
    """

    def __init__(self, bind: Engine, config: Any) -> None:
        self._bind = bind
        try:
            self._max_audio = _number(config.max_session_seconds, positive=True)
            self._max_tts = _integer(config.max_text_characters, positive=True)
            self._daily_audio = _number(config.daily_audio_seconds)
            self._daily_tts = _integer(config.daily_tts_characters)
            self._concurrent = _integer(config.max_concurrent_sessions, positive=True)
            self._cleanup = _number(getattr(config, "lease_cleanup_seconds", 30))
        except Exception:
            raise VoiceError("network_unavailable", fatal=True) from None

    async def acquire(self, user_id: int, session_id: str) -> VoiceUsageReservation:
        """Reserve worst-case usage before any billable provider operation.

        Session IDs must be server-generated and unique to one connection.
        Retrying an active ID is idempotent; closed or expired IDs cannot be
        reused to start new provider work.
        """
        return await asyncio.to_thread(self._acquire_sync, user_id, session_id)

    @staticmethod
    def _keys(user_id: int, session_id: str) -> tuple[str, str, str]:
        _integer(user_id, positive=True)
        if not isinstance(session_id, str) or not session_id or len(session_id) > 256:
            raise ValueError("Invalid voice session identifier")
        digest = hashlib.sha256(session_id.encode("utf-8")).hexdigest()
        return f"{_PREFIX}:user:{user_id}", f"{_PREFIX}:session:{user_id}:{digest}", digest

    def _transaction(self, user_key: str, operation: Callable[[Session, Setting, dict[str, Any]], _T]) -> _T:
        try:
            sqlite = self._bind.dialect.name == "sqlite"
            lock = _sqlite_lock(self._bind) if sqlite else nullcontext()
            with lock:
                # Concurrent initial acquisitions can both observe no user
                # row. The PK chooses the winner; retry in a fresh transaction
                # so even snapshot-isolated readers see the committed lock row.
                for attempt in range(3):
                    try:
                        with Session(self._bind, expire_on_commit=False) as session:
                            if sqlite:
                                session.connection().exec_driver_sql("BEGIN IMMEDIATE")
                            row = session.exec(
                                select(Setting).where(Setting.key == user_key).with_for_update()
                            ).first()
                            if row is None:
                                row = Setting(key=user_key, value='{"version":1,"active":{}}')
                                session.add(row)
                                session.flush()
                            data = _decode(row)
                            result = operation(session, row, data)
                            session.commit()
                            return result
                    except IntegrityError:
                        if attempt == 2:
                            raise
            raise RuntimeError("Unable to reserve voice usage")
        except VoiceError:
            raise
        except Exception:
            # Do not expose storage exceptions, connection strings, or SQL.
            raise VoiceError("network_unavailable", fatal=True) from None

    @staticmethod
    def _prune_active(data: dict[str, Any], now: float) -> dict[str, float]:
        active = data.get("active")
        if not isinstance(active, dict):
            raise ValueError("Invalid voice leases")
        remaining = {}
        for key, expires_at in active.items():
            if not isinstance(key, str) or len(key) != 64:
                raise ValueError("Invalid voice lease identifier")
            expiry = _number(expires_at, positive=True)
            if expiry > now:
                remaining[key] = expiry
        data["active"] = remaining
        return remaining

    @staticmethod
    def _reservation(data: dict[str, Any]) -> tuple[str, float, int, float, bool]:
        day = data.get("day")
        if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
            raise ValueError("Invalid voice usage date")
        audio = _number(data.get("reserved_audio_seconds"), positive=True)
        tts = _integer(data.get("reserved_tts_characters"), positive=True)
        expires = _number(data.get("expires_at"), positive=True)
        closed = data.get("closed")
        if type(closed) is not bool:
            raise ValueError("Invalid voice reservation state")
        return day, audio, tts, expires, closed

    def _acquire_sync(self, user_id: int, session_id: str) -> VoiceUsageReservation:
        try:
            user_key, reservation_key, digest = self._keys(user_id, session_id)
        except Exception:
            raise VoiceError("network_unavailable", fatal=True) from None

        def acquire(session: Session, user_row: Setting, user: dict[str, Any]) -> VoiceUsageReservation | None:
            now = _utc_now().astimezone(timezone.utc)
            active = self._prune_active(user, now.timestamp())
            existing = session.get(Setting, reservation_key)
            if existing is not None:
                _, audio, tts, expiry, closed = self._reservation(_decode(existing))
                if not closed and expiry > now.timestamp():
                    if active.get(digest) != expiry:
                        raise ValueError("Missing active voice lease")
                    _save(session, user_row, user)
                    return VoiceUsageReservation(self, user_id, session_id, audio, tts, expiry)
                _save(session, user_row, user)
                return None

            day = now.date().isoformat()
            daily_key = f"{_PREFIX}:day:{user_id}:{day}"
            daily_row = session.get(Setting, daily_key)
            usage = _decode(daily_row) if daily_row else {
                "version": 1, "audio_seconds": 0.0, "tts_characters": 0,
            }
            audio = _number(usage.get("audio_seconds"))
            tts = _integer(usage.get("tts_characters"))
            if (len(active) >= self._concurrent
                    or audio + self._max_audio > self._daily_audio
                    or tts + self._max_tts > self._daily_tts):
                # Persist removal of expired leases even if today's allowance
                # is exhausted. The expired reservation stays fully charged.
                _save(session, user_row, user)
                return None

            expiry = now.timestamp() + self._max_audio + self._cleanup
            usage["audio_seconds"] = audio + self._max_audio
            usage["tts_characters"] = tts + self._max_tts
            _save(session, daily_row or Setting(key=daily_key, value=""), usage)
            _save(session, Setting(key=reservation_key, value=""), {
                "version": 1, "day": day, "reserved_audio_seconds": self._max_audio,
                "reserved_tts_characters": self._max_tts, "expires_at": expiry, "closed": False,
            })
            active[digest] = expiry
            _save(session, user_row, user)
            return VoiceUsageReservation(self, user_id, session_id, self._max_audio, self._max_tts, expiry)

        reservation = self._transaction(user_key, acquire)
        if reservation is None:
            raise VoiceError("rate_limited", retryable=True)
        return reservation

    def _close_sync(self, user_id: int, session_id: str, audio_seconds: float, tts_characters: int) -> None:
        try:
            user_key, reservation_key, digest = self._keys(user_id, session_id)
            actual_audio = _number(audio_seconds)
            actual_tts = _integer(tts_characters)
        except Exception:
            raise VoiceError("network_unavailable", fatal=True) from None

        def close(session: Session, user_row: Setting, user: dict[str, Any]) -> None:
            active = self._prune_active(user, _utc_now().timestamp())
            reservation_row = session.get(Setting, reservation_key)
            if reservation_row is None:
                raise ValueError("Missing voice reservation")
            reservation = _decode(reservation_row)
            day, reserved_audio, reserved_tts, _, closed = self._reservation(reservation)
            if not closed:
                daily_row = session.get(Setting, f"{_PREFIX}:day:{user_id}:{day}")
                if daily_row is None:
                    raise ValueError("Missing daily voice usage")
                usage = _decode(daily_row)
                usage["audio_seconds"] = _number(
                    _number(usage.get("audio_seconds")) - reserved_audio + actual_audio
                )
                usage["tts_characters"] = _integer(
                    _integer(usage.get("tts_characters")) - reserved_tts + actual_tts
                )
                _save(session, daily_row, usage)
                reservation.update(closed=True, audio_seconds=actual_audio, tts_characters=actual_tts)
                _save(session, reservation_row, reservation)
            active.pop(digest, None)
            _save(session, user_row, user)

        self._transaction(user_key, close)
