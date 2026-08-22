"""Safe, provider-neutral retry decisions for one Aria model turn.

The bounded retry state, semantic retry classification, server-provided delay
handling, and retry telemetry fields are adapted from OpenAI Codex's
``codex-rs/core/src/responses_retry.rs``,
``codex-rs/protocol/src/error.rs``, and
``codex-rs/codex-api/src/sse/responses.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: translated to Python, made independent of
Codex protocols and transports, given deterministic backoff, and made strictly
side-effect-aware. Aria retries only before its Agent Loop has received any
model event; text, reasoning, or a tool plan permanently closes the automatic
retry window for that model turn. This module makes no model or Codex calls.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from enum import Enum
from typing import Any, Mapping


DEFAULT_MAX_ATTEMPTS = 2
DEFAULT_BASE_DELAY_MS = 500
DEFAULT_MAX_DELAY_MS = 5_000
HARD_MAX_ATTEMPTS = 3

_RETRYABLE_HTTP_STATUSES = frozenset({408, 409, 425, 429, 500, 502, 503, 504, 529})
_NON_RETRYABLE_HTTP_STATUSES = frozenset({400, 401, 402, 403, 404, 405, 413, 422})
_QUOTA_MARKERS = (
    "insufficient_quota",
    "quota exceeded",
    "quota_exceeded",
    "billing hard limit",
    "billing limit",
    "billing_not_active",
    "credit balance",
    "credits exhausted",
    "spend limit",
    "usage limit reached",
    "payment required",
    "账户余额不足",
    "余额不足",
    "额度已用完",
)
_INVALID_REQUEST_MARKERS = (
    "context_length_exceeded",
    "context window exceeded",
    "maximum context length",
    "invalid api key",
    "invalid_api_key",
    "authentication_error",
    "permission_denied",
    "content policy",
)
_RATE_LIMIT_MARKERS = (
    "rate limit",
    "rate_limit_exceeded",
    "too many requests",
)
_TRANSIENT_MARKERS = (
    "timed out",
    "timeout",
    "connection reset",
    "connection refused",
    "connection aborted",
    "connection closed",
    "server disconnected",
    "remote protocol error",
    "temporarily unavailable",
    "service unavailable",
    "engine_overloaded",
    "server_is_overloaded",
    "overloaded_error",
    "internal server error",
    "network error",
)
_HTTP_STATUS_RE = re.compile(r"(?:http(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*(\d{3})", re.I)
_MESSAGE_RETRY_AFTER_RE = re.compile(
    r"(?:try|retry)\s+again\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds?|s|seconds?)\b",
    re.I,
)


class TurnRetryCategory(str, Enum):
    """Stable categories suitable for traces and aggregate metrics."""

    TRANSIENT = "transient"
    RATE_LIMIT = "rate_limit"
    NON_RETRYABLE = "non_retryable"
    UNKNOWN = "unknown"


class ModelProviderHTTPError(RuntimeError):
    """Provider-neutral HTTP failure retaining status and retry headers.

    Provider adapters raise this instead of sleeping and replaying an SSE
    request internally. The Agent Loop can then make one consistent decision
    while it still knows whether any output has been committed.
    """

    def __init__(
        self,
        provider: str,
        status_code: int,
        *,
        body: str = "",
        headers: Mapping[str, Any] | None = None,
    ) -> None:
        self.provider = str(provider or "model")
        self.status_code = int(status_code)
        self.headers = {str(key): str(value) for key, value in (headers or {}).items()}
        self.body = str(body or "")[:500]
        detail = f": {self.body}" if self.body else ""
        super().__init__(f"{self.provider} HTTP {self.status_code}{detail}")


@dataclass(frozen=True)
class TurnRetryDecision:
    retryable: bool
    category: TurnRetryCategory
    reason: str
    attempt: int
    max_attempts: int
    delay_ms: int = 0
    status_code: int | None = None
    retry_after_ms: int | None = None
    response_committed: bool = False

    def to_trace_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["category"] = self.category.value
        return payload


def normalize_max_attempts(value: Any) -> int:
    """Clamp configuration to one initial request plus at most two retries."""

    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_MAX_ATTEMPTS
    return max(1, min(HARD_MAX_ATTEMPTS, parsed))


def deterministic_backoff_ms(
    attempt: int,
    *,
    base_delay_ms: int = DEFAULT_BASE_DELAY_MS,
    max_delay_ms: int = DEFAULT_MAX_DELAY_MS,
) -> int:
    """Return bounded exponential delay for a failed 1-based attempt."""

    attempt = max(1, int(attempt or 1))
    base = max(0, int(base_delay_ms or 0))
    cap = max(0, int(max_delay_ms or 0))
    return min(cap, base * (2 ** (attempt - 1)))


def _lookup_header(headers: Any, name: str) -> str:
    if not headers:
        return ""
    try:
        items = headers.items()
    except AttributeError:
        return ""
    lowered = name.lower()
    for key, value in items:
        if str(key).lower() == lowered:
            return str(value).strip()
    return ""


def parse_retry_after_ms(
    value: str | None,
    *,
    now: datetime | None = None,
) -> int | None:
    """Parse ``Retry-After`` seconds or an RFC 7231 HTTP date."""

    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        seconds = float(raw)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(raw)
        except (TypeError, ValueError, OverflowError):
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        reference = now or datetime.now(timezone.utc)
        if reference.tzinfo is None:
            reference = reference.replace(tzinfo=timezone.utc)
        seconds = max(0.0, (parsed - reference).total_seconds())
    if seconds < 0:
        return None
    return max(0, round(seconds * 1_000))


def _exception_headers(exc: Exception) -> Any:
    response = getattr(exc, "response", None)
    return getattr(response, "headers", None) or getattr(exc, "headers", None)


def _exception_status_code(exc: Exception, message: str) -> int | None:
    response = getattr(exc, "response", None)
    candidates = (
        getattr(exc, "status_code", None),
        getattr(response, "status_code", None),
        getattr(exc, "status", None),
    )
    for candidate in candidates:
        try:
            if candidate is not None:
                return int(candidate)
        except (TypeError, ValueError):
            continue
    matched = _HTTP_STATUS_RE.search(message)
    return int(matched.group(1)) if matched else None


def _message_retry_after_ms(message: str) -> int | None:
    matched = _MESSAGE_RETRY_AFTER_RE.search(message)
    if not matched:
        return None
    value = float(matched.group(1))
    unit = matched.group(2).lower()
    return round(value if unit.startswith("ms") or unit.startswith("millisecond") else value * 1_000)


def _is_transport_exception(exc: Exception) -> bool:
    for error_type in type(exc).__mro__:
        name = error_type.__name__.lower()
        if any(marker in name for marker in ("timeout", "connect", "network", "protocol", "transport")):
            return True
    return False


def decide_turn_retry(
    exc: Exception,
    *,
    attempt: int,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    response_committed: bool = False,
    base_delay_ms: int = DEFAULT_BASE_DELAY_MS,
    max_delay_ms: int = DEFAULT_MAX_DELAY_MS,
) -> TurnRetryDecision:
    """Classify one failed model attempt without exposing raw error content."""

    normalized_attempts = normalize_max_attempts(max_attempts)
    attempt = max(1, int(attempt or 1))
    message = str(exc or "").lower()
    status_code = _exception_status_code(exc, message)
    retry_after_ms = parse_retry_after_ms(_lookup_header(_exception_headers(exc), "retry-after"))
    if retry_after_ms is None:
        retry_after_ms = _message_retry_after_ms(message)

    if response_committed:
        return TurnRetryDecision(
            retryable=False,
            category=TurnRetryCategory.NON_RETRYABLE,
            reason="response_committed",
            attempt=attempt,
            max_attempts=normalized_attempts,
            status_code=status_code,
            retry_after_ms=retry_after_ms,
            response_committed=True,
        )

    if any(marker in message for marker in _QUOTA_MARKERS):
        category = TurnRetryCategory.NON_RETRYABLE
        reason = "quota_or_billing"
        retry_candidate = False
    elif any(marker in message for marker in _INVALID_REQUEST_MARKERS):
        category = TurnRetryCategory.NON_RETRYABLE
        reason = "invalid_request"
        retry_candidate = False
    elif status_code in _NON_RETRYABLE_HTTP_STATUSES:
        category = TurnRetryCategory.NON_RETRYABLE
        reason = "non_retryable_http_status"
        retry_candidate = False
    elif status_code == 429:
        category = TurnRetryCategory.RATE_LIMIT
        reason = "temporary_rate_limit"
        retry_candidate = True
    elif any(marker in message for marker in _RATE_LIMIT_MARKERS):
        category = TurnRetryCategory.RATE_LIMIT
        reason = "temporary_rate_limit"
        retry_candidate = True
    elif status_code in _RETRYABLE_HTTP_STATUSES:
        category = TurnRetryCategory.TRANSIENT
        reason = "transient_http_status"
        retry_candidate = True
    elif _is_transport_exception(exc) or any(marker in message for marker in _TRANSIENT_MARKERS):
        category = TurnRetryCategory.TRANSIENT
        reason = "transient_transport"
        retry_candidate = True
    else:
        category = TurnRetryCategory.UNKNOWN
        reason = "unclassified_error"
        retry_candidate = False

    if not retry_candidate:
        return TurnRetryDecision(
            retryable=False,
            category=category,
            reason=reason,
            attempt=attempt,
            max_attempts=normalized_attempts,
            status_code=status_code,
            retry_after_ms=retry_after_ms,
        )

    if attempt >= normalized_attempts:
        return TurnRetryDecision(
            retryable=False,
            category=category,
            reason="attempts_exhausted",
            attempt=attempt,
            max_attempts=normalized_attempts,
            status_code=status_code,
            retry_after_ms=retry_after_ms,
        )

    bounded_max_delay = max(0, int(max_delay_ms or 0))
    if retry_after_ms is not None and retry_after_ms > bounded_max_delay:
        return TurnRetryDecision(
            retryable=False,
            category=category,
            reason="retry_after_exceeds_budget",
            attempt=attempt,
            max_attempts=normalized_attempts,
            status_code=status_code,
            retry_after_ms=retry_after_ms,
        )

    delay_ms = (
        retry_after_ms
        if retry_after_ms is not None
        else deterministic_backoff_ms(
            attempt,
            base_delay_ms=base_delay_ms,
            max_delay_ms=bounded_max_delay,
        )
    )
    return TurnRetryDecision(
        retryable=True,
        category=category,
        reason=reason,
        attempt=attempt,
        max_attempts=normalized_attempts,
        delay_ms=delay_ms,
        status_code=status_code,
        retry_after_ms=retry_after_ms,
    )
