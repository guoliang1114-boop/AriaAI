from __future__ import annotations

import json
from types import SimpleNamespace

from app.services.chat.runtime import _api_message_from_history, _should_include_history_message


def test_empty_assistant_tool_history_is_kept_as_structured_summary():
    message = SimpleNamespace(
        role="assistant",
        content="",
        metadata_json=json.dumps(
            {
                "tool_calls": [
                    {
                        "tool_name": "read_project_file",
                        "status": "completed",
                        "summary": "读取项目背景.md",
                    }
                ]
            },
            ensure_ascii=False,
        ),
    )

    assert _should_include_history_message(message) is True
    api_message = _api_message_from_history(message)
    assert api_message["role"] == "assistant"
    assert "Prior structured tool execution" in api_message["content"]
    assert "read_project_file" in api_message["content"]


def test_empty_message_without_structured_history_is_filtered():
    message = SimpleNamespace(role="assistant", content=" ", metadata_json="{}")

    assert _should_include_history_message(message) is False
