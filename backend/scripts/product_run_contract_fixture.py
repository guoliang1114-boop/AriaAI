"""Generate deterministic wire examples from Aria's actual event builders.

Run with --write when deliberately updating the v1 contract. The backend checks
freshness; the frontend checks types, runtime acceptance, and lifecycle folding.
All values are synthetic. No database or model calls are made.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.chat import product_run_events as events

FIXTURE_PATH = BACKEND_ROOT / "tests/fixtures/product_run_events_v1.json"
TIMESTAMP = "2026-09-20T00:00:00.000+00:00"


def _constants(cls):
    return sorted(value for name, value in vars(cls).items() if name.isupper())


def build_contract_fixture() -> dict:
    verification = {
        "schema_version": 1, "verification_id": 91, "verifier_version": 1,
        "status": "manual_required", "technical_status": "passed", "skill_status": "manual_required",
        "content_sha256": "a" * 64, "evidence_sha256": "b" * 64,
        "automated_check_count": 5, "automated_passed_count": 5,
        "automated_failed_count": 0, "automated_skipped_count": 0, "skill_check_count": 2,
        "metrics": {"slide_count": 12}, "verification_plan_sha256": "c" * 64,
        "skill_release_sha256": "d" * 64,
    }
    deliverable = {
        "schema_version": 1, "deliverable_id": "board-deck", "name": "合成董事会汇报",
        "formats": ["pptx"], "default_format": "pptx", "stage": "proposal",
        "save_targets": ["project"], "requires_review": True,
        "business_verifiers": [{"verifier_id": "slide_count", "expected_min": 12}],
        "contract_sha256": "a" * 64, "catalog_sha256": "b" * 64, "skill_release_sha256": "d" * 64,
    }
    runtime = {
        "schema_version": 1, "load_status": "loaded", "package_kind": "bundled",
        "release_id": "7", "version": "1.0", "release_status": "stable", "release_sha256": "d" * 64,
        "instruction_loaded": True, "instruction_complete": True, "progressive_loading": True,
        "resource_count": 1, "resource_names": ["references/quality-checklist.md"],
        "script_resource_count": 0, "scripts_executable": False, "tool_contract_valid": True,
        "declared_tool_count": 2, "granted_tool_count": 1, "policy_filtered_tool_count": 1,
        "verification_status": "available", "verification_step_count": 2, "verification_source_count": 1,
        "verification_context_complete": True, "verification_plan_sha256": "c" * 64,
        "deliverable": deliverable,
    }

    def started(run_id, **kwargs):
        return events.run_started(run_id, timestamp=TIMESTAMP, **kwargs)

    def context(run_id, rich=False):
        return events.context_receipt(
            run_id, scope="project" if rich else "chat",
            project={"id": 42, "name": "合成项目"} if rich else None,
            memory={
                "status": "ready" if rich else "not_applicable", "version": 3 if rich else 0,
                "raw_context_available": rich, "retrieval_mode": "focused" if rich else "none",
                **({"selected_slots": ["key_risks"], "selected_slot_count": 1, "available_slot_count": 1,
                    "selected_item_count": 1, "layers": [{
                        "scope": "project", "status": "ready", "version": 3, "retrieval_mode": "focused",
                        "selected_slots": ["key_risks"], "selected_slot_count": 1, "available_slot_count": 1,
                        "selected_item_count": 1, "query_facets": ["risk"],
                    }]} if rich else {}),
            },
            skill={"status": "applied", "usage_mode": "workflow", "reason": "explicit", "confidence": 1,
                   "id": "7", "name": "合成 Skill", "source": "explicit", "runtime": runtime,
                   "candidates": [{"id": "7", "name": "合成 Skill", "score": 1}]} if rich else
                  {"status": "not_used", "usage_mode": "none", "reason": "", "confidence": 0},
            evidence={"knowledge_retrieval_mode": "source_scoped" if rich else "none"},
            world_state={"current_version": "a" * 12, "previous_version": "b" * 12, "changed": True,
                         "changed_categories": ["files"], "categories": {"files": {"added": 1, "current_count": 1}}} if rich else None,
        )

    quiet = "run_contract_quiet"
    task = "run_contract_task"
    approval = "run_contract_approval"
    failed = "run_contract_failed"
    cancelled = "run_contract_cancelled"
    scenarios = [
        {"name": "quiet", "events": [
            started(quiet, display_mode="quiet"),
            events.turn_receipt(quiet, summary="回答合成问题", mode="answer_only", target_scope="chat",
                                execution_scope="chat_only", expected_response="answer", write_allowed=False,
                                requires_confirmation=False, steering_supported=True),
            context(quiet), events.text_delta(quiet, "合成回答"),
            events.reference_delta(quiet, "project_file:42", title="合成资料", url="/files/42"),
            events.message_persisted(quiet, 101), events.run_done(quiet, "completed", message_id=101),
        ]},
        {"name": "task", "events": [
            started(task, display_mode="skill", skill={"name": "合成 Skill", "id": "7", "source": "explicit"}),
            context(task, True), events.status(task, "正在生成合成交付物", display_mode="task", progress=0.5),
            events.steering_applied(task, steering_id="steer_contract", sequence=1, content_preview="保留十二页", message_id=102),
            events.step_started(task, 1, "生成合成交付物", step_total=1),
            events.tool_progress(task, 1, "生成演示文稿", "running", detail="合成案例", progress=0.5),
            events.task_update(task, 31, "running", current_step=1, total_steps=1, step_title="生成合成交付物", progress_pct=50),
            events.tool_progress(task, 1, "生成演示文稿", "completed", progress=1.0),
            events.step_completed(task, 1, "completed", duration_ms=250),
            events.artifact_ready(task, 57, "pptx", download_url="/files/57", preview_url="/preview/57",
                                  source_tool="generate_ppt", output_id="out_contract", content_sha256="a" * 64, verification=verification),
            events.memory_candidate_ready(task, 18, "project", "project_risk", content_sha256="b" * 64),
            events.task_update(task, 31, "completed", progress_pct=100),
            events.text_delta(task, "合成交付完成"), events.message_persisted(task, "103", parent_run_id=quiet),
            events.run_done(task, "completed", message_id="103", artifact_ids=[57]),
        ]},
        {"name": "approval", "events": [
            started(approval, display_mode="confirmation"),
            events.confirmation_required(approval, "更新合成项目", "写入项目内容", params_snapshot={"project_id": 42}, deadline="2026-09-21T00:00:00Z"),
            events.run_done(approval, "waiting_confirmation"),
        ]},
        {"name": "failed", "events": [
            started(failed, display_mode="task"), events.step_started(failed, 1, "读取合成来源"),
            events.tool_progress(failed, 1, "读取资料", "failed"), events.step_completed(failed, 1, "failed", 10, truncated=True),
            events.run_failed(failed, "MODEL_TIMEOUT", "合成运行未完成", retryable=True, fallback_content="合成失败说明"),
        ]},
        {"name": "cancelled", "events": [started(cancelled), events.run_done(cancelled, "cancelled")]},
    ]
    variant = "run_contract_variants"
    variants = [started(variant, display_mode=value) for value in sorted(events._DISPLAY_MODES)]
    variants += [started(variant, skill={"name": "合成 Skill", "source": value}) for value in sorted(events._SKILL_SOURCES)]
    variants += [events.tool_progress(variant, 1, "合成工具", value) for value in _constants(events.ToolProgressStatus)]
    variants += [events.task_update(variant, "31", value) for value in _constants(events.ToolProgressStatus)]
    variants += [events.artifact_ready(variant, "57", value) for value in _constants(events.ArtifactType)]
    variants += [events.run_done(variant, value) for value in _constants(events.RunFinalStatus)]
    variants += [events.run_failed(variant, value, "合成失败说明") for value in _constants(events.ErrorCode)]
    variants += [events.memory_candidate_ready(variant, "18", value, "lesson") for value in ("user", "project", "client")]
    return {"schema_version": 1, "synthetic": True, "event_types": _constants(events.EventType), "scenarios": scenarios, "variants": variants}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    expected = json.dumps(build_contract_fixture(), ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.write:
        FIXTURE_PATH.write_text(expected)
        return 0
    if not FIXTURE_PATH.is_file() or FIXTURE_PATH.read_text() != expected:
        raise SystemExit("Product Run fixture is stale; review the contract and regenerate with --write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
