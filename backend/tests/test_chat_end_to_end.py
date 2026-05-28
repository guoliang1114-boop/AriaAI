"""End-to-end safety-net tests for the chat streaming orchestrator.

These tests exercise ``app.services.chat.stream_chat_events`` as a black box.
They mock only the two boundary dependencies:

  1. ``runtime.llm.stream_response`` — the LLM provider stream
  2. ``app.tools.registry.execute`` — tool invocation

Everything else (phase orchestration, state machinery, DB persistence,
SSE event shape) runs for real against the test PostgreSQL database.

These tests are the contract the refactor (5-phase pipeline → agent loop)
must preserve. They MUST pass before any production code is changed AND
continue passing after the cutover.
"""
from __future__ import annotations

import asyncio
import json
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from typing import Any, AsyncIterator, Iterable
from unittest.mock import AsyncMock, patch

from sqlmodel import Session, SQLModel, select

from app.models.db import (
    Conversation,
    Message,
    PendingToolAction,
    Project,
)
from app.services.chat import stream_chat_events
from app.services.chat_tools import ChatRuntime
from tests.test_database import create_test_engine, drop_all_tables


# ----------------------------------------------------------------------
# Test helpers
# ----------------------------------------------------------------------


def _make_stream(chunks: list[str] | list[list[str]]):
    """Factory for ``stream_response`` mocks.

    If a flat list of strings is given, every call yields the same chunks.
    If a list-of-lists is given, each invocation yields the next sublist
    (raises StopIteration if exhausted — useful to detect over-calling).
    """

    if chunks and isinstance(chunks[0], list):
        iterations = iter(chunks)  # type: ignore[arg-type]

        async def _stream(*_args: Any, **_kwargs: Any) -> AsyncIterator[str]:
            try:
                this_call = next(iterations)
            except StopIteration as exc:  # pragma: no cover - defensive
                raise AssertionError("LLM stream invoked more times than scripted") from exc
            for chunk in this_call:
                yield chunk

        return _stream

    flat: list[str] = list(chunks)  # type: ignore[assignment]

    async def _stream(*_args: Any, **_kwargs: Any) -> AsyncIterator[str]:
        for chunk in flat:
            yield chunk

    return _stream


def _parse_sse_events(raw_events: Iterable[str]) -> list[dict]:
    """Parse a list of ``data: {...}\\n\\n`` SSE frames into dicts."""
    parsed: list[dict] = []
    for raw in raw_events:
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        payload = line[len("data:") :].strip()
        if not payload:
            continue
        parsed.append(json.loads(payload))
    return parsed


def _event_types(events: list[dict]) -> list[str]:
    return [str(e.get("type", "")) for e in events]


def _events_of_type(events: list[dict], type_name: str) -> list[dict]:
    return [e for e in events if e.get("type") == type_name]


def _concat_text(events: list[dict]) -> str:
    return "".join(str(e.get("content", "")) for e in _events_of_type(events, "text"))


# ----------------------------------------------------------------------
# Base test case
# ----------------------------------------------------------------------


class ChatEndToEndBase(unittest.IsolatedAsyncioTestCase):
    """Shared scaffolding: real test DB, mock runtime, mock tool registry."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_test_engine()

    @classmethod
    def tearDownClass(cls) -> None:
        drop_all_tables(cls.engine)
        cls.engine.dispose()

    async def asyncSetUp(self) -> None:
        # Full schema reset per test — slower but bulletproof against the FK
        # graph (ChatTrace → Message → Conversation, PendingToolAction →
        # Conversation, etc.) that the production code touches.
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        # Always-present conversation for the tests to target.
        with Session(self.engine) as session:
            conv = Conversation(title="Safety Net")
            session.add(conv)
            session.commit()
            session.refresh(conv)
            self.conv_id = conv.id

        # Patches active for every test — keep persistence + background work
        # local to the assertions we care about.
        self._stack = ExitStack()
        # Title scheduling launches a background asyncio task; turn it into
        # a no-op so we do not leak tasks across tests.
        self._stack.enter_context(
            patch(
                "app.services.chat.persist.schedule_title_generation",
                new=lambda *a, **kw: None,
            )
        )

        # By default no tool runs. Each test overrides this via
        # ``self.set_tool_executor(handler)`` when it needs tool behavior.
        self._tool_handler = AsyncMock(
            side_effect=lambda *a, **kw: (_ for _ in ()).throw(
                AssertionError(f"Unexpected tool call: args={a} kwargs={kw}")
            )
        )

        self._registry_patch = self._stack.enter_context(
            patch("app.tools.registry.execute", new=self._tool_dispatch)
        )

        # Build the mock runtime. Real ChatRuntime so __post_init__ and
        # attribute access work like production code.
        async def _noop_complete(*_a: Any, **_kw: Any) -> str:
            return ""

        self.runtime = ChatRuntime(
            conv_id=self.conv_id,
            selected_model="test-model",
            llm=SimpleNamespace(
                stream_response=_make_stream([""]),
                complete=_noop_complete,
            ),
            system="You are a helpful assistant.",
            api_messages=[{"role": "user", "content": "hello"}],
            rag_sources=[],
            tools=None,
            max_tokens=2000,
            temperature=0.3,
            project_id=None,
            skill_name="",
            prepare_metrics={},
            chat_mode="standalone_qa",
            action_policy="write_artifact",
            tool_access_policy="write_allowed",
            intent_prepared_async=True,
        )

        self.req = SimpleNamespace(
            conversation_id=self.conv_id,
            project_id=None,
            content="hello",
            action_confirmations=[],
            # Mirror the production SendMessageRequest shape so persist paths
            # that read optional fields (skill_id, force_skill, etc.) do not
            # AttributeError on the mock.
            skill_id=None,
            force_skill=False,
        )

    async def asyncTearDown(self) -> None:
        self._stack.close()

    # ----- dispatch helpers --------------------------------------------------

    async def _tool_dispatch(self, name: str, tool_input: dict) -> dict:
        """Route to whatever handler the current test has registered."""
        return await self._tool_handler(name, tool_input)

    def set_llm_stream(self, chunks: list[str] | list[list[str]]) -> None:
        self.runtime.llm.stream_response = _make_stream(chunks)

    def set_tool_handler(self, handler) -> None:
        """Install a tool dispatcher: ``async def handler(name, input) -> dict``."""
        self._tool_handler = handler

    async def drain(self) -> list[dict]:
        """Run the orchestrator and return parsed SSE events."""
        raw_events: list[str] = []
        async for raw in stream_chat_events(self.runtime, self.req, self.engine):
            raw_events.append(raw)
        return _parse_sse_events(raw_events)

    def assistant_messages(self) -> list[Message]:
        with Session(self.engine) as session:
            return list(
                session.exec(
                    select(Message).where(Message.conversation_id == self.conv_id).order_by(Message.id)
                ).all()
            )


# ----------------------------------------------------------------------
# Scenario 1: text-only response
# ----------------------------------------------------------------------


class TextOnlyResponseTests(ChatEndToEndBase):
    """The simplest path: model returns plain text, no tools, no truncation."""

    async def test_streams_text_and_persists_assistant_message(self) -> None:
        self.set_llm_stream(["Hello ", "world", "!"])

        events = await self.drain()

        # 1) opener events
        self.assertEqual(events[0]["type"], "conversation_id")
        self.assertEqual(events[0]["id"], self.conv_id)

        # 2) the user-visible text reaches the stream verbatim
        self.assertEqual(_concat_text(events), "Hello world!")

        # 3) terminal event is "done" with the full text as metadata
        done = _events_of_type(events, "done")
        self.assertEqual(len(done), 1)

        # 4) the assistant message lands in the DB
        msgs = self.assistant_messages()
        assistant = [m for m in msgs if m.role == "assistant"]
        self.assertEqual(len(assistant), 1)
        self.assertEqual(assistant[0].content, "Hello world!")

    async def test_no_tool_events_emitted_when_no_tool_use(self) -> None:
        self.set_llm_stream(["Just chatting."])

        events = await self.drain()

        for forbidden in ("tool_executing", "tool_result", "tool_planned"):
            self.assertEqual(
                _events_of_type(events, forbidden),
                [],
                f"Did not expect any {forbidden!r} event for a text-only turn",
            )


# ----------------------------------------------------------------------
# Scenario 2: single tool call → result → follow-up text
# ----------------------------------------------------------------------


class SingleToolCallTests(ChatEndToEndBase):
    """Model emits one tool_use, tool runs, model produces final text."""

    async def test_executes_tool_then_streams_final_text(self) -> None:
        tool_block = json.dumps(
            {
                "type": "tool_use",
                "id": "tu_1",
                "name": "read_project_markdown_document",
                "input": {"action": "list"},
            }
        )
        # First LLM call → emit tool_use; second call (P3 follow-up) → final text
        self.set_llm_stream(
            [
                [f"Let me check the files. {tool_block}"],
                ["Here is the summary."],
            ]
        )

        tool_handler = AsyncMock(
            return_value={
                "type": "tool_result",
                "tool_name": "read_project_markdown_document",
                "tool_use_id": "tu_1",
                "status": "success",
                "output": {"files": []},
            }
        )
        self.set_tool_handler(tool_handler)

        events = await self.drain()

        # Tool ran exactly once with the expected name
        self.assertEqual(tool_handler.call_count, 1)
        args, _ = tool_handler.call_args
        self.assertEqual(args[0], "read_project_markdown_document")

        # SSE: there should be a tool_executing AND a tool_result event
        self.assertGreaterEqual(len(_events_of_type(events, "tool_executing")), 1)
        self.assertGreaterEqual(len(_events_of_type(events, "tool_result")), 1)

        # Final text contains the follow-up content
        self.assertIn("Here is the summary.", _concat_text(events))

        # Done event present
        self.assertEqual(len(_events_of_type(events, "done")), 1)

        # Assistant message persisted with both portions
        assistant = [m for m in self.assistant_messages() if m.role == "assistant"]
        self.assertEqual(len(assistant), 1)
        full_text = assistant[0].content
        self.assertIn("Let me check the files.", full_text)
        self.assertIn("Here is the summary.", full_text)


# ----------------------------------------------------------------------
# Scenario 3: HITAS — destructive tool requires confirmation
# ----------------------------------------------------------------------


class DestructiveConfirmationTests(ChatEndToEndBase):
    """Destructive tool must NOT execute; must persist a PendingToolAction."""

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        # Create a real Project so manage_project_files has a valid target.
        with Session(self.engine) as session:
            project = Project(name="P", client="C", description="d")
            session.add(project)
            session.commit()
            session.refresh(project)
            self.project_id = project.id
        # Re-create the conversation linked to this project so policy gating
        # treats it as a project conversation.
        with Session(self.engine) as session:
            conv = session.get(Conversation, self.conv_id)
            assert conv is not None
            conv.project_id = self.project_id
            session.add(conv)
            session.commit()
        self.runtime.project_id = self.project_id
        self.runtime.chat_mode = "project_deep_dive"
        self.runtime.action_policy = "destructive_action"
        self.runtime.tool_access_policy = "write_allowed"
        self.req.project_id = self.project_id

    async def test_destructive_tool_creates_pending_action_and_skips_execution(self) -> None:
        tool_block = json.dumps(
            {
                "type": "tool_use",
                "id": "tu_delete",
                "name": "manage_project_files",
                "input": {
                    "action": "delete",
                    "project_id": self.project_id,
                    "file_ids": [1],
                },
            }
        )
        self.set_llm_stream([[f"I will remove that file. {tool_block}"]])

        # If the tool actually runs, the default handler raises — that's the assertion.
        events = await self.drain()

        # Done event present
        self.assertEqual(len(_events_of_type(events, "done")), 1)

        # A PendingToolAction row exists for this conversation
        with Session(self.engine) as session:
            actions = session.exec(
                select(PendingToolAction).where(PendingToolAction.conversation_id == self.conv_id)
            ).all()
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].tool_name, "manage_project_files")
        self.assertEqual(actions[0].status, "pending")


# ----------------------------------------------------------------------
# Scenario 4: tool returns error → no artifact, error surfaced in text
# ----------------------------------------------------------------------


class ToolErrorTests(ChatEndToEndBase):
    """Tool execution fails; loop reports the error and finishes the turn."""

    async def test_tool_error_surfaces_in_final_message(self) -> None:
        tool_block = json.dumps(
            {
                "type": "tool_use",
                "id": "tu_err",
                "name": "read_project_markdown_document",
                "input": {"action": "list"},
            }
        )
        self.set_llm_stream(
            [
                [f"Reading files. {tool_block}"],
                ["I could not read the files."],
            ]
        )

        async def _failing_tool(name: str, tool_input: dict) -> dict:
            return {
                "type": "tool_result",
                "tool_name": name,
                "tool_use_id": "tu_err",
                "status": "error",
                "error": "permission denied",
            }

        self.set_tool_handler(AsyncMock(side_effect=_failing_tool))

        events = await self.drain()

        # tool_result event still emitted (with error status)
        results = _events_of_type(events, "tool_result")
        self.assertGreaterEqual(len(results), 1)

        # Done present, follow-up text reaches the user
        self.assertEqual(len(_events_of_type(events, "done")), 1)
        self.assertIn("could not read", _concat_text(events))


# ----------------------------------------------------------------------
# Scenario 5: truncation triggers auto-continue
# ----------------------------------------------------------------------


class TruncationTests(ChatEndToEndBase):
    """Output truncation marker triggers one automatic continuation."""

    async def test_single_truncation_auto_continues(self) -> None:
        self.set_llm_stream(
            [
                ["First half ", "[OUTPUT_TRUNCATED]"],
                ["second half."],
            ]
        )

        events = await self.drain()

        self.assertIn("First half", _concat_text(events))
        self.assertIn("second half.", _concat_text(events))
        # We do NOT expect a `truncated:can_continue` event because the
        # continuation succeeded.
        truncated_events = [
            e for e in _events_of_type(events, "truncated") if e.get("can_continue") is True
        ]
        self.assertEqual(truncated_events, [])
        self.assertEqual(len(_events_of_type(events, "done")), 1)

    async def test_double_truncation_emits_can_continue(self) -> None:
        self.set_llm_stream(
            [
                ["Part 1 ", "[OUTPUT_TRUNCATED]"],
                ["Part 2 ", "[OUTPUT_TRUNCATED]"],
            ]
        )

        events = await self.drain()

        truncated_events = _events_of_type(events, "truncated")
        self.assertEqual(len(truncated_events), 1)
        self.assertTrue(truncated_events[0].get("can_continue"))
        self.assertEqual(len(_events_of_type(events, "done")), 1)


# ----------------------------------------------------------------------
# Scenario 6: Skill execution (§5.1 of docs/13 — defensive net)
# ----------------------------------------------------------------------


class SkillExecutionTests(ChatEndToEndBase):
    """When ``runtime.skill_name`` is set, a turn that calls a skill tool must:

    1. Route the call to the skill tool (here: ``generate_ppt_from_skill``).
    2. Stream the standard tool_executing / tool_result events.
    3. Persist an assistant message whose metadata carries the canonical 5-step
       ``skill_progress`` (built by ``_build_completed_skill_progress``).
    """

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        # Mark this run as Skill-driven so persist.py populates skill_progress.
        self.runtime.skill_name = "digital-strategy"

    async def test_skill_turn_persists_skill_progress_and_invokes_skill_tool(self) -> None:
        tool_block = json.dumps(
            {
                "type": "tool_use",
                "id": "tu_skill_1",
                "name": "generate_ppt_from_skill",
                "input": {
                    "skill_name": "digital-strategy",
                    "title": "Demo Deck",
                    "slides": [
                        {"type": "content", "title": "Slide A", "content": "- bullet"}
                    ],
                },
            }
        )
        # Model emits the skill tool call, then narrates a short closing message.
        self.set_llm_stream(
            [
                [f"Generating the deck now. {tool_block}"],
                ["Done — the deck is saved."],
            ]
        )

        tool_handler = AsyncMock(
            return_value={
                "type": "tool_result",
                "tool_name": "generate_ppt_from_skill",
                "tool_use_id": "tu_skill_1",
                "status": "success",
                "output": {
                    "success": True,
                    "file_name": "demo_deck.pptx",
                    "file_type": "pptx",
                    "message": "Created demo_deck.pptx",
                },
            }
        )
        self.set_tool_handler(tool_handler)

        events = await self.drain()

        # 1. Skill tool was invoked.
        self.assertEqual(tool_handler.call_count, 1)
        args, _ = tool_handler.call_args
        self.assertEqual(args[0], "generate_ppt_from_skill")
        self.assertEqual(args[1].get("skill_name"), "digital-strategy")

        # 2. Standard tool events fired.
        self.assertGreaterEqual(len(_events_of_type(events, "tool_executing")), 1)
        self.assertGreaterEqual(len(_events_of_type(events, "tool_result")), 1)
        self.assertEqual(len(_events_of_type(events, "done")), 1)

        # 3. Persisted assistant message carries the 5-step skill_progress.
        assistant = [m for m in self.assistant_messages() if m.role == "assistant"]
        self.assertEqual(len(assistant), 1)
        metadata = json.loads(assistant[0].metadata_json or "{}")
        progress = metadata.get("skill_progress")
        self.assertIsInstance(progress, list, "skill_progress should be a list when skill_name is set")
        keys = [step.get("key") for step in progress]
        self.assertEqual(
            keys,
            ["prepare", "thinking", "tools", "final", "saving"],
            f"skill_progress keys do not match canonical 5-step shape: {keys}",
        )
        tools_step = next(step for step in progress if step["key"] == "tools")
        # The tools step should reflect that a real tool ran (not the "no tools"
        # placeholder used when the model answers without calling anything).
        self.assertTrue(
            any("generate_ppt_from_skill" in line or "完成" in line for line in tools_step.get("logs", [])),
            f"tools step did not record the real tool execution: {tools_step.get('logs')}",
        )

    async def test_non_skill_turn_does_not_emit_skill_progress(self) -> None:
        """Regression: ``skill_progress`` must only fire when a skill is active."""
        self.runtime.skill_name = ""  # override base override
        self.set_llm_stream([["Just a plain answer."]])

        await self.drain()

        assistant = [m for m in self.assistant_messages() if m.role == "assistant"]
        self.assertEqual(len(assistant), 1)
        metadata = json.loads(assistant[0].metadata_json or "{}")
        self.assertNotIn("skill_progress", metadata)


# ----------------------------------------------------------------------
# Scenario 7: Product Run Event v1 boundary events (docs/13 §4.1 A1 wave 2)
# ----------------------------------------------------------------------


class ProductRunEventV1BoundaryTests(ChatEndToEndBase):
    """The orchestrator must emit the v1 boundary events alongside legacy ones.

    These are additive — old frontends ignore them, but a v1-aware frontend can
    use them to track run lifecycle without parsing legacy event shapes.
    """

    async def test_happy_path_emits_run_started_message_persisted_run_done(self) -> None:
        self.set_llm_stream([["Hello"]])

        events = await self.drain()

        starts = _events_of_type(events, "run_started")
        dones = _events_of_type(events, "run_done")
        persisted = _events_of_type(events, "message_persisted")

        self.assertEqual(len(starts), 1, "should emit exactly one run_started")
        self.assertEqual(len(dones), 1, "should emit exactly one run_done")
        self.assertEqual(len(persisted), 1, "should emit message_persisted before legacy done")

        run_id = starts[0]["run_id"]
        self.assertTrue(run_id.startswith("run_"))
        self.assertEqual(dones[0]["run_id"], run_id, "run_done must reuse the run_started run_id")
        self.assertEqual(dones[0]["final_status"], "completed")
        self.assertEqual(persisted[0]["run_id"], run_id)
        # message_persisted must come before the legacy done so v1 consumers can
        # swap the streaming bubble for the persisted message at the right beat.
        idx_persisted = events.index(persisted[0])
        legacy_done = _events_of_type(events, "done")[0]
        self.assertLess(idx_persisted, events.index(legacy_done))

    async def test_run_started_carries_skill_identity_when_set(self) -> None:
        self.runtime.skill_name = "digital-strategy"
        self.set_llm_stream([["ok"]])

        events = await self.drain()
        started = _events_of_type(events, "run_started")[0]
        self.assertEqual(started.get("skill", {}).get("name"), "digital-strategy")

    async def test_no_skill_means_no_skill_field_on_run_started(self) -> None:
        self.runtime.skill_name = ""
        self.set_llm_stream([["plain"]])

        events = await self.drain()
        started = _events_of_type(events, "run_started")[0]
        self.assertNotIn("skill", started)


# ----------------------------------------------------------------------
# Scenario 9: Product Run Event v1 contract goldens (docs/13 §7.2 / D.2)
# ----------------------------------------------------------------------
#
# These tests pin the SHAPE of the v1 events that flow from the orchestrator
# today. They protect against silent protocol drift when later waves extend the
# event types — a missing or renamed required field will break the contract
# test immediately, before frontend consumers (PR #9) get hit by it.


def _strip_volatile_run_event_fields(event: dict) -> dict:
    """Drop fields that legitimately change between runs (timestamps, run_id)
    so the assertion can equality-check against a stable golden snapshot."""
    cleaned = dict(event)
    for vol_key in ("run_id", "timestamp"):
        cleaned.pop(vol_key, None)
    return cleaned


class ProductRunEventV1ContractGoldens(ChatEndToEndBase):
    """Lock down the exact field shape of every v1 event the orchestrator emits
    today. New event types added by later A1 waves must add their own golden."""

    async def test_happy_text_only_run_started_shape(self) -> None:
        self.set_llm_stream([["hi"]])
        events = await self.drain()
        started = _events_of_type(events, "run_started")[0]
        # Plain text-only run: no skill, no display_mode (we don't set them yet).
        self.assertEqual(_strip_volatile_run_event_fields(started), {"type": "run_started"})
        # Volatile fields are nonetheless present and well-formed.
        self.assertTrue(started["run_id"].startswith("run_"))
        self.assertIsInstance(started["timestamp"], str)
        self.assertGreater(len(started["timestamp"]), 10)

    async def test_run_started_skill_block_shape(self) -> None:
        self.runtime.skill_name = "digital-strategy"
        self.set_llm_stream([["ok"]])
        events = await self.drain()
        started = _events_of_type(events, "run_started")[0]
        cleaned = _strip_volatile_run_event_fields(started)
        # Skill block has exactly {name}; no id is set unless runtime.skill_id is.
        self.assertEqual(cleaned, {"type": "run_started", "skill": {"name": "digital-strategy"}})

    async def test_message_persisted_shape(self) -> None:
        self.set_llm_stream([["hello"]])
        events = await self.drain()
        persisted = _events_of_type(events, "message_persisted")[0]
        cleaned = _strip_volatile_run_event_fields(persisted)
        # message_id is an int from the DB; assert the shape, not the value.
        self.assertEqual(set(cleaned.keys()), {"type", "message_id"})
        self.assertEqual(cleaned["type"], "message_persisted")
        self.assertIsInstance(cleaned["message_id"], int)

    async def test_run_done_completed_shape(self) -> None:
        self.set_llm_stream([["hello"]])
        events = await self.drain()
        done = _events_of_type(events, "run_done")[0]
        self.assertEqual(
            _strip_volatile_run_event_fields(done),
            {"type": "run_done", "final_status": "completed"},
        )

    async def test_run_failed_shape_on_llm_exception(self) -> None:
        async def boom(*_a, **_kw):
            raise RuntimeError("boom: model exploded")
            # unreachable but keeps this a valid async generator if not raised
            yield ""  # pragma: no cover

        self.runtime.llm.stream_response = boom

        events = await self.drain()
        failed = _events_of_type(events, "run_failed")
        self.assertEqual(len(failed), 1)
        cleaned = _strip_volatile_run_event_fields(failed[0])
        # Required + expected-optional fields; error_code is from the enum.
        self.assertEqual(cleaned["type"], "run_failed")
        self.assertEqual(cleaned["error_code"], "UNKNOWN")
        self.assertIsInstance(cleaned["error_message"], str)
        self.assertTrue(cleaned["error_message"])
        # retryable is set; fallback_content carries the full failure text.
        self.assertIn("retryable", cleaned)
        self.assertIn("fallback_content", cleaned)

    async def test_v1_event_order_is_stable(self) -> None:
        """The v1 boundary events must appear in this exact relative order:
        run_started → ... → message_persisted → run_done."""
        self.set_llm_stream([["hello"]])
        events = await self.drain()

        positions = {
            t: next((i for i, e in enumerate(events) if e.get("type") == t), -1)
            for t in ("run_started", "message_persisted", "run_done")
        }
        self.assertGreater(positions["run_started"], -1)
        self.assertGreater(positions["message_persisted"], positions["run_started"])
        self.assertGreater(positions["run_done"], positions["message_persisted"])
        # And legacy ``done`` is still emitted before ``run_done``.
        legacy_done = next((i for i, e in enumerate(events) if e.get("type") == "done"), -1)
        self.assertGreater(legacy_done, -1)
        self.assertLess(legacy_done, positions["run_done"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
