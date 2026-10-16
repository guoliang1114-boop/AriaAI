from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
import sqlite3
import threading
from types import SimpleNamespace

import pytest
from sqlalchemy import event
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine, select

from app.models.db import Setting
from app.services.voice import limits
from app.services.voice.limits import VoiceUsageLedger, VoiceUsageReservation
from app.services.voice.protocol import VoiceError


def config(**overrides):
    values = dict(
        max_session_seconds=300,
        max_text_characters=12000,
        daily_audio_seconds=1800,
        daily_tts_characters=60000,
        max_concurrent_sessions=1,
        lease_cleanup_seconds=30,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.fixture
def engine():
    # Only the existing Setting table, entirely in memory. No application
    # singleton, startup hooks, database service, or provider is imported.
    bind = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Setting.__table__.create(bind)
    yield bind
    bind.dispose()


@pytest.fixture
def clock(monkeypatch):
    state = {"now": datetime(2026, 10, 16, 12, tzinfo=timezone.utc)}
    monkeypatch.setattr(limits, "_utc_now", lambda: state["now"])
    return state


def records(engine):
    with Session(engine) as session:
        return {row.key: json.loads(row.value) for row in session.exec(select(Setting)).all()}


def daily(engine, user_id=1, day="2026-10-16"):
    return records(engine)[f"voice.usage.v1:day:{user_id}:{day}"]


def active(engine, user_id=1):
    return records(engine)[f"voice.usage.v1:user:{user_id}"]["active"]


def assert_limited(error):
    assert isinstance(error, VoiceError)
    assert error.code == "rate_limited"
    assert error.retryable is True


def assert_unavailable(error):
    assert isinstance(error, VoiceError)
    assert error.code == "network_unavailable"
    assert error.fatal is True
    assert str(error) == "network_unavailable"


@pytest.mark.asyncio
async def test_reserves_worst_case_before_return_and_refunds_actual_usage(engine, clock):
    ledger = VoiceUsageLedger(engine, config())
    reservation = await ledger.acquire(1, "session-a")

    assert isinstance(reservation, VoiceUsageReservation)
    assert reservation.max_session_seconds == 300
    assert reservation.max_text_characters == 12000
    assert reservation.expires_at == clock["now"].timestamp() + 330
    assert daily(engine) == {"version": 1, "audio_seconds": 300.0, "tts_characters": 12000}
    assert len(active(engine)) == 1

    await reservation.close(audio_seconds=1.25, tts_characters=7)

    assert daily(engine) == {"version": 1, "audio_seconds": 1.25, "tts_characters": 7}
    assert active(engine) == {}
    # A different worker and connection can immediately use the refunded quota.
    await VoiceUsageLedger(engine, config()).acquire(1, "session-b")
    assert daily(engine)["audio_seconds"] == 301.25


@pytest.mark.asyncio
@pytest.mark.parametrize("overrides", [
    {"daily_audio_seconds": 299}, {"daily_tts_characters": 11999},
    {"daily_audio_seconds": 0}, {"daily_tts_characters": 0},
])
async def test_daily_allowance_must_cover_entire_reservation(engine, clock, overrides):
    with pytest.raises(VoiceError) as exc:
        await VoiceUsageLedger(engine, config(**overrides)).acquire(1, "session-a")
    assert_limited(exc.value)
    assert not any(":day:" in key or ":session:" in key for key in records(engine))


@pytest.mark.asyncio
async def test_concurrent_acquisitions_from_independent_workers_have_one_winner(engine, clock):
    workers = [VoiceUsageLedger(engine, config()) for _ in range(12)]
    results = await asyncio.gather(
        *(worker.acquire(1, f"session-{index}") for index, worker in enumerate(workers)),
        return_exceptions=True,
    )
    assert sum(isinstance(result, VoiceUsageReservation) for result in results) == 1
    for result in results:
        if isinstance(result, Exception):
            assert_limited(result)
    assert daily(engine)["audio_seconds"] == 300
    assert daily(engine)["tts_characters"] == 12000
    assert len(active(engine)) == 1


@pytest.mark.asyncio
async def test_same_active_id_is_durably_idempotent_across_workers(engine, clock):
    results = await asyncio.gather(*(
        VoiceUsageLedger(engine, config()).acquire(1, "same-session") for _ in range(10)
    ))
    assert all(isinstance(result, VoiceUsageReservation) for result in results)
    assert daily(engine)["audio_seconds"] == 300
    assert len(active(engine)) == 1
    assert len([key for key in records(engine) if ":session:" in key]) == 1

    await asyncio.gather(*(result.close(10, 50) for result in results))
    assert daily(engine)["audio_seconds"] == 10
    assert daily(engine)["tts_characters"] == 50
    assert active(engine) == {}


@pytest.mark.asyncio
async def test_closed_id_cannot_restart_provider_work_or_refund_twice(engine, clock):
    first = await VoiceUsageLedger(engine, config()).acquire(1, "same-session")
    duplicate = await VoiceUsageLedger(engine, config()).acquire(1, "same-session")
    await first.close(30, 100)
    await duplicate.close(0, 0)
    assert daily(engine)["audio_seconds"] == 30
    assert daily(engine)["tts_characters"] == 100
    with pytest.raises(VoiceError) as exc:
        await VoiceUsageLedger(engine, config()).acquire(1, "same-session")
    assert_limited(exc.value)


@pytest.mark.asyncio
async def test_parallel_closes_preserve_other_reservations_and_actual_usage(engine, clock):
    first = await VoiceUsageLedger(engine, config(max_concurrent_sessions=2)).acquire(1, "first")
    second = await VoiceUsageLedger(engine, config(max_concurrent_sessions=2)).acquire(1, "second")
    await asyncio.gather(first.close(30, 100), first.close(30, 100), second.close(50, 20))
    assert daily(engine)["audio_seconds"] == 80
    assert daily(engine)["tts_characters"] == 120
    assert active(engine) == {}


@pytest.mark.asyncio
async def test_daily_caps_apply_even_when_concurrency_allows_more(engine, clock):
    ledger = VoiceUsageLedger(engine, config(max_concurrent_sessions=3, daily_audio_seconds=600))
    await ledger.acquire(1, "one")
    await ledger.acquire(1, "two")
    with pytest.raises(VoiceError) as exc:
        await ledger.acquire(1, "three")
    assert_limited(exc.value)
    assert daily(engine)["audio_seconds"] == 600


@pytest.mark.asyncio
async def test_tts_daily_cap_independent_of_audio_cap(engine, clock):
    ledger = VoiceUsageLedger(engine, config(max_concurrent_sessions=3, daily_tts_characters=12000))
    await ledger.acquire(1, "one")
    with pytest.raises(VoiceError) as exc:
        await ledger.acquire(1, "two")
    assert_limited(exc.value)
    assert daily(engine)["tts_characters"] == 12000


@pytest.mark.asyncio
async def test_users_have_independent_counters_and_leases(engine, clock):
    ledger = VoiceUsageLedger(engine, config())
    first, _ = await asyncio.gather(ledger.acquire(1, "same-id"), ledger.acquire(2, "same-id"))
    await first.close(20, 10)
    assert daily(engine, 1)["audio_seconds"] == 20
    assert daily(engine, 2)["audio_seconds"] == 300
    assert len(active(engine, 2)) == 1


@pytest.mark.asyncio
async def test_crashed_lease_expires_but_worst_case_usage_remains_charged(engine, clock):
    ledger = VoiceUsageLedger(engine, config())
    old = await ledger.acquire(1, "crashed-session")
    clock["now"] += timedelta(seconds=329)
    with pytest.raises(VoiceError) as exc:
        await ledger.acquire(1, "new-session")
    assert_limited(exc.value)

    clock["now"] += timedelta(seconds=1)
    await VoiceUsageLedger(engine, config()).acquire(1, "new-session")
    assert daily(engine)["audio_seconds"] == 600
    assert daily(engine)["tts_characters"] == 24000
    assert len(active(engine)) == 1
    assert old.expires_at not in active(engine).values()
    with pytest.raises(VoiceError) as exc:
        await ledger.acquire(1, "crashed-session")
    assert_limited(exc.value)
    assert daily(engine)["audio_seconds"] == 600


@pytest.mark.asyncio
async def test_expired_active_lease_is_removed_even_when_daily_quota_is_exhausted(engine, clock):
    ledger = VoiceUsageLedger(engine, config(daily_audio_seconds=300))
    await ledger.acquire(1, "crashed-session")
    clock["now"] += timedelta(seconds=331)
    with pytest.raises(VoiceError) as exc:
        await ledger.acquire(1, "new-session")
    assert_limited(exc.value)
    assert active(engine) == {}
    assert daily(engine)["audio_seconds"] == 300


@pytest.mark.asyncio
async def test_midnight_resets_daily_budget_without_resetting_active_concurrency(engine, clock):
    clock["now"] = datetime(2026, 10, 16, 23, 59, 50, tzinfo=timezone.utc)
    old = await VoiceUsageLedger(engine, config()).acquire(1, "old-day")
    clock["now"] += timedelta(seconds=20)
    with pytest.raises(VoiceError) as exc:
        await VoiceUsageLedger(engine, config()).acquire(1, "new-day")
    assert_limited(exc.value)

    await old.close(20, 100)
    await VoiceUsageLedger(engine, config()).acquire(1, "new-day")
    assert daily(engine, day="2026-10-16")["audio_seconds"] == 20
    assert daily(engine, day="2026-10-16")["tts_characters"] == 100
    assert daily(engine, day="2026-10-17")["audio_seconds"] == 300
    assert daily(engine, day="2026-10-17")["tts_characters"] == 12000


@pytest.mark.asyncio
async def test_actual_overrun_is_charged_in_full(engine, clock):
    reservation = await VoiceUsageLedger(engine, config()).acquire(1, "overrun")
    await reservation.close(305.25, 12001)
    assert daily(engine)["audio_seconds"] == 305.25
    assert daily(engine)["tts_characters"] == 12001


@pytest.mark.asyncio
@pytest.mark.parametrize("audio,tts", [
    (-1, 0), (float("nan"), 0), (float("inf"), 0), (True, 0), ("1", 0),
    (0, -1), (0, 1.5), (0, True), (0, "1"),
])
async def test_invalid_settlement_retains_entire_reservation(engine, clock, audio, tts):
    reservation = await VoiceUsageLedger(engine, config()).acquire(1, "session")
    with pytest.raises(VoiceError) as exc:
        await reservation.close(audio, tts)
    assert_unavailable(exc.value)
    assert daily(engine)["audio_seconds"] == 300
    assert daily(engine)["tts_characters"] == 12000
    assert len(active(engine)) == 1


@pytest.mark.asyncio
async def test_corrupt_daily_record_fails_closed_without_resetting_usage(engine, clock):
    reservation = await VoiceUsageLedger(engine, config()).acquire(1, "session")
    await reservation.close(10, 20)
    with Session(engine) as session:
        row = session.get(Setting, "voice.usage.v1:day:1:2026-10-16")
        row.value = '{"version":1,"audio_seconds":-10,"tts_characters":20}'
        session.add(row)
        session.commit()
    with pytest.raises(VoiceError) as exc:
        await VoiceUsageLedger(engine, config()).acquire(1, "new-session")
    assert_unavailable(exc.value)
    assert daily(engine)["audio_seconds"] == -10
    assert len([key for key in records(engine) if ":session:" in key]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["not-json", "[]", '{"version":2,"active":{}}', '{"version":1,"active":[]}'])
async def test_corrupt_user_record_fails_closed(engine, clock, value):
    with Session(engine) as session:
        session.add(Setting(key="voice.usage.v1:user:1", value=value))
        session.commit()
    with pytest.raises(VoiceError) as exc:
        await VoiceUsageLedger(engine, config()).acquire(1, "session")
    assert_unavailable(exc.value)


@pytest.mark.asyncio
async def test_failed_commit_does_not_return_a_reservation(engine, clock, monkeypatch):
    def fail_commit(self):
        raise OperationalError("private SQL", {}, RuntimeError("private connection string"))

    monkeypatch.setattr(Session, "commit", fail_commit)
    with pytest.raises(VoiceError) as exc:
        await VoiceUsageLedger(engine, config()).acquire(1, "session")
    assert_unavailable(exc.value)
    assert records(engine) == {}


@pytest.mark.asyncio
async def test_failed_settlement_can_be_retried_without_losing_charge(engine, clock, monkeypatch):
    reservation = await VoiceUsageLedger(engine, config()).acquire(1, "session")
    original = Session.commit

    def fail_commit(self):
        raise OperationalError("private SQL", {}, RuntimeError("private connection string"))

    monkeypatch.setattr(Session, "commit", fail_commit)
    with pytest.raises(VoiceError) as exc:
        await reservation.close(10, 20)
    assert_unavailable(exc.value)
    assert daily(engine)["audio_seconds"] == 300
    assert len(active(engine)) == 1
    monkeypatch.setattr(Session, "commit", original)
    await reservation.close(10, 20)
    assert daily(engine)["audio_seconds"] == 10
    assert daily(engine)["tts_characters"] == 20


@pytest.mark.asyncio
async def test_concurrent_initial_row_conflict_retries_fresh_transaction(engine, clock):
    inserts = []

    def conflict_once(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO setting") and parameters[0] == "voice.usage.v1:user:1":
            inserts.append(statement)
            if len(inserts) == 1:
                raise IntegrityError(statement, parameters, sqlite3.IntegrityError("simulated concurrent insert"))

    event.listen(engine, "before_cursor_execute", conflict_once)
    try:
        await VoiceUsageLedger(engine, config()).acquire(1, "session")
    finally:
        event.remove(engine, "before_cursor_execute", conflict_once)
    assert len(inserts) == 2
    assert daily(engine)["audio_seconds"] == 300
    assert len(active(engine)) == 1


@pytest.mark.asyncio
async def test_transaction_uses_row_lock_sqlite_write_lock_and_worker_thread(engine, clock):
    main_thread = threading.get_ident()
    thread_ids = []
    statements = []
    row_locks = []

    def capture_sql(conn, cursor, statement, parameters, context, executemany):
        thread_ids.append(threading.get_ident())
        statements.append(statement)

    def capture_clause(conn, clause, multiparams, params, execution_options):
        if getattr(clause, "_for_update_arg", None) is not None:
            row_locks.append(str(clause.compile(dialect=postgresql.dialect())))

    event.listen(engine, "before_cursor_execute", capture_sql)
    event.listen(engine, "before_execute", capture_clause)
    try:
        reservation = await VoiceUsageLedger(engine, config()).acquire(1, "session")
        await reservation.close(1, 1)
    finally:
        event.remove(engine, "before_cursor_execute", capture_sql)
        event.remove(engine, "before_execute", capture_clause)
    assert thread_ids and main_thread not in thread_ids
    assert statements.count("BEGIN IMMEDIATE") == 2
    assert len(row_locks) == 2
    assert all("FOR UPDATE" in statement for statement in row_locks)


@pytest.mark.asyncio
async def test_no_session_content_is_persisted(engine, clock):
    session_id = "opaque-session-id-never-store-raw"
    await VoiceUsageLedger(engine, config()).acquire(1, session_id)
    assert session_id not in json.dumps(records(engine))


@pytest.mark.parametrize("overrides", [
    {"max_session_seconds": 0}, {"max_session_seconds": float("nan")},
    {"max_text_characters": 0}, {"max_text_characters": 1.5},
    {"daily_audio_seconds": -1}, {"daily_tts_characters": -1},
    {"max_concurrent_sessions": 0}, {"lease_cleanup_seconds": -1},
])
def test_invalid_config_fails_closed_without_database_connection(engine, overrides):
    with pytest.raises(VoiceError) as exc:
        VoiceUsageLedger(engine, config(**overrides))
    assert_unavailable(exc.value)
    assert records(engine) == {}
