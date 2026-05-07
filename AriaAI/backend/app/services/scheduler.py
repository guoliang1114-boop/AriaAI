"""APScheduler service — manage recurring AI tasks."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.executors.pool import ThreadPoolExecutor
from app.config import MEMORY_REBUILD_MAX_WORKERS
from app.services.time_utils import utc_now_naive

# Use ThreadPoolExecutor to support async functions
_scheduler = BackgroundScheduler(
    executors={'default': ThreadPoolExecutor(max_workers=MEMORY_REBUILD_MAX_WORKERS)},
    timezone=UTC,
)
_job_metadata: dict[str, dict] = {}


def _as_utc_aware(value: datetime) -> datetime:
    """Treat legacy naive datetimes as UTC before handing them to APScheduler."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def start() -> None:
    try:
        if not _scheduler.running:
            _scheduler.start()
    except Exception:
        pass  # Serverless env — scheduler not supported


def shutdown() -> None:
    try:
        if _scheduler.running:
            _scheduler.shutdown(wait=False)
    except Exception:
        pass


def is_running() -> bool:
    return bool(_scheduler.running)


def next_run_from_frequency(frequency: str, cron_expr: str = "") -> Optional[datetime]:
    now = _as_utc_aware(utc_now_naive())
    freq = frequency.lower()
    if freq == "daily":
        return now + timedelta(days=1)
    elif freq == "weekly":
        return now + timedelta(weeks=1)
    elif freq == "monthly":
        return now + timedelta(days=30)
    elif cron_expr:
        try:
            trigger = CronTrigger.from_crontab(cron_expr)
            return trigger.get_next_fire_time(None, now)
        except Exception:
            return None
    return None


def register_task(task) -> None:
    if not task.is_enabled:
        return
    _add_job(task)


def update_task(task) -> None:
    remove_task(task.id)
    if task.is_enabled:
        _add_job(task)


def remove_task(task_id: int) -> None:
    job_id = f"task_{task_id}"
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)


def remove_job(job_id: str) -> None:
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)
    _job_metadata.pop(job_id, None)


def get_job(job_id: str):
    return _scheduler.get_job(job_id)


def get_jobs():
    return list(_scheduler.get_jobs())


def get_job_metadata(job_id: str) -> dict:
    return dict(_job_metadata.get(job_id, {}))


def add_or_replace_date_job(
    job_id: str,
    run_at: datetime,
    func,
    args: Optional[list] = None,
    metadata: Optional[dict] = None,
) -> None:
    if not _scheduler.running:
        return

    args = args or []
    _job_metadata[job_id] = dict(metadata or {})

    def _run_job():
        result = func(*args)
        if asyncio.iscoroutine(result):
            asyncio.run(result)

    _scheduler.add_job(
        _run_job,
        trigger=DateTrigger(run_date=_as_utc_aware(run_at), timezone=UTC),
        id=job_id,
        replace_existing=True,
        misfire_grace_time=3600,
    )


def trigger_now(task) -> None:
    import asyncio
    from app.services.task_runner import run_task
    asyncio.run(run_task(task.id))


def _add_job(task) -> None:
    import asyncio
    from app.services.task_runner import run_task

    job_id = f"task_{task.id}"
    freq = task.frequency.lower()

    if freq == "daily":
        trigger = IntervalTrigger(days=1)
    elif freq == "weekly":
        trigger = IntervalTrigger(weeks=1)
    elif freq == "monthly":
        trigger = IntervalTrigger(days=30)
    elif task.cron_expr:
        try:
            trigger = CronTrigger.from_crontab(task.cron_expr)
        except Exception:
            return
    else:
        return

    # Wrap async function for scheduler
    def _run_async_task(task_id: int):
        asyncio.run(run_task(task_id))

    _scheduler.add_job(_run_async_task, trigger=trigger, args=[task.id], id=job_id, replace_existing=True)
