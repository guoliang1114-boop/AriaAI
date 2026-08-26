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
