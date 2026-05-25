"""Integration tests for chat streaming phases.

Tests the full P1 → P2 → P3 → P4 pipeline with mocked LLM and tools.
"""
from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.artifact_intent import ArtifactContract
from app.services.chat.mode_registry import ActionPolicy, ChatMode
from app.services.chat.runtime import _upgrade_policy_for_confirmed_followup
from app.services.chat.state import ChatSessionState
from app.services.intent_router import IntentDecision
from app.services.chat.phases.p1_planning import run_p1_planning
from app.services.chat.phases.p2_tools import _tool_confirmation_token, run_p2_tools
from app.services.chat.phases.p3_followup import run_p3_followup
from app.services.chat.phases.p4_persist import run_p4_persist
from app.services.chat.phases.p0_durable_task import _task_confirmation_reason, run_p0_durable_task
from app.tools.office_documents import (
    MANAGE_PROJECT_FILES_TOOL_NAME,
    MANAGE_PROJECT_FOLDERS_TOOL_NAME,
    WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
)
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME


class _AsyncIter:
    """Helper to turn a list of strings into an async iterator for LLM streams."""

    def __init__(self, chunks: list[str]):
        self._chunks = chunks

    async def __aiter__(self):
        for chunk in self._chunks:
            yield chunk


def _make_stream(chunks: list[str]):
    """Return a coroutine that yields the given chunks."""
    async def _stream(*args, **kwargs):
        for chunk in chunks:
            yield chunk
    return _stream


class ChatPhaseIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime = MagicMock()
        self.runtime.conv_id = 1
        self.runtime.project_id = 1
        self.runtime.selected_model = "test-model"
        self.runtime.max_tokens = 2000
        self.runtime.temperature = 0.5
        self.runtime.system = "system prompt"
        self.runtime.api_messages = [{"role": "user", "content": "hello"}]
        self.runtime.tools = None
        self.runtime.rag_sources = None
        self.runtime.skill_name = ""
        self.runtime.prepare_metrics = {}
        self.runtime.action_policy = "write_artifact"
        self.runtime.chat_mode = "project_deep_dive"
        self.runtime.intent_reason = ""
        self.runtime.intent_method = ""
        self.runtime.artifact_contract = None
        self.bind = MagicMock()

        self.req = MagicMock()
        self.req.project_id = 1
        self.req.content = "test message"

    def test_confirmation_followup_after_deletion_plan_upgrades_policy(self):
        decision = IntentDecision(
            chat_mode=ChatMode.PROJECT_DEEP_DIVE,
            action_policy=ActionPolicy.READ_ONLY_TOOL,
            task_route=None,
            confidence=0.72,
            reason="default",
            method="rule_fallback",
        )
        req = SimpleNamespace(project_id=27, content="执行", action_confirmations=[])
        history = [
            SimpleNamespace(role="assistant", content="🗑️ 删除清单\n文件ID 131 给我准备一个-PPT.pptx"),
            SimpleNamespace(role="user", content="执行"),
        ]

        upgraded = _upgrade_policy_for_confirmed_followup(decision, req, history)

        self.assertEqual(upgraded.action_policy, ActionPolicy.DESTRUCTIVE_ACTION)
        self.assertEqual(upgraded.reason, "confirmation_followup_after_deletion_plan")

    def _collect_events(self, async_gen):
        """Drain an async generator into a list."""
        return asyncio.run(self._collect(async_gen))

    async def _collect(self, async_gen):
        return [e async for e in async_gen]

    # ------------------------------------------------------------------
    # P1 — Planning without tools
    # ------------------------------------------------------------------
    async def test_p1_no_tools_streams_text(self):
        self.runtime.llm.stream_response = _make_stream(["Hello", " world"])
        state = ChatSessionState()

        events = []
        async for event in run_p1_planning(self.runtime, self.req, state):
            events.append(event)

        text_events = [e for e in events if '"type": "text"' in e]
        self.assertGreaterEqual(len(text_events), 2)
        self.assertEqual(state.text_buffer, "Hello world")
        self.assertEqual(state.tool_use_blocks, [])

    async def test_p1_truncation_once_continues(self):
        """P1 detects truncation, marks p1_truncated, and auto-continues."""
        self.runtime.llm.stream_response = _make_stream(
            ["Part 1 ", "[OUTPUT_TRUNCATED]"]
        )
        # Continuation stream
        self.runtime.llm.stream_response = _make_stream(
            ["Part 1 ", "[OUTPUT_TRUNCATED]"]
        )
        # We need to track calls because the function calls stream_response twice
        call_count = 0

        async def _tracking_stream(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                for chunk in ["Part 1 ", "[OUTPUT_TRUNCATED]"]:
                    yield chunk
            else:
                for chunk in ["Part 2"]:
                    yield chunk

        self.runtime.llm.stream_response = _tracking_stream
        state = ChatSessionState()

        events = []
        async for event in run_p1_planning(self.runtime, self.req, state):
            events.append(event)

        self.assertTrue(state.p1_truncated)
        self.assertFalse(state.p1_double_truncated)
        self.assertEqual(state.text_buffer, "Part 1 Part 2")
        # Should have continuation status event
        status_events = [e for e in events if '"stage": "continuing"' in e]
        self.assertGreaterEqual(len(status_events), 1)

    async def test_p1_double_truncation_emits_can_continue(self):
        """P1 truncated twice emits truncated event with can_continue=true."""
        call_count = 0

        async def _tracking_stream(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                for chunk in ["Part 1 ", "[OUTPUT_TRUNCATED]"]:
                    yield chunk
            else:
                for chunk in ["Part 2 ", "[OUTPUT_TRUNCATED]"]:
                    yield chunk

        self.runtime.llm.stream_response = _tracking_stream
        state = ChatSessionState()

        events = []
        async for event in run_p1_planning(self.runtime, self.req, state):
            events.append(event)

        self.assertTrue(state.p1_truncated)
        self.assertTrue(state.p1_double_truncated)
        # Should emit truncated event with can_continue
        truncated_events = [e for e in events if '"type": "truncated"' in e]
        self.assertEqual(len(truncated_events), 1)
        self.assertIn('"can_continue": true', truncated_events[0])

    async def test_p1_detects_tool_use_block(self):
        """P1 detects tool_use JSON blocks embedded in text."""
        tool_block = json.dumps({"type": "tool_use", "name": "write_tool", "id": "t1", "input": {}})
        self.runtime.llm.stream_response = _make_stream([f"Let me write: {tool_block}"])
        state = ChatSessionState()

        async for _ in run_p1_planning(self.runtime, self.req, state):
            pass

        self.assertEqual(len(state.tool_use_blocks), 1)
        self.assertEqual(state.tool_use_blocks[0]["name"], "write_tool")

    # ------------------------------------------------------------------
    # P2 — Tool execution
    # ------------------------------------------------------------------
    async def test_p2_executes_tool_and_collects_result(self):
        """P2 executes a single tool and collects result."""
        self.runtime.tools = None
        self.runtime.project_id = 1

        state = ChatSessionState()
        state.text_buffer = "I will write a file"
        state.tool_use_blocks = [
            {"name": "write_tool", "input": {"file_name": "test.md"}, "id": "t1"}
        ]

        with patch("app.services.chat.phases.p2_tools.registry.execute") as mock_exec:
            mock_exec.return_value = {"status": "completed", "output": {"file_name": "test.md"}}
            events = []
            async for event in run_p2_tools(self.runtime, self.req, state):
                events.append(event)

        self.assertEqual(len(state.tool_result_blocks), 1)
        self.assertEqual(len(state.tool_call_events), 1)
        self.assertEqual(state.tool_call_events[0]["status"], "completed")
        self.assertEqual(state.tool_call_events[0]["tool_name"], "write_tool")

    async def test_p2_tool_error(self):
        """P2 handles tool execution errors gracefully."""
        self.runtime.tools = None
        self.runtime.project_id = 1

        state = ChatSessionState()
        state.text_buffer = ""
        state.tool_use_blocks = [
            {"name": "broken_tool", "input": {}, "id": "t1"}
        ]

        with patch("app.services.chat.phases.p2_tools.registry.execute") as mock_exec:
            mock_exec.side_effect = RuntimeError("tool failed")
            events = []
            async for event in run_p2_tools(self.runtime, self.req, state):
                events.append(event)

        self.assertEqual(len(state.tool_call_events), 1)
        self.assertEqual(state.tool_call_events[0]["status"], "error")
        self.assertIn("tool failed", state.tool_call_events[0]["error"])

    # ------------------------------------------------------------------
    # P3 — Follow-up
    # ------------------------------------------------------------------
    async def test_p3_generates_followup_text(self):
        """P3 generates follow-up text after tool results."""
        state = ChatSessionState()
        state.text_buffer = "I will write a file"
        state.tool_use_blocks = [
            {"name": "write_tool", "input": {}, "id": "t1"}
        ]
        state.tool_result_blocks = [
            {"type": "tool_result", "tool_use_id": "t1", "content": "{}"}
        ]
        state.reasoning_content = ""

        self.runtime.llm.stream_response = _make_stream(["The file has been created."])

        events = []
        async for event in run_p3_followup(self.runtime, self.req, state):
            events.append(event)

        self.assertEqual(state.follow_up_text, "The file has been created.")
        text_events = [e for e in events if '"type": "text"' in e]
        self.assertGreaterEqual(len(text_events), 1)

    async def test_p3_truncated_sets_flag(self):
        """P3 detects truncation in follow-up."""
        state = ChatSessionState()
        state.text_buffer = "x"
        state.tool_use_blocks = [{"name": "t", "input": {}, "id": "t1"}]
        state.tool_result_blocks = [{"type": "tool_result", "tool_use_id": "t1", "content": "{}"}]

        self.runtime.llm.stream_response = _make_stream(["Long text ", "[OUTPUT_TRUNCATED]"])

        events = []
        async for event in run_p3_followup(self.runtime, self.req, state):
            events.append(event)

        self.assertTrue(state.p3_truncated)

    async def test_p3_confirmation_token_does_not_bypass_hitas(self):
        """Legacy confirmation tokens do not execute follow-up tools directly."""
        tool_input = {"mode": "append", "content": "## 后续行动"}
        confirmed_input = {**tool_input, "project_id": 1}
        state = ChatSessionState()
        state.text_buffer = "已读取现有材料。"
        state.tool_use_blocks = [{"name": READ_MARKDOWN_TOOL_NAME, "input": {"action": "list"}, "id": "t1"}]
        state.tool_result_blocks = [{"type": "tool_result", "tool_use_id": "t1", "content": "{}"}]

        self.runtime.project_id = 1
        self.runtime.action_policy = "modify_existing_file"
        self.req.action_confirmations = [_tool_confirmation_token(PROJECT_MARKDOWN_TOOL_NAME, confirmed_input)]
        self.runtime.llm.stream_response = _make_stream([
            json.dumps(
                {
                    "type": "tool_use",
                    "name": PROJECT_MARKDOWN_TOOL_NAME,
                    "id": "p3-confirm-exact",
                    "input": tool_input,
                },
                ensure_ascii=False,
            )
        ])

        with patch("app.services.chat.phases.p3_followup.registry.execute", new=AsyncMock()) as mock_exec:
            async for _ in run_p3_followup(self.runtime, self.req, state):
                pass

        mock_exec.assert_not_awaited()
        self.assertTrue(state.confirmation_requested)
        self.assertEqual(state.tool_call_events[-1]["status"], "confirmation_required")
        self.assertEqual(len(state.pending_tool_actions), 1)

    async def test_p3_blocked_folder_move_reports_not_executed(self):
        """Blocked follow-up folder moves must not look successful to the model."""
        state = ChatSessionState()
        state.text_buffer = "先看一下项目空间。"
        state.tool_use_blocks = [{"name": MANAGE_PROJECT_FOLDERS_TOOL_NAME, "input": {"action": "list"}, "id": "t1"}]
        state.tool_result_blocks = [{"type": "tool_result", "tool_use_id": "t1", "content": "{}"}]

        self.runtime.project_id = 27
        self.runtime.action_policy = "read_only_tool"
        self.req.action_confirmations = []
        self.runtime.llm.stream_response = _make_stream([
            json.dumps(
                {
                    "type": "tool_use",
                    "name": MANAGE_PROJECT_FOLDERS_TOOL_NAME,
                    "id": "p3-move-file",
                    "input": {"action": "move_file", "file_id": 131, "folder_id": 5},
                },
                ensure_ascii=False,
            )
        ])

        with patch("app.services.chat.phases.p3_followup.registry.execute", new=AsyncMock()) as mock_exec:
            async for _ in run_p3_followup(self.runtime, self.req, state):
                pass

        mock_exec.assert_not_awaited()
        self.assertEqual(state.tool_call_events[-1]["status"], "blocked")
        blocked_payload = json.loads(state.tool_result_blocks[-1]["content"])
        self.assertFalse(blocked_payload["success"])
        self.assertTrue(blocked_payload["not_executed"])
        self.assertEqual(blocked_payload["status"], "blocked")

    # ------------------------------------------------------------------
    # P4 — Persistence
    # ------------------------------------------------------------------
    async def test_p4_persists_assistant_message(self):
        """P4 persists the final message and emits done event."""
        state = ChatSessionState()
        state.text_buffer = "Hello"
        state.follow_up_text = " world"
        state.tool_call_events = [{"tool_name": "t", "status": "completed"}]
        state.stage_timings = {"planning_ms": 100}

        self.runtime.rag_sources = None
        self.runtime.skill_name = ""

        with patch("app.services.chat.phases.p4_persist.persist_assistant_message") as mock_persist, \
             patch("app.services.chat.phases.p4_persist.persist_generated_artifacts") as mock_artifacts:
            mock_persist.return_value = (True, 42)
            mock_artifacts.return_value = []

            events = []
            async for event in run_p4_persist(self.runtime, self.req, self.bind, state):
                events.append(event)

        done_events = [e for e in events if '"type": "done"' in e]
        self.assertEqual(len(done_events), 1)
        self.assertEqual(state.full_text, "Hello\n\nworld")
        self.assertTrue(state.need_title)
        mock_persist.assert_called_once()

    async def test_p4_empty_response_uses_fallback(self):
        """P4 uses fallback message when response is empty."""
        state = ChatSessionState()
        state.text_buffer = ""
        state.follow_up_text = ""
        state.tool_call_events = []
        state.stage_timings = {}

        self.runtime.rag_sources = None
        self.runtime.skill_name = ""

        with patch("app.services.chat.phases.p4_persist.persist_assistant_message") as mock_persist, \
             patch("app.services.chat.phases.p4_persist.persist_generated_artifacts") as mock_artifacts:
            mock_persist.return_value = (False, 42)
            mock_artifacts.return_value = []

            events = []
            async for event in run_p4_persist(self.runtime, self.req, self.bind, state):
                events.append(event)

        self.assertIn("AI 服务暂时未能生成回复", state.full_text)

    async def test_p4_artifact_contract_failure_does_not_persist_fake_delivery(self):
        """P4 marks contract failure when a required artifact was not produced."""
        state = ChatSessionState()
        state.text_buffer = "这里是一大段表格内容，但没有真实生成 Excel。"
        state.follow_up_text = ""
        state.tool_call_events = []
        state.stage_timings = {}

        self.runtime.rag_sources = None
        self.runtime.skill_name = ""
        self.runtime.artifact_contract = ArtifactContract(
            delivery_required=True,
            output_kind="xlsx",
            title="部门访谈问卷",
            allowed_tools=("write_project_office_document",),
            confidence=0.86,
            reason="test",
            source="llm_router",
        )

        with patch("app.services.chat.phases.p4_persist.persist_assistant_message") as mock_persist, \
             patch("app.services.chat.phases.p4_persist.persist_generated_artifacts") as mock_artifacts:
            mock_persist.return_value = (False, 42)
            mock_artifacts.return_value = []

            events = []
            async for event in run_p4_persist(self.runtime, self.req, self.bind, state):
                events.append(event)

        self.assertIn("没有成功生成 XLSX 文件", state.full_text)
        persisted_metadata = mock_persist.call_args.args[4]
        self.assertTrue(persisted_metadata["delivery_failed"])
        self.assertEqual(persisted_metadata["artifact_contract"]["output_kind"], "xlsx")
        self.assertTrue(any(item["type"] == "artifact_delivery_failed" for item in state.trace_events))

    async def test_p4_artifact_contract_satisfied_by_artifact(self):
        """P4 treats a persisted artifact as satisfying the contract."""
        state = ChatSessionState()
        state.text_buffer = "Excel 已生成。"
        state.artifacts = [{"name": "部门访谈问卷.xlsx", "file_type": "xlsx"}]
        state.stage_timings = {}

        self.runtime.rag_sources = None
        self.runtime.skill_name = ""
        self.runtime.artifact_contract = ArtifactContract(
            delivery_required=True,
            output_kind="xlsx",
            title="部门访谈问卷",
            allowed_tools=("write_project_office_document",),
            confidence=0.86,
            reason="test",
            source="llm_router",
        )

        with patch("app.services.chat.phases.p4_persist.persist_assistant_message") as mock_persist, \
             patch("app.services.chat.phases.p4_persist.persist_generated_artifacts") as mock_artifacts:
            mock_persist.return_value = (False, 42)
            mock_artifacts.return_value = state.artifacts

            async for _ in run_p4_persist(self.runtime, self.req, self.bind, state):
                pass

        self.assertNotIn("没有成功生成", state.full_text)
        persisted_metadata = mock_persist.call_args.args[4]
        self.assertNotIn("delivery_failed", persisted_metadata)

    # ------------------------------------------------------------------
    # P0 — Durable task early-return
    # ------------------------------------------------------------------
    async def test_p0_no_task_route_skips(self):
        """P0 returns early when no durable task route is found."""
        self.req.project_id = 1

        async def fake_router(*args, **kwargs):
            return SimpleNamespace(
                chat_mode=self.runtime.chat_mode,
                action_policy=self.runtime.action_policy,
                task_route=None,
                confidence=0.72,
                reason="test:no_task",
                method="test",
            )

        with patch("app.services.chat.phases.p0_durable_task.classify_chat_intent_async", side_effect=fake_router):
            events = []
            async for event in run_p0_durable_task(self.runtime, self.req, self.bind, ChatSessionState()):
                events.append(event)

        self.assertEqual(events, [])

    async def test_p0_no_project_id_skips(self):
        """P0 skips when project_id is None."""
        self.req.project_id = None
        state = ChatSessionState()

        events = []
        async for event in run_p0_durable_task(self.runtime, self.req, self.bind, state):
            events.append(event)

        self.assertEqual(events, [])
        self.assertFalse(state.durable_task_completed)

    async def test_p0_flags_high_cost_ppt_for_confirmation(self):
        route = SimpleNamespace(task_type="generate_client_ppt", output_kind="pptx")
        self.req.content = "请生成一个全面详细的客户沟通 PPT，至少 10 页。"
        self.runtime.action_policy = "durable_task"

        reason = _task_confirmation_reason(self.runtime, self.req, route)

        self.assertIn("确认", reason)

    async def test_p0_flags_high_cost_excel_for_confirmation(self):
        route = SimpleNamespace(task_type="generate_project_excel", output_kind="xlsx")
        self.req.content = "请生成一个全面丰富的全部门访谈问卷 Excel。"
        self.runtime.action_policy = "durable_task"

        reason = _task_confirmation_reason(self.runtime, self.req, route)

        self.assertIn("Excel", reason)

    # ------------------------------------------------------------------
    # End-to-end: P1 → P4 without tools
    # ------------------------------------------------------------------
    async def test_e2e_no_tools(self):
        """Full flow: P1 streams text, P2 skipped, P3 skipped, P4 persists."""
        state = ChatSessionState()
        self.runtime.llm.stream_response = _make_stream(["Hello world"])

        # P1
        async for _ in run_p1_planning(self.runtime, self.req, state):
            pass
        self.assertEqual(state.text_buffer, "Hello world")
        self.assertEqual(state.tool_use_blocks, [])

        # P2 skipped (no tools)
        self.assertEqual(state.tool_use_blocks, [])

        # P3 skipped (no tools)
        self.assertEqual(state.tool_result_blocks, [])

        # P4
        self.runtime.rag_sources = None
        self.runtime.skill_name = ""
        with patch("app.services.chat.phases.p4_persist.persist_assistant_message") as mock_persist, \
             patch("app.services.chat.phases.p4_persist.persist_generated_artifacts") as mock_artifacts:
            mock_persist.return_value = (False, 42)
            mock_artifacts.return_value = []

            events = []
            async for event in run_p4_persist(self.runtime, self.req, self.bind, state):
                events.append(event)

            self.assertEqual(state.full_text, "Hello world")
            done_events = [e for e in events if '"type": "done"' in e]
            self.assertEqual(len(done_events), 1)

    # ------------------------------------------------------------------
    # End-to-end: P1 → P2 → P3 with tool
    # ------------------------------------------------------------------
    async def test_e2e_with_tool(self):
        """Full flow with tool: P1 plans, P2 executes, P3 follows up, P4 persists."""
        state = ChatSessionState()
        self.runtime.project_id = 1

        # P1: tool planned
        tool_block = json.dumps({"type": "tool_use", "name": "write_tool", "id": "t1", "input": {"file_name": "test.md"}})
        self.runtime.llm.stream_response = _make_stream([f"I will write: {tool_block}"])

        async for _ in run_p1_planning(self.runtime, self.req, state):
            pass

        self.assertEqual(len(state.tool_use_blocks), 1)

        # P2: execute tool
        with patch("app.services.chat.phases.p2_tools.registry.execute") as mock_exec:
            mock_exec.return_value = {"status": "completed", "output": {"file_name": "test.md"}}
            async for _ in run_p2_tools(self.runtime, self.req, state):
                pass

        self.assertEqual(len(state.tool_result_blocks), 1)

        # P3: follow-up
        self.runtime.llm.stream_response = _make_stream(["File written successfully."])
        async for _ in run_p3_followup(self.runtime, self.req, state):
            pass

        self.assertEqual(state.follow_up_text, "File written successfully.")

        # P4: persist
        self.runtime.rag_sources = None
        self.runtime.skill_name = ""
        with patch("app.services.chat.phases.p4_persist.persist_assistant_message") as mock_persist, \
             patch("app.services.chat.phases.p4_persist.persist_generated_artifacts") as mock_artifacts:
            mock_persist.return_value = (False, 42)
            mock_artifacts.return_value = []

            events = []
            async for event in run_p4_persist(self.runtime, self.req, self.bind, state):
                events.append(event)

            self.assertIn("File written successfully.", state.full_text)
            done_events = [e for e in events if '"type": "done"' in e]
            self.assertEqual(len(done_events), 1)

    async def test_p2_retries_artifact_tool_once(self):
        """P2 retries a required artifact tool once before reporting failure."""
        state = ChatSessionState()
        state.tool_use_blocks = [
            {
                "type": "tool_use",
                "name": WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
                "id": "tool-1",
                "input": {"file_type": "xlsx", "file_name": "访谈问卷.xlsx", "sheets": []},
            }
        ]
        self.runtime.project_id = 1
        self.runtime.action_policy = "durable_task"
        self.runtime.artifact_contract = ArtifactContract(
            delivery_required=True,
            output_kind="xlsx",
            allowed_tools=(WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,),
            confidence=0.9,
            reason="test",
            source="rule",
        )

        first_result = {"status": "error", "error": "temporary writer error"}
        with tempfile.TemporaryDirectory() as tmpdir:
            saved_file = Path(tmpdir) / "访谈问卷.xlsx"
            saved_file.write_bytes(b"fake xlsx bytes")
            second_result = {
                "status": "completed",
                "success": True,
                "output": {"file_name": "访谈问卷.xlsx", "file_type": "xlsx", "path": str(saved_file)},
            }

            with patch("app.services.chat.phases.p2_tools.registry.execute", new=AsyncMock(side_effect=[first_result, second_result])) as mock_exec:
                events = []
                async for event in run_p2_tools(self.runtime, self.req, state):
                    events.append(event)

        self.assertEqual(mock_exec.await_count, 2)
        self.assertTrue(any(item["type"] == "tool_retry" for item in state.trace_events))
        self.assertEqual(state.tool_call_events[-1]["status"], "completed")
        self.assertIn("正在自动重试一次", "".join(events))

    async def test_p2_requires_confirmation_for_modify_tool(self):
        """P2 blocks modify/delete tools until the caller provides confirmation."""
        state = ChatSessionState()
        state.tool_use_blocks = [
            {
                "type": "tool_use",
                "name": PROJECT_MARKDOWN_TOOL_NAME,
                "id": "tool-confirm",
                "input": {"mode": "append", "content": "## 会后行动清单"},
            }
        ]
        self.runtime.project_id = 1
        self.runtime.action_policy = "modify_existing_file"
        self.req.action_confirmations = []

        with patch("app.services.chat.phases.p2_tools.registry.execute", new=AsyncMock()) as mock_exec:
            events = []
            async for event in run_p2_tools(self.runtime, self.req, state):
                events.append(event)

        mock_exec.assert_not_awaited()
        self.assertTrue(state.confirmation_requested)
        self.assertEqual(state.tool_call_events[-1]["status"], "confirmation_required")
        self.assertEqual(state.trace_events[-1]["type"], "tool_confirmation_required")
        confirmation_token = state.trace_events[-1]["confirmation_token"]
        self.assertTrue(confirmation_token.startswith(f"tool:{PROJECT_MARKDOWN_TOOL_NAME}:append:"))
        self.assertIn("等待确认", "".join(events))

    async def test_p2_confirmation_token_is_bound_to_tool_input(self):
        """A confirmation token only authorizes the exact tool input it was created for."""
        stale_input = {"mode": "append", "content": "## 旧内容", "project_id": 1}
        current_input = {"mode": "append", "content": "## 新内容"}
        state = ChatSessionState()
        state.tool_use_blocks = [
            {
                "type": "tool_use",
                "name": PROJECT_MARKDOWN_TOOL_NAME,
                "id": "tool-confirm-stale",
                "input": current_input,
            }
        ]
        self.runtime.project_id = 1
        self.runtime.action_policy = "modify_existing_file"
        self.req.action_confirmations = [_tool_confirmation_token(PROJECT_MARKDOWN_TOOL_NAME, stale_input)]

        with patch("app.services.chat.phases.p2_tools.registry.execute", new=AsyncMock()) as mock_exec:
            async for _ in run_p2_tools(self.runtime, self.req, state):
                pass

        mock_exec.assert_not_awaited()
        self.assertTrue(state.confirmation_requested)
        self.assertEqual(state.tool_call_events[-1]["status"], "confirmation_required")

    async def test_p2_confirmation_token_does_not_bypass_hitas(self):
        """Legacy confirmation tokens no longer execute tools through the chat stream."""
        tool_input = {"mode": "append", "content": "## 会后行动清单"}
        confirmed_input = {**tool_input, "project_id": 1}
        state = ChatSessionState()
        state.tool_use_blocks = [
            {
                "type": "tool_use",
                "name": PROJECT_MARKDOWN_TOOL_NAME,
                "id": "tool-confirm-exact",
                "input": tool_input,
            }
        ]
        self.runtime.project_id = 1
        self.runtime.action_policy = "modify_existing_file"
        self.req.action_confirmations = [_tool_confirmation_token(PROJECT_MARKDOWN_TOOL_NAME, confirmed_input)]

        with patch("app.services.chat.phases.p2_tools.registry.execute", new=AsyncMock(return_value={"status": "completed", "success": True})) as mock_exec:
            async for _ in run_p2_tools(self.runtime, self.req, state):
                pass

        mock_exec.assert_not_awaited()
        self.assertTrue(state.confirmation_requested)
        self.assertEqual(state.tool_call_events[-1]["status"], "confirmation_required")

    async def test_p2_requires_confirmation_for_project_file_delete_tool(self):
        """Project-space file deletion must pause for explicit confirmation."""
        state = ChatSessionState()
        state.tool_use_blocks = [
            {
                "type": "tool_use",
                "name": MANAGE_PROJECT_FILES_TOOL_NAME,
                "id": "tool-delete-files",
                "input": {"action": "delete", "file_ids": [12, 13], "reason": "疑似重复生成物"},
            }
        ]
        self.runtime.project_id = 1
        self.runtime.action_policy = "destructive_action"
        self.req.action_confirmations = []

        with patch("app.services.chat.phases.p2_tools.registry.execute", new=AsyncMock()) as mock_exec:
            async for _ in run_p2_tools(self.runtime, self.req, state):
                pass

        mock_exec.assert_not_awaited()
        self.assertTrue(state.confirmation_requested)
        self.assertEqual(state.tool_call_events[-1]["status"], "confirmation_required")
        self.assertTrue(state.tool_call_events[-1]["confirmation_token"].startswith(f"tool:{MANAGE_PROJECT_FILES_TOOL_NAME}:delete:"))
        self.assertIn("待删除文件 ID：12, 13", state.tool_call_events[-1]["details"])

    async def test_p2_adds_project_id_to_folder_management_tool(self):
        """Folder management calls should receive project_id before execution."""
        state = ChatSessionState()
        state.tool_use_blocks = [
            {
                "type": "tool_use",
                "name": MANAGE_PROJECT_FOLDERS_TOOL_NAME,
                "id": "tool-list-folders",
                "input": {"action": "list"},
            }
        ]
        self.runtime.project_id = 27
        self.runtime.action_policy = "read_only_tool"
        self.req.action_confirmations = []

        with patch("app.services.chat.phases.p2_tools.registry.execute", new=AsyncMock(return_value={"status": "completed", "output": {"folders": []}})) as mock_exec:
            async for _ in run_p2_tools(self.runtime, self.req, state):
                pass

        mock_exec.assert_awaited_once()
        self.assertEqual(mock_exec.await_args.args[1]["project_id"], 27)

    async def test_p2_blocked_folder_move_reports_not_executed(self):
        """A read-only turn cannot move files, and the tool result must be a failure."""
        state = ChatSessionState()
        state.tool_use_blocks = [
            {
                "type": "tool_use",
                "name": MANAGE_PROJECT_FOLDERS_TOOL_NAME,
                "id": "tool-move-file",
                "input": {"action": "move_file", "file_id": 131, "folder_id": 5},
            }
        ]
        self.runtime.project_id = 27
        self.runtime.action_policy = "read_only_tool"
        self.req.action_confirmations = []

        with patch("app.services.chat.phases.p2_tools.registry.execute", new=AsyncMock()) as mock_exec:
            events = []
            async for event in run_p2_tools(self.runtime, self.req, state):
                events.append(event)

        mock_exec.assert_not_awaited()
        self.assertEqual(state.tool_call_events[-1]["status"], "blocked")
        blocked_payload = json.loads(state.tool_result_blocks[-1]["content"])
        self.assertFalse(blocked_payload["success"])
        self.assertTrue(blocked_payload["not_executed"])
        self.assertEqual(blocked_payload["status"], "blocked")
        self.assertIn('"success": false', "".join(events))

    async def test_p2_requires_confirmation_for_project_file_move_tool(self):
        """Project-space file moves pause with concrete confirmation details."""
        state = ChatSessionState()
        state.tool_use_blocks = [
            {
                "type": "tool_use",
                "name": MANAGE_PROJECT_FOLDERS_TOOL_NAME,
                "id": "tool-move-file",
                "input": {"action": "move_file", "file_id": 131, "folder_name": "项目交付文档"},
            }
        ]
        self.runtime.project_id = 27
        self.runtime.action_policy = "modify_existing_file"
        self.req.action_confirmations = []

        with patch("app.services.chat.phases.p2_tools.registry.execute", new=AsyncMock()) as mock_exec:
            async for _ in run_p2_tools(self.runtime, self.req, state):
                pass

        mock_exec.assert_not_awaited()
        self.assertTrue(state.confirmation_requested)
        self.assertEqual(state.tool_call_events[-1]["status"], "confirmation_required")
        self.assertIn("待移动文件：131", state.tool_call_events[-1]["details"])
        self.assertIn("目标文件夹：项目交付文档", state.tool_call_events[-1]["details"])
        self.assertEqual(state.pending_tool_actions[-1]["action_type"], "move_project_file")

    async def test_p2_does_not_require_confirmation_for_read_tool_in_modify_turn(self):
        """A modify-capable turn may still use read-only tools without confirmation."""
        state = ChatSessionState()
        state.tool_use_blocks = [
            {
                "type": "tool_use",
                "name": READ_MARKDOWN_TOOL_NAME,
                "id": "tool-read",
                "input": {"action": "list"},
            }
        ]
        self.runtime.project_id = 1
        self.runtime.action_policy = "modify_existing_file"
        self.req.action_confirmations = []

        with patch("app.services.chat.phases.p2_tools.registry.execute", new=AsyncMock(return_value={"status": "completed", "output": {"files": []}})) as mock_exec:
            async for _ in run_p2_tools(self.runtime, self.req, state):
                pass

        mock_exec.assert_awaited_once()
        self.assertEqual(state.tool_call_events[-1]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
