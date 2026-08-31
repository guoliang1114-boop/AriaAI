from __future__ import annotations

import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Conversation, Message, Project, ProjectMember, User
from app.routers.chat_conversations import get_conversation_continuity
from app.services.agent_harness.conversation_capsule import (
    advance_conversation_capsule,
    build_conversation_capsule,
)
from app.services.chat.conversation_continuity import (
    build_conversation_continuity_snapshot,
)


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _working_memory() -> SimpleNamespace:
    return SimpleNamespace(
        current_artifact={"project_file_id": 18, "name": "风险清单.md"},
        current_task={"id": 9, "task_type": "analysis", "status": "running"},
        last_user_request="完善风险方案",
        last_assistant_summary="已完成第一轮梳理。",
        user_constraints=[],
        decisions=[{"message_id": 1, "summary": ["采用分阶段交付"]}],
    )


def _seed_ready_state(session: Session) -> tuple[Project, Conversation, User, Message, Message]:
    owner = User(email="continuity-owner@example.com", password_hash="x")
    project = Project(
        name="Continuity",
        client="Test",
        memory_version=3,
        memory_stale=False,
        context_memory_json=json.dumps(
            {
                "open_questions": {
                    "pinned": ["预算上限是多少？"],
                    "ai": ["客户是否确认范围？", "预算上限是多少？"],
                }
            },
            ensure_ascii=False,
        ),
    )
    session.add(owner)
    session.add(project)
    session.flush()
    session.add(ProjectMember(project_id=int(project.id or 0), user_id=int(owner.id or 0), role="owner"))
    conversation = Conversation(
        title="风险工作流",
        project_id=int(project.id or 0),
        owner_user_id=int(owner.id or 0),
    )
    session.add(conversation)
    session.flush()
    source = Message(
        conversation_id=int(conversation.id or 0),
        role="user",
        content="完成风险方案，只分析，不执行。",
    )
    session.add(source)
    session.flush()
    capsule = build_conversation_capsule(
        conversation_id=int(conversation.id or 0),
        project_id=int(project.id or 0),
        history=[source],
        current_content="完成风险方案",
        working_memory=_working_memory(),
        turn_contract={
            "mode": "plan_only",
            "user_goal": "完成风险方案",
            "user_constraints": ["只分析，不执行"],
        },
    )
    capsule = advance_conversation_capsule(
        capsule,
        tool_events=[
            {
                "tool_use_id": "read-risk-1",
                "tool_name": "read_project_file",
                "status": "failed",
                "summary": "风险文件暂不可读",
                "input": {"secret": "must-not-leak"},
            }
        ],
        assistant_summary="尚需恢复风险文件读取。",
    )
    assert capsule is not None
    assistant = Message(
        conversation_id=int(conversation.id or 0),
        role="assistant",
        content="我已经完成第一轮梳理。",
    )
    assistant.set_metadata({"conversation_capsule": capsule})
    session.add(assistant)
    session.commit()
    session.refresh(project)
    session.refresh(conversation)
    session.refresh(owner)
    session.refresh(source)
    session.refresh(assistant)
    return project, conversation, owner, source, assistant


def test_snapshot_projects_only_validated_bounded_continuity_state() -> None:
    session = _session()
    project, conversation, _, source, assistant = _seed_ready_state(session)

    snapshot = build_conversation_continuity_snapshot(session, conversation=conversation)

    assert snapshot["status"] == "ready"
    assert snapshot["project_id"] == project.id
    assert snapshot["state"]["capsule_message_id"] == assistant.id
    assert snapshot["state"]["active_goal"] == "完成风险方案"
    assert snapshot["state"]["turn_mode"] == "plan_only"
    assert snapshot["state"]["confirmed_constraints"] == ["只分析，不执行"]
    assert snapshot["state"]["decisions"] == ["采用分阶段交付"]
    assert snapshot["state"]["source_message_ids"] == [source.id]
    assert snapshot["state"]["blockers"] == [
        {
            "kind": "tool_failure",
            "tool_name": "read_project_file",
            "summary": "风险文件暂不可读",
        }
    ]
    assert snapshot["project_questions"] == {
        "status": "ready",
        "memory_version": 3,
        "stale": False,
        "items": ["客户是否确认范围？", "预算上限是多少？"],
    }
    rendered = json.dumps(snapshot, ensure_ascii=False)
    assert "must-not-leak" not in rendered
    assert "tool_outcomes" not in snapshot["state"]
    assert "last_assistant_summary" not in snapshot["state"]
    assert snapshot["privacy"] == {
        "includes_bounded_conversation_state": True,
        "includes_prompt_content": False,
        "includes_tool_inputs": False,
        "includes_hidden_reasoning": False,
    }


def test_snapshot_fails_closed_when_latest_capsule_is_tampered() -> None:
    session = _session()
    _, conversation, _, _, assistant = _seed_ready_state(session)
    tampered = deepcopy(assistant.get_metadata()["conversation_capsule"])
    tampered["active_goal"] = "被篡改的目标"
    assistant.set_metadata({"conversation_capsule": tampered})
    session.add(assistant)
    session.commit()

    snapshot = build_conversation_continuity_snapshot(session, conversation=conversation)

    assert snapshot["status"] == "invalid"
    assert snapshot["reason_code"] == "capsule_fingerprint_mismatch"
    assert snapshot["state"] is None
    assert "被篡改的目标" not in json.dumps(snapshot, ensure_ascii=False)


def test_snapshot_rejects_capsule_sources_from_another_conversation() -> None:
    session = _session()
    project, conversation, _, _, assistant = _seed_ready_state(session)
    other_conversation = Conversation(title="Other", project_id=project.id)
    session.add(other_conversation)
    session.flush()
    foreign_source = Message(
        conversation_id=int(other_conversation.id or 0),
        role="user",
        content="other scope",
    )
    session.add(foreign_source)
    session.flush()
    capsule = build_conversation_capsule(
        conversation_id=int(conversation.id or 0),
        project_id=int(project.id or 0),
        history=[foreign_source],
        current_content="继续",
        working_memory=_working_memory(),
        turn_contract={"mode": "execute_now", "user_goal": "继续"},
    )
    assistant.set_metadata({"conversation_capsule": capsule})
    session.add(assistant)
    session.commit()

    snapshot = build_conversation_continuity_snapshot(session, conversation=conversation)

    assert snapshot["status"] == "invalid"
    assert snapshot["reason_code"] == "source_message_scope_mismatch"
    assert snapshot["state"] is None


def test_continuity_route_enforces_conversation_acl() -> None:
    session = _session()
    _, conversation, owner, _, _ = _seed_ready_state(session)
    outsider = User(email="continuity-outsider@example.com", password_hash="x")
    session.add(outsider)
    session.commit()
    session.refresh(outsider)

    allowed = get_conversation_continuity(
        int(conversation.id or 0),
        session=session,
        current_user=owner,
    )
    assert allowed["status"] == "ready"

    with pytest.raises(Exception) as exc:
        get_conversation_continuity(
            int(conversation.id or 0),
            session=session,
            current_user=outsider,
        )
    assert getattr(exc.value, "status_code", None) == 403


def test_snapshot_is_unavailable_without_a_persisted_capsule() -> None:
    session = _session()
    conversation = Conversation(title="Empty", owner_user_id=7)
    session.add(conversation)
    session.commit()
    session.refresh(conversation)

    snapshot = build_conversation_continuity_snapshot(session, conversation=conversation)

    assert snapshot["status"] == "unavailable"
    assert snapshot["reason_code"] == "capsule_not_available"
    assert snapshot["state"] is None
    assert snapshot["project_questions"]["status"] == "not_applicable"
