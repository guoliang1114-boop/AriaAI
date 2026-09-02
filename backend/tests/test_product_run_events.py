"""Unit tests for the Product Run Event v1 builders (spec in code)."""
from __future__ import annotations

import unittest

from app.services.chat.product_run_events import (
    ArtifactType,
    DisplayMode,
    ErrorCode,
    EventType,
    RunFinalStatus,
    StepCompletedStatus,
    ToolProgressStatus,
    USER_FACING_MESSAGE_MAX_CHARS,
    artifact_ready,
    confirmation_required,
    context_receipt,
    make_run_id,
    memory_candidate_ready,
    message_persisted,
    reference_delta,
    resolve_run_display_mode,
    run_done,
    run_failed,
    run_started,
    steering_applied,
    status,
    step_completed,
    step_started,
    task_update,
    text_delta,
    turn_receipt,
    tool_progress,
)


class DisplayModeResolutionTest(unittest.TestCase):
    def test_policy_modes_remain_product_level_and_skill_wins(self):
        self.assertEqual(resolve_run_display_mode("direct_answer"), DisplayMode.QUIET)
        self.assertEqual(resolve_run_display_mode("read_only_tool"), DisplayMode.CONTEXTUAL)
        self.assertEqual(resolve_run_display_mode("write_artifact"), DisplayMode.TASK)
        self.assertEqual(resolve_run_display_mode("durable_task"), DisplayMode.TASK)
        self.assertEqual(resolve_run_display_mode("destructive_action"), DisplayMode.CONFIRMATION)
        self.assertEqual(
            resolve_run_display_mode("direct_answer", has_skill=True),
            DisplayMode.SKILL,
        )


class RunIdTest(unittest.TestCase):
    def test_make_run_id_format(self):
        rid = make_run_id()
        self.assertTrue(rid.startswith("run_"))
        self.assertGreater(len(rid), 10)
        self.assertNotEqual(make_run_id(), make_run_id())


class RunStartedTest(unittest.TestCase):
    def test_minimum_fields(self):
        rid = make_run_id()
        event = run_started(rid)
        self.assertEqual(event["type"], EventType.RUN_STARTED)
        self.assertEqual(event["run_id"], rid)
        self.assertIn("timestamp", event)
        self.assertNotIn("skill", event)
        self.assertNotIn("display_mode", event)

    def test_with_display_mode_and_skill(self):
        rid = make_run_id()
        event = run_started(
            rid,
            display_mode=DisplayMode.SKILL,
            skill={"name": "数字化战略", "id": "digital-strategy", "source": "auto"},
        )
        self.assertEqual(event["display_mode"], "skill")
        self.assertEqual(event["skill"], {"name": "数字化战略", "id": "digital-strategy", "source": "auto"})

    def test_invalid_display_mode_rejected(self):
        with self.assertRaises(ValueError):
            run_started(make_run_id(), display_mode="loud")

    def test_skill_without_name_rejected(self):
        with self.assertRaises(ValueError):
            run_started(make_run_id(), skill={"id": "x"})

    def test_invalid_skill_source_rejected(self):
        with self.assertRaises(ValueError):
            run_started(make_run_id(), skill={"name": "Skill", "source": "guessed"})

    def test_invalid_run_id_rejected(self):
        with self.assertRaises(ValueError):
            run_started("not-a-run-id")


class StatusTest(unittest.TestCase):
    def test_basic(self):
        event = status(make_run_id(), "正在生成回复...", display_mode=DisplayMode.QUIET)
        self.assertEqual(event["type"], EventType.STATUS)
        self.assertEqual(event["message"], "正在生成回复...")
        self.assertEqual(event["display_mode"], "quiet")

    def test_overlong_message_rejected(self):
        with self.assertRaises(ValueError):
            status(make_run_id(), "x" * (USER_FACING_MESSAGE_MAX_CHARS + 1))

    def test_empty_message_rejected(self):
        with self.assertRaises(ValueError):
            status(make_run_id(), "   ")


class TurnReceiptAndSteeringTest(unittest.TestCase):
    def test_turn_receipt_exposes_contract_without_internal_prompt(self):
        event = turn_receipt(
            make_run_id(),
            summary="生成十页董事会汇报",
            mode="execute_now",
            target_scope="project",
            execution_scope="project_write",
            expected_response="pptx_deliverable",
            write_allowed=True,
            requires_confirmation=False,
            steering_supported=True,
            user_constraints=["只分析，不修改项目内容", "输出为 Markdown"],
        )
        self.assertEqual(event["type"], EventType.TURN_RECEIPT)
        self.assertTrue(event["steering_supported"])
        self.assertEqual(
            event["user_constraints"],
            ["只分析，不修改项目内容", "输出为 Markdown"],
        )
        self.assertNotIn("system_prompt", event)

    def test_steering_applied_is_sequence_bound(self):
        event = steering_applied(
            make_run_id(),
            steering_id="steer_abc",
            sequence=2,
            content_preview="控制在十页",
            message_id=91,
        )
        self.assertEqual(event["type"], EventType.STEERING_APPLIED)
        self.assertEqual(event["sequence"], 2)
        self.assertEqual(event["message_id"], 91)


class ContextReceiptTest(unittest.TestCase):
    def test_context_receipt_exposes_freshness_and_routing_without_content(self):
        event = context_receipt(
            make_run_id(),
            scope="project",
            project={"id": 26, "name": "Transformation"},
            memory={
                "status": "stale",
                "version": 4,
                "raw_context_available": True,
                "retrieval_mode": "focused",
                "query_facets": ["risk"],
                "selected_slots": ["key_risks", "open_questions", "next_actions"],
                "stale_slots": ["key_risks"],
                "selected_slot_count": 3,
                "stale_slot_count": 1,
                "available_slot_count": 8,
                "omitted_slot_count": 5,
                "selected_item_count": 6,
                "evidence_ref_count": 9,
                "direct_fact_count": 2,
                "matched_fact_count": 1,
                "scoped_fact_count": 2,
                "unresolved_fact_count": 1,
                "_source_snapshots": {"project:26": "private-source-hash"},
                "layers": [
                    {
                        "scope": "user",
                        "status": "ready",
                        "version": 2,
                        "retrieval_mode": "focused",
                        "selected_slots": ["response_preferences.tone"],
                        "selected_slot_count": 1,
                        "available_slot_count": 3,
                        "omitted_slot_count": 2,
                        "selected_item_count": 1,
                        "overridden_dimensions": ["language"],
                    },
                    {
                        "scope": "client",
                        "status": "stale",
                        "version": 5,
                        "retrieval_mode": "focused",
                        "selected_slots": ["decision_patterns"],
                        "selected_slot_count": 1,
                        "available_slot_count": 4,
                        "omitted_slot_count": 3,
                        "selected_item_count": 2,
                        "stale_slots": ["decision_patterns"],
                        "stale_slot_count": 1,
                        "evidence_ref_count": 3,
                        "direct_fact_count": 1,
                        "matched_fact_count": 0,
                        "scoped_fact_count": 1,
                        "unresolved_fact_count": 0,
                        "source_sha256": "private-source-hash",
                    },
                ],
            },
            skill={
                "status": "applied",
                "usage_mode": "advisory",
                "id": 7,
                "name": "舞弊风险评估",
                "source": "auto",
                "reason": "auto_skill_advisory_match",
                "confidence": 0.9,
            },
            evidence={
                "workspace_context": True,
                "attached_file_count": 1,
                "knowledge_reference_count": 2,
                "history_message_count": 8,
                "conversation_capsule": True,
                "user_preferences": False,
                "compacted": False,
            },
            warnings=[
                "project_memory_stale",
                "client_memory_stale",
                "user_preference_overridden",
            ],
        )

        self.assertEqual(event["type"], EventType.CONTEXT_RECEIPT)
        self.assertEqual(event["memory"]["version"], 4)
        self.assertEqual(event["memory"]["retrieval_mode"], "focused")
        self.assertEqual(event["memory"]["selected_item_count"], 6)
        self.assertEqual(event["memory"]["stale_slots"], ["key_risks"])
        self.assertEqual(event["memory"]["stale_slot_count"], 1)
        self.assertEqual(event["memory"]["evidence_ref_count"], 9)
        self.assertEqual(event["memory"]["direct_fact_count"], 2)
        self.assertEqual(event["memory"]["matched_fact_count"], 1)
        self.assertEqual(event["memory"]["scoped_fact_count"], 2)
        self.assertEqual(event["memory"]["unresolved_fact_count"], 1)
        self.assertEqual(
            [layer["scope"] for layer in event["memory"]["layers"]],
            ["user", "client"],
        )
        self.assertEqual(
            event["memory"]["layers"][0]["overridden_dimensions"],
            ["language"],
        )
        self.assertEqual(
            event["memory"]["layers"][1]["stale_slots"],
            ["decision_patterns"],
        )
        self.assertEqual(event["memory"]["layers"][1]["direct_fact_count"], 1)
        self.assertEqual(event["memory"]["layers"][1]["matched_fact_count"], 0)
        self.assertEqual(event["skill"]["usage_mode"], "advisory")
        self.assertEqual(event["evidence"]["knowledge_reference_count"], 2)
        self.assertNotIn("prompt", event)
        self.assertNotIn("content", event)
        self.assertNotIn("_source_snapshots", str(event))
        self.assertNotIn("source_sha256", str(event))

    def test_context_receipt_whitelists_skill_runtime_contract(self):
        event = context_receipt(
            make_run_id(),
            scope="chat",
            memory={
                "status": "not_applicable",
                "version": 0,
                "retrieval_mode": "none",
            },
            skill={
                "status": "applied",
                "usage_mode": "workflow",
                "name": "Proposal",
                "reason": "forced_by_user",
                "confidence": 1.0,
                "runtime": {
                    "schema_version": 1,
                    "load_status": "loaded",
                    "package_kind": "bundled",
                    "release_id": "19",
                    "version": "1.2.0",
                    "release_status": "stable",
                    "release_sha256": "d" * 64,
                    "instruction_loaded": True,
                    "instruction_complete": True,
                    "progressive_loading": True,
                    "resource_count": 1,
                    "resource_names": ["references/quality-checklist.md"],
                    "script_resource_count": 0,
                    "scripts_executable": False,
                    "tool_contract_valid": True,
                    "declared_tool_count": 2,
                    "granted_tool_count": 1,
                    "policy_filtered_tool_count": 1,
                    "verification_status": "available",
                    "verification_step_count": 6,
                    "verification_source_count": 1,
                    "verification_context_complete": True,
                    "prompt": "must never leave backend",
                },
            },
            evidence={},
        )

        runtime = event["skill"]["runtime"]
        self.assertEqual(runtime["release_id"], "19")
        self.assertEqual(runtime["resource_names"], ["references/quality-checklist.md"])
        self.assertEqual(runtime["granted_tool_count"], 1)
        self.assertNotIn("prompt", runtime)

    def test_context_receipt_rejects_executable_package_scripts(self):
        with self.assertRaisesRegex(ValueError, "scripts_executable must be false"):
            context_receipt(
                make_run_id(),
                scope="chat",
                memory={
                    "status": "not_applicable",
                    "version": 0,
                    "retrieval_mode": "none",
                },
                skill={
                    "status": "applied",
                    "usage_mode": "workflow",
                    "name": "Unsafe",
                    "reason": "forced_by_user",
                    "confidence": 1.0,
                    "runtime": {
                        "schema_version": 1,
                        "load_status": "loaded",
                        "package_kind": "custom",
                        "scripts_executable": True,
                        "verification_status": "not_declared",
                    },
                },
                evidence={},
            )

    def test_context_receipt_rejects_overrides_on_non_user_layer(self):
        with self.assertRaises(ValueError):
            context_receipt(
                make_run_id(),
                scope="project",
                memory={
                    "status": "ready",
                    "version": 1,
                    "layers": [
                        {
                            "scope": "client",
                            "status": "ready",
                            "version": 1,
                            "overridden_dimensions": ["tone"],
                        }
                    ],
                },
                skill={"status": "not_used", "usage_mode": "none"},
                evidence={},
            )

    def test_context_receipt_rejects_arbitrary_layer_slot_names(self):
        with self.assertRaises(ValueError):
            context_receipt(
                make_run_id(),
                scope="chat",
                memory={
                    "status": "not_applicable",
                    "version": 0,
                    "layers": [
                        {
                            "scope": "user",
                            "status": "ready",
                            "version": 1,
                            "selected_slots": ["PRIVATE_CUSTOM_KEY"],
                        }
                    ],
                },
                skill={"status": "not_used", "usage_mode": "none"},
                evidence={},
            )

    def test_context_receipt_rejects_stale_slot_that_was_not_selected(self):
        with self.assertRaises(ValueError):
            context_receipt(
                make_run_id(),
                scope="project",
                memory={
                    "status": "stale",
                    "version": 2,
                    "selected_slots": ["key_risks"],
                    "stale_slots": ["financial_status"],
                },
                skill={"status": "not_used", "usage_mode": "none"},
                evidence={},
            )

    def test_context_receipt_bounds_ambiguous_candidates(self):
        event = context_receipt(
            make_run_id(),
            scope="project",
            memory={"status": "ready", "version": 2},
            skill={
                "status": "ambiguous",
                "usage_mode": "none",
                "reason": "auto_skill_ambiguous_advisory_match",
                "candidates": [
                    {"id": index, "name": f"Skill {index}", "score": 90}
                    for index in range(5)
                ],
            },
            evidence={},
            warnings=["skill_match_ambiguous"],
        )

        self.assertEqual(len(event["skill"]["candidates"]), 3)

    def test_context_receipt_rejects_unknown_warning(self):
        with self.assertRaises(ValueError):
            context_receipt(
                make_run_id(),
                scope="chat",
                memory={"status": "not_applicable", "version": 0},
                skill={"status": "not_used", "usage_mode": "none"},
                evidence={},
                warnings=["raw_prompt_exposed"],
            )

    def test_context_receipt_rejects_unknown_memory_retrieval_mode(self):
        with self.assertRaises(ValueError):
            context_receipt(
                make_run_id(),
                scope="project",
                memory={"status": "ready", "version": 1, "retrieval_mode": "guess"},
                skill={"status": "not_used", "usage_mode": "none"},
                evidence={},
            )

    def test_context_receipt_exposes_content_free_project_state_change(self):
        event = context_receipt(
            make_run_id(),
            scope="project",
            memory={"status": "ready", "version": 4},
            skill={"status": "not_used", "usage_mode": "none"},
            evidence={},
            world_state={
                "current_version": "abcdef123456",
                "previous_version": "123456abcdef",
                "baseline": False,
                "changed": True,
                "changed_categories": ["files"],
                "categories": {
                    "files": {"added": 1, "removed": 0, "updated": 2, "current_count": 8}
                },
                "truncated": False,
            },
            warnings=["project_world_state_changed"],
        )

        self.assertEqual(event["world_state"]["current_version"], "abcdef123456")
        self.assertEqual(event["world_state"]["categories"]["files"]["updated"], 2)
        self.assertIn("project_world_state_changed", event["warnings"])
        self.assertNotIn("content", str(event))


class TextDeltaTest(unittest.TestCase):
    def test_basic(self):
        event = text_delta(make_run_id(), "hello")
        self.assertEqual(event["type"], EventType.TEXT_DELTA)
        self.assertEqual(event["content"], "hello")

    def test_empty_string_allowed(self):
        # An empty delta is unusual but should not raise — it's still valid text.
        event = text_delta(make_run_id(), "")
        self.assertEqual(event["content"], "")


class StepEventsTest(unittest.TestCase):
    def test_step_started_and_completed(self):
        rid = make_run_id()
        started = step_started(rid, 1, "读取项目资料", step_total=3)
        completed = step_completed(rid, 1, StepCompletedStatus.COMPLETED, 230)
        self.assertEqual(started["title"], "读取项目资料")
        self.assertEqual(started["step_index"], 1)
        self.assertEqual(started["step_total"], 3)
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["duration_ms"], 230)
        self.assertFalse(completed["truncated"])

    def test_step_index_must_be_positive(self):
        with self.assertRaises(ValueError):
            step_started(make_run_id(), 0, "x")

    def test_step_completed_status_restricted(self):
        with self.assertRaises(ValueError):
            step_completed(make_run_id(), 1, "running", 100)

    def test_step_completed_negative_duration_rejected(self):
        with self.assertRaises(ValueError):
            step_completed(make_run_id(), 1, StepCompletedStatus.COMPLETED, -1)


class ToolProgressTest(unittest.TestCase):
    def test_basic(self):
        event = tool_progress(
            make_run_id(), 2, "读取项目文档", ToolProgressStatus.RUNNING
        )
        self.assertEqual(event["type"], EventType.TOOL_PROGRESS)
        self.assertEqual(event["step_index"], 2)
        self.assertEqual(event["status"], "running")

    def test_invalid_status_rejected(self):
        with self.assertRaises(ValueError):
            tool_progress(make_run_id(), 1, "x", "weird")


class TaskUpdateTest(unittest.TestCase):
    def test_basic(self):
        event = task_update(
            make_run_id(),
            42,
            ToolProgressStatus.RUNNING,
            progress_pct=40,
            current_step=2,
            total_steps=4,
            step_title="生成结构化大纲",
        )
        self.assertEqual(event["task_id"], "42")
        self.assertEqual(event["progress_pct"], 40)
        self.assertEqual(event["current_step"], 2)

    def test_progress_pct_out_of_range_rejected(self):
        with self.assertRaises(ValueError):
            task_update(make_run_id(), 1, ToolProgressStatus.RUNNING, progress_pct=150)


class ConfirmationRequiredTest(unittest.TestCase):
    def test_basic(self):
        event = confirmation_required(
            make_run_id(),
            action="删除项目文件",
            impact="该操作不可恢复",
            params_snapshot={"path": "a.txt"},
        )
        self.assertEqual(event["type"], EventType.CONFIRMATION_REQUIRED)
        self.assertEqual(event["params_snapshot"], {"path": "a.txt"})

    def test_empty_action_rejected(self):
        with self.assertRaises(ValueError):
            confirmation_required(make_run_id(), action=" ", impact="x")


class ArtifactReadyTest(unittest.TestCase):
    def test_basic(self):
        event = artifact_ready(
            make_run_id(),
            artifact_id=57,
            artifact_type=ArtifactType.PPTX,
            download_url="/files/57",
            source_tool="generate_ppt_from_skill",
            output_id="out_artifact_57",
            content_sha256="a" * 64,
        )
        self.assertEqual(event["artifact_id"], "57")
        self.assertEqual(event["artifact_type"], "pptx")
        self.assertEqual(event["download_url"], "/files/57")
        self.assertEqual(event["source_tool"], "generate_ppt_from_skill")
        self.assertEqual(event["output_id"], "out_artifact_57")
        self.assertEqual(event["content_sha256"], "a" * 64)

    def test_invalid_artifact_type_rejected(self):
        with self.assertRaises(ValueError):
            artifact_ready(make_run_id(), 1, "wav")

    def test_invalid_content_digest_rejected(self):
        with self.assertRaises(ValueError):
            artifact_ready(make_run_id(), 1, ArtifactType.PDF, content_sha256="short")


class MemoryCandidateReadyTest(unittest.TestCase):
    def test_pending_review_event(self):
        event = memory_candidate_ready(
            make_run_id(),
            18,
            "project",
            "project_risk",
            content_sha256="b" * 64,
        )
        self.assertEqual(event["type"], EventType.MEMORY_CANDIDATE_READY)
        self.assertEqual(event["candidate_id"], "18")
        self.assertEqual(event["status"], "pending_review")

    def test_invalid_scope_rejected(self):
        with self.assertRaises(ValueError):
            memory_candidate_ready(make_run_id(), 18, "organization", "lesson")


class RunTerminalEventsTest(unittest.TestCase):
    def test_message_persisted(self):
        event = message_persisted(make_run_id(), message_id=99)
        self.assertEqual(event["type"], EventType.MESSAGE_PERSISTED)
        self.assertEqual(event["message_id"], 99)

    def test_run_done(self):
        event = run_done(
            make_run_id(),
            RunFinalStatus.COMPLETED,
            message_id=100,
            artifact_ids=[57, "58"],
        )
        self.assertEqual(event["final_status"], "completed")
        self.assertEqual(event["artifact_ids"], ["57", "58"])

    def test_run_done_waiting_confirmation(self):
        event = run_done(make_run_id(), RunFinalStatus.WAITING_CONFIRMATION)
        self.assertEqual(event["final_status"], "waiting_confirmation")

    def test_run_done_status_restricted(self):
        with self.assertRaises(ValueError):
            run_done(make_run_id(), "running")

    def test_run_failed_basic(self):
        event = run_failed(
            make_run_id(),
            ErrorCode.MODEL_TIMEOUT,
            "AI 服务响应超时，请稍后重试",
            retryable=True,
        )
        self.assertEqual(event["error_code"], "MODEL_TIMEOUT")
        self.assertTrue(event["retryable"])

    def test_run_failed_unknown_error_code_rejected(self):
        with self.assertRaises(ValueError):
            run_failed(make_run_id(), "MADE_UP", "x")


class ReferenceDeltaTest(unittest.TestCase):
    def test_basic(self):
        event = reference_delta(
            make_run_id(),
            "project_file:42",
            url="/files/42",
            title="项目背景.md",
        )
        self.assertEqual(event["type"], EventType.REFERENCE_DELTA)
        self.assertEqual(event["source"], "project_file:42")
        self.assertEqual(event["title"], "项目背景.md")


class DurableTaskTaskUpdateMappingTest(unittest.TestCase):
    """Tests for the helper that maps a TaskRun payload to a v1 task_update SSE
    frame (``app.services.chat.durable_task._v1_task_update_from_payload``)."""

    def _parse_sse(self, frame: str) -> dict:
        import json as _json

        line = frame.strip()
        self.assertTrue(line.startswith("data:"), f"unexpected frame: {frame!r}")
        return _json.loads(line[len("data:"):].strip())

    def test_running_task_with_partial_step_progress(self):
        from app.services.chat.durable_task import _v1_task_update_from_payload

        payload = {
            "id": 42,
            "status": "running",
            "current_step_key": "step_2",
            "steps": [
                {"step_key": "step_1", "title": "收集上下文", "status": "completed"},
                {"step_key": "step_2", "title": "生成大纲", "status": "running"},
                {"step_key": "step_3", "title": "保存交付物", "status": "pending"},
                {"step_key": "step_4", "title": "整理交付", "status": "pending"},
            ],
        }
        frame = _v1_task_update_from_payload("run_xyz", payload)
        self.assertIsNotNone(frame)
        event = self._parse_sse(frame)
        self.assertEqual(event["type"], "task_update")
        self.assertEqual(event["task_id"], "42")
        self.assertEqual(event["status"], "running")
        self.assertEqual(event["total_steps"], 4)
        self.assertEqual(event["current_step"], 2)
        self.assertEqual(event["step_title"], "生成大纲")
        self.assertEqual(event["progress_pct"], 25)  # 1/4 completed

    def test_completed_task_yields_100_progress(self):
        from app.services.chat.durable_task import _v1_task_update_from_payload

        payload = {
            "id": 7,
            "status": "completed",
            "steps": [
                {"step_key": "a", "status": "completed"},
                {"step_key": "b", "status": "completed"},
            ],
        }
        event = self._parse_sse(_v1_task_update_from_payload("run_x", payload))
        self.assertEqual(event["status"], "completed")
        self.assertEqual(event["progress_pct"], 100)

    def test_paused_maps_to_pending_and_canceled_maps_to_failed(self):
        from app.services.chat.durable_task import _v1_task_update_from_payload

        paused = self._parse_sse(
            _v1_task_update_from_payload("run_x", {"id": 1, "status": "paused"})
        )
        self.assertEqual(paused["status"], "pending")

        canceled = self._parse_sse(
            _v1_task_update_from_payload("run_x", {"id": 2, "status": "canceled"})
        )
        self.assertEqual(canceled["status"], "failed")

    def test_unknown_status_returns_none(self):
        from app.services.chat.durable_task import _v1_task_update_from_payload

        self.assertIsNone(
            _v1_task_update_from_payload("run_x", {"id": 1, "status": "stalled_unknown"})
        )

    def test_returns_none_without_run_id(self):
        from app.services.chat.durable_task import _v1_task_update_from_payload

        self.assertIsNone(
            _v1_task_update_from_payload("", {"id": 1, "status": "running"})
        )

    def test_returns_none_without_task_id(self):
        from app.services.chat.durable_task import _v1_task_update_from_payload

        self.assertIsNone(
            _v1_task_update_from_payload("run_x", {"status": "running"})
        )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
