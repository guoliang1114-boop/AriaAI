from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import HTTPException
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select
import yaml

from app.models.db import Project, ProjectFileVersion
from app.services.agent_harness.structured_patch import (
    StructuredPatchConflict,
    StructuredPatchError,
    content_sha256,
    parse_structured_patch,
    plan_structured_patch,
)
from app.services.chat.mode_registry import ActionPolicy
from app.services.agent_harness.tool_policy import PolicyDecision, evaluate_tool_policy
from app.services.chat import tool_executor
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_executor import execute_tool_with_policy
from app.services.chat_tools import ChatRuntime
from app.routers.chat_schemas import SendMessageRequest
from app.services.project_core import init_default_project_folders
from app.services.project_documents import create_project_document_record, read_project_document_content
from app.tools import project_markdown


def _golden_cases() -> list[dict]:
    fixture = Path(__file__).with_name("golden_chat_set") / "structured_patch_cases.yaml"
    return yaml.safe_load(fixture.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", _golden_cases(), ids=lambda case: case["name"])
def test_structured_patch_golden_cases(case: dict) -> None:
    if case.get("expected_error"):
        with pytest.raises(StructuredPatchError) as exc_info:
            plan_structured_patch(
                case["patch"],
                base_content=case["base"],
                expected_path=case["file_name"],
            )
        assert exc_info.value.code == case["expected_error"]
        return

    plan = plan_structured_patch(
        case["patch"],
        base_content=case["base"],
        expected_path=case["file_name"],
    )
    assert case["expected_contains"] in plan.result_content
    assert plan.replacement_count == case["expected_replacements"]
    assert plan.base_sha256 == content_sha256(case["base"])
    assert plan.result_sha256 == content_sha256(plan.result_content)
    assert plan.unified_diff.startswith(f"--- a/{case['file_name']}")


def test_parser_rejects_path_traversal_and_multiple_documents() -> None:
    with pytest.raises(StructuredPatchError, match="unsafe_target"):
        parse_structured_patch(
            """*** Begin Patch
*** Update File: ../outside.md
@@
-old
+new
*** End Patch"""
        )

    with pytest.raises(StructuredPatchError, match="single_update_only"):
        parse_structured_patch(
            """*** Begin Patch
*** Update File: first.md
@@
-old
+new
*** Update File: second.md
@@
-old
+new
*** End Patch"""
        )


def test_patch_preserves_unmodified_crlf_lines() -> None:
    base = "# 标题\r\n\r\n- 状态：高\r\n- Owner：PM\r\n"
    patch = """*** Begin Patch
*** Update File: status.md
@@ # 标题
-- 状态：高
+- 状态：中
*** End Patch"""

    result = plan_structured_patch(patch, base_content=base, expected_path="status.md")

    assert result.result_content == "# 标题\r\n\r\n- 状态：中\r\n- Owner：PM\r\n"


def test_patch_rejects_missing_and_ambiguous_context() -> None:
    missing = """*** Begin Patch
*** Update File: risk.md
@@
-not present
+replacement
*** End Patch"""
    with pytest.raises(StructuredPatchConflict) as missing_error:
        plan_structured_patch(missing, base_content="# Risk\n", expected_path="risk.md")
    assert missing_error.value.code == "missing_context"

    ambiguous = """*** Begin Patch
*** Update File: risk.md
@@
-same
+changed
*** End Patch"""
    with pytest.raises(StructuredPatchConflict) as ambiguous_error:
        plan_structured_patch(ambiguous, base_content="same\nsame\n", expected_path="risk.md")
    assert ambiguous_error.value.code == "ambiguous_context"


@pytest.fixture
def markdown_store(tmp_path: Path, monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()
    monkeypatch.setattr(project_markdown, "engine", engine)
    monkeypatch.setattr(project_markdown, "UPLOADS_DIR", uploads_dir)

    with Session(engine) as session:
        project = Project(name="Patch Project", client="Client")
        session.add(project)
        session.commit()
        session.refresh(project)
        project_file = create_project_document_record(
            session,
            project.id,
            name="项目风险.md",
            content="# 项目风险\n\n- 风险：高\n",
            uploads_dir=uploads_dir,
            init_default_folders=init_default_project_folders,
        )
        project_id = project.id
        file_id = project_file.id
    yield engine, uploads_dir, project_id, file_id
    engine.dispose()


def _read_file(engine, uploads_dir: Path, project_id: int, file_id: int) -> str:
    with Session(engine) as session:
        project_file = project_markdown.get_project_document_file_or_404(session, project_id, file_id)
        return read_project_document_content(project_file, uploads_dir=uploads_dir)


def _patch_input(project_id: int, file_id: int, base: str) -> dict:
    return {
        "project_id": project_id,
        "file_id": file_id,
        "mode": "patch",
        "base_sha256": content_sha256(base),
        "patch": """*** Begin Patch
*** Update File: 项目风险.md
@@ # 项目风险
-- 风险：高
+- 风险：中
*** End Patch""",
    }


def test_patch_preflight_apply_and_version_backed_rollback(markdown_store) -> None:
    engine, uploads_dir, project_id, file_id = markdown_store
    original = _read_file(engine, uploads_dir, project_id, file_id)
    prepared = project_markdown.prepare_project_markdown_action_input(
        _patch_input(project_id, file_id, original)
    )
    frozen = prepared["_aria_patch_preflight"]
    assert frozen["base_sha256"] == content_sha256(original)
    assert "- 风险：中" in frozen["preview_diff"]

    applied = asyncio.run(project_markdown.update_project_markdown_document(**prepared))
    patched = _read_file(engine, uploads_dir, project_id, file_id)
    assert applied["action"] == "patched"
    assert applied["result_sha256"] == content_sha256(patched)
    assert applied["rollback_available"] is True
    assert "- 风险：中" in patched

    rollback_input = project_markdown.prepare_project_markdown_action_input(
        {
            "project_id": project_id,
            "file_id": file_id,
            "mode": "rollback",
            "base_sha256": content_sha256(patched),
            "version_id": applied["rollback_version_id"],
        }
    )
    rolled_back = asyncio.run(project_markdown.update_project_markdown_document(**rollback_input))
    assert rolled_back["action"] == "rolled_back"
    assert rolled_back["restored_from_version_id"] == applied["rollback_version_id"]
    assert _read_file(engine, uploads_dir, project_id, file_id) == original

    with Session(engine) as session:
        versions = session.exec(
            select(ProjectFileVersion)
            .where(ProjectFileVersion.project_file_id == file_id)
            .order_by(ProjectFileVersion.version_number)
        ).all()
    assert len(versions) == 3
    assert [version.change_source for version in versions] == [
        "manual_create",
        "structured_patch",
        f"structured_patch_rollback:{applied['rollback_version_id']}",
    ]


def test_confirmation_time_base_conflict_rejects_without_overwrite(markdown_store) -> None:
    engine, uploads_dir, project_id, file_id = markdown_store
    original = _read_file(engine, uploads_dir, project_id, file_id)
    prepared = project_markdown.prepare_project_markdown_action_input(
        _patch_input(project_id, file_id, original)
    )

    with Session(engine) as session:
        project_file = project_markdown.get_project_document_file_or_404(session, project_id, file_id)
        path = uploads_dir / project_file.path
    concurrent_content = "# 项目风险\n\n- 风险：已由他人更新\n"
    path.write_text(concurrent_content, encoding="utf-8")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(project_markdown.update_project_markdown_document(**prepared))

    assert exc_info.value.status_code == 409
    assert "base_version_conflict" in str(exc_info.value.detail)
    assert path.read_text(encoding="utf-8") == concurrent_content


def test_preflight_rejects_symlink_artifact_target(markdown_store, tmp_path: Path) -> None:
    engine, uploads_dir, project_id, file_id = markdown_store
    original = _read_file(engine, uploads_dir, project_id, file_id)
    with Session(engine) as session:
        project_file = project_markdown.get_project_document_file_or_404(session, project_id, file_id)
        path = uploads_dir / project_file.path
    outside = tmp_path / "outside.md"
    outside.write_text(original, encoding="utf-8")
    path.unlink()
    path.symlink_to(outside)

    with pytest.raises(HTTPException) as exc_info:
        project_markdown.prepare_project_markdown_action_input(
            _patch_input(project_id, file_id, original)
        )

    assert exc_info.value.status_code == 400
    assert "unsafe_artifact_path" in str(exc_info.value.detail)
    assert outside.read_text(encoding="utf-8") == original


def test_database_failure_compensates_atomic_file_write(markdown_store, monkeypatch) -> None:
    engine, uploads_dir, project_id, file_id = markdown_store
    original = _read_file(engine, uploads_dir, project_id, file_id)
    prepared = project_markdown.prepare_project_markdown_action_input(
        _patch_input(project_id, file_id, original)
    )
    create_snapshot = project_markdown.create_project_file_version_snapshot

    def fail_applied_snapshot(session, project_file, content, *, change_source="", message_id=None):
        if change_source == "structured_patch":
            raise RuntimeError("simulated snapshot failure")
        return create_snapshot(
            session,
            project_file,
            content,
            change_source=change_source,
            message_id=message_id,
        )

    monkeypatch.setattr(project_markdown, "create_project_file_version_snapshot", fail_applied_snapshot)
    with pytest.raises(RuntimeError, match="simulated snapshot failure"):
        asyncio.run(project_markdown.update_project_markdown_document(**prepared))

    assert _read_file(engine, uploads_dir, project_id, file_id) == original
    with Session(engine) as session:
        versions = session.exec(
            select(ProjectFileVersion).where(ProjectFileVersion.project_file_id == file_id)
        ).all()
    assert len(versions) == 1


def test_structured_modes_always_require_hitas_prompt() -> None:
    for mode in ("patch", "rollback"):
        evaluation = evaluate_tool_policy(
            ActionPolicy.MODIFY_EXISTING_FILE,
            project_markdown.PROJECT_MARKDOWN_TOOL_NAME,
            {"mode": mode},
        )
        assert evaluation.decision is PolicyDecision.PROMPT
        assert evaluation.requires_confirmation is True


def _chat_runtime(action_policy: ActionPolicy = ActionPolicy.MODIFY_EXISTING_FILE) -> ChatRuntime:
    return ChatRuntime(
        conv_id=1,
        selected_model="test-model",
        llm=object(),
        system="",
        api_messages=[],
        rag_sources=[],
        tools=[],
        max_tokens=256,
        temperature=0.0,
        project_id=9,
        action_policy=action_policy,
    )


def test_agent_loop_freezes_diff_before_creating_hitas_action(monkeypatch) -> None:
    captured: list[dict] = []

    def fake_prepare(tool_input: dict) -> dict:
        captured.append(dict(tool_input))
        return {
            **tool_input,
            "_aria_patch_preflight": {
                "schema_version": 1,
                "mode": "patch",
                "project_file_id": 12,
                "target_name": "风险.md",
                "base_sha256": "a" * 64,
                "result_sha256": "b" * 64,
                "replacement_count": 1,
                "preview_diff": "--- a/风险.md\n+++ b/风险.md\n-old\n+new\n",
                "preview_truncated": False,
                "rollback_target_version_id": None,
            },
        }

    monkeypatch.setattr(tool_executor, "prepare_project_markdown_action_input", fake_prepare)
    state = ChatSessionState(run_id="run-patch")
    outcome = asyncio.run(
        execute_tool_with_policy(
            _chat_runtime(),
            state,
            {
                "id": "tool-patch",
                "name": project_markdown.PROJECT_MARKDOWN_TOOL_NAME,
                "input": {
                    "mode": "patch",
                    "file_id": 12,
                    "base_sha256": "a" * 64,
                    "patch": "*** Begin Patch\n*** Update File: 风险.md\n@@\n-old\n+new\n*** End Patch",
                },
            },
            req=SendMessageRequest(content="请把风险改成 new", project_id=9),
            step_text="",
            step_truncated=False,
            step_index=0,
        )
    )

    assert captured[0]["project_id"] == 9
    assert outcome.confirmation_required is True
    assert len(state.pending_tool_actions) == 1
    assert state.pending_tool_actions[0]["risk_level"] == "high"
    frozen_input = state.pending_tool_actions[0]["tool_input"]
    assert frozen_input["_aria_patch_preflight"]["result_sha256"] == "b" * 64
    assert "Diff 预览" in "\n".join(state.pending_tool_actions[0]["details"])
    assert not any(event.get("status") == "completed" for event in state.tool_call_events)


def test_agent_loop_conflict_does_not_create_hitas_action(monkeypatch) -> None:
    def conflict(_tool_input: dict) -> dict:
        raise HTTPException(409, "base_version_conflict")

    monkeypatch.setattr(tool_executor, "prepare_project_markdown_action_input", conflict)
    state = ChatSessionState(run_id="run-conflict")
    outcome = asyncio.run(
        execute_tool_with_policy(
            _chat_runtime(),
            state,
            {
                "id": "tool-conflict",
                "name": project_markdown.PROJECT_MARKDOWN_TOOL_NAME,
                "input": {
                    "mode": "patch",
                    "file_id": 12,
                    "base_sha256": "a" * 64,
                    "patch": "*** Begin Patch\n*** Update File: 风险.md\n@@\n-old\n+new\n*** End Patch",
                },
            },
            req=SendMessageRequest(content="请更新风险", project_id=9),
            step_text="",
            step_truncated=False,
            step_index=0,
        )
    )

    assert outcome.confirmation_required is False
    assert state.pending_tool_actions == []
    assert state.tool_call_events[0]["status"] == "conflict"
    assert "base_version_conflict" in outcome.result_block["content"]


def test_forbidden_patch_is_blocked_before_document_preflight(monkeypatch) -> None:
    def should_not_run(_tool_input: dict) -> dict:
        raise AssertionError("forbidden patch must not read the document")

    monkeypatch.setattr(tool_executor, "prepare_project_markdown_action_input", should_not_run)
    state = ChatSessionState(run_id="run-forbidden")
    outcome = asyncio.run(
        execute_tool_with_policy(
            _chat_runtime(ActionPolicy.DIRECT_ANSWER),
            state,
            {
                "id": "tool-forbidden",
                "name": project_markdown.PROJECT_MARKDOWN_TOOL_NAME,
                "input": {"mode": "patch", "file_id": 12, "base_sha256": "a" * 64, "patch": "invalid"},
            },
            req=SendMessageRequest(content="分析一下风险", project_id=9),
            step_text="",
            step_truncated=False,
            step_index=0,
        )
    )

    assert outcome.confirmation_required is False
    assert state.tool_call_events[0]["status"] == "blocked"
    assert state.pending_tool_actions == []
