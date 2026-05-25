from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import yaml

from app.services.chat.phases.p4_persist import run_p4_persist
from app.services.chat.state import ChatSessionState
from app.services.chat.working_memory import build_working_memory, should_continue_current_artifact


def _cases() -> list[dict]:
    path = Path(__file__).parent / "golden_chat_set" / "multiturn_cases.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))["cases"]


def test_multiturn_working_memory_golden_cases():
    for case in [item for item in _cases() if item["kind"] == "working_memory"]:
        history = [
            SimpleNamespace(
                role="assistant",
                content="已生成或更新项目文件。",
                metadata_json=json.dumps(case["history_metadata"], ensure_ascii=False),
            )
        ]
        memory = build_working_memory(history, case["user_content"])
        if case.get("expected_current_artifact"):
            assert (memory.current_artifact or {}).get("name") == case["expected_current_artifact"], case["id"]
        if case.get("expected_filename"):
            assert memory.explicit_target_filename == case["expected_filename"], case["id"]
        assert should_continue_current_artifact(memory) is bool(case["expected_continuation"]), case["id"]


def test_multiturn_truth_gate_golden_cases():
    async def run_case(case: dict):
        runtime = MagicMock()
        runtime.conv_id = 1
        runtime.project_id = 1
        runtime.rag_sources = None
        runtime.skill_name = ""
        runtime.action_policy = case["action_policy"]
        runtime.artifact_contract = None
        runtime.working_memory = {}
        req = SimpleNamespace(project_id=1, content="整理项目空间", action_confirmations=[])
        state = ChatSessionState()
        state.text_buffer = case["assistant_text"]
        with patch("app.services.chat.phases.p4_persist.persist_assistant_message") as mock_persist, \
             patch("app.services.chat.phases.p4_persist.persist_generated_artifacts") as mock_artifacts:
            mock_persist.return_value = (False, 99)
            mock_artifacts.return_value = []
            async for _ in run_p4_persist(runtime, req, MagicMock(), state):
                pass
        return state.full_text

    for case in [item for item in _cases() if item["kind"] == "truth_gate"]:
        text = asyncio.run(run_case(case))
        assert case["expected_text_contains"] in text, case["id"]
