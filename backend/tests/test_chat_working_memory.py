from __future__ import annotations

import json
from types import SimpleNamespace

from app.services.chat.working_memory import (
    build_working_memory,
    extract_explicit_markdown_filename,
    should_continue_current_artifact,
)


def test_extract_explicit_markdown_filename_prefers_last_mention():
    assert extract_explicit_markdown_filename("先看 demo.md，最后写入 项目背景.md") == "项目背景.md"


def test_working_memory_recovers_recent_artifact_and_continuation():
    history = [
        SimpleNamespace(role="user", content="请写入项目背景.md", metadata_json="{}"),
        SimpleNamespace(
            role="assistant",
            content="已写入项目 Markdown 文件：项目背景.md",
            metadata_json=json.dumps(
                {
                    "artifacts": [
                        {
                            "project_file_id": 183,
                            "name": "项目背景.md",
                            "file_type": "md",
                            "path": "projects/32/mock_项目背景.md",
                        }
                    ]
                },
                ensure_ascii=False,
            ),
        ),
    ]

    memory = build_working_memory(history, "内容不够深刻，加强一下")

    assert memory.current_artifact is not None
    assert memory.current_artifact["project_file_id"] == 183
    assert memory.current_artifact["name"] == "项目背景.md"
    assert memory.continuation_requested is True
    assert should_continue_current_artifact(memory) is True


def test_working_memory_recovers_pending_markdown_save_as_current_artifact():
    history = [
        SimpleNamespace(
            role="assistant",
            content="已准备保存。",
            metadata_json=json.dumps(
                {
                    "pending_markdown_saves": [
                        {
                            "file_id": 201,
                            "file_name": "风险分析.md",
                            "folder_id": 7,
                        }
                    ]
                },
                ensure_ascii=False,
            ),
        )
    ]

    memory = build_working_memory(history, "继续完善")

    assert memory.current_artifact is not None
    assert memory.current_artifact["project_file_id"] == 201
    assert memory.current_artifact["name"] == "风险分析.md"
    assert should_continue_current_artifact(memory) is True
