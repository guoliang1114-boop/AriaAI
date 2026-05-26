"""Recovery helpers for stale HITAS tool approvals."""
from __future__ import annotations

import json
import logging
from datetime import timedelta

from sqlmodel import Session, select

from app.models.db import Message, PendingToolAction
from app.services.time_utils import utc_now_naive

logger = logging.getLogger(__name__)

STALE_EXECUTING_MINUTES = 30
STALE_EXECUTING_MESSAGE = (
    "Action execution status unknown after server interruption; please verify manually."
)


def reap_stale_executing_actions(
    session: Session,
    *,
    stale_after_minutes: int = STALE_EXECUTING_MINUTES,
) -> int:
    """Mark long-running HITAS actions as failed/unknown without retrying them.

    Destructive actions must never be retried automatically after a crash. If the
    process dies after claim and before result persistence, the only safe server
    recovery is to mark the action as unknown/failed and ask a human to verify.
    """
    cutoff = utc_now_naive() - timedelta(minutes=stale_after_minutes)
    actions = session.exec(
        select(PendingToolAction).where(PendingToolAction.status == "executing")
    ).all()
    reaped = 0
    for action in actions:
        started_at = action.confirmed_at or action.created_at
        if started_at and started_at > cutoff:
            continue
        result = {
            "success": False,
            "error": STALE_EXECUTING_MESSAGE,
            "requires_manual_verification": True,
        }
        action.status = "failed"
        action.error_message = STALE_EXECUTING_MESSAGE
        action.result_json = json.dumps(result, ensure_ascii=False, default=str)
        session.add(
            Message(
                conversation_id=action.conversation_id,
                role="assistant",
                content=f"{action.title or action.tool_name} 执行状态未知：请人工核查后再继续。",
                metadata_json=json.dumps(
                    {
                        "tool_action_result": {
                            "pending_action_id": action.id,
                            "tool_name": action.tool_name,
                            "status": action.status,
                            "result": result,
                        }
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            )
        )
        reaped += 1
    if reaped:
        session.commit()
        logger.warning("Marked %s stale HITAS executing actions as failed/unknown.", reaped)
    return reaped


def reap_stale_executing_actions_with_engine(engine) -> int:
    with Session(engine) as session:
        return reap_stale_executing_actions(session)
