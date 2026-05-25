"""Conversation-level working memory reconstructed from persisted chat turns.

This is intentionally storage-light: v1 derives the active artifact/task from
recent message metadata so old conversations immediately benefit without a DB
migration.  The output is injected into prompts and used by deterministic
follow-up routing.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.models.db import Message
from app.services.project_documents import ensure_markdown_filename


CONTINUATION_TERMS = (
    "继续",
    "加强",
    "深化",
    "丰富",
    "补充",
    "完善",
    "优化",
    "修改",
    "改一下",
    "调整",
    "重写",
    "写入",
    "保存",
    "覆盖",
    "替换",
    "内容不够",
    "不够深刻",
    "不够丰富",
    "再深",
    "再补",
    "continue",
    "improve",
    "enhance",
    "revise",
    "update",
)

_EXPLICIT_MARKDOWN_FILE_RE = re.compile(
    r"(?:最后写入|写入|保存到|保存为|保存成|存到|存为|另存为|命名为|输出到|输出为|文件名[:：]?)\s*"
    r"([A-Za-z0-9_\-\u4e00-\u9fff][A-Za-z0-9_\-\u4e00-\u9fff（）()·. ]{0,80}\.md)",
    re.I,
)
_MARKDOWN_FILE_RE = re.compile(r"([A-Za-z0-9_\-\u4e00-\u9fff][A-Za-z0-9_\-\u4e00-\u9fff（）()·. ]{0,80}\.md)", re.I)


@dataclass(frozen=True)
class WorkingMemory:
    current_artifact: dict[str, Any] | None = None
    current_task: dict[str, Any] | None = None
    explicit_target_filename: str = ""
    continuation_requested: bool = False
    last_user_request: str = ""
    last_assistant_summary: str = ""
    summary: str = ""
    user_constraints: list[str] | None = None
    decisions: list[dict[str, Any]] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "current_artifact": self.current_artifact,
            "current_task": self.current_task,
            "explicit_target_filename": self.explicit_target_filename,
            "continuation_requested": self.continuation_requested,
            "last_user_request": self.last_user_request,
            "last_assistant_summary": self.last_assistant_summary,
            "summary": self.summary,
            "user_constraints": self.user_constraints or [],
            "decisions": self.decisions or [],
        }


def _metadata(message: Message) -> dict[str, Any]:
    try:
        parsed = json.loads(message.metadata_json or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def extract_explicit_markdown_filename(content: str) -> str:
    text = str(content or "")
    explicit_matches = [match.group(1).strip() for match in _EXPLICIT_MARKDOWN_FILE_RE.finditer(text)]
    if explicit_matches:
        return ensure_markdown_filename(Path(explicit_matches[-1]).name)
    matches = [match.group(1).strip() for match in _MARKDOWN_FILE_RE.finditer(text)]
    if not matches:
        return ""
    # Prefer the last mention: "最后写入 项目背景.md" should win over examples.
    return ensure_markdown_filename(Path(matches[-1]).name)


def artifact_from_metadata(metadata: dict[str, Any]) -> dict[str, Any] | None:
    pending_saves = metadata.get("pending_markdown_saves")
    if isinstance(pending_saves, list):
        for item in reversed(pending_saves):
            if not isinstance(item, dict):
                continue
            file_id = item.get("file_id") or item.get("project_file_id")
            file_name = item.get("file_name") or item.get("name")
            if file_id or file_name:
                return {
                    "project_file_id": file_id,
                    "name": file_name,
                    "file_type": "md",
                    "folder_id": item.get("folder_id"),
                    "source": "pending_markdown_saves",
                }

    artifacts = metadata.get("artifacts")
    if isinstance(artifacts, list):
        for item in reversed(artifacts):
            if not isinstance(item, dict):
                continue
            file_id = item.get("project_file_id") or item.get("id")
            file_name = item.get("name") or item.get("file_name")
            file_type = str(item.get("file_type") or "").lower()
            if file_id or file_name:
                return {
                    "project_file_id": file_id,
                    "name": file_name,
                    "file_type": file_type,
                    "path": item.get("path"),
                    "description": item.get("description"),
                    "source": "artifacts",
                }

    task_run = metadata.get("task_run")
    if isinstance(task_run, dict):
        task_artifacts = task_run.get("artifacts")
        if isinstance(task_artifacts, list):
            for item in reversed(task_artifacts):
                if not isinstance(item, dict):
                    continue
                file_id = item.get("project_file_id")
                file_name = item.get("name") or item.get("file_name")
                file_type = str(item.get("file_type") or "").lower()
                if file_id or file_name:
                    return {
                        "project_file_id": file_id,
                        "name": file_name,
                        "file_type": file_type,
                        "path": item.get("path"),
                        "source": "task_run.artifacts",
                    }
    return None


def _task_from_metadata(metadata: dict[str, Any]) -> dict[str, Any] | None:
    task = metadata.get("task_run")
    if not isinstance(task, dict) or not task.get("id"):
        return None
    return {
        "id": task.get("id"),
        "task_type": task.get("task_type") or metadata.get("task_type"),
        "status": task.get("status"),
        "goal": task.get("goal"),
    }


def is_artifact_continuation_request(content: str) -> bool:
    text = re.sub(r"\s+", "", str(content or "").strip().lower())
    if not text:
        return False
    return any(term.lower().replace(" ", "") in text for term in CONTINUATION_TERMS)


def build_working_memory(
    history: list[Message],
    current_content: str,
    *,
    persisted_state: dict[str, Any] | None = None,
) -> WorkingMemory:
    persisted_state = persisted_state if isinstance(persisted_state, dict) else {}
    current_artifact: dict[str, Any] | None = persisted_state.get("current_artifact") or None
    current_task: dict[str, Any] | None = persisted_state.get("current_task") or None
    last_user_request = str(persisted_state.get("last_user_request") or "")
    last_assistant_summary = str(persisted_state.get("last_assistant_summary") or "")
    user_constraints = persisted_state.get("user_constraints") if isinstance(persisted_state.get("user_constraints"), list) else []
    decisions = persisted_state.get("decisions") if isinstance(persisted_state.get("decisions"), list) else []

    for message in history:
        role = getattr(message, "role", "")
        content = str(getattr(message, "content", "") or "").strip()
        if role == "user" and content:
            last_user_request = content
        if role != "assistant":
            continue
        if content:
            last_assistant_summary = content[:800]
        metadata = _metadata(message)
        artifact = artifact_from_metadata(metadata)
        if artifact:
            current_artifact = artifact
        task = _task_from_metadata(metadata)
        if task:
            current_task = task

    explicit_filename = extract_explicit_markdown_filename(current_content)
    return WorkingMemory(
        current_artifact=current_artifact,
        current_task=current_task,
        explicit_target_filename=explicit_filename,
        continuation_requested=is_artifact_continuation_request(current_content),
        last_user_request=last_user_request,
        last_assistant_summary=last_assistant_summary,
        summary=str(persisted_state.get("summary") or ""),
        user_constraints=[str(item) for item in user_constraints[:12] if str(item).strip()],
        decisions=[item for item in decisions[:12] if isinstance(item, dict)],
    )


def should_continue_current_artifact(memory: WorkingMemory) -> bool:
    artifact = memory.current_artifact or {}
    if not artifact:
        return False
    if memory.explicit_target_filename:
        return True
    return memory.continuation_requested


def format_working_memory_for_prompt(memory: WorkingMemory) -> str:
    parts: list[str] = ["## Conversation Working Memory"]
    artifact = memory.current_artifact or {}
    if artifact:
        parts.append(
            "Current artifact: "
            f"name={artifact.get('name') or '-'}, "
            f"file_type={artifact.get('file_type') or '-'}, "
            f"project_file_id={artifact.get('project_file_id') or '-'}."
        )
    if memory.current_task:
        task = memory.current_task
        parts.append(
            "Current task: "
            f"id={task.get('id')}, type={task.get('task_type')}, status={task.get('status')}."
        )
    if memory.summary:
        parts.append(f"Persistent state summary: {memory.summary}.")
    if memory.user_constraints:
        parts.append("Active user constraints:")
        parts.extend(f"- {item}" for item in memory.user_constraints[:6])
    if memory.decisions:
        parts.append("Recent completed decisions/actions:")
        for decision in memory.decisions[:4]:
            summary = decision.get("summary")
            if isinstance(summary, list):
                summary = "；".join(str(item) for item in summary[:4])
            if summary:
                parts.append(f"- {summary}")
    if memory.explicit_target_filename:
        parts.append(f"Explicit target filename in this turn: {memory.explicit_target_filename}.")
    if memory.continuation_requested:
        parts.append(
            "The current user turn looks like a continuation/modification request. "
            "If there is a current artifact, treat pronouns like 'this', 'it', '刚才', '继续', "
            "'加强', '补充', or '写入' as referring to that artifact unless the user names a different target."
        )
    if len(parts) == 1:
        return ""
    return "\n".join(parts)
