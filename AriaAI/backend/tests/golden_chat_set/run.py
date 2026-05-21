from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

from app.routers.chat_schemas import SendMessageRequest
from app.services.intent_router import classify_chat_intent
from app.services.policy_guards import policy_allows_tool


def _load_cases() -> list[dict]:
    path = Path(__file__).with_name("router_cases.yaml")
    return yaml.safe_load(path.read_text(encoding="utf-8"))["cases"]


def _tool_check_parts(tool_check) -> tuple[str, dict]:
    if isinstance(tool_check, dict):
        return tool_check["name"], tool_check.get("input", {"mode": "create", "content": "# Test"})
    return str(tool_check), {"mode": "create", "content": "# Test"}


def _case_failures(case: dict) -> list[str]:
    req = SendMessageRequest(
        content=case["content"],
        project_id=case.get("project_id"),
        skill_id=case.get("skill_id"),
        force_skill=case.get("force_skill", False),
    )
    decision = classify_chat_intent(
        req,
        effective_skill_id=case.get("skill_id") if case.get("force_skill") else None,
    )

    failures: list[str] = []
    if decision.chat_mode.value != case["expected_chat_mode"]:
        failures.append(f"chat_mode expected={case['expected_chat_mode']} actual={decision.chat_mode.value}")
    if decision.action_policy.value != case["expected_action_policy"]:
        failures.append(
            f"action_policy expected={case['expected_action_policy']} actual={decision.action_policy.value}"
        )

    for tool_check in case.get("forbid_tools") or []:
        tool_name, tool_input = _tool_check_parts(tool_check)
        allowed, _, _ = policy_allows_tool(decision.action_policy, tool_name, tool_input)
        if allowed:
            failures.append(f"unexpectedly allowed {tool_name}")

    for tool_check in case.get("allow_tools") or []:
        tool_name, tool_input = _tool_check_parts(tool_check)
        allowed, _, _ = policy_allows_tool(decision.action_policy, tool_name, tool_input)
        if not allowed:
            failures.append(f"unexpectedly blocked {tool_name}")

    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run chat router golden set cases.")
    parser.add_argument("--fail-under", type=float, default=1.0, help="Minimum pass ratio required, from 0.0 to 1.0.")
    args = parser.parse_args(argv)

    cases = _load_cases()
    failed: list[tuple[str, list[str]]] = []
    for case in cases:
        failures = _case_failures(case)
        if failures:
            failed.append((case["id"], failures))

    passed = len(cases) - len(failed)
    ratio = passed / len(cases) if cases else 0.0
    print(f"Golden chat set: {passed}/{len(cases)} passed ({ratio:.1%})")
    for case_id, failures in failed:
        print(f"- {case_id}: {'; '.join(failures)}")

    if ratio < args.fail_under:
        print(f"Pass ratio {ratio:.1%} is below --fail-under {args.fail_under:.1%}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
