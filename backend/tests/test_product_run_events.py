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
    make_run_id,
    message_persisted,
    reference_delta,
    run_done,
    run_failed,
    run_started,
    status,
    step_completed,
    step_started,
    task_update,
    text_delta,
    tool_progress,
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
            skill={"name": "数字化战略", "id": "digital-strategy"},
        )
        self.assertEqual(event["display_mode"], "skill")
        self.assertEqual(event["skill"], {"name": "数字化战略", "id": "digital-strategy"})

    def test_invalid_display_mode_rejected(self):
        with self.assertRaises(ValueError):
            run_started(make_run_id(), display_mode="loud")

    def test_skill_without_name_rejected(self):
        with self.assertRaises(ValueError):
            run_started(make_run_id(), skill={"id": "x"})

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
        )
        self.assertEqual(event["artifact_id"], "57")
        self.assertEqual(event["artifact_type"], "pptx")
        self.assertEqual(event["download_url"], "/files/57")

    def test_invalid_artifact_type_rejected(self):
        with self.assertRaises(ValueError):
            artifact_ready(make_run_id(), 1, "wav")


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


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
