"""Provider-neutral context budgeting for AriaAI agent runs.

Token estimation and UTF-8-safe middle truncation are adapted from OpenAI
Codex's ``codex-rs/utils/string/src/truncate.rs``. The separation between the
full context-window hard cap, output reserve, and compaction threshold is
adapted from ``codex-rs/core/src/session/context_window.rs``. Tool-output-aware
truncation and call/output history invariants are adapted from
``codex-rs/core/src/context_manager/history.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: translated to Python, made provider-neutral,
and extended with deterministic conversation-history excerpts, structured
budget metrics, atomic tool-call/result retention, and structure-preserving
tool payload compaction. This module performs no model or Codex runtime calls.
"""
from __future__ import annotations

import json
import math
import re
from copy import deepcopy
from dataclasses import asdict, dataclass
from typing import Any, Optional

APPROX_BYTES_PER_TOKEN = 4
MESSAGE_OVERHEAD_TOKENS = 4
TOOLS_OVERHEAD_TOKENS = 8
MIN_CONTEXT_WINDOW_TOKENS = 4_096


def approx_token_count(text: str) -> int:
    """Return Codex's conservative byte-based token estimate."""

    byte_count = len((text or "").encode("utf-8"))
    return math.ceil(byte_count / APPROX_BYTES_PER_TOKEN)


def _prefix_end_for_bytes(text: str, byte_budget: int) -> int:
    consumed = 0
    end = 0
    for index, character in enumerate(text):
        size = len(character.encode("utf-8"))
        if consumed + size > byte_budget:
            break
        consumed += size
        end = index + 1
    return end


def _suffix_start_for_bytes(text: str, byte_budget: int, *, floor: int) -> int:
    consumed = 0
    start = len(text)
    for index in range(len(text) - 1, floor - 1, -1):
        size = len(text[index].encode("utf-8"))
        if consumed + size > byte_budget:
            break
        consumed += size
        start = index
    return start


def truncate_middle_with_token_budget(text: str, max_tokens: int) -> tuple[str, Optional[int]]:
    """Preserve a UTF-8-safe prefix and suffix within an approximate budget."""

    text = text or ""
    original_tokens = approx_token_count(text)
    if original_tokens <= max_tokens:
        return text, None
    if max_tokens <= 0:
        return f"…{original_tokens} tokens truncated…", original_tokens

    # Reserve room for the marker itself so callers can use the result as a
    # real budget boundary rather than only a preserved-content boundary.
    marker_reserve = min(max_tokens, 12)
    content_tokens = max(0, max_tokens - marker_reserve)
    byte_budget = content_tokens * APPROX_BYTES_PER_TOKEN
    left_budget = byte_budget // 2
    right_budget = byte_budget - left_budget
    prefix_end = _prefix_end_for_bytes(text, left_budget)
    suffix_start = _suffix_start_for_bytes(text, right_budget, floor=prefix_end)
    removed_tokens = approx_token_count(text[prefix_end:suffix_start])
    marker = f"…{removed_tokens} tokens truncated…"
    result = f"{text[:prefix_end]}{marker}{text[suffix_start:]}"

    # Very small budgets can still be exceeded by a multi-digit marker. Tighten
    # the preserved content until the complete rendered result fits.
    while approx_token_count(result) > max_tokens and content_tokens > 0:
        overflow = approx_token_count(result) - max_tokens
        content_tokens = max(0, content_tokens - max(1, overflow))
        byte_budget = content_tokens * APPROX_BYTES_PER_TOKEN
        left_budget = byte_budget // 2
        right_budget = byte_budget - left_budget
        prefix_end = _prefix_end_for_bytes(text, left_budget)
        suffix_start = _suffix_start_for_bytes(text, right_budget, floor=prefix_end)
        removed_tokens = approx_token_count(text[prefix_end:suffix_start])
        marker = f"…{removed_tokens} tokens truncated…"
        result = f"{text[:prefix_end]}{marker}{text[suffix_start:]}"
    return result, original_tokens


def estimate_message_tokens(message: dict[str, Any]) -> int:
    content = message.get("content", "")
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=False, default=str)
    role = str(message.get("role") or "")
    reasoning = str(message.get("reasoning_content") or "")
    return (
        MESSAGE_OVERHEAD_TOKENS
        + approx_token_count(role)
        + approx_token_count(content)
        + approx_token_count(reasoning)
    )


def estimate_tools_tokens(tools: list[dict] | None) -> int:
    if not tools:
        return 0
    rendered = json.dumps(tools, ensure_ascii=False, sort_keys=True, default=str)
    return TOOLS_OVERHEAD_TOKENS + approx_token_count(rendered)


_MODEL_WINDOW_RE = re.compile(r"(?:^|[-_/])(\d+)([km])(?:$|[-_.])", re.IGNORECASE)


def resolve_model_context_window(model: str, *, default_tokens: int) -> int:
    """Resolve explicit ``8k``/``32k`` model suffixes, otherwise use config."""

    for match in _MODEL_WINDOW_RE.finditer(model or ""):
        amount = int(match.group(1))
        multiplier = 1_000 if match.group(2).lower() == "k" else 1_000_000
        resolved = amount * multiplier
        if resolved >= MIN_CONTEXT_WINDOW_TOKENS:
            return resolved
    return max(MIN_CONTEXT_WINDOW_TOKENS, int(default_tokens))


@dataclass(frozen=True)
class ContextBudgetReport:
    context_window_tokens: int
    safety_margin_tokens: int
    output_reserved_tokens: int
    input_limit_tokens: int
    tool_tokens: int
    system_tokens_before: int
    system_tokens_after: int
    history_tokens_before: int
    history_tokens_after: int
    history_messages_before: int
    history_messages_after: int
    structured_messages_before: int
    structured_messages_after: int
    tool_batches_before: int
    tool_batches_after: int
    summarized_messages: int
    truncated_recent_messages: int
    estimated_total_before: int
    estimated_total_after: int
    compacted: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ContextBudgetResult:
    system: str
    messages: list[dict[str, Any]]
    report: ContextBudgetReport


def _compacted_payload(value: Any, token_budget: int) -> dict[str, Any]:
    rendered = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    original_tokens = approx_token_count(rendered)
    minimal: dict[str, Any] = {
        "_aria_compacted": True,
        "original_tokens": original_tokens,
    }
    if token_budget <= approx_token_count(json.dumps(minimal, separators=(",", ":"))):
        return minimal

    excerpt_budget = max(1, token_budget - approx_token_count(json.dumps(minimal)) - 8)
    excerpt = truncate_middle_with_token_budget(rendered, excerpt_budget)[0]
    payload = {**minimal, "excerpt": excerpt}
    while (
        approx_token_count(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        > token_budget
        and excerpt_budget > 1
    ):
        excerpt_budget = max(1, excerpt_budget - 4)
        payload["excerpt"] = truncate_middle_with_token_budget(rendered, excerpt_budget)[0]
    return payload


def _truncate_reasoning(message: dict[str, Any], token_budget: int) -> None:
    reasoning = message.get("reasoning_content")
    if not isinstance(reasoning, str) or not reasoning:
        return
    reasoning_budget = max(0, token_budget // 5)
    if reasoning_budget <= 0:
        message["reasoning_content"] = ""
        return
    message["reasoning_content"] = truncate_middle_with_token_budget(
        reasoning,
        reasoning_budget,
    )[0]


def _truncate_structured_message(
    message: dict[str, Any],
    token_budget: int,
) -> dict[str, Any]:
    result = deepcopy(message)
    content = result.get("content")
    if not isinstance(content, list):
        return result

    _truncate_reasoning(result, token_budget)
    original_blocks = deepcopy(content)
    scaffold_blocks = deepcopy(content)
    dynamic: list[tuple[int, str]] = []
    for index, block in enumerate(scaffold_blocks):
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type") or "")
        if block_type == "text" and isinstance(block.get("text"), str):
            block["text"] = ""
            dynamic.append((index, "text"))
        elif block_type == "tool_result":
            block["content"] = ""
            dynamic.append((index, "tool_result"))
        elif block_type == "tool_use":
            block["input"] = {}
            dynamic.append((index, "tool_use"))

    scaffold = {**result, "content": scaffold_blocks}
    available = max(0, token_budget - estimate_message_tokens(scaffold))
    per_value_budget = available // max(1, len(dynamic))
    compacted_blocks = deepcopy(scaffold_blocks)

    for block_index, value_type in dynamic:
        original = original_blocks[block_index]
        block = compacted_blocks[block_index]
        assert isinstance(original, dict) and isinstance(block, dict)
        if value_type == "text":
            text = str(original.get("text") or "")
            block["text"] = truncate_middle_with_token_budget(text, per_value_budget)[0]
        elif value_type == "tool_result":
            original_content = original.get("content", "")
            rendered = (
                original_content
                if isinstance(original_content, str)
                else json.dumps(original_content, ensure_ascii=False, default=str)
            )
            if approx_token_count(rendered) <= per_value_budget:
                block["content"] = original_content
            else:
                block["content"] = json.dumps(
                    _compacted_payload(original_content, per_value_budget),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
        elif value_type == "tool_use":
            tool_input = original.get("input") if isinstance(original.get("input"), dict) else {}
            rendered_input = json.dumps(tool_input, ensure_ascii=False, default=str)
            if approx_token_count(rendered_input) <= per_value_budget:
                block["input"] = tool_input
            else:
                block["input"] = _compacted_payload(tool_input, per_value_budget)

    result["content"] = compacted_blocks
    if estimate_message_tokens(result) <= token_budget:
        return result

    # If fixed IDs/names and wrapper overhead consumed more than the allocation,
    # retain protocol structure and collapse only the model-visible payloads.
    minimal_blocks = deepcopy(compacted_blocks)
    for block in minimal_blocks:
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type") or "")
        if block_type == "text":
            block["text"] = ""
        elif block_type == "tool_result":
            block["content"] = '{"_aria_compacted":true}'
        elif block_type == "tool_use":
            block["input"] = {"_aria_compacted": True}
    result["content"] = minimal_blocks
    return result


def _truncate_message(message: dict[str, Any], token_budget: int) -> tuple[dict[str, Any], bool]:
    result = deepcopy(message)
    if estimate_message_tokens(result) <= token_budget:
        return result, False

    content = result.get("content", "")
    if isinstance(content, list):
        structured = _truncate_structured_message(result, token_budget)
        return structured, structured != message

    _truncate_reasoning(result, token_budget)
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=False, default=str)
    role_tokens = approx_token_count(str(result.get("role") or ""))
    reasoning_tokens = approx_token_count(str(result.get("reasoning_content") or ""))
    content_budget = max(
        1,
        token_budget - MESSAGE_OVERHEAD_TOKENS - role_tokens - reasoning_tokens,
    )
    truncated, original_tokens = truncate_middle_with_token_budget(content, content_budget)
    result["content"] = truncated
    return result, original_tokens is not None or result != message


def _fit_recent_messages(
    messages: list[dict[str, Any]],
    token_budget: int,
) -> tuple[list[dict[str, Any]], int]:
    if not messages or token_budget <= 0:
        return [], 0

    weights = [1 << min(index, 3) for index in range(len(messages))]
    total_weight = sum(weights)
    remaining_budget = token_budget
    remaining_weight = total_weight
    fitted: list[dict[str, Any]] = []
    truncated_count = 0

    for index, message in enumerate(messages):
        messages_left = len(messages) - index
        minimum_for_rest = max(0, (messages_left - 1) * (MESSAGE_OVERHEAD_TOKENS + 8))
        weighted_share = max(
            MESSAGE_OVERHEAD_TOKENS + 8,
            (remaining_budget * weights[index]) // max(1, remaining_weight),
        )
        allocation = min(max(1, remaining_budget - minimum_for_rest), weighted_share)
        fitted_message, was_truncated = _truncate_message(message, allocation)
        fitted.append(fitted_message)
        truncated_count += int(was_truncated)
        used = estimate_message_tokens(fitted_message)
        remaining_budget = max(0, remaining_budget - used)
        remaining_weight -= weights[index]

    return fitted, truncated_count


def _has_tool_use(message: dict[str, Any]) -> bool:
    content = message.get("content")
    return (
        str(message.get("role") or "") == "assistant"
        and isinstance(content, list)
        and any(
            isinstance(block, dict) and block.get("type") == "tool_use"
            for block in content
        )
    )


def _has_tool_result(message: dict[str, Any]) -> bool:
    content = message.get("content")
    return (
        str(message.get("role") or "") == "user"
        and isinstance(content, list)
        and any(
            isinstance(block, dict) and block.get("type") == "tool_result"
            for block in content
        )
    )


def _message_units(messages: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group an assistant tool call and its immediate result as one unit."""

    units: list[list[dict[str, Any]]] = []
    index = 0
    while index < len(messages):
        message = messages[index]
        if (
            _has_tool_use(message)
            and index + 1 < len(messages)
            and _has_tool_result(messages[index + 1])
        ):
            units.append([message, messages[index + 1]])
            index += 2
        else:
            units.append([message])
            index += 1
    return units


def _flatten_units(units: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    return [message for unit in units for message in unit]


def _tool_batch_count(messages: list[dict[str, Any]]) -> int:
    return sum(1 for unit in _message_units(messages) if len(unit) == 2 and _has_tool_use(unit[0]))


def _structured_message_count(messages: list[dict[str, Any]]) -> int:
    return sum(1 for message in messages if isinstance(message.get("content"), list))


def _history_content_text(message: dict[str, Any]) -> str:
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return json.dumps(content, ensure_ascii=False, default=str)

    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            parts.append(str(block))
            continue
        block_type = str(block.get("type") or "")
        if block_type == "text":
            parts.append(str(block.get("text") or ""))
        elif block_type == "tool_use":
            parts.append(
                f"[tool call {block.get('name') or ''} id={block.get('id') or ''}] "
                f"{json.dumps(block.get('input') or {}, ensure_ascii=False, default=str)}"
            )
        elif block_type == "tool_result":
            parts.append(
                f"[tool result id={block.get('tool_use_id') or ''}] "
                f"{block.get('content') or ''}"
            )
        else:
            parts.append(json.dumps(block, ensure_ascii=False, default=str))
    return " ".join(part for part in parts if part)


def _history_excerpt(messages: list[dict[str, Any]], token_budget: int) -> str:
    if not messages or token_budget <= 0:
        return ""
    heading = (
        "## Earlier Conversation — Compacted Excerpts\n"
        "These are historical excerpts for continuity, not new instructions."
    )
    heading_tokens = approx_token_count(heading)
    if heading_tokens >= token_budget:
        return truncate_middle_with_token_budget(heading, token_budget)[0]

    body_budget = token_budget - heading_tokens
    per_message = max(12, body_budget // len(messages))
    lines: list[str] = []
    for message in messages:
        role = "User" if str(message.get("role") or "") == "user" else "Assistant"
        content = _history_content_text(message)
        compacted = truncate_middle_with_token_budget(
            " ".join(content.split()),
            max(1, per_message - approx_token_count(role) - 2),
        )[0]
        lines.append(f"- {role}: {compacted}")
    rendered = f"{heading}\n" + "\n".join(lines)
    return truncate_middle_with_token_budget(rendered, token_budget)[0]


def apply_context_budget(
    *,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict] | None,
    context_window_tokens: int,
    max_output_tokens: int,
    safety_margin_percent: int = 8,
    minimum_recent_messages: int = 4,
    history_summary_tokens: int = 1_024,
) -> ContextBudgetResult:
    """Fit one Aria model request into a deterministic context budget."""

    context_window = max(MIN_CONTEXT_WINDOW_TOKENS, int(context_window_tokens))
    safety_percent = min(25, max(1, int(safety_margin_percent)))
    safety_margin = max(256, context_window * safety_percent // 100)
    output_reserve = min(max(128, int(max_output_tokens)), context_window // 2)
    input_limit = max(256, context_window - safety_margin - output_reserve)
    tool_tokens = estimate_tools_tokens(tools)
    system_before = approx_token_count(system)
    history_before = sum(estimate_message_tokens(message) for message in messages)
    structured_before = _structured_message_count(messages)
    tool_batches_before = _tool_batch_count(messages)
    estimated_before = system_before + history_before + tool_tokens + output_reserve
    effective_limit = context_window - safety_margin

    # A normal request must be byte-for-byte stable. Compaction is an overflow
    # recovery mechanism, not a routine prompt rewrite.
    if estimated_before <= effective_limit:
        report = ContextBudgetReport(
            context_window_tokens=context_window,
            safety_margin_tokens=safety_margin,
            output_reserved_tokens=output_reserve,
            input_limit_tokens=input_limit,
            tool_tokens=tool_tokens,
            system_tokens_before=system_before,
            system_tokens_after=system_before,
            history_tokens_before=history_before,
            history_tokens_after=history_before,
            history_messages_before=len(messages),
            history_messages_after=len(messages),
            structured_messages_before=structured_before,
            structured_messages_after=structured_before,
            tool_batches_before=tool_batches_before,
            tool_batches_after=tool_batches_before,
            summarized_messages=0,
            truncated_recent_messages=0,
            estimated_total_before=estimated_before,
            estimated_total_after=estimated_before,
            compacted=False,
        )
        return ContextBudgetResult(
            system=system,
            messages=deepcopy(messages),
            report=report,
        )

    available_without_tools = max(128, input_limit - tool_tokens)
    desired_history_floor = min(2_048, max(256, available_without_tools // 3))
    system_budget = max(128, available_without_tools - desired_history_floor)
    compacted_system, system_original_tokens = truncate_middle_with_token_budget(
        system,
        system_budget,
    )

    system_after_base = approx_token_count(compacted_system)
    message_budget = max(64, available_without_tools - system_after_base)
    history_fits = history_before <= message_budget
    compacted_messages = deepcopy(messages)
    history_excerpt = ""
    summarized_messages = 0
    truncated_recent_messages = 0

    if not history_fits and messages:
        units = _message_units(messages)
        minimum_recent = min(len(messages), max(1, int(minimum_recent_messages)))
        summary_reserve = min(
            max(0, int(history_summary_tokens)),
            max(0, message_budget // 4),
        )
        recent_budget = max(32, message_budget - summary_reserve)
        recent_unit_start = len(units)
        recent_message_count = 0
        while recent_unit_start > 0 and recent_message_count < minimum_recent:
            recent_unit_start -= 1
            recent_message_count += len(units[recent_unit_start])
        recent_source = _flatten_units(units[recent_unit_start:])
        compacted_messages, truncated_recent_messages = _fit_recent_messages(
            recent_source,
            recent_budget,
        )

        used_recent = sum(estimate_message_tokens(message) for message in compacted_messages)
        spare_recent = max(0, recent_budget - used_recent)
        while recent_unit_start > 0:
            candidate_unit = units[recent_unit_start - 1]
            candidate_cost = sum(estimate_message_tokens(message) for message in candidate_unit)
            if candidate_cost > spare_recent:
                break
            compacted_messages[0:0] = deepcopy(candidate_unit)
            recent_unit_start -= 1
            spare_recent -= candidate_cost

        older_messages = _flatten_units(units[:recent_unit_start])
        summarized_messages = len(older_messages)
        excerpt_budget = summary_reserve + spare_recent
        history_excerpt = _history_excerpt(older_messages, excerpt_budget)

    final_system = compacted_system
    if history_excerpt:
        final_system = f"{final_system.rstrip()}\n\n{history_excerpt}\n"

    system_after = approx_token_count(final_system)
    history_after = sum(estimate_message_tokens(message) for message in compacted_messages)
    estimated_after = system_after + history_after + tool_tokens + output_reserve

    # Rounding, structured wrappers, and rendered truncation markers can use a
    # few extra tokens. Walk oldest-to-newest so recent evidence retains the
    # largest share, while never converting tool messages into plain strings.
    if estimated_after > effective_limit and compacted_messages:
        for message_index, message in enumerate(compacted_messages):
            if estimated_after <= effective_limit:
                break
            overflow = estimated_after - effective_limit
            current_cost = estimate_message_tokens(message)
            target = max(MESSAGE_OVERHEAD_TOKENS + 8, current_cost - overflow - 4)
            compacted, was_truncated = _truncate_message(message, target)
            new_cost = estimate_message_tokens(compacted)
            if new_cost >= current_cost:
                continue
            compacted_messages[message_index] = compacted
            truncated_recent_messages += int(was_truncated)
            history_after -= current_cost - new_cost
            estimated_after = system_after + history_after + tool_tokens + output_reserve

    if estimated_after > effective_limit:
        overflow = estimated_after - effective_limit
        tightened_system_budget = max(32, system_after - overflow - 4)
        tightened_system, tightened_original = truncate_middle_with_token_budget(
            final_system,
            tightened_system_budget,
        )
        if tightened_original is not None:
            final_system = tightened_system
            system_after = approx_token_count(final_system)
        history_after = sum(estimate_message_tokens(message) for message in compacted_messages)
        estimated_after = system_after + history_after + tool_tokens + output_reserve

    compacted = bool(
        system_original_tokens is not None
        or summarized_messages
        or truncated_recent_messages
    )
    report = ContextBudgetReport(
        context_window_tokens=context_window,
        safety_margin_tokens=safety_margin,
        output_reserved_tokens=output_reserve,
        input_limit_tokens=input_limit,
        tool_tokens=tool_tokens,
        system_tokens_before=system_before,
        system_tokens_after=system_after,
        history_tokens_before=history_before,
        history_tokens_after=history_after,
        history_messages_before=len(messages),
        history_messages_after=len(compacted_messages),
        structured_messages_before=structured_before,
        structured_messages_after=_structured_message_count(compacted_messages),
        tool_batches_before=tool_batches_before,
        tool_batches_after=_tool_batch_count(compacted_messages),
        summarized_messages=summarized_messages,
        truncated_recent_messages=truncated_recent_messages,
        estimated_total_before=estimated_before,
        estimated_total_after=estimated_after,
        compacted=compacted,
    )
    return ContextBudgetResult(
        system=final_system,
        messages=compacted_messages,
        report=report,
    )
