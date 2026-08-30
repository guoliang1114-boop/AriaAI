"""Content-free project index for durably interrupted chat runs.

The recovery center is deliberately a projection, not a second recovery
protocol.  It helps a project member find terminal Runs and their durable
mailbox evidence; the existing recovery-preview endpoint remains the sole
authority for creating a continuation contract.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

from app.models.db import ChatRun, ChatRunInput, Conversation, Message


RECOVERY_SOURCE_STATUSES = ("cancelled", "failed", "interrupted")
RECOVERY_CENTER_SCHEMA_VERSION = 1


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _reason(run: ChatRun) -> dict[str, str]:
    error_code = str(run.error_code or "").strip().upper()
    if error_code.startswith("CHAT_RUN_WORKER_LEASE_"):
        category = "worker_lost"
    elif "TIMEOUT" in error_code or "DEADLINE" in error_code:
        category = "timeout"
    elif any(token in error_code for token in ("PROVIDER", "MODEL", "UPSTREAM", "RATE_LIMIT")):
        category = "provider_failure"
    elif str(run.status or "") == "cancelled" and not error_code:
        category = "user_cancelled"
    elif str(run.status or "") == "interrupted" and not error_code:
        category = "worker_interrupted"
    else:
        category = "runtime_failure"
    return {
        "category": category,
        "code": error_code or f"CHAT_RUN_{str(run.status or 'failed').upper()}",
    }


def _valid_projection(run: ChatRun, message: Message | None) -> bool:
    if (
        message is None
        or message.role != "assistant"
        or message.conversation_id != run.conversation_id
        or message.id != run.assistant_message_id
    ):
        return False
    rollout = message.get_metadata().get("run_rollout")
    return isinstance(rollout, dict) and str(rollout.get("run_id") or "") == run.run_id


def build_project_recovery_center(
    session: Session,
    *,
    project_id: int,
    limit: int = 50,
) -> dict[str, Any]:
    """Return recent terminal Run recovery evidence without message content."""

    safe_limit = max(1, min(int(limit), 100))
    rows = session.exec(
        select(ChatRun, Conversation)
        .join(Conversation, Conversation.id == ChatRun.conversation_id)
        .where(
            ChatRun.project_id == project_id,
            Conversation.project_id == project_id,
            ChatRun.status.in_(RECOVERY_SOURCE_STATUSES),
        )
        .order_by(ChatRun.updated_at.desc(), ChatRun.id.desc())
        .limit(safe_limit + 1)
    ).all()
    truncated = len(rows) > safe_limit
    rows = rows[:safe_limit]
    runs = [row[0] for row in rows]
    conversations = {int(row[1].id or 0): row[1] for row in rows}
    run_ids = [run.run_id for run in runs]
    run_db_ids = [int(run.id or 0) for run in runs if run.id is not None]
    assistant_ids = [
        int(run.assistant_message_id)
        for run in runs
        if run.assistant_message_id is not None
    ]

    messages = {
        int(message.id or 0): message
        for message in (
            session.exec(select(Message).where(Message.id.in_(assistant_ids))).all()
            if assistant_ids
            else []
        )
    }
    child_rows = (
        session.exec(
            select(ChatRun)
            .where(ChatRun.parent_run_id.in_(run_ids))
            .order_by(ChatRun.updated_at.desc(), ChatRun.id.desc())
        ).all()
        if run_ids
        else []
    )
    latest_child_by_parent: dict[str, ChatRun] = {}
    for child in child_rows:
        parent_run_id = str(child.parent_run_id or "")
        if parent_run_id and parent_run_id not in latest_child_by_parent:
            latest_child_by_parent[parent_run_id] = child

    input_rows = (
        session.exec(
            select(ChatRunInput)
            .where(
                ChatRunInput.chat_run_id.in_(run_db_ids),
                ChatRunInput.kind == "steering",
                ChatRunInput.status.in_(("accepted", "unapplied", "applied")),
            )
            .order_by(ChatRunInput.sequence, ChatRunInput.id)
        ).all()
        if run_db_ids
        else []
    )
    inputs_by_run: dict[int, list[ChatRunInput]] = defaultdict(list)
    for item in input_rows:
        inputs_by_run[int(item.chat_run_id)].append(item)

    items: list[dict[str, Any]] = []
    for run in runs:
        message = messages.get(int(run.assistant_message_id or 0))
        projection_available = _valid_projection(run, message)
        child = latest_child_by_parent.get(run.run_id)
        if child is not None:
            recovery_state = "continued"
        elif projection_available:
            recovery_state = "ready"
        else:
            recovery_state = "projection_missing"

        run_inputs = inputs_by_run.get(int(run.id or 0), [])
        unapplied = [item for item in run_inputs if item.status in {"accepted", "unapplied"}]
        applied = [item for item in run_inputs if item.status == "applied"]
        conversation = conversations.get(run.conversation_id)
        items.append(
            {
                "run_id": run.run_id,
                "conversation_id": run.conversation_id,
                "conversation_title": str(conversation.title if conversation else "")[:200],
                "source_message_id": run.source_message_id,
                "assistant_message_id": run.assistant_message_id,
                "source_status": run.status,
                "phase": run.phase,
                "reason": _reason(run),
                "retryable": bool(run.retryable),
                "recovery_state": recovery_state,
                "can_review": recovery_state == "ready",
                "projection_available": projection_available,
                "child_run": (
                    {
                        "run_id": child.run_id,
                        "status": child.status,
                        "assistant_message_id": child.assistant_message_id,
                        "updated_at": _iso(child.updated_at),
                    }
                    if child is not None
                    else None
                ),
                "unapplied_input_count": len(unapplied),
                "unapplied_input_message_ids": [
                    int(item.message_id)
                    for item in unapplied
                    if item.message_id is not None
                ],
                "applied_input_count": len(applied),
                "started_at": _iso(run.started_at),
                "completed_at": _iso(run.completed_at),
                "updated_at": _iso(run.updated_at),
            }
        )

    ready_items = [item for item in items if item["recovery_state"] == "ready"]
    missing_items = [item for item in items if item["recovery_state"] == "projection_missing"]
    continued_items = [item for item in items if item["recovery_state"] == "continued"]
    attention_items = ready_items + missing_items
    return {
        "schema_version": RECOVERY_CENTER_SCHEMA_VERSION,
        "project_id": project_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "returned_count": len(items),
            "ready_count": len(ready_items),
            "continued_count": len(continued_items),
            "projection_missing_count": len(missing_items),
            "attention_count": len(attention_items),
            "unapplied_input_count": sum(item["unapplied_input_count"] for item in attention_items),
            "oldest_attention_at": min(
                (str(item["updated_at"]) for item in attention_items if item["updated_at"]),
                default=None,
            ),
            "truncated": truncated,
        },
        "items": items,
        "privacy": {
            "includes_message_content": False,
            "includes_prompt_content": False,
            "includes_worker_lease_token": False,
        },
    }
