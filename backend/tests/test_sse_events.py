"""SSE event-type contract snapshots.

These tests pin down WHICH SSE event types are emitted (and in what relative
order) for representative chat scenarios.  Payload details belong in the
end-to-end behavior tests; this file is intentionally narrow.

If the refactor (5-phase pipeline → agent loop) changes the user-visible
event types or their relative order, these tests fail and force a deliberate
decision: update the snapshot or fix the regression.

These snapshots are derived against the current main and serve as the
contract the new implementation must continue to satisfy.
"""
from __future__ import annotations

import json
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from typing import Any, AsyncIterator, Iterable
from unittest.mock import AsyncMock, patch

from sqlmodel import Session, SQLModel, select

from app.models.db import Conversation, Message, PendingToolAction, Project
from app.services.chat import stream_chat_events
from app.services.chat_tools import ChatRuntime
from tests.test_database import create_test_engine, drop_all_tables


# ----------------------------------------------------------------------
# Local helpers (kept independent of test_chat_end_to_end so this file
# can be read in isolation).
# ----------------------------------------------------------------------


def _make_scripted_stream(scripts: list[list[str]]):
    iterator = iter(scripts)

    async def _stream(*_args: Any, **_kwargs: Any) -> AsyncIterator[str]:
        try:
            this = next(iterator)
        except StopIteration as exc:  # pragma: no cover
            raise AssertionError("LLM stream invoked more times than scripted") from exc
        for chunk in this:
            yield chunk

    return _stream


def _parse(raw_frames: Iterable[str]) -> list[dict]:
    out: list[dict] = []
    for raw in raw_frames:
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        payload = line[len("data:") :].strip()
        if payload:
            out.append(json.loads(payload))
    return out


def _types(events: list[dict]) -> list[str]:
    return [str(e.get("type", "")) for e in events]


def _unique_in_order(seq: list[str]) -> list[str]:
    """Compact a sequence so that consecutive duplicates collapse.

    The orchestrator legitimately emits long runs of repeated event types
    (e.g. many ``text`` events in a row). For the contract snapshot we only
    care about the topology of transitions.
    """
    out: list[str] = []
    for item in seq:
        if not out or out[-1] != item:
            out.append(item)
    return out


# ----------------------------------------------------------------------
# Scaffolding
# ----------------------------------------------------------------------


class SseEventContractBase(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_test_engine()

    @classmethod
    def tearDownClass(cls) -> None:
        drop_all_tables(cls.engine)
        cls.engine.dispose()

    async def asyncSetUp(self) -> None:
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            conv = Conversation(title="SSE contract")
            session.add(conv)
            session.commit()
            session.refresh(conv)
            self.conv_id = conv.id

        self._stack = ExitStack()
        self._stack.enter_context(
            patch(
                "app.services.chat.persist.schedule_title_generation",
                new=lambda *a, **kw: None,
            )
        )

        self._tool_handler = AsyncMock(
            side_effect=lambda *a, **kw: (_ for _ in ()).throw(
                AssertionError(f"Unexpected tool call: {a} {kw}")
            )
        )
        self._stack.enter_context(
            patch("app.tools.registry.execute", new=self._tool_dispatch)
        )

        async def _noop_complete(*_a: Any, **_kw: Any) -> str:
            return ""

        self.runtime = ChatRuntime(
            conv_id=self.conv_id,
            selected_model="test-model",
            llm=SimpleNamespace(
                stream_response=_make_scripted_stream([[""]]),
                complete=_noop_complete,
            ),
            system="system",
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
        )

    async def asyncTearDown(self) -> None:
        self._stack.close()

    async def _tool_dispatch(self, name: str, tool_input: dict) -> dict:
        return await self._tool_handler(name, tool_input)

    def set_llm_scripts(self, scripts: list[list[str]]) -> None:
        self.runtime.llm.stream_response = _make_scripted_stream(scripts)

    def set_tool_handler(self, handler) -> None:
        self._tool_handler = handler

    async def collect_event_types(self) -> list[str]:
        raw: list[str] = []
        async for frame in stream_chat_events(self.runtime, self.req, self.engine):
            raw.append(frame)
        return _types(_parse(raw))


# ----------------------------------------------------------------------
# Contract: text-only response
# ----------------------------------------------------------------------


class TextOnlySseContract(SseEventContractBase):
    async def test_event_topology(self) -> None:
        self.set_llm_scripts([["Hi ", "there."]])

        types = await self.collect_event_types()
        compact = _unique_in_order(types)

        # The transition graph must contain:
        #   conversation_id → ... → text → ... → done
        self.assertEqual(compact[0], "conversation_id")
        self.assertEqual(compact[-1], "run_done")
        # Legacy ``done`` is still emitted during v1 double-send and precedes ``run_done``.
        self.assertIn("done", compact, "legacy done must still be emitted alongside v1")
        self.assertLess(compact.index("done"), compact.index("run_done"))
        self.assertIn("text", compact)
        for forbidden in ("tool_executing", "tool_result", "tool_planned", "truncated"):
            self.assertNotIn(forbidden, compact, f"{forbidden!r} must not appear")


# ----------------------------------------------------------------------
# Contract: single tool call
# ----------------------------------------------------------------------


class SingleToolSseContract(SseEventContractBase):
    async def test_event_topology(self) -> None:
        tool_block = json.dumps(
            {
                "type": "tool_use",
                "id": "tu_1",
                "name": "read_project_markdown_document",
                "input": {"action": "list"},
            }
        )
        self.set_llm_scripts(
            [
                [f"checking. {tool_block}"],
                ["done."],
            ]
        )
        self.set_tool_handler(
            AsyncMock(
                return_value={
                    "type": "tool_result",
                    "tool_name": "read_project_markdown_document",
                    "tool_use_id": "tu_1",
                    "status": "success",
                    "output": {"files": []},
                }
            )
        )

        types = await self.collect_event_types()
        compact = _unique_in_order(types)

        # Required: conversation_id present, ends with done, both tool events appear
        self.assertEqual(compact[0], "conversation_id")
        self.assertEqual(compact[-1], "run_done")
        # Legacy ``done`` is still emitted during v1 double-send and precedes ``run_done``.
        self.assertIn("done", compact, "legacy done must still be emitted alongside v1")
        self.assertLess(compact.index("done"), compact.index("run_done"))
        self.assertIn("tool_executing", compact)
        self.assertIn("tool_result", compact)
        # tool_executing must precede tool_result
        self.assertLess(compact.index("tool_executing"), compact.index("tool_result"))


# ----------------------------------------------------------------------
# Contract: destructive confirmation
# ----------------------------------------------------------------------


class DestructiveConfirmationSseContract(SseEventContractBase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        with Session(self.engine) as session:
            project = Project(name="P", client="C", description="d")
            session.add(project)
            session.commit()
            session.refresh(project)
            self.project_id = project.id
            conv = session.get(Conversation, self.conv_id)
            assert conv is not None
            conv.project_id = self.project_id
            session.add(conv)
            session.commit()

        self.runtime.project_id = self.project_id
        self.runtime.chat_mode = "project_deep_dive"
        self.runtime.action_policy = "destructive_action"
        self.req.project_id = self.project_id

    async def test_event_topology(self) -> None:
        tool_block = json.dumps(
            {
                "type": "tool_use",
                "id": "tu_d",
                "name": "manage_project_files",
                "input": {
                    "action": "delete",
                    "project_id": self.project_id,
                    "file_ids": [1],
                },
            }
        )
        self.set_llm_scripts([[f"I will remove. {tool_block}"]])

        types = await self.collect_event_types()
        compact = _unique_in_order(types)

        # Conversation must still open and close cleanly
        self.assertEqual(compact[0], "conversation_id")
        self.assertEqual(compact[-1], "run_done")
        # Legacy ``done`` is still emitted during v1 double-send and precedes ``run_done``.
        self.assertIn("done", compact, "legacy done must still be emitted alongside v1")
        self.assertLess(compact.index("done"), compact.index("run_done"))
        # tool_result is the conventional surface for confirmation-required
        self.assertIn("tool_result", compact)


# ----------------------------------------------------------------------
# Contract: truncation auto-continue
# ----------------------------------------------------------------------


class TruncationSseContract(SseEventContractBase):
    async def test_single_truncation_no_can_continue_event(self) -> None:
        self.set_llm_scripts(
            [
                ["Part 1 ", "[OUTPUT_TRUNCATED]"],
                ["Part 2"],
            ]
        )

        types = await self.collect_event_types()
        compact = _unique_in_order(types)

        self.assertEqual(compact[0], "conversation_id")
        self.assertEqual(compact[-1], "run_done")
        # Legacy ``done`` is still emitted during v1 double-send and precedes ``run_done``.
        self.assertIn("done", compact, "legacy done must still be emitted alongside v1")
        self.assertLess(compact.index("done"), compact.index("run_done"))
        self.assertIn("text", compact)
        # Successfully continued — never a "truncated" event surfaced to UI
        self.assertNotIn("truncated", compact)

    async def test_double_truncation_emits_truncated_event(self) -> None:
        self.set_llm_scripts(
            [
                ["A ", "[OUTPUT_TRUNCATED]"],
                ["B ", "[OUTPUT_TRUNCATED]"],
            ]
        )

        types = await self.collect_event_types()
        compact = _unique_in_order(types)

        self.assertEqual(compact[0], "conversation_id")
        # A second truncation leaves the requested output incomplete. The
        # legacy stream still closes with ``done``, while the canonical product
        # run truthfully records an incomplete terminal state as ``run_failed``
        # (OUTPUT_TRUNCATED) so clients can offer recovery instead of claiming
        # success.
        self.assertEqual(compact[-1], "run_failed")
        self.assertIn("done", compact, "legacy done must still be emitted alongside v1")
        self.assertLess(compact.index("done"), compact.index("run_failed"))
        self.assertIn("truncated", compact)
        # truncated must come before the run terminators
        self.assertLess(compact.index("truncated"), compact.index("done"))
        self.assertLess(compact.index("truncated"), compact.index("run_failed"))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
