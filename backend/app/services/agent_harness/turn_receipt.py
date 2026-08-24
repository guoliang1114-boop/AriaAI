"""Build Aria's user-visible turn-understanding receipt.

The receipt is derived from Aria's already-resolved ``TurnContract``. It never
serializes the system prompt, internal instruction layers, tool arguments, or
provider state. This makes it a product acknowledgement, not chain-of-thought.
"""
from __future__ import annotations

from typing import Any, Mapping

from app.services.chat.product_run_events import turn_receipt


def build_turn_receipt(
    run_id: str,
    turn_contract: Mapping[str, Any] | None,
    *,
    steering_supported: bool,
) -> dict[str, Any]:
    contract = turn_contract if isinstance(turn_contract, Mapping) else {}
    summary = str(contract.get("user_goal") or "处理本轮请求").strip()[:240]
    return turn_receipt(
        run_id,
        summary=summary or "处理本轮请求",
        mode=str(contract.get("mode") or "answer_only"),
        target_scope=str(contract.get("target_scope") or "chat"),
        execution_scope=str(contract.get("execution_scope") or "chat_only"),
        expected_response=str(contract.get("expected_response") or "direct_answer"),
        write_allowed=bool(contract.get("write_allowed", False)),
        requires_confirmation=bool(contract.get("requires_confirmation", False)),
        steering_supported=steering_supported,
    )
