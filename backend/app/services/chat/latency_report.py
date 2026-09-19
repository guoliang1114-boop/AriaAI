"""Bounded, content-free latency percentiles from Aria's native run ledger."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta
import json
import math
import re

from sqlmodel import Session, select

from app.models.db import ChatRun, ChatTrace
from app.services.time_utils import utc_now_naive

TIMING_KEYS = ("provider_headers_ms", "provider_reasoning_ms", "provider_text_ms", "provider_tool_ms",
               "model_first_event_ms", "bounded_answer_ready_ms", "total_stream_ms")


def _duration(value):
    return float(value) if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 86_400_000 else None


def _percentiles(values: list[float]) -> dict:
    values = sorted(values)
    def percentile(fraction):
        return round(values[max(0, math.ceil(fraction * len(values)) - 1)], 2) if values else None
    return {"sample_count": len(values), "p50_ms": percentile(0.5), "p95_ms": percentile(0.95)}


def build_latency_report(session: Session, *, days: int = 7, limit: int = 5000) -> dict:
    days, limit = max(1, min(days, 90)), max(1, min(limit, 10000))
    since = utc_now_naive() - timedelta(days=days)
    rows = session.exec(select(ChatRun.model, ChatRun.status, ChatRun.duration_ms,
                               ChatRun.conversation_id, ChatRun.assistant_message_id)
                        .where(ChatRun.started_at >= since)
                        .order_by(ChatRun.started_at.desc(), ChatRun.id.desc()).limit(limit + 1)).all()
    truncated = len(rows) > limit
    rows = rows[:limit]
    message_ids = sorted({row[4] for row in rows if row[4] is not None})
    traces = {}
    for offset in range(0, len(message_ids), 500):
        for conversation_id, message_id, timings in session.exec(select(
            ChatTrace.conversation_id, ChatTrace.message_id, ChatTrace.stage_timings_json
        ).where(ChatTrace.message_id.in_(message_ids[offset:offset + 500])).order_by(ChatTrace.id.desc())):
            key = (conversation_id, message_id)
            if key not in traces:
                try:
                    data = json.loads(timings or "{}")
                except (ValueError, TypeError):
                    data = {}
                traces[key] = data if isinstance(data, dict) else {}
    groups = defaultdict(list)
    outcomes = Counter()
    allowed_statuses = {"completed", "failed", "cancelled", "interrupted", "running", "pending",
                        "paused", "reserved", "waiting_confirmation"}
    for model, status, duration, conversation_id, message_id in rows:
        model = model if re.fullmatch(r"[A-Za-z0-9_./:-]{1,100}", model or "") else "unknown"
        status = status if status in allowed_statuses else "unknown"
        outcomes[status] += 1
        groups[(model, status)].append((duration, traces.get((conversation_id, message_id), {})))
    summaries = []
    for (model, status), samples in sorted(groups.items()):
        metrics = {key: _percentiles([valid for _, trace in samples if (valid := _duration(trace.get(key))) is not None])
                   for key in TIMING_KEYS}
        metrics["run_duration_ms"] = _percentiles([valid for value, _ in samples if (valid := _duration(value)) is not None])
        summaries.append({"model": model, "status": status, "run_count": len(samples), "metrics": metrics})
    return {"schema_version": 1, "content_included": False, "days": days, "sample_limit": limit,
            "run_count": len(rows), "truncated": truncated, "percentile_method": "nearest_rank",
            "outcomes": dict(outcomes), "groups": summaries}
