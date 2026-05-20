"""Unit tests for chat streaming phases and infrastructure."""
from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event, iter_with_heartbeat, await_with_heartbeat
from app.services.chat.truncation import strip_truncation_marker, OUTPUT_TRUNCATED_MARKER
from app.services.chat.workflow import (
    workflow_status,
    workflow_status_from_task_event,
    workflow_plan_events,
    task_event_detail,
    task_step_output_details,
    task_payload_tool_calls,
)
from app.services.chat.mode_registry import ChatMode
from app.services.chat.runtime import (
    _cap_max_tokens_for_model,
    decide_skill_activation,
    _is_standalone_fast_path,
    _should_apply_skill,
    _resolve_runtime_model_and_tokens,
)


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
class ChatSessionStateTests(unittest.TestCase):
    def test_default_values(self):
        state = ChatSessionState()
        self.assertEqual(state.full_text, "")
        self.assertEqual(state.tool_use_blocks, [])
        self.assertFalse(state.p1_truncated)
        self.assertFalse(state.durable_task_completed)

    def test_with_stage_timings(self):
        state = ChatSessionState(stage_timings={"planning_ms": 100})
        self.assertEqual(state.stage_timings["planning_ms"], 100)

    def test_mutable_fields(self):
        state = ChatSessionState()
        state.text_buffer = "hello"
        state.tool_use_blocks.append({"name": "test"})
        self.assertEqual(state.text_buffer, "hello")
        self.assertEqual(len(state.tool_use_blocks), 1)


# ---------------------------------------------------------------------------
# SSE
# ---------------------------------------------------------------------------
class SseEventTests(unittest.TestCase):
    def test_formats_dict(self):
        result = sse_event({"type": "text", "content": "hello"})
        self.assertTrue(result.startswith("data: "))
        self.assertTrue(result.endswith("\n\n"))
        parsed = json.loads(result.replace("data: ", "").strip())
        self.assertEqual(parsed["type"], "text")

    def test_unicode_preserved(self):
        result = sse_event({"content": "中文"})
        self.assertIn("中文", result)


class IterWithHeartbeatTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.items = ["chunk1", "chunk2", "chunk3"]

    async def _slow_iterator(self):
        for item in self.items:
            await asyncio.sleep(0.01)
            yield item

    async def test_yields_all_items(self):
        results = []
        async for item in iter_with_heartbeat(
            self._slow_iterator(), stage="test", message="waiting", seconds=1.0
        ):
            results.append(item)
        self.assertEqual(results, self.items)

    async def test_heartbeat_when_slow(self):
        """If source is very slow, heartbeat status events should be yielded."""
        async def very_slow():
            await asyncio.sleep(0.5)
            yield "late"

        results = []
        async for item in iter_with_heartbeat(
            very_slow(), stage="test", message="waiting", seconds=0.05
        ):
            results.append(item)

        # Should have at least one heartbeat + the real item
        heartbeats = [r for r in results if isinstance(r, dict)]
        real_items = [r for r in results if isinstance(r, str)]
        self.assertGreaterEqual(len(heartbeats), 1)
        self.assertEqual(real_items, ["late"])

    async def test_cleans_up_pending(self):
        """Pending task should be cancelled on generator exit."""
        async def infinite():
            while True:
                await asyncio.sleep(10)
                yield "x"

        count = 0
        async for _ in iter_with_heartbeat(infinite(), stage="test", message="wait", seconds=0.01):
            count += 1
            if count >= 2:
                break
        self.assertGreaterEqual(count, 1)


class AwaitWithHeartbeatTests(unittest.IsolatedAsyncioTestCase):
    async def test_yields_result(self):
        async def slow_task():
            await asyncio.sleep(0.01)
            return "done"

        results = []
        async for item in await_with_heartbeat(slow_task(), stage="test", message="waiting", seconds=1.0):
            results.append(item)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["type"], "result")
        self.assertEqual(results[0]["result"], "done")

    async def test_heartbeat_before_result(self):
        async def slow_task():
            await asyncio.sleep(0.1)
            return "done"

        results = []
        async for item in await_with_heartbeat(slow_task(), stage="test", message="waiting", seconds=0.02):
            results.append(item)

        heartbeats = [r for r in results if r.get("type") == "status"]
        results_events = [r for r in results if r.get("type") == "result"]
        self.assertGreaterEqual(len(heartbeats), 1)
        self.assertEqual(len(results_events), 1)


# ---------------------------------------------------------------------------
# Truncation
# ---------------------------------------------------------------------------
class StripTruncationMarkerTests(unittest.TestCase):
    def test_no_marker(self):
        result, was = strip_truncation_marker("hello world")
        self.assertEqual(result, "hello world")
        self.assertFalse(was)

    def test_with_marker(self):
        result, was = strip_truncation_marker("hello[OUTPUT_TRUNCATED]")
        self.assertEqual(result, "hello")
        self.assertTrue(was)

    def test_only_marker(self):
        result, was = strip_truncation_marker("[OUTPUT_TRUNCATED]")
        self.assertEqual(result, "")
        self.assertTrue(was)

    def test_marker_constant(self):
        self.assertEqual(OUTPUT_TRUNCATED_MARKER, "[OUTPUT_TRUNCATED]")


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------
class WorkflowStatusTests(unittest.TestCase):
    def test_basic_structure(self):
        result = workflow_status(
            step_index=1, step_total=4, title="Test", message="Msg", stage="test"
        )
        self.assertEqual(result["type"], "status")
        self.assertEqual(result["step_index"], 1)
        self.assertEqual(result["step_total"], 4)
        self.assertEqual(result["step_status"], "running")

    def test_completed_status(self):
        result = workflow_status(
            step_index=1, step_total=4, title="Test", message="Msg", stage="test", status="completed"
        )
        self.assertEqual(result["step_status"], "completed")


class WorkflowStatusFromTaskEventTests(unittest.TestCase):
    def test_empty_step_returns_none(self):
        self.assertIsNone(workflow_status_from_task_event({}))

    def test_step_completed(self):
        event = {"step": {"sort_order": 2}, "event_type": "step_completed", "message": "Done"}
        result = workflow_status_from_task_event(event)
        self.assertEqual(result["step_status"], "completed")

    def test_step_failed(self):
        event = {"step": {"sort_order": 1}, "event_type": "step_failed"}
        result = workflow_status_from_task_event(event)
        self.assertEqual(result["step_status"], "error")


class WorkflowPlanEventsTests(unittest.TestCase):
    def test_returns_two_events(self):
        events = workflow_plan_events()
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["step_index"], 1)
        self.assertEqual(events[1]["step_index"], 2)
        self.assertEqual(events[0]["step_status"], "completed")


class TaskStepOutputDetailsTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(task_step_output_details(None), [])

    def test_project_name(self):
        result = task_step_output_details({"project_name": "P", "client": "C"})
        self.assertTrue(any("P" in r and "C" in r for r in result))

    def test_file_info(self):
        result = task_step_output_details({"file_name": "x.docx", "file_type": "docx"})
        self.assertTrue(any("x.docx" in r for r in result))


class TaskPayloadToolCallsTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(task_payload_tool_calls({}), [])

    def test_single_step(self):
        payload = {
            "steps": [
                {"sort_order": 1, "title": "Step 1", "status": "completed"}
            ]
        }
        result = task_payload_tool_calls(payload)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["status"], "completed")
        self.assertIn("Step 1", result[0]["tool_name"])

    def test_failed_step(self):
        payload = {
            "steps": [
                {"sort_order": 1, "title": "Step 1", "status": "failed", "error_message": "Oops"}
            ]
        }
        result = task_payload_tool_calls(payload)
        self.assertEqual(result[0]["status"], "error")
        self.assertEqual(result[0]["error"], "Oops")


# ---------------------------------------------------------------------------
# Runtime helpers
# ---------------------------------------------------------------------------
class CapMaxTokensForModelTests(unittest.TestCase):
    def test_kimi_k2_6(self):
        self.assertEqual(_cap_max_tokens_for_model("kimi-k2.6", 50000), 32768)

    def test_moonshot_8k(self):
        self.assertEqual(_cap_max_tokens_for_model("moonshot-v1-8k", 5000), 4096)

    def test_claude(self):
        self.assertEqual(_cap_max_tokens_for_model("claude-3-opus", 10000), 8192)

    def test_default(self):
        self.assertEqual(_cap_max_tokens_for_model("unknown", 10000), 8192)

    def test_respects_lower_request(self):
        self.assertEqual(_cap_max_tokens_for_model("claude-3", 4000), 4000)


class DummyRequest:
    def __init__(self, content="", project_id=None, skill_id=None, rag_doc_ids=None, file_ids=None, force_skill=False):
        self.content = content
        self.project_id = project_id
        self.skill_id = skill_id
        self.rag_doc_ids = rag_doc_ids
        self.file_ids = file_ids
        self.force_skill = force_skill


class IsStandaloneFastPathTests(unittest.TestCase):
    def test_true_when_no_project_no_skill_no_rag_no_files_short_text(self):
        req = DummyRequest(content="Hi", project_id=None, skill_id=None)
        self.assertTrue(_is_standalone_fast_path(req, None, ChatMode.STANDALONE_QA))

    def test_false_when_project_set(self):
        req = DummyRequest(content="Hi", project_id=1)
        self.assertFalse(_is_standalone_fast_path(req, None, ChatMode.PROJECT_DEEP_DIVE))

    def test_false_when_skill_set(self):
        req = DummyRequest(content="Hi")
        self.assertFalse(_is_standalone_fast_path(req, 1, ChatMode.SKILL_EXECUTION))

    def test_false_when_long_text(self):
        req = DummyRequest(content="x" * 300)
        self.assertFalse(_is_standalone_fast_path(req, None, ChatMode.STANDALONE_QA))


class ShouldApplySkillTests(unittest.TestCase):
    def test_no_skill_returns_false(self):
        self.assertFalse(_should_apply_skill("create ppt", None))

    def test_empty_content_returns_false(self):
        class FakeSkill:
            name = "test"
            system_prompt = ""
        self.assertFalse(_should_apply_skill("", FakeSkill()))

    def test_explicit_skill_keyword(self):
        class FakeSkill:
            name = "test"
            system_prompt = ""
        self.assertTrue(_should_apply_skill("@skill create ppt", FakeSkill()))

    def test_force_skill_applies(self):
        class FakeSkill:
            name = "test"
            system_prompt = ""
        decision = decide_skill_activation("生成一份报告", FakeSkill(), force_skill=True)
        self.assertTrue(decision.apply)
        self.assertEqual(decision.reason, "forced_by_user")

    def test_deliverable_intent_does_not_auto_apply(self):
        class FakeSkill:
            name = "test"
            system_prompt = ""
        self.assertFalse(_should_apply_skill("生成一份报告", FakeSkill()))

    def test_casual_question_blocks(self):
        class FakeSkill:
            name = "test"
            system_prompt = ""
        self.assertFalse(_should_apply_skill("how to create a report", FakeSkill()))

    def test_long_template_does_not_auto_apply(self):
        class FakeSkill:
            name = "test"
            system_prompt = ""
        text = "x" * 200 + "\nsome: template"
        self.assertFalse(_should_apply_skill(text, FakeSkill()))


class ResolveRuntimeModelAndTokensTests(unittest.TestCase):
    def test_no_project_no_skill_kimi_fast_path(self):
        req = DummyRequest(content="Hi")
        model, tokens = _resolve_runtime_model_and_tokens(req, "kimi-k2.6", 4096, None, chat_mode=ChatMode.STANDALONE_QA)
        # kimi-k2.6 standalone fast path caps at 1536 tokens
        self.assertEqual(tokens, 1536)

    def test_no_project_no_skill_other_model(self):
        req = DummyRequest(content="Hi")
        model, tokens = _resolve_runtime_model_and_tokens(req, "claude-3", 4096, None, chat_mode=ChatMode.STANDALONE_QA)
        self.assertEqual(tokens, 2048)

    def test_with_project_returns_max_tokens(self):
        req = DummyRequest(content="Hi", project_id=1)
        model, tokens = _resolve_runtime_model_and_tokens(req, "kimi-k2.6", 4096, None, chat_mode=ChatMode.PROJECT_DEEP_DIVE)
        self.assertEqual(tokens, 4096)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def async_iter(items):
    """Convert a list into an async iterator."""
    for item in items:
        yield item


if __name__ == "__main__":
    unittest.main()
