from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    Conversation,
    Message,
    Project,
    ProjectMemoryFact,
    ProjectMember,
    ProjectQuestionResolution,
    ProjectQuestionResolutionEvent,
    User,
)
from app.routers.chat_conversations import (
    reopen_conversation_project_question,
    resolve_conversation_project_question,
)
from app.routers.chat_schemas import (
    ReopenProjectQuestionRequest,
    ResolveProjectQuestionRequest,
)
from app.services.chat.conversation_continuity import (
    build_conversation_continuity_snapshot,
)
from app.services.project_contexts import (
    _get_existing_raw_memory,
    save_project_memory,
)


QUESTION = "客户是否已经确认验收范围？"


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _seed() -> tuple[Session, Project, Conversation, User, Message]:
    session = _session()
    owner = User(email="question-owner@example.com", password_hash="x")
    project = Project(name="Question closure", client="Test")
    session.add(owner)
    session.add(project)
    session.flush()
    session.add(
        ProjectMember(
            project_id=int(project.id or 0),
            user_id=int(owner.id or 0),
            role="owner",
        )
    )
    conversation = Conversation(
        title="Scope answer",
        project_id=int(project.id or 0),
        owner_user_id=int(owner.id or 0),
    )
    session.add(conversation)
    session.flush()
    answer = Message(
        conversation_id=int(conversation.id or 0),
        role="assistant",
        content="客户已在 8 月 31 日书面确认验收范围。",
    )
    session.add(answer)
    session.commit()
    save_project_memory(
        session,
        int(project.id or 0),
        {
            "open_questions": {"ai": [QUESTION], "pinned": [QUESTION]},
            "_accepted_memory_candidates": {"open_questions": [QUESTION]},
            "_coverage": {},
        },
        trigger="test_seed",
    )
    session.refresh(project)
    session.refresh(conversation)
    session.refresh(owner)
    session.refresh(answer)
    return session, project, conversation, owner, answer


def _resolve(
    session: Session,
    project: Project,
    conversation: Conversation,
    owner: User,
    answer: Message,
):
    snapshot = build_conversation_continuity_snapshot(session, conversation=conversation)
    questions = snapshot["project_questions"]
    return resolve_conversation_project_question(
        int(conversation.id or 0),
        ResolveProjectQuestionRequest(
            question=QUESTION,
            answer_message_id=int(answer.id or 0),
            resolution_summary="客户书面确认已覆盖当前验收边界。",
            expected_memory_version=questions["memory_version"],
            expected_slot_version=questions["slot_version"],
        ),
        session=session,
        current_user=owner,
    )


def test_resolution_atomically_retires_question_and_binds_assistant_answer() -> None:
    session, project, conversation, owner, answer = _seed()

    result = _resolve(session, project, conversation, owner, answer)

    assert result["schema_version"] == 2
    assert result["project_questions"]["items"] == []
    assert len(result["project_questions"]["resolved"]) == 1
    projection = result["project_questions"]["resolved"][0]
    assert projection["status"] == "resolved"
    assert projection["answer_message_id"] == answer.id
    assert projection["answer_conversation_id"] == conversation.id
    assert projection["answer_available"] is True

    row = session.exec(select(ProjectQuestionResolution)).one()
    assert row.status == "resolved"
    assert row.resolution_revision == 1
    assert row.resolved_memory_version == 2
    assert row.question_fact_key
    events = session.exec(
        select(ProjectQuestionResolutionEvent).order_by(
            ProjectQuestionResolutionEvent.resolution_revision
        )
    ).all()
    assert [(item.action, item.note) for item in events] == [
        ("resolved", "客户书面确认已覆盖当前验收边界。")
    ]
    fact = session.exec(
        select(ProjectMemoryFact).where(
            ProjectMemoryFact.fact_key == row.question_fact_key
        )
    ).one()
    assert fact.is_active is False

    session.refresh(project)
    raw = _get_existing_raw_memory(project)
    assert raw["open_questions"] == {"ai": [], "pinned": []}
    assert raw["_accepted_memory_candidates"]["open_questions"] == []


def test_reopen_returns_question_as_user_pinned_anchor() -> None:
    session, project, conversation, owner, answer = _seed()
    resolved = _resolve(session, project, conversation, owner, answer)
    resolution = resolved["project_questions"]["resolved"][0]

    reopened = reopen_conversation_project_question(
        int(conversation.id or 0),
        int(resolution["id"]),
        ReopenProjectQuestionRequest(
            reason="客户新增了验收例外，需要再次确认。",
            expected_resolution_revision=resolution["resolution_revision"],
            expected_memory_version=resolved["project_questions"]["memory_version"],
            expected_slot_version=resolved["project_questions"]["slot_version"],
        ),
        session=session,
        current_user=owner,
    )

    assert reopened["project_questions"]["items"] == [QUESTION]
    assert reopened["project_questions"]["resolved"] == []
    row = session.exec(select(ProjectQuestionResolution)).one()
    assert row.status == "open"
    assert row.resolution_revision == 2
    assert row.reopen_reason == "客户新增了验收例外，需要再次确认。"
    events = session.exec(
        select(ProjectQuestionResolutionEvent).order_by(
            ProjectQuestionResolutionEvent.resolution_revision
        )
    ).all()
    assert [(item.action, item.resolution_revision) for item in events] == [
        ("resolved", 1),
        ("reopened", 2),
    ]
    assert events[0].answer_message_id == answer.id
    assert events[1].note == "客户新增了验收例外，需要再次确认。"
    session.refresh(project)
    assert _get_existing_raw_memory(project)["open_questions"]["pinned"] == [QUESTION]

    revised_answer = Message(
        conversation_id=int(conversation.id or 0),
        role="assistant",
        content="客户已对新增例外完成二次确认。",
    )
    session.add(revised_answer)
    session.commit()
    session.refresh(revised_answer)
    resolved_again = resolve_conversation_project_question(
        int(conversation.id or 0),
        ResolveProjectQuestionRequest(
            question=QUESTION,
            answer_message_id=int(revised_answer.id or 0),
            resolution_summary="新增例外已经二次书面确认。",
            expected_memory_version=reopened["project_questions"]["memory_version"],
            expected_slot_version=reopened["project_questions"]["slot_version"],
        ),
        session=session,
        current_user=owner,
    )
    assert resolved_again["project_questions"]["items"] == []
    events = session.exec(
        select(ProjectQuestionResolutionEvent).order_by(
            ProjectQuestionResolutionEvent.resolution_revision
        )
    ).all()
    assert [(item.action, item.resolution_revision) for item in events] == [
        ("resolved", 1),
        ("reopened", 2),
        ("resolved", 3),
    ]
    assert events[0].answer_message_id == answer.id
    assert events[2].answer_message_id == revised_answer.id
    assert events[2].note == "新增例外已经二次书面确认。"


def test_resolution_rejects_stale_memory_version_without_partial_write() -> None:
    session, project, conversation, owner, answer = _seed()
    snapshot = build_conversation_continuity_snapshot(session, conversation=conversation)
    raw = _get_existing_raw_memory(project)
    raw["current_objective"] = "New objective"
    save_project_memory(
        session,
        int(project.id or 0),
        raw,
        trigger="concurrent_change",
        rebuilt_slots=("current_objective",),
    )

    with pytest.raises(HTTPException) as exc:
        resolve_conversation_project_question(
            int(conversation.id or 0),
            ResolveProjectQuestionRequest(
                question=QUESTION,
                answer_message_id=int(answer.id or 0),
                resolution_summary="旧页面尝试关单。",
                expected_memory_version=snapshot["project_questions"]["memory_version"],
                expected_slot_version=snapshot["project_questions"]["slot_version"],
            ),
            session=session,
            current_user=owner,
        )
    assert exc.value.status_code == 409
    session.rollback()
    assert session.exec(select(ProjectQuestionResolution)).all() == []
    session.refresh(project)
    assert QUESTION in _get_existing_raw_memory(project)["open_questions"]["ai"]


def test_resolution_rejects_answer_from_another_conversation() -> None:
    session, project, conversation, owner, _ = _seed()
    other = Conversation(
        title="Other",
        project_id=int(project.id or 0),
        owner_user_id=int(owner.id or 0),
    )
    session.add(other)
    session.flush()
    foreign_answer = Message(
        conversation_id=int(other.id or 0),
        role="assistant",
        content="Out of scope",
    )
    session.add(foreign_answer)
    session.commit()
    snapshot = build_conversation_continuity_snapshot(session, conversation=conversation)

    with pytest.raises(HTTPException) as exc:
        resolve_conversation_project_question(
            int(conversation.id or 0),
            ResolveProjectQuestionRequest(
                question=QUESTION,
                answer_message_id=int(foreign_answer.id or 0),
                resolution_summary="错误绑定。",
                expected_memory_version=snapshot["project_questions"]["memory_version"],
                expected_slot_version=snapshot["project_questions"]["slot_version"],
            ),
            session=session,
            current_user=owner,
        )
    assert exc.value.status_code == 409
    session.rollback()
    assert session.exec(select(ProjectQuestionResolution)).all() == []


def test_resolution_route_rejects_viewer_and_memory_change_flags_review() -> None:
    session, project, conversation, owner, answer = _seed()
    viewer = User(email="question-viewer@example.com", password_hash="x")
    session.add(viewer)
    session.flush()
    session.add(
        ProjectMember(
            project_id=int(project.id or 0),
            user_id=int(viewer.id or 0),
            role="viewer",
        )
    )
    session.commit()
    session.refresh(viewer)
    before = build_conversation_continuity_snapshot(session, conversation=conversation)
    with pytest.raises(HTTPException) as exc:
        resolve_conversation_project_question(
            int(conversation.id or 0),
            ResolveProjectQuestionRequest(
                question=QUESTION,
                answer_message_id=int(answer.id or 0),
                resolution_summary="只读成员不能关单。",
                expected_memory_version=before["project_questions"]["memory_version"],
                expected_slot_version=before["project_questions"]["slot_version"],
            ),
            session=session,
            current_user=viewer,
        )
    assert exc.value.status_code == 403
    session.rollback()

    resolved = _resolve(session, project, conversation, owner, answer)
    session.refresh(project)
    raw = _get_existing_raw_memory(project)
    raw["current_objective"] = "范围变化后的目标"
    save_project_memory(
        session,
        int(project.id or 0),
        raw,
        trigger="memory_changed_after_resolution",
        rebuilt_slots=("current_objective",),
    )
    reviewed = build_conversation_continuity_snapshot(session, conversation=conversation)
    item = reviewed["project_questions"]["resolved"][0]
    assert item["status"] == "needs_review"
    assert item["review_reason"] == "project_memory_changed"
    assert item["resolved_memory_version"] == resolved["project_questions"]["memory_version"]
