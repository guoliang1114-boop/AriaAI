"""APScheduler service — manage recurring AI tasks."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

_scheduler = BackgroundScheduler()


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


def next_run_from_frequency(frequency: str, cron_expr: str = "") -> Optional[datetime]:
    now = datetime.utcnow()
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


def trigger_now(task) -> None:
    from app.services.task_runner import run_task
    run_task(task.id)


def _add_job(task) -> None:
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

    _scheduler.add_job(run_task, trigger=trigger, args=[task.id], id=job_id, replace_existing=True)
