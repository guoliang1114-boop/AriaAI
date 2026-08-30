from __future__ import annotations

import json
from collections.abc import Iterator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.database import get_session
from app.models.db import (
    ClientRecord,
    ClientStakeholder,
    ClientStakeholderHistory,
    Project,
    ProjectMember,
    ProjectMemorySummary,
    User,
)
from app.routers import projects_briefing as briefing_module
from app.routers.auth import get_current_user


@pytest.fixture
def project_briefing_api() -> Iterator[tuple[TestClient, object, int]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        actor = User(
            email="project-briefing-writer@example.com",
            password_hash="x",
            display_name="Project Briefing Writer",
        )
        session.add(actor)
        session.commit()
        session.refresh(actor)
        actor_id = int(actor.id)

    app = FastAPI()
    app.include_router(briefing_module.router, prefix="/projects")

    def override_session():
        with Session(engine) as session:
            yield session

    def override_current_user():
        with Session(engine) as session:
            actor = session.get(User, actor_id)
            assert actor is not None
            return actor

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[briefing_module.get_session] = override_session
    app.dependency_overrides[get_current_user] = override_current_user
    with TestClient(app, raise_server_exceptions=False) as api:
        yield api, engine, actor_id
    engine.dispose()


def _seed_project_scope(
    engine,
    *,
    actor_id: int,
    role: str,
) -> tuple[int, int, int]:
    with Session(engine) as session:
        client = ClientRecord(
            name=f"Project client {role}",
            created_by_user_id=actor_id,
            client_memory_stale=False,
        )
        session.add(client)
        session.flush()
        project = Project(
            name=f"Project {role}",
            client=client.name,
            client_id=client.id,
            status="delivering",
            context_memory_json="{}",
            memory_stale=False,
        )
        session.add(project)
        session.flush()
        session.add(
            ProjectMember(
                project_id=int(project.id),
                user_id=actor_id,
                role=role,
            )
        )
        stakeholder = ClientStakeholder(
            client_id=int(client.id),
            name="Finance Sponsor",
            role="CFO",
            note="Manual source",
        )
        session.add(stakeholder)
        session.commit()
        session.refresh(stakeholder)
        return int(project.id), int(client.id), int(stakeholder.id)


def _remove_project_membership(engine, *, project_id: int, actor_id: int) -> None:
    with Session(engine) as session:
        membership = session.exec(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == actor_id,
            )
        ).first()
        assert membership is not None
        session.delete(membership)
        session.commit()


def test_viewer_cannot_use_project_briefing_write_routes(project_briefing_api) -> None:
    api, engine, actor_id = project_briefing_api
    project_id, client_id, stakeholder_id = _seed_project_scope(
        engine,
        actor_id=actor_id,
        role="viewer",
    )
    analyze_model = AsyncMock(return_value="{}")

    with (
        patch.object(
            briefing_module,
            "complete_with_selected_model",
            new=analyze_model,
        ),
        patch.object(briefing_module, "stream_with_selected_model") as stream_model,
    ):
        apply_response = api.post(
            f"/projects/{project_id}/stakeholder-candidates/apply",
            json={"text": "李总监负责预算审批。"},
        )
        analyze_response = api.post(
            f"/projects/{project_id}/stakeholders/{stakeholder_id}/analyze",
            json={"focus": "decision process"},
        )
        refine_response = api.post(
            f"/projects/{project_id}/briefing/refine",
            json={"meeting_type": "risk", "force_refresh": True},
        )
        stream_response = api.post(
            f"/projects/{project_id}/briefing/refine/stream",
            json={"meeting_type": "risk", "force_refresh": True},
        )

    assert apply_response.status_code == 403
    assert analyze_response.status_code == 403
    assert refine_response.status_code == 403
    assert stream_response.status_code == 403
    analyze_model.assert_not_awaited()
    stream_model.assert_not_called()
    with Session(engine) as session:
        assert len(
            session.exec(
                select(ClientStakeholder).where(
                    ClientStakeholder.client_id == client_id
                )
            ).all()
        ) == 1
        assert session.exec(
            select(ProjectMemorySummary).where(
                ProjectMemorySummary.project_id == project_id
            )
        ).all() == []


def test_editor_can_apply_and_analyze_project_stakeholders(project_briefing_api) -> None:
    api, engine, actor_id = project_briefing_api
    project_id, client_id, stakeholder_id = _seed_project_scope(
        engine,
        actor_id=actor_id,
        role="editor",
    )

    apply_response = api.post(
        f"/projects/{project_id}/stakeholder-candidates/apply",
        json={"text": "李总监负责预算审批。"},
    )
    model = AsyncMock(
        return_value=json.dumps(
            {
                "personality_profile": "Evidence-based profile",
                "decision_style": "Consensus",
                "communication_strategy": "Lead with quantified risk",
                "trust_signals": "Shares constraints early",
            }
        )
    )
    with patch.object(
        briefing_module,
        "complete_with_selected_model",
        new=model,
    ):
        analyze_response = api.post(
            f"/projects/{project_id}/stakeholders/{stakeholder_id}/analyze",
            json={"focus": "decision process"},
        )
    refine_model = AsyncMock(return_value="Editor briefing")
    with patch.object(
        briefing_module,
        "complete_with_selected_model",
        new=refine_model,
    ):
        refine_response = api.post(
            f"/projects/{project_id}/briefing/refine",
            json={"meeting_type": "risk", "force_refresh": True},
        )

    assert apply_response.status_code == 200, apply_response.text
    assert apply_response.json()["created"]
    assert analyze_response.status_code == 200, analyze_response.text
    assert analyze_response.json()["personality_profile"] == "Evidence-based profile"
    assert refine_response.status_code == 200, refine_response.text
    assert refine_response.json()["content"] == "Editor briefing"
    with Session(engine) as session:
        stakeholders = session.exec(
            select(ClientStakeholder).where(ClientStakeholder.client_id == client_id)
        ).all()
        assert len(stakeholders) >= 2


def test_stakeholder_analysis_rechecks_membership_after_model_wait(
    project_briefing_api,
) -> None:
    api, engine, actor_id = project_briefing_api
    project_id, _, stakeholder_id = _seed_project_scope(
        engine,
        actor_id=actor_id,
        role="editor",
    )

    async def revoke_then_complete(**_kwargs):
        _remove_project_membership(
            engine,
            project_id=project_id,
            actor_id=actor_id,
        )
        return json.dumps(
            {
                "personality_profile": "Unauthorized model result",
                "decision_style": "Unauthorized model result",
                "communication_strategy": "Unauthorized model result",
                "trust_signals": "Unauthorized model result",
            }
        )

    with patch.object(
        briefing_module,
        "complete_with_selected_model",
        new=revoke_then_complete,
    ):
        response = api.post(
            f"/projects/{project_id}/stakeholders/{stakeholder_id}/analyze",
            json={"focus": "decision process"},
        )

    assert response.status_code == 403, response.text
    with Session(engine) as session:
        stakeholder = session.get(ClientStakeholder, stakeholder_id)
        assert stakeholder is not None
        assert stakeholder.personality_profile == ""
        assert stakeholder.decision_style == ""
        assert session.exec(
            select(ClientStakeholderHistory).where(
                ClientStakeholderHistory.stakeholder_id == stakeholder_id
            )
        ).all() == []


def test_stakeholder_analysis_rejects_same_name_client_reassignment(
    project_briefing_api,
) -> None:
    api, engine, actor_id = project_briefing_api
    project_id, original_client_id, stakeholder_id = _seed_project_scope(
        engine,
        actor_id=actor_id,
        role="editor",
    )

    async def reassign_then_complete(**_kwargs):
        with Session(engine) as session:
            original_client = session.get(ClientRecord, original_client_id)
            assert original_client is not None
            replacement = ClientRecord(
                name=original_client.name,
                created_by_user_id=actor_id,
            )
            session.add(replacement)
            session.flush()
            project = session.get(Project, project_id)
            assert project is not None
            project.client_id = replacement.id
            session.add(project)
            session.commit()
        return json.dumps(
            {
                "personality_profile": "Wrong client result",
                "decision_style": "Wrong client result",
                "communication_strategy": "Wrong client result",
                "trust_signals": "Wrong client result",
            }
        )

    with patch.object(
        briefing_module,
        "complete_with_selected_model",
        new=reassign_then_complete,
    ):
        response = api.post(
            f"/projects/{project_id}/stakeholders/{stakeholder_id}/analyze",
            json={"focus": "decision process"},
        )

    assert response.status_code == 409, response.text
    with Session(engine) as session:
        stakeholder = session.get(ClientStakeholder, stakeholder_id)
        assert stakeholder is not None
        assert stakeholder.personality_profile == ""
        assert stakeholder.decision_style == ""


def test_refine_rechecks_membership_and_does_not_write_failure_receipt(
    project_briefing_api,
) -> None:
    api, engine, actor_id = project_briefing_api
    project_id, _, _ = _seed_project_scope(
        engine,
        actor_id=actor_id,
        role="editor",
    )

    async def revoke_then_fail(**_kwargs):
        _remove_project_membership(
            engine,
            project_id=project_id,
            actor_id=actor_id,
        )
        raise RuntimeError("provider failed after revocation")

    with patch.object(
        briefing_module,
        "complete_with_selected_model",
        new=revoke_then_fail,
    ):
        response = api.post(
            f"/projects/{project_id}/briefing/refine",
            json={"meeting_type": "risk", "force_refresh": True},
        )

    assert response.status_code == 403, response.text
    with Session(engine) as session:
        project = session.get(Project, project_id)
        assert project is not None
        assert "_last_failure" not in json.loads(project.context_memory_json or "{}")
        assert session.exec(
            select(ProjectMemorySummary).where(
                ProjectMemorySummary.project_id == project_id
            )
        ).all() == []


def test_refine_rechecks_membership_before_summary_write(
    project_briefing_api,
) -> None:
    api, engine, actor_id = project_briefing_api
    project_id, _, _ = _seed_project_scope(
        engine,
        actor_id=actor_id,
        role="editor",
    )

    async def revoke_then_complete(**_kwargs):
        _remove_project_membership(
            engine,
            project_id=project_id,
            actor_id=actor_id,
        )
        return "Unauthorized briefing"

    with patch.object(
        briefing_module,
        "complete_with_selected_model",
        new=revoke_then_complete,
    ):
        response = api.post(
            f"/projects/{project_id}/briefing/refine",
            json={"meeting_type": "risk", "force_refresh": True},
        )

    assert response.status_code == 403, response.text
    with Session(engine) as session:
        assert session.exec(
            select(ProjectMemorySummary).where(
                ProjectMemorySummary.project_id == project_id
            )
        ).all() == []


def test_refine_rejects_prompt_source_change_during_model_wait(
    project_briefing_api,
) -> None:
    api, engine, actor_id = project_briefing_api
    project_id, _, _ = _seed_project_scope(
        engine,
        actor_id=actor_id,
        role="editor",
    )

    async def change_source_then_complete(**_kwargs):
        with Session(engine) as write_session:
            project = write_session.get(Project, project_id)
            assert project is not None
            project.description = "New authoritative briefing source"
            write_session.add(project)
            write_session.commit()
        return "Stale briefing generated from the old description"

    with patch.object(
        briefing_module,
        "complete_with_selected_model",
        new=change_source_then_complete,
    ):
        response = api.post(
            f"/projects/{project_id}/briefing/refine",
            json={"meeting_type": "risk", "force_refresh": True},
        )

    assert response.status_code == 409, response.text
    assert "sources changed" in response.json()["detail"]
    with Session(engine) as session:
        project = session.get(Project, project_id)
        assert project is not None
        assert project.description == "New authoritative briefing source"
        assert session.exec(
            select(ProjectMemorySummary).where(
                ProjectMemorySummary.project_id == project_id
            )
        ).all() == []


def test_stream_refine_rechecks_membership_before_cache_write(
    project_briefing_api,
) -> None:
    api, engine, actor_id = project_briefing_api
    project_id, _, _ = _seed_project_scope(
        engine,
        actor_id=actor_id,
        role="editor",
    )

    async def stream_then_revoke(**_kwargs):
        yield "Draft briefing"
        _remove_project_membership(
            engine,
            project_id=project_id,
            actor_id=actor_id,
        )

    with patch.object(
        briefing_module,
        "stream_with_selected_model",
        new=stream_then_revoke,
    ):
        response = api.post(
            f"/projects/{project_id}/briefing/refine/stream",
            json={"meeting_type": "risk", "force_refresh": True},
        )

    assert response.status_code == 200
    assert '"type": "error"' in response.text
    assert '"status_code": 403' in response.text
    with Session(engine) as session:
        assert session.exec(
            select(ProjectMemorySummary).where(
                ProjectMemorySummary.project_id == project_id
            )
        ).all() == []


def test_stream_refine_rejects_prompt_source_change_before_cache_write(
    project_briefing_api,
) -> None:
    api, engine, actor_id = project_briefing_api
    project_id, _, _ = _seed_project_scope(
        engine,
        actor_id=actor_id,
        role="editor",
    )

    async def stream_after_source_change(**_kwargs):
        with Session(engine) as write_session:
            project = write_session.get(Project, project_id)
            assert project is not None
            project.description = "New source committed while streaming"
            write_session.add(project)
            write_session.commit()
        yield "Stale streamed briefing"

    with patch.object(
        briefing_module,
        "stream_with_selected_model",
        new=stream_after_source_change,
    ):
        response = api.post(
            f"/projects/{project_id}/briefing/refine/stream",
            json={"meeting_type": "risk", "force_refresh": True},
        )

    assert response.status_code == 200
    assert '"type": "error"' in response.text
    assert '"status_code": 409' in response.text
    assert "sources changed" in response.text
    with Session(engine) as session:
        assert session.exec(
            select(ProjectMemorySummary).where(
                ProjectMemorySummary.project_id == project_id
            )
        ).all() == []
