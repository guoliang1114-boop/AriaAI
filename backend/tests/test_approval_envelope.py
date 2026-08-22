import json
from types import SimpleNamespace

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import PendingToolAction
from app.services.agent_harness.approval_envelope import (
    APPROVAL_ENVELOPE_PREFIX,
    ApprovalEnvelopeError,
    approval_envelope_hash,
    legacy_tool_input_hash,
    verify_approval_envelope,
)
from app.services.chat.durable_task import _persist_markdown_continuation_action


def _delete_snapshot(**overrides):
    values = {
        "tool_name": "manage_project_files",
        "tool_input": {"project_id": 7, "action": "delete", "file_ids": [11, 12]},
        "project_id": 7,
        "action_type": "delete_files",
        "risk_level": "destructive",
        "policy_at_creation": "destructive_action",
        "approval_batch_id": "hitas-7-test",
        "sequence_index": 0,
    }
    values.update(overrides)
    return values


def test_versioned_envelope_is_deterministic_and_binds_all_execution_fields():
    snapshot = _delete_snapshot()
    fingerprint = approval_envelope_hash(**snapshot)

    assert fingerprint.startswith(APPROVAL_ENVELOPE_PREFIX)
    reordered = _delete_snapshot(
        tool_input={"file_ids": [11, 12], "action": "delete", "project_id": 7}
    )
    assert approval_envelope_hash(**reordered) == fingerprint

    for field, changed in (
        ("tool_name", "manage_project_folders"),
        ("tool_input", {"project_id": 7, "action": "delete", "file_ids": [12]}),
        ("project_id", 8),
        ("action_type", "delete_folder"),
        ("risk_level", "high"),
        ("policy_at_creation", "modify_existing_file"),
        ("approval_batch_id", "hitas-7-other"),
        ("sequence_index", 1),
    ):
        assert approval_envelope_hash(**_delete_snapshot(**{field: changed})) != fingerprint


def test_versioned_envelope_verifies_confirmation_required_policy():
    snapshot = _delete_snapshot()
    fingerprint = approval_envelope_hash(**snapshot)

    verified = verify_approval_envelope(
        stored_fingerprint=fingerprint,
        **snapshot,
    )

    assert verified.legacy is False
    assert verified.schema_version == 2
    assert verified.policy_evaluation is not None
    assert verified.policy_evaluation.required_policy.value == "destructive_action"


def test_versioned_envelope_rejects_modified_input():
    snapshot = _delete_snapshot()
    fingerprint = approval_envelope_hash(**snapshot)

    with pytest.raises(ApprovalEnvelopeError, match="approval_snapshot_mismatch"):
        verify_approval_envelope(
            stored_fingerprint=fingerprint,
            **_delete_snapshot(
                tool_input={"project_id": 7, "action": "delete", "file_ids": [999]}
            ),
        )


def test_versioned_envelope_rejects_policy_drift_even_with_matching_hash():
    snapshot = _delete_snapshot(policy_at_creation="read_only_tool")
    fingerprint = approval_envelope_hash(**snapshot)

    with pytest.raises(ApprovalEnvelopeError, match="approval_policy_drift"):
        verify_approval_envelope(stored_fingerprint=fingerprint, **snapshot)


def test_versioned_envelope_rejects_risk_downgrade_even_with_matching_hash():
    snapshot = _delete_snapshot(risk_level="high")
    fingerprint = approval_envelope_hash(**snapshot)

    with pytest.raises(ApprovalEnvelopeError, match="approval_risk_downgrade"):
        verify_approval_envelope(stored_fingerprint=fingerprint, **snapshot)


def test_legacy_input_hash_is_checked_and_unbound_legacy_rows_are_identified():
    snapshot = _delete_snapshot()
    legacy_hash = legacy_tool_input_hash(snapshot["tool_input"])

    verified = verify_approval_envelope(
        stored_fingerprint=legacy_hash,
        **snapshot,
    )
    assert verified.legacy is True
    assert verified.schema_version == 1

    with pytest.raises(ApprovalEnvelopeError, match="approval_legacy_input_mismatch"):
        verify_approval_envelope(
            stored_fingerprint=legacy_hash,
            **_delete_snapshot(
                tool_input={"project_id": 7, "action": "delete", "file_ids": [99]}
            ),
        )

    unbound = verify_approval_envelope(stored_fingerprint="", **snapshot)
    assert unbound.legacy is True
    assert unbound.schema_version == 0


def test_durable_markdown_pending_action_is_persisted_with_v2_envelope():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    runtime = SimpleNamespace(
        conv_id=31,
        project_id=7,
        action_policy="modify_existing_file",
        trace_id="trace-31",
    )
    req = SimpleNamespace(project_id=7)
    project_file = SimpleNamespace(id=44, name="方案.md")

    action_id, _, _ = _persist_markdown_continuation_action(
        engine,
        runtime=runtime,
        req=req,
        project_file=project_file,
        revised_content="# 新方案",
        details=["覆盖方案.md"],
    )

    with Session(engine) as session:
        action = session.get(PendingToolAction, action_id)
        assert action is not None
        assert action.tool_input_hash.startswith(APPROVAL_ENVELOPE_PREFIX)
        tool_input = json.loads(action.tool_input_json)
        verified = verify_approval_envelope(
            stored_fingerprint=action.tool_input_hash,
            tool_name=action.tool_name,
            tool_input=tool_input,
            project_id=action.project_id,
            action_type=action.action_type,
            risk_level=action.risk_level,
            policy_at_creation=action.policy_at_creation,
            approval_batch_id=action.approval_batch_id,
            sequence_index=action.sequence_index,
        )
        assert verified.legacy is False


def test_republished_legacy_markdown_action_is_upgraded_before_preview():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    runtime = SimpleNamespace(
        conv_id=32,
        project_id=8,
        action_policy="modify_existing_file",
        trace_id="trace-32",
    )
    req = SimpleNamespace(project_id=8)
    project_file = SimpleNamespace(id=45, name="旧方案.md")
    tool_input = {
        "project_id": 8,
        "mode": "replace",
        "file_id": 45,
        "file_name": "旧方案.md",
        "content": "# 修订",
    }
    with Session(engine) as session:
        legacy = PendingToolAction(
            conversation_id=32,
            project_id=8,
            tool_name="update_project_markdown_document",
            tool_input_json=json.dumps(tool_input, ensure_ascii=False, default=str),
            action_type="modify_document",
            title="旧审批",
        )
        session.add(legacy)
        session.commit()

    action_id, _, _ = _persist_markdown_continuation_action(
        engine,
        runtime=runtime,
        req=req,
        project_file=project_file,
        revised_content="# 修订",
        details=["重新发布"],
    )

    with Session(engine) as session:
        actions = session.exec(select(PendingToolAction)).all()
        assert len(actions) == 1
        assert actions[0].id == action_id
        assert actions[0].risk_level == "high"
        assert actions[0].policy_at_creation == "modify_existing_file"
        assert actions[0].tool_input_hash.startswith(APPROVAL_ENVELOPE_PREFIX)
