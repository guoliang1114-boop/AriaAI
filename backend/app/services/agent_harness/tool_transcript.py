"""Provider-neutral tool transcript normalization for AriaAI.

Call/output pairing, orphan-output removal, and deterministic synthetic output
insertion are Python adaptations of OpenAI Codex:

* ``codex-rs/core/src/context_manager/normalize.rs``
* ``codex-rs/core/src/context_manager/history.rs``

Upstream baseline: commit ``343074d4207d572809bd8cea15f4be1d09d98e0b``
(Apache License 2.0).

Modified for AriaAI on 2026-08-23: translated from response items to Aria's
provider-neutral Anthropic-shaped messages, added deterministic missing-ID
repair, fail-closed duplicate-call filtering before execution, structured
diagnostics, and immutable input handling. Synthetic results say only that an
outcome is unavailable; they never claim that a business action succeeded or
retry it. This module does not import, start, or communicate with Codex.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import asdict, dataclass
from typing import Any, Sequence

_CALL_ID_PREFIX = "aria_call_"
_FINGERPRINT_DOMAIN = "aria-tool-transcript-v1"


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def _fingerprint(value: Any) -> str:
    payload = f"{_FINGERPRINT_DOMAIN}\n{_canonical_json(value)}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _stable_call_id(
    block: dict[str, Any],
    *,
    namespace: str,
    ordinal: int,
    nonce: int = 0,
) -> str:
    identity = {
        "namespace": namespace,
        "ordinal": ordinal,
        "nonce": nonce,
        "name": str(block.get("name") or ""),
        "input": block.get("input") if isinstance(block.get("input"), dict) else {},
    }
    digest = hashlib.sha256(_canonical_json(identity).encode("utf-8")).hexdigest()
    return f"{_CALL_ID_PREFIX}{digest[:24]}"


def _unique_stable_call_id(
    block: dict[str, Any],
    *,
    namespace: str,
    ordinal: int,
    used_ids: set[str],
) -> str:
    nonce = 0
    while True:
        candidate = _stable_call_id(
            block,
            namespace=namespace,
            ordinal=ordinal,
            nonce=nonce,
        )
        if candidate not in used_ids:
            return candidate
        nonce += 1


@dataclass(frozen=True)
class ToolTranscriptIssue:
    code: str
    message_index: int
    call_id: str = ""
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ToolTranscriptNormalization:
    messages: list[dict[str, Any]]
    issues: tuple[ToolTranscriptIssue, ...]
    source_fingerprint: str
    normalized_fingerprint: str
    synthetic_result_count: int
    removed_orphan_count: int
    rewritten_call_id_count: int

    @property
    def changed(self) -> bool:
        return self.source_fingerprint != self.normalized_fingerprint

    def metrics(self) -> dict[str, Any]:
        return {
            "changed": self.changed,
            "issue_count": len(self.issues),
            "synthetic_result_count": self.synthetic_result_count,
            "removed_orphan_count": self.removed_orphan_count,
            "rewritten_call_id_count": self.rewritten_call_id_count,
            "source_fingerprint": self.source_fingerprint,
            "normalized_fingerprint": self.normalized_fingerprint,
            "issue_codes": [issue.code for issue in self.issues],
        }


@dataclass(frozen=True)
class PlannedToolCallNormalization:
    tool_calls: list[dict[str, Any]]
    issues: tuple[ToolTranscriptIssue, ...]
    source_fingerprint: str
    normalized_fingerprint: str
    removed_duplicate_count: int
    assigned_call_id_count: int

    @property
    def changed(self) -> bool:
        return self.source_fingerprint != self.normalized_fingerprint

    def metrics(self) -> dict[str, Any]:
        return {
            "changed": self.changed,
            "issue_count": len(self.issues),
            "removed_duplicate_count": self.removed_duplicate_count,
            "assigned_call_id_count": self.assigned_call_id_count,
            "source_fingerprint": self.source_fingerprint,
            "normalized_fingerprint": self.normalized_fingerprint,
            "issue_codes": [issue.code for issue in self.issues],
        }


def _synthetic_aborted_result(call_id: str) -> dict[str, Any]:
    payload = {
        "ok": False,
        "success": False,
        "status": "aborted",
        "synthetic": True,
        "execution_outcome_unknown": True,
        "retryable": False,
        "error": (
            "Tool execution was interrupted or its output is unavailable. "
            "Do not assume success or retry automatically."
        ),
    }
    return {
        "type": "tool_result",
        "tool_use_id": call_id,
        "content": _canonical_json(payload),
    }


def normalize_planned_tool_calls(
    tool_calls: Sequence[dict[str, Any]],
    *,
    step_index: int,
) -> PlannedToolCallNormalization:
    """Assign missing call IDs and drop duplicate IDs before tool execution.

    A duplicate ID is ambiguous at the provider protocol boundary. Executing
    both copies can repeat a consequential business action, so Aria keeps only
    the first occurrence and records the rejected duplicate in diagnostics.
    """

    source = deepcopy(list(tool_calls))
    normalized: list[dict[str, Any]] = []
    issues: list[ToolTranscriptIssue] = []
    used_ids: set[str] = set()
    removed_duplicates = 0
    assigned_ids = 0

    for ordinal, raw_block in enumerate(source):
        if not isinstance(raw_block, dict):
            issues.append(
                ToolTranscriptIssue(
                    code="malformed_tool_call_removed",
                    message_index=step_index,
                    detail=f"ordinal={ordinal}",
                )
            )
            continue

        block = deepcopy(raw_block)
        raw_id = block.get("id")
        call_id = str(raw_id).strip() if raw_id is not None else ""
        if not call_id:
            call_id = _unique_stable_call_id(
                block,
                namespace=f"planned-step-{step_index}",
                ordinal=ordinal,
                used_ids=used_ids,
            )
            block["id"] = call_id
            assigned_ids += 1
            issues.append(
                ToolTranscriptIssue(
                    code="missing_call_id_assigned",
                    message_index=step_index,
                    call_id=call_id,
                    detail=f"ordinal={ordinal}",
                )
            )
        elif call_id in used_ids:
            removed_duplicates += 1
            issues.append(
                ToolTranscriptIssue(
                    code="duplicate_tool_call_removed",
                    message_index=step_index,
                    call_id=call_id,
                    detail=f"ordinal={ordinal}",
                )
            )
            continue
        elif raw_id != call_id:
            block["id"] = call_id
            issues.append(
                ToolTranscriptIssue(
                    code="call_id_canonicalized",
                    message_index=step_index,
                    call_id=call_id,
                    detail=f"ordinal={ordinal}",
                )
            )

        used_ids.add(call_id)
        normalized.append(block)

    return PlannedToolCallNormalization(
        tool_calls=normalized,
        issues=tuple(issues),
        source_fingerprint=_fingerprint(source),
        normalized_fingerprint=_fingerprint(normalized),
        removed_duplicate_count=removed_duplicates,
        assigned_call_id_count=assigned_ids,
    )


def _tool_use_blocks(message: dict[str, Any]) -> list[tuple[int, dict[str, Any]]]:
    if str(message.get("role") or "") != "assistant":
        return []
    content = message.get("content")
    if not isinstance(content, list):
        return []
    return [
        (index, block)
        for index, block in enumerate(content)
        if isinstance(block, dict) and block.get("type") == "tool_use"
    ]


def _has_tool_results(message: Any) -> bool:
    if not isinstance(message, dict) or str(message.get("role") or "") != "user":
        return False
    content = message.get("content")
    return isinstance(content, list) and any(
        isinstance(block, dict) and block.get("type") == "tool_result"
        for block in content
    )


def normalize_tool_transcript(
    messages: Sequence[dict[str, Any]],
) -> ToolTranscriptNormalization:
    """Return an immutable-input, provider-neutral, well-paired transcript.

    Each assistant tool-use batch is paired only with the immediately following
    Aria user/tool-result message. Results elsewhere are orphans and are
    removed. Missing outputs are inserted immediately after their call batch,
    preserving ordinary text messages and the call order expected by providers.
    """

    source = deepcopy(list(messages))
    normalized: list[dict[str, Any]] = []
    issues: list[ToolTranscriptIssue] = []
    used_call_ids: set[str] = set()
    synthetic_results = 0
    removed_orphans = 0
    rewritten_ids = 0
    index = 0

    while index < len(source):
        raw_message = source[index]
        if not isinstance(raw_message, dict):
            normalized.append(deepcopy(raw_message))
            index += 1
            continue

        calls = _tool_use_blocks(raw_message)
        if calls:
            assistant_message = deepcopy(raw_message)
            content = assistant_message.get("content")
            assert isinstance(content, list)
            call_entries: list[tuple[str, str]] = []

            for block_index, _ in calls:
                block = deepcopy(content[block_index])
                raw_id = block.get("id")
                original_id = str(raw_id).strip() if raw_id is not None else ""
                call_id = original_id
                issue_code = ""
                if not call_id:
                    issue_code = "missing_call_id_assigned"
                elif call_id in used_call_ids:
                    issue_code = "duplicate_call_id_rewritten"

                if issue_code:
                    call_id = _unique_stable_call_id(
                        block,
                        namespace=f"history-message-{index}",
                        ordinal=block_index,
                        used_ids=used_call_ids,
                    )
                    block["id"] = call_id
                    rewritten_ids += 1
                    issues.append(
                        ToolTranscriptIssue(
                            code=issue_code,
                            message_index=index,
                            call_id=call_id,
                            detail=f"block_index={block_index}",
                        )
                    )
                elif raw_id != call_id:
                    block["id"] = call_id
                    rewritten_ids += 1
                    issues.append(
                        ToolTranscriptIssue(
                            code="call_id_canonicalized",
                            message_index=index,
                            call_id=call_id,
                            detail=f"block_index={block_index}",
                        )
                    )

                used_call_ids.add(call_id)
                call_entries.append((call_id, original_id))
                content[block_index] = block

            normalized.append(assistant_message)

            result_message: dict[str, Any] | None = None
            result_blocks: list[dict[str, Any]] = []
            other_blocks: list[Any] = []
            consumed_result_message = index + 1 < len(source) and _has_tool_results(source[index + 1])
            if consumed_result_message:
                result_message = deepcopy(source[index + 1])
                result_content = result_message.get("content")
                assert isinstance(result_content, list)
                saw_non_result = False
                moved_results_before_text = False
                for block in result_content:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        moved_results_before_text = moved_results_before_text or saw_non_result
                        result_blocks.append(deepcopy(block))
                    else:
                        saw_non_result = True
                        other_blocks.append(deepcopy(block))
                if moved_results_before_text:
                    issues.append(
                        ToolTranscriptIssue(
                            code="tool_result_blocks_moved_before_text",
                            message_index=index + 1,
                        )
                    )

            matched: dict[int, dict[str, Any]] = {}
            matched_order: list[int] = []
            for result_block in result_blocks:
                raw_result_id = result_block.get("tool_use_id")
                result_id = str(raw_result_id).strip() if raw_result_id is not None else ""
                match_index: int | None = None

                if result_id:
                    for candidate_index, (call_id, _) in enumerate(call_entries):
                        if candidate_index not in matched and call_id == result_id:
                            match_index = candidate_index
                            break
                    if match_index is None:
                        for candidate_index, (_, original_id) in enumerate(call_entries):
                            if (
                                candidate_index not in matched
                                and original_id
                                and original_id == result_id
                            ):
                                match_index = candidate_index
                                break
                else:
                    match_index = next(
                        (candidate for candidate in range(len(call_entries)) if candidate not in matched),
                        None,
                    )

                if match_index is None:
                    removed_orphans += 1
                    issue_code = (
                        "duplicate_tool_result_removed"
                        if result_id and any(call_id == result_id for call_id, _ in call_entries)
                        else "orphan_tool_result_removed"
                    )
                    issues.append(
                        ToolTranscriptIssue(
                            code=issue_code,
                            message_index=index + 1,
                            call_id=result_id,
                        )
                    )
                    continue

                call_id = call_entries[match_index][0]
                if raw_result_id != call_id:
                    result_block["tool_use_id"] = call_id
                    issues.append(
                        ToolTranscriptIssue(
                            code="tool_result_id_rewritten",
                            message_index=index + 1,
                            call_id=call_id,
                        )
                    )
                matched[match_index] = result_block
                matched_order.append(match_index)

            if matched_order != sorted(matched_order):
                issues.append(
                    ToolTranscriptIssue(
                        code="tool_results_reordered",
                        message_index=index + 1,
                    )
                )

            ordered_results: list[dict[str, Any]] = []
            for call_index, (call_id, _) in enumerate(call_entries):
                result_block = matched.get(call_index)
                if result_block is None:
                    result_block = _synthetic_aborted_result(call_id)
                    synthetic_results += 1
                    issues.append(
                        ToolTranscriptIssue(
                            code="missing_tool_result_inserted",
                            message_index=index,
                            call_id=call_id,
                        )
                    )
                ordered_results.append(result_block)

            if result_message is None:
                result_message = {"role": "user", "content": ordered_results}
            else:
                result_message["content"] = [*ordered_results, *other_blocks]
            normalized.append(result_message)
            index += 2 if consumed_result_message else 1
            continue

        if _has_tool_results(raw_message):
            message = deepcopy(raw_message)
            content = message.get("content")
            assert isinstance(content, list)
            retained: list[Any] = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    removed_orphans += 1
                    issues.append(
                        ToolTranscriptIssue(
                            code="orphan_tool_result_removed",
                            message_index=index,
                            call_id=str(block.get("tool_use_id") or ""),
                        )
                    )
                else:
                    retained.append(deepcopy(block))
            if retained:
                message["content"] = retained
                normalized.append(message)
            index += 1
            continue

        normalized.append(deepcopy(raw_message))
        index += 1

    source_fingerprint = _fingerprint(source)
    normalized_fingerprint = _fingerprint(normalized)
    return ToolTranscriptNormalization(
        messages=normalized,
        issues=tuple(issues),
        source_fingerprint=source_fingerprint,
        normalized_fingerprint=normalized_fingerprint,
        synthetic_result_count=synthetic_results,
        removed_orphan_count=removed_orphans,
        rewritten_call_id_count=rewritten_ids,
    )
