from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    Conversation,
    Message,
    Project,
    ProjectMember,
    ProjectQuestionProfile,
    ProjectQuestionProfileEvent,
    User,
)
from app.routers.chat_schemas import (
    ReopenProjectQuestionRequest,
    ResolveProjectQuestionRequest,
)
from app.routers.projects_questions import (
    UpdateProjectQuestionProfileRequest,
    patch_project_question_profile,
    reopen_project_workbench_question,
    resolve_project_workbench_question,
)
from app.services.project_contexts import save_project_memory
from app.services.project_question_workbench import (
    build_project_question_workbench,
    update_project_question_profile,
)
from app.services.project_question_resolutions import project_question_sha256


QUESTION = "客户是否确认了最终验收范围？"


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _seed():
    session = _session()
    owner = User(
        email="workbench-owner@example.com",
        display_name="项目负责人",
        password_hash="x",
    )
    viewer = User(
        email="workbench-viewer@example.com",
        display_name="只读成员",
        password_hash="x",
    )
    outsider = User(
        email="workbench-outsider@example.com",
        display_name="项目外用户",
        password_hash="x",
    )
    project = Project(name="Question workbench", client="Test")
    other_project = Project(name="Other project", client="Test")
    session.add(owner)
    session.add(viewer)
    session.add(outsider)
    session.add(project)
    session.add(other_project)
    session.flush()
    session.add(
        ProjectMember(
            project_id=int(project.id or 0),
            user_id=int(owner.id or 0),
            role="owner",
        )
    )
    session.add(
        ProjectMember(
            project_id=int(project.id or 0),
            user_id=int(viewer.id or 0),
            role="viewer",
        )
    )
    conversations = [
        Conversation(
            title="范围讨论",
            project_id=int(project.id or 0),
            owner_user_id=int(owner.id or 0),
        ),
        Conversation(
            title="验收讨论",
            project_id=int(project.id or 0),
            owner_user_id=int(owner.id or 0),
        ),
        Conversation(
            title="其他项目",
            project_id=int(other_project.id or 0),
            owner_user_id=int(outsider.id or 0),
        ),
    ]
    for conversation in conversations:
        session.add(conversation)
    session.flush()
    answers = [
        Message(
            conversation_id=int(conversations[0].id or 0),
            role="assistant",
            content="A" * 420,
        ),
        Message(
            conversation_id=int(conversations[1].id or 0),
            role="assistant",
            content="客户已经书面确认最终验收范围。",
        ),
        Message(
            conversation_id=int(conversations[2].id or 0),
            role="assistant",
            content="其他项目的回答",
        ),
    ]
    for answer in answers:
        session.add(answer)
    session.commit()
    save_project_memory(
        session,
        int(project.id or 0),
        {
            "open_questions": {"ai": [QUESTION], "pinned": []},
            "_coverage": {},
        },
        trigger="question_workbench_seed",
    )
    for value in [owner, viewer, outsider, project, other_project, *conversations, *answers]:
        session.refresh(value)
    return session, owner, viewer, outsider, project, conversations, answers


def test_workbench_composes_open_questions_members_and_bounded_project_answers() -> None:
    session, owner, _, _, project, conversations, answers = _seed()

    payload = build_project_question_workbench(
        session,
        project=project,
        current_user=owner,
    )

    assert payload["schema_version"] == 1
    assert payload["can_write"] is True
    assert payload["memory"]["status"] == "ready"
    assert payload["counts"] == {"open": 1, "needs_review": 0, "resolved": 0}
    assert payload["questions"][0]["question"] == QUESTION
    assert payload["questions"][0]["profile"]["revision"] == 0
    assert [item["display_name"] for item in payload["members"]] == [
        "项目负责人",
        "只读成员",
    ]
    candidate_ids = {item["message_id"] for item in payload["answer_candidates"]}
    assert candidate_ids == {answers[0].id, answers[1].id}
    assert answers[2].id not in candidate_ids
    long_preview = next(
        item["preview"]
        for item in payload["answer_candidates"]
        if item["conversation_id"] == conversations[0].id
    )
    assert len(long_preview) == 280
    assert all("content" not in item for item in payload["answer_candidates"])
    assert payload["privacy"]["includes_full_answer_content"] is False


def test_workbench_withholds_answer_previews_from_viewers_and_stale_memory() -> None:
    session, owner, viewer, _, project, _, _ = _seed()

    viewer_payload = build_project_question_workbench(
        session,
        project=project,
        current_user=viewer,
    )
    assert viewer_payload["can_write"] is False
    assert viewer_payload["answer_candidates"] == []
    assert viewer_payload["privacy"]["includes_bounded_answer_previews"] is False

    project.memory_stale = True
    session.add(project)
    session.commit()
    session.refresh(project)
    stale_payload = build_project_question_workbench(
        session,
        project=project,
        current_user=owner,
    )
    assert stale_payload["memory"]["status"] == "stale"
    assert stale_payload["answer_candidates"] == []


def test_profile_cas_and_append_only_audit_preserve_each_revision() -> None:
    session, owner, viewer, _, project, _, _ = _seed()
    identity = project_question_sha256(QUESTION)

    first = update_project_question_profile(
        session,
        project_id=int(project.id or 0),
        actor_user_id=int(owner.id or 0),
        question=QUESTION,
        question_sha256=identity,
        owner_user_id=int(viewer.id or 0),
        priority="high",
        due_date="2026-09-15",
        expected_revision=0,
    )
    assert first.revision == 1
    assert first.owner_user_id == viewer.id

    second = update_project_question_profile(
        session,
        project_id=int(project.id or 0),
        actor_user_id=int(owner.id or 0),
        question=QUESTION,
        question_sha256=identity,
        owner_user_id=int(owner.id or 0),
        priority="critical",
        due_date="",
        expected_revision=1,
    )
    assert second.revision == 2
    events = session.exec(
        select(ProjectQuestionProfileEvent).order_by(
            ProjectQuestionProfileEvent.revision
        )
    ).all()
    assert [event.revision for event in events] == [1, 2]
    assert events[0].previous_owner_user_id is None
    assert events[0].owner_user_id == viewer.id
    assert events[1].previous_owner_user_id == viewer.id
    assert events[1].owner_user_id == owner.id
    assert events[1].previous_due_date == "2026-09-15"

    with pytest.raises(HTTPException) as exc:
        update_project_question_profile(
            session,
            project_id=int(project.id or 0),
            actor_user_id=int(owner.id or 0),
            question=QUESTION,
            question_sha256=identity,
            owner_user_id=None,
            priority="normal",
            due_date=None,
            expected_revision=1,
        )
    assert exc.value.status_code == 409
    session.rollback()
    assert session.exec(select(ProjectQuestionProfile)).one().revision == 2
    assert len(session.exec(select(ProjectQuestionProfileEvent)).all()) == 2


def test_profile_rejects_non_member_owner_and_viewer_write() -> None:
    session, owner, viewer, outsider, project, _, _ = _seed()
    identity = project_question_sha256(QUESTION)

    with pytest.raises(HTTPException) as exc:
        update_project_question_profile(
            session,
            project_id=int(project.id or 0),
            actor_user_id=int(owner.id or 0),
            question=QUESTION,
            question_sha256=identity,
            owner_user_id=int(outsider.id or 0),
            priority="high",
            due_date="2026-09-15",
            expected_revision=0,
        )
    assert exc.value.status_code == 400
    session.rollback()

    with pytest.raises(HTTPException) as exc:
        patch_project_question_profile(
            int(project.id or 0),
            identity,
            UpdateProjectQuestionProfileRequest(
                question=QUESTION,
                priority="normal",
                expected_revision=0,
            ),
            session=session,
            current_user=viewer,
        )
    assert exc.value.status_code == 403
    assert session.exec(select(ProjectQuestionProfile)).all() == []


def test_project_route_selects_cross_conversation_answer_and_reopens_without_source_scope() -> None:
    session, owner, _, _, project, conversations, answers = _seed()
    before = build_project_question_workbench(
        session,
        project=project,
        current_user=owner,
    )

    resolved = resolve_project_workbench_question(
        int(project.id or 0),
        ResolveProjectQuestionRequest(
            question=QUESTION,
            answer_message_id=int(answers[1].id or 0),
            resolution_summary="书面确认已经归档并核对。",
            expected_memory_version=before["memory"]["memory_version"],
            expected_slot_version=before["memory"]["slot_version"],
        ),
        session=session,
        current_user=owner,
    )
    item = resolved["questions"][0]
    assert item["status"] == "resolved"
    assert item["resolution"]["answer_conversation_id"] == conversations[1].id
    assert resolved["counts"]["open"] == 0

    reopened = reopen_project_workbench_question(
        int(project.id or 0),
        item["resolution"]["id"],
        ReopenProjectQuestionRequest(
            reason="客户补充了新的验收例外。",
            expected_resolution_revision=item["resolution"]["resolution_revision"],
            expected_memory_version=resolved["memory"]["memory_version"],
            expected_slot_version=resolved["memory"]["slot_version"],
        ),
        session=session,
        current_user=owner,
    )
    assert reopened["counts"]["open"] == 1
    assert reopened["questions"][0]["status"] == "open"


def test_project_route_rejects_answer_from_another_project() -> None:
    session, owner, _, _, project, _, answers = _seed()
    before = build_project_question_workbench(
        session,
        project=project,
        current_user=owner,
    )

    with pytest.raises(HTTPException) as exc:
        resolve_project_workbench_question(
            int(project.id or 0),
            ResolveProjectQuestionRequest(
                question=QUESTION,
                answer_message_id=int(answers[2].id or 0),
                resolution_summary="不能绑定其他项目回答。",
                expected_memory_version=before["memory"]["memory_version"],
                expected_slot_version=before["memory"]["slot_version"],
            ),
            session=session,
            current_user=owner,
        )
    assert exc.value.status_code == 409
