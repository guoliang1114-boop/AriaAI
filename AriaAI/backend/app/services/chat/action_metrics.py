"""Runtime metrics and alert helpers for HITAS approvals."""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import timedelta
from typing import Any

from sqlmodel import Session, select

from app.models.db import PendingToolAction
from app.services.time_utils import utc_now_naive

logger = logging.getLogger(__name__)

RESOLVED_ACTION_STATUSES = {"completed", "failed", "skipped"}
FAILED_ACTION_STATUSES = {"failed", "skipped"}


def build_hitas_action_metrics(
    session: Session,
    *,
    window_minutes: int = 24 * 60,
    stale_after_minutes: int = 30,
    failure_rate_alert_threshold: float = 0.2,
    min_resolved_for_failure_rate_alert: int = 5,
) -> dict[str, Any]:
    """Return operational HITAS metrics and alert candidates.

    The metrics are intentionally computed from ``PendingToolAction`` so the
    approval table remains the single fact source. This endpoint is not a
    Prometheus exporter yet; it is a compact admin-facing health snapshot that
    can later be scraped or wired to alerting.
    """
    now = utc_now_naive()
    window_start = now - timedelta(minutes=max(1, window_minutes))
    stale_cutoff = now - timedelta(minutes=max(1, stale_after_minutes))
    actions = session.exec(
        select(PendingToolAction).where(PendingToolAction.created_at >= window_start)
    ).all()

    total = len(actions)
    by_status: dict[str, int] = defaultdict(int)
    by_risk_level: dict[str, int] = defaultdict(int)
    for action in actions:
        by_status[action.status or "unknown"] += 1
        by_risk_level[action.risk_level or "unknown"] += 1

    resolved_actions = [action for action in actions if action.status in RESOLVED_ACTION_STATUSES]
    failed_actions = [action for action in resolved_actions if action.status in FAILED_ACTION_STATUSES]
    resolved_count = len(resolved_actions)
    failed_count = len(failed_actions)
    failure_rate = failed_count / resolved_count if resolved_count else 0.0

    stale_actions = [
        action
        for action in actions
        if action.status == "executing" and (action.confirmed_at or action.created_at) <= stale_cutoff
    ]

    batches: dict[str, list[PendingToolAction]] = defaultdict(list)
    for action in actions:
        if action.approval_batch_id:
            batches[action.approval_batch_id].append(action)
    partial_failed_batches = []
    for batch_id, batch_actions in batches.items():
        statuses = {action.status for action in batch_actions}
        has_success = "completed" in statuses
        has_failure = bool(statuses & FAILED_ACTION_STATUSES)
        if has_success and has_failure:
            partial_failed_batches.append(
                {
                    "approval_batch_id": batch_id,
                    "completed_count": sum(1 for action in batch_actions if action.status == "completed"),
                    "failed_count": sum(1 for action in batch_actions if action.status in FAILED_ACTION_STATUSES),
                    "action_ids": [action.id for action in batch_actions if action.id],
                }
            )

    alerts: list[dict[str, Any]] = []
    if resolved_count >= min_resolved_for_failure_rate_alert and failure_rate >= failure_rate_alert_threshold:
        alerts.append(
            {
                "code": "hitas_confirmation_failure_rate_high",
                "severity": "warning",
                "message": f"HITAS failure rate is {failure_rate:.0%} over {resolved_count} resolved actions.",
                "value": failure_rate,
                "threshold": failure_rate_alert_threshold,
            }
        )
    if stale_actions:
        alerts.append(
            {
                "code": "hitas_stale_executing_actions",
                "severity": "critical",
                "message": f"{len(stale_actions)} HITAS actions are stale in executing state.",
                "value": len(stale_actions),
                "action_ids": [action.id for action in stale_actions if action.id],
            }
        )
    if partial_failed_batches:
        alerts.append(
            {
                "code": "hitas_batch_partial_failures",
                "severity": "warning",
                "message": f"{len(partial_failed_batches)} HITAS batches partially failed.",
                "value": len(partial_failed_batches),
                "batches": partial_failed_batches[:20],
            }
        )

    if alerts:
        logger.warning("HITAS metrics emitted %s alert(s): %s", len(alerts), [alert["code"] for alert in alerts])

    return {
        "window_minutes": window_minutes,
        "stale_after_minutes": stale_after_minutes,
        "total_actions": total,
        "resolved_actions": resolved_count,
        "failed_actions": failed_count,
        "confirmation_failure_rate": failure_rate,
        "stale_executing_actions": len(stale_actions),
        "partial_failed_batches": len(partial_failed_batches),
        "by_status": dict(sorted(by_status.items())),
        "by_risk_level": dict(sorted(by_risk_level.items())),
        "alerts": alerts,
    }
