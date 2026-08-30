from __future__ import annotations

import asyncio
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import GeneratedFile, Milestone, Project, ProjectFile
from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.approval_envelope import RECOVERY_HITAS_ACTION_TYPE
from app.services.agent_harness.run_effect_record import canonical_tool_input_sha256
from app.services.agent_harness.project_world_state import (
    build_project_world_state_manifest,
    compare_project_world_states,
)
from app.services.chat.mode_registry import ActionPolicy
from app.services.artifact_intent import ArtifactContract
from app.services.chat.persist import (
    _delivery_satisfied,
    _has_successful_mutation,
    _maybe_create_markdown_from_response,
    _maybe_generate_missing_ppt_artifact,
    run_persist,
)
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_executor import execute_tool_with_policy
from app.services.chat.turn_recovery import build_turn_recovery_preview
from app.services.chat_tools import ChatRuntime


def _runtime(contract: dict, *, project_id: int | None = None) -> ChatRuntime:
    return ChatRuntime(
        conv_id=7,
        selected_model="test",
        llm=SimpleNamespace(),
        system="",
        api_messages=[],
        rag_sources=[],
        tools=[],
        max_tokens=128,
        temperature=0.0,
        action_policy=ActionPolicy.WRITE_ARTIFACT,
        project_id=project_id,
        prepare_metrics={"turn_recovery": contract},
    )


def _contract(*, generated_file_id: int, digest: str, changed: bool = False) -> dict:
    effect = {
        "schema_version": 1,
        "step_index": 0,
        "tool_use_id": "source_tool",
        "tool_name": "generate_pdf",
        "input_sha256": canonical_tool_input_sha256({"title": "Report"}),
        "effect": "create",
        "outcome": "persisted",
        "target_ref": {"kind": "new_artifact"},
        "result_ref": {
            "kind": "persisted_artifact",
            "output_id": "out_verified",
            "generated_file_id": generated_file_id,
            "content_sha256": digest,
        },
    }
    return {
        "schema_version": 2,
        "source_run_id": "run_source",
        "strategy": "replan_from_checkpoint",
        "world_state_change": {"changed": changed},
        "effect_ledger": {
            "schema_version": 1,
            "records": [effect],
            "integrity": {
                "mutating_effect_count": 1,
                "verified_persisted_count": 1,
                "unresolved_mutating_count": 0,
                "legacy_or_unknown_mutating_count": 0,
                "orphan_persisted_result_count": 0,
            },
        },
    }


def test_identical_verified_artifact_returns_already_completed_without_registry(tmp_path, monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    payload = b"persisted report"
    digest = hashlib.sha256(payload).hexdigest()
    artifact_path = tmp_path / "report.pdf"
    artifact_path.write_bytes(payload)
    try:
        with Session(engine) as session:
            record = GeneratedFile(
                conversation_id=7,
                project_id=None,
                name="report.pdf",
                file_type="pdf",
                path="report.pdf",
                run_id="run_source",
                output_id="out_verified",
                content_sha256=digest,
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            generated_file_id = int(record.id or 0)
        monkeypatch.setattr("app.services.chat.tool_executor.UPLOADS_DIR", tmp_path)
        state = ChatSessionState(run_id="run_child", rollout_bind=engine)
        runtime = _runtime(_contract(generated_file_id=generated_file_id, digest=digest))
        with patch("app.services.chat.tool_executor.registry.execute", new=AsyncMock()) as execute_mock:
            outcome = asyncio.run(
                execute_tool_with_policy(
                    runtime,
                    state,
                    {"id": "retry_tool", "name": "generate_pdf", "input": {"title": "Report"}},
                    req=SendMessageRequest(content="continue"),
                    step_text="",
                    step_truncated=False,
                    step_index=0,
                )
            )
        assert execute_mock.await_count == 0
        assert json.loads(outcome.result_block["content"])["status"] == "already_completed"
        assert state.artifacts == []
        assert len(state.verified_recovery_artifacts) == 1
        verified_artifact = state.verified_recovery_artifacts[0]
        assert verified_artifact["id"] == generated_file_id
        assert verified_artifact["run_id"] == "run_source"
        assert verified_artifact["output_id"] == "out_verified"
        assert verified_artifact["content_sha256"] == digest
        assert verified_artifact["recovery_verified"] is True
        delivery_contract = ArtifactContract(
            delivery_required=True,
            output_kind="pdf",
            allowed_tools=("generate_pdf",),
        )
        assert _delivery_satisfied(state, delivery_contract) is True
        assert _has_successful_mutation(state) is True

        runtime.artifact_contract = delivery_contract
        state.full_text = "PDF 已生成，可直接下载。"
        persisted: dict = {}

        def fake_persist(_bind, _conv_id, content, _request_content, metadata):
            persisted["content"] = content
            persisted["metadata"] = metadata
            return False, 99

        with patch(
            "app.services.chat.persist.persist_assistant_message", new=fake_persist
        ), patch(
            "app.services.chat.persist.persist_run_artifacts"
        ) as persist_artifacts, patch(
            "app.services.chat.persist.persist_chat_trace"
        ), patch(
            "app.services.chat.persist.schedule_title_generation"
        ):
            events = asyncio.run(
                _collect_events(
                    run_persist(
                        runtime,
                        SendMessageRequest(content="continue"),
                        engine,
                        state,
                    )
                )
            )

        persist_artifacts.assert_not_called()
        assert persisted["metadata"]["artifacts"][0]["recovery_verified"] is True
        assert persisted["metadata"].get("delivery_failed") is not True
        assert "没有完成这个操作" not in persisted["content"]
        assert any('"type": "artifact_ready"' in event for event in events)
        with Session(engine) as session:
            unchanged = session.get(GeneratedFile, generated_file_id)
            assert unchanged is not None
            assert unchanged.run_id == "run_source"
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


async def _collect_events(stream) -> list[str]:
    return [event async for event in stream]


def test_source_artifact_world_change_still_skips_exact_verified_write(tmp_path, monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    payload = b"source run artifact"
    digest = hashlib.sha256(payload).hexdigest()
    (tmp_path / "source.pdf").write_bytes(payload)
    try:
        with Session(engine) as session:
            project = Project(name="Source output", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = int(project.id or 0)
            source_baseline = build_project_world_state_manifest(session, project_id)
            record = GeneratedFile(
                conversation_id=7,
                project_id=project_id,
                name="source.pdf",
                file_type="pdf",
                path="source.pdf",
                run_id="run_source",
                output_id="out_verified",
                content_sha256=digest,
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            generated_file_id = int(record.id or 0)
            current = build_project_world_state_manifest(session, project_id)
        world_change = compare_project_world_states(source_baseline, current)
        assert world_change["changed"] is True
        source_contract = _contract(
            generated_file_id=generated_file_id,
            digest=digest,
            changed=True,
        )
        preview = build_turn_recovery_preview(
            {
                "run_id": "run_source",
                "status": "failed",
                "snapshot_sha256": "e" * 64,
                "steps": [],
                "effect_ledger": source_contract["effect_ledger"],
                "recovery": {"can_retry": False},
            },
            source_message_id=11,
            current_project_world_state=current,
            project_world_state_change=world_change,
        )
        assert preview["world_state_change"]["changed"] is True

        monkeypatch.setattr("app.services.chat.tool_executor.UPLOADS_DIR", tmp_path)
        state = ChatSessionState(rollout_bind=engine)
        with patch("app.services.chat.tool_executor.registry.execute", new=AsyncMock()) as execute_mock:
            outcome = asyncio.run(
                execute_tool_with_policy(
                    _runtime(preview, project_id=project_id),
                    state,
                    {"id": "retry_tool", "name": "generate_pdf", "input": {"title": "Report"}},
                    req=SendMessageRequest(content="continue", project_id=project_id),
                    step_text="",
                    step_truncated=False,
                    step_index=0,
                )
            )
        assert execute_mock.await_count == 0
        assert json.loads(outcome.result_block["content"])["status"] == "already_completed"
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_artifact_byte_drift_and_world_change_require_manual_review(tmp_path, monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    expected = hashlib.sha256(b"expected").hexdigest()
    (tmp_path / "report.pdf").write_bytes(b"drifted")
    try:
        with Session(engine) as session:
            record = GeneratedFile(
                conversation_id=7,
                name="report.pdf",
                file_type="pdf",
                path="report.pdf",
                run_id="run_source",
                output_id="out_verified",
                content_sha256=expected,
            )
            session.add(record)
            session.commit()
            session.refresh(record)
            generated_file_id = int(record.id or 0)
        monkeypatch.setattr("app.services.chat.tool_executor.UPLOADS_DIR", tmp_path)
        for changed in (False, True):
            state = ChatSessionState(rollout_bind=engine)
            with patch("app.services.chat.tool_executor.registry.execute", new=AsyncMock()) as execute_mock:
                outcome = asyncio.run(
                    execute_tool_with_policy(
                        _runtime(_contract(generated_file_id=generated_file_id, digest=expected, changed=changed)),
                        state,
                        {"id": "retry_tool", "name": "generate_pdf", "input": {"title": "Report"}},
                        req=SendMessageRequest(content="continue"),
                        step_text="",
                        step_truncated=False,
                        step_index=0,
                    )
                )
            assert execute_mock.await_count == 0
            assert json.loads(outcome.result_block["content"])["status"] == "manual_review"
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_retry_read_strategy_blocks_every_mutation_without_registry() -> None:
    contract = {
        "schema_version": 2,
        "source_run_id": "run_source",
        "strategy": "retry_read_step",
        "world_state_change": {"changed": False},
        "effect_ledger": {"schema_version": 1, "records": [], "integrity": {}},
    }
    state = ChatSessionState()
    with patch("app.services.chat.tool_executor.registry.execute", new=AsyncMock()) as execute_mock:
        outcome = asyncio.run(
            execute_tool_with_policy(
                _runtime(contract),
                state,
                {"id": "new_write", "name": "generate_pdf", "input": {"title": "New"}},
                req=SendMessageRequest(content="retry only the read"),
                step_text="",
                step_truncated=False,
                step_index=0,
            )
        )
    assert execute_mock.await_count == 0
    assert json.loads(outcome.result_block["content"])["status"] == "manual_review"


def test_new_recovery_mutation_requires_hitas_without_registry_execution() -> None:
    contract = {
        "schema_version": 2,
        "source_run_id": "run_source",
        "strategy": "replan_from_checkpoint",
        "world_state_change": {"changed": False},
        "effect_ledger": {
            "schema_version": 1,
            "records": [],
            "integrity": {
                "mutating_effect_count": 0,
                "verified_persisted_count": 0,
                "unresolved_mutating_count": 0,
                "legacy_or_unknown_mutating_count": 0,
                "orphan_persisted_result_count": 0,
            },
        },
    }
    state = ChatSessionState()

    with patch("app.services.chat.tool_executor.registry.execute", new=AsyncMock()) as execute_mock:
        outcome = asyncio.run(
            execute_tool_with_policy(
                _runtime(contract),
                state,
                {"id": "new_write", "name": "generate_pdf", "input": {"title": "New report"}},
                req=SendMessageRequest(content="continue"),
                step_text="",
                step_truncated=False,
                step_index=0,
            )
        )

    assert execute_mock.await_count == 0
    assert outcome.confirmation_required is True
    assert json.loads(outcome.result_block["content"])["status"] == "confirmation_required"
    assert len(state.pending_tool_actions) == 1
    assert state.pending_tool_actions[0]["tool_name"] == "generate_pdf"
    assert state.pending_tool_actions[0]["action_type"] == RECOVERY_HITAS_ACTION_TYPE
    assert state.tool_call_events[-1]["status"] == "confirmation_required"


def test_project_change_during_recovery_blocks_mutation_without_registry() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project = Project(name="Recovery", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = int(project.id or 0)
            baseline = build_project_world_state_manifest(session, project_id)
            session.add(Milestone(project_id=project_id, title="Changed after model started"))
            session.commit()

        contract = {
            "schema_version": 2,
            "source_run_id": "run_source",
            "strategy": "replan_from_checkpoint",
            "project_world_state": baseline,
            "world_state_change": {"changed": False},
            "effect_ledger": {"schema_version": 1, "records": [], "integrity": {}},
        }
        state = ChatSessionState(rollout_bind=engine)
        with patch("app.services.chat.tool_executor.registry.execute", new=AsyncMock()) as execute_mock:
            outcome = asyncio.run(
                execute_tool_with_policy(
                    _runtime(contract, project_id=project_id),
                    state,
                    {"id": "new_write", "name": "generate_pdf", "input": {"title": "New"}},
                    req=SendMessageRequest(content="continue"),
                    step_text="",
                    step_truncated=False,
                    step_index=0,
                )
            )
        assert execute_mock.await_count == 0
        assert json.loads(outcome.result_block["content"])["status"] == "manual_review"
        assert state.trace_events[-1]["reason"] == "project_world_state_changed_during_recovery"
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_recovery_disables_mutating_persist_fallbacks(monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project = Project(name="Fallback guard", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = int(project.id or 0)
            baseline = build_project_world_state_manifest(session, project_id)
        recovery = {
            "schema_version": 2,
            "source_run_id": "run_source",
            "strategy": "replan_from_checkpoint",
            "contract_sha256": "d" * 64,
            "project_world_state": baseline,
            "world_state_change": {"changed": False},
            "effect_ledger": {"schema_version": 1, "records": [], "integrity": {}},
        }
        runtime = _runtime(recovery, project_id=project_id)
        state = ChatSessionState(rollout_bind=engine)
        ppt_contract = ArtifactContract(
            delivery_required=True,
            output_kind="pptx",
            allowed_tools=("generate_ppt_from_skill",),
        )
        with patch("app.services.chat.persist.registry.execute", new=AsyncMock()) as execute_mock:
            generated = asyncio.run(
                _maybe_generate_missing_ppt_artifact(
                    runtime,
                    SendMessageRequest(content="generate PPT", project_id=project_id),
                    state,
                    "substantive response",
                    ppt_contract,
                )
            )
        assert generated is False
        assert execute_mock.await_count == 0

        markdown_contract = ArtifactContract(
            delivery_required=True,
            output_kind="md",
            allowed_tools=("update_project_markdown_document",),
        )
        markdown = _maybe_create_markdown_from_response(
            runtime=runtime,
            req=SendMessageRequest(
                content="保存为 recovery.md",
                project_id=project_id,
            ),
            bind=engine,
            state=state,
            full_text="# Recovery\n\n" + ("This content must remain response-only. " * 8),
            artifact_contract=markdown_contract,
        )
        assert markdown is None
        with Session(engine) as session:
            assert session.exec(select(ProjectFile)).all() == []
        blocked = [
            item for item in state.trace_events
            if item.get("type") == "recovery_persist_fallback_blocked"
        ]
        assert {item.get("fallback") for item in blocked} == {
            "ppt_artifact",
            "markdown_project_file",
        }
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()
