"""Content-free interaction feedback and aggregate quality metrics."""
from __future__ import annotations

import json
from typing import Any, Iterable

from app.services.time_utils import utc_now_naive

FEEDBACK_SCHEMA_VERSION = 1
FEEDBACK_REASONS = {
    "inaccurate",
    "missing_context",
    "wrong_skill",
    "wrong_action",
    "unclear",
    "incomplete",
}


def build_message_feedback(rating: str, reasons: Iterable[str] = ()) -> dict[str, Any]:
    normalized_rating = str(rating or "").strip().lower()
    if normalized_rating not in {"helpful", "unhelpful"}:
        raise ValueError("feedback rating must be helpful or unhelpful")
    normalized_reasons: list[str] = []
    for reason in reasons:
        value = str(reason or "").strip().lower()
        if value in FEEDBACK_REASONS and value not in normalized_reasons:
            normalized_reasons.append(value)
        if len(normalized_reasons) >= 3:
            break
    if normalized_rating == "helpful":
        normalized_reasons = []
    return {
        "schema_version": FEEDBACK_SCHEMA_VERSION,
        "rating": normalized_rating,
        "reasons": normalized_reasons,
        "updated_at": utc_now_naive().isoformat(),
    }


def parse_message_metadata(value: str | dict[str, Any] | None) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    try:
        parsed = json.loads(value or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def aggregate_interaction_metrics(messages: Iterable[Any]) -> dict[str, Any]:
    """Aggregate categorical signals only; message content is never inspected."""

    assistant_turns = 0
    feedback_count = 0
    helpful_count = 0
    revision_feedback_count = 0
    revision_helpful_count = 0
    setup_requested = 0
    setup_applied = 0
    setup_dismissed = 0
    negative_reasons = {reason: 0 for reason in sorted(FEEDBACK_REASONS)}

    for message in messages:
        role = str(getattr(message, "role", "") or "")
        metadata = parse_message_metadata(getattr(message, "metadata_json", "{}"))
        if role == "assistant":
            assistant_turns += 1
            feedback = metadata.get("interaction_feedback")
            if not isinstance(feedback, dict) or feedback.get("schema_version") != FEEDBACK_SCHEMA_VERSION:
                continue
            rating = str(feedback.get("rating") or "")
            if rating not in {"helpful", "unhelpful"}:
                continue
            feedback_count += 1
            helpful = rating == "helpful"
            helpful_count += int(helpful)
            if isinstance(metadata.get("turn_revision"), dict):
                revision_feedback_count += 1
                revision_helpful_count += int(helpful)
            if not helpful:
                for reason in list(feedback.get("reasons") or [])[:3]:
                    if reason in negative_reasons:
                        negative_reasons[reason] += 1
        elif role == "user":
            trace = metadata.get("turn_setup_trace")
            if not isinstance(trace, dict) or trace.get("schema_version") != 1:
                continue
            setup_requested += 1
            outcome = str(trace.get("outcome") or "")
            setup_applied += int(outcome == "applied")
            setup_dismissed += int(outcome == "dismissed")

    def ratio(numerator: int, denominator: int) -> float | None:
        return round(numerator / denominator, 4) if denominator else None

    return {
        "schema_version": 1,
        "assistant_turn_count": assistant_turns,
        "feedback_count": feedback_count,
        "feedback_coverage": ratio(feedback_count, assistant_turns),
        "helpful_count": helpful_count,
        "helpful_rate": ratio(helpful_count, feedback_count),
        "revision_feedback_count": revision_feedback_count,
        "revision_success_rate": ratio(revision_helpful_count, revision_feedback_count),
        "turn_setup": {
            "requested_count": setup_requested,
            "applied_count": setup_applied,
            "dismissed_count": setup_dismissed,
            "adoption_rate": ratio(setup_applied, setup_requested),
        },
        "negative_reasons": negative_reasons,
        "privacy": {
            "stores_message_content": False,
            "stores_free_text_feedback": False,
            "stores_user_identity": False,
        },
    }


def aggregate_skill_run_metrics(
    runs: Iterable[Any],
    messages: Iterable[Any],
) -> dict[str, Any]:
    """Join content-free Run snapshots to categorical Assistant feedback.

    The implementation intentionally never reads ``Message.content``. Historical
    Runs created before version snapshots are grouped under an empty version so
    current metadata is never misrepresented as the version used in the past.
    """

    feedback_by_message_id: dict[int, tuple[str, tuple[str, ...], bool]] = {}
    for message in messages:
        if str(getattr(message, "role", "") or "") != "assistant":
            continue
        message_id = getattr(message, "id", None)
        if not isinstance(message_id, int):
            continue
        metadata = parse_message_metadata(getattr(message, "metadata_json", "{}"))
        feedback = metadata.get("interaction_feedback")
        if not isinstance(feedback, dict) or feedback.get("schema_version") != FEEDBACK_SCHEMA_VERSION:
            continue
        rating = str(feedback.get("rating") or "")
        if rating not in {"helpful", "unhelpful"}:
            continue
        reasons = tuple(
            reason
            for reason in list(feedback.get("reasons") or [])[:3]
            if reason in FEEDBACK_REASONS
        )
        feedback_by_message_id[message_id] = (
            rating,
            reasons,
            isinstance(metadata.get("turn_revision"), dict),
        )

    groups: dict[tuple[int, str, str, str], dict[str, Any]] = {}
    for run in runs:
        skill_id = int(getattr(run, "skill_id", 0) or 0)
        skill_name = str(getattr(run, "skill_name", "") or "").strip()
        if not skill_id and not skill_name:
            continue
        version = str(getattr(run, "skill_version", "") or "").strip()
        release_sha256 = str(getattr(run, "skill_release_sha256", "") or "").strip().lower()
        if len(release_sha256) != 64 or any(char not in "0123456789abcdef" for char in release_sha256):
            release_sha256 = ""
        key = (skill_id, skill_name, version, release_sha256)
        group = groups.setdefault(
            key,
            {
                "skill_id": skill_id or None,
                "skill_name": skill_name,
                "version": version or None,
                "release_status": str(getattr(run, "skill_release_status", "") or "").strip() or None,
                "release_sha256": release_sha256 or None,
                "run_count": 0,
                "completed_count": 0,
                "failed_count": 0,
                "cancelled_count": 0,
                "waiting_confirmation_count": 0,
                "feedback_count": 0,
                "helpful_count": 0,
                "wrong_skill_count": 0,
                "revision_feedback_count": 0,
                "revision_helpful_count": 0,
                "duration_ms_total": 0,
                "activation_sources": {"explicit": 0, "auto": 0, "conversation": 0, "other": 0},
            },
        )
        group["run_count"] += 1
        status = str(getattr(run, "status", "") or "")
        status_key = {
            "completed": "completed_count",
            "failed": "failed_count",
            "cancelled": "cancelled_count",
            "waiting_confirmation": "waiting_confirmation_count",
        }.get(status)
        if status_key:
            group[status_key] += 1
        group["duration_ms_total"] += max(0, int(getattr(run, "duration_ms", 0) or 0))
        source = str(getattr(run, "skill_activation_source", "") or "")
        source_key = source if source in {"explicit", "auto", "conversation"} else "other"
        group["activation_sources"][source_key] += 1

        assistant_message_id = getattr(run, "assistant_message_id", None)
        feedback = feedback_by_message_id.get(assistant_message_id)
        if feedback is None:
            continue
        rating, reasons, is_revision = feedback
        helpful = rating == "helpful"
        group["feedback_count"] += 1
        group["helpful_count"] += int(helpful)
        group["wrong_skill_count"] += int("wrong_skill" in reasons)
        if is_revision:
            group["revision_feedback_count"] += 1
            group["revision_helpful_count"] += int(helpful)

    def ratio(numerator: int, denominator: int) -> float | None:
        return round(numerator / denominator, 4) if denominator else None

    items: list[dict[str, Any]] = []
    for group in groups.values():
        run_count = group.pop("run_count")
        feedback_count = group["feedback_count"]
        revision_count = group["revision_feedback_count"]
        duration_total = group.pop("duration_ms_total")
        revision_helpful = group.pop("revision_helpful_count")
        items.append(
            {
                **group,
                "run_count": run_count,
                "completion_rate": ratio(group["completed_count"], run_count),
                "feedback_coverage": ratio(feedback_count, run_count),
                "helpful_rate": ratio(group["helpful_count"], feedback_count),
                "revision_success_rate": ratio(revision_helpful, revision_count),
                "average_duration_ms": round(duration_total / run_count) if run_count else 0,
            }
        )
    items.sort(
        key=lambda item: (
            -int(item["run_count"]),
            str(item["skill_name"]).casefold(),
            str(item["version"] or ""),
        )
    )
    total_runs = sum(int(item["run_count"]) for item in items)
    return {
        "schema_version": 1,
        "run_count": total_runs,
        "versioned_run_count": sum(
            int(item["run_count"]) for item in items if item["version"] is not None
        ),
        "items": items,
        "privacy": {
            "reads_message_content": False,
            "stores_free_text_feedback": False,
            "stores_user_identity": False,
        },
    }
