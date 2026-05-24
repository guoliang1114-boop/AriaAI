import json
from types import SimpleNamespace
from typing import Optional

from sqlmodel import Session, SQLModel, create_engine

from app.models.db import ProjectFile
from app.routers.chat_conversations import _latest_pending_action
from app.services.chat.pending_actions import build_project_file_cleanup_pending_action


def _message(role: str, content: str, metadata: Optional[dict] = None):
    return SimpleNamespace(
        role=role,
        content=content,
        metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
    )


def test_latest_pending_action_survives_later_assistant_reply():
    token = "tool:manage_project_files:delete:abc123"
    action = _latest_pending_action(
        [
            _message("user", "现在空间里面有特别多的垃圾文件，清除"),
            _message(
                "assistant",
                "确认执行吗？",
                {
                    "tool_calls": [
                        {
                            "tool_name": "manage_project_files",
                            "status": "confirmation_required",
                            "confirmation_token": token,
                        }
                    ],
                    "pending_tool_confirmations": [
                        {
                            "confirmation_token": token,
                            "tool_name": "manage_project_files",
                            "tool_input": {"action": "delete", "file_ids": [130, 131]},
                        }
                    ],
                },
            ),
            _message("user", "执行"),
            _message("assistant", "抱歉，我只有读取权限。"),
        ]
    )

    assert action is not None
    assert action.call["confirmation_token"] == token
    assert action.can_confirm is True
    assert action.source_content == "现在空间里面有特别多的垃圾文件，清除"


def test_latest_pending_action_ignores_consumed_token():
    token = "tool:manage_project_files:delete:abc123"
    action = _latest_pending_action(
        [
            _message("user", "现在空间里面有特别多的垃圾文件，清除"),
            _message(
                "assistant",
                "确认执行吗？",
                {
                    "pending_tool_confirmations": [
                        {
                            "confirmation_token": token,
                            "tool_name": "manage_project_files",
                            "tool_input": {"action": "delete", "file_ids": [130, 131]},
                        }
                    ],
                },
            ),
            _message("user", "确认并执行"),
            _message("assistant", "操作已完成。", {"resolved_action_confirmations": [token]}),
        ]
    )

    assert action is None


def test_latest_pending_action_ignores_hitas_batch_result():
    token = "tool:manage_project_files:delete:abc123"
    action = _latest_pending_action(
        [
            _message("user", "现在空间里面有特别多的垃圾文件，清除"),
            _message(
                "assistant",
                "确认执行吗？",
                {
                    "pending_tool_confirmations": [
                        {
                            "confirmation_token": token,
                            "tool_name": "manage_project_files",
                            "tool_input": {"action": "delete", "file_ids": [130, 131]},
                        }
                    ],
                    "tool_calls": [
                        {
                            "tool_name": "manage_project_files",
                            "status": "confirmation_required",
                            "confirmation_token": token,
                        }
                    ],
                },
            ),
            _message(
                "assistant",
                "已执行。",
                {
                    "tool_action_batch_result": {
                        "approval_batch_id": "hitas-1",
                        "pending_action_ids": [1],
                        "status": "completed",
                    }
                },
            ),
        ]
    )

    assert action is None


def test_cleanup_request_builds_deterministic_delete_confirmation():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(ProjectFile(project_id=27, name="重复方案.pptx", file_type="pptx", path="a.pptx", origin="ai_generated"))
        session.add(ProjectFile(project_id=27, name="重复方案.pptx", file_type="pptx", path="b.pptx", origin="ai_generated"))
        session.add(ProjectFile(project_id=27, name="找不到该文件.docx", file_type="docx", path="missing.docx", origin="ai_generated"))
        session.commit()

        pending = build_project_file_cleanup_pending_action(
            session,
            project_id=27,
            user_content="现在空间里面有特别多的垃圾文件，清除",
            action_policy="destructive_action",
        )

    assert pending is not None
    assert pending["tool_name"] == "manage_project_files"
    assert pending["tool_input"]["action"] == "delete"
    assert pending["tool_input"]["file_ids"]
    assert pending["confirmation_token"].startswith("tool:manage_project_files:delete:")
    assert pending["details"]
