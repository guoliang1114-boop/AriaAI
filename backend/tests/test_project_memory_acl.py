from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app import database as database_module
from app.models.db import (
    Project,
    ProjectMember,
    ProjectMemorySnapshot,
    ProjectMemorySummary,
    User,
)
from app.routers import projects_deps, projects_memory
from app.routers.auth import get_current_user


_READY_MEMORY = {
    "project_brief": "ACL project brief",
    "current_stage": "delivery",
    "current_objective": "Ship safely",
    "recent_progress": [],
    "key_risks": {"ai": [], "pinned": []},
    "open_questions": {"ai": [], "pinned": []},
    "next_actions": [],
    "important_documents": [],
    "financial_status": "",
    "delivery_signals": [],
    "stakeholder_notes": {"ai": [], "pinned": []},
    "client_stakeholders": [],
    "memory_version": 1,
    "stale": False,
    "rebuild_log": [],
    "_coverage": {},
}


class ProjectMemoryAclTestCase(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        database_path = Path(self.tmpdir.name) / "project-memory-acl.db"
        self.engine = create_engine(
            f"sqlite:///{database_path}",
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            session.add_all(
                [
                    User(
                        id=1,
                        email="owner-project-memory@example.com",
                        display_name="Owner",
                        password_hash="h",
                    ),
                    User(
                        id=2,
                        email="viewer-project-memory@example.com",
                        display_name="Viewer",
                        password_hash="h",
                    ),
                    User(
                        id=3,
                        email="admin-project-memory@example.com",
                        display_name="Admin",
                        password_hash="h",
                        is_admin=True,
                    ),
                ]
            )
            session.commit()
            project = Project(
                name="Project Memory ACL",
                client="ACL Client",
                context_summary="original context",
                context_memory_json=json.dumps(_READY_MEMORY),
                memory_version=1,
                memory_stale=False,
            )
            session.add(project)
            session.flush()
            session.add_all(
                [
                    ProjectMember(project_id=project.id, user_id=1, role="owner"),
                    ProjectMember(project_id=project.id, user_id=2, role="viewer"),
                ]
            )
            snapshot = ProjectMemorySnapshot(
                project_id=project.id,
                memory_version=1,
                trigger="baseline",
                memory_json=json.dumps(_READY_MEMORY),
            )
            session.add(snapshot)
            session.commit()
            self.project_id = int(project.id)
            self.snapshot_id = int(snapshot.id)

        self.current_user_id = 1

        def override_session():
            with Session(self.engine) as session:
                yield session

        def override_current_user():
            with Session(self.engine) as session:
                user = session.get(User, self.current_user_id)
                assert user is not None
                return user

        app = FastAPI()
        app.include_router(projects_memory.router, prefix="/projects")
        app.dependency_overrides[database_module.get_session] = override_session
        app.dependency_overrides[get_current_user] = override_current_user
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()
        self.tmpdir.cleanup()

    def _delete_owner_membership(self) -> None:
        with Session(self.engine) as session:
            member = session.exec(
                select(ProjectMember).where(
                    ProjectMember.project_id == self.project_id,
                    ProjectMember.user_id == 1,
                )
            ).one()
            session.delete(member)
            session.commit()

    def _deactivate_owner(self) -> None:
        with Session(self.engine) as session:
            owner = session.get(User, 1)
            assert owner is not None
            owner.is_active = False
            session.add(owner)
            session.commit()

    def _assert_no_generated_memory_side_effects(self) -> None:
        with Session(self.engine) as session:
            project = session.get(Project, self.project_id)
            assert project is not None
            memory = json.loads(project.context_memory_json or "{}")
            summaries = session.exec(
                select(ProjectMemorySummary).where(
                    ProjectMemorySummary.project_id == self.project_id
                )
            ).all()
            snapshots = session.exec(
                select(ProjectMemorySnapshot).where(
                    ProjectMemorySnapshot.project_id == self.project_id
                )
            ).all()

        self.assertEqual(project.context_summary, "original context")
        self.assertEqual(project.memory_version, 1)
        self.assertNotIn("_last_failure", memory)
        self.assertEqual(summaries, [])
        self.assertEqual(len(snapshots), 1)

    def test_viewer_can_read_but_all_project_memory_writes_are_forbidden(self):
        self.current_user_id = 2
        self.assertEqual(
            self.client.get(f"/projects/{self.project_id}/memory").status_code,
            200,
        )
        write_requests = [
            ("post", f"/projects/{self.project_id}/generate-context", None),
            (
                "patch",
                f"/projects/{self.project_id}/memory/slots/key_risks",
                {"pinned": ["viewer must not write"]},
            ),
            ("post", f"/projects/{self.project_id}/memory/rebuild", None),
            (
                "post",
                f"/projects/memory/jobs/{self.project_id}/cancel",
                None,
            ),
            (
                "post",
                f"/projects/memory/jobs/{self.project_id}/run-now",
                None,
            ),
            (
                "post",
                f"/projects/{self.project_id}/memory/summarize",
                {"rebuild_if_stale": False, "force_refresh": True},
            ),
            (
                "post",
                f"/projects/{self.project_id}/memory/summaries/generate",
                {"rebuild_if_stale": False, "force_refresh": True},
            ),
            (
                "post",
                (
                    f"/projects/{self.project_id}/memory/snapshots/"
                    f"{self.snapshot_id}/rollback"
                ),
                None,
            ),
            (
                "post",
                "/projects/memory/rebuild-batch",
                {"project_ids": [self.project_id]},
            ),
            (
                "post",
                "/projects/memory/warm-summaries-batch",
                {"project_ids": [self.project_id]},
            ),
        ]

        with patch.object(
            projects_memory,
            "complete_with_selected_model",
            new=AsyncMock(side_effect=AssertionError("provider must not run")),
        ), patch.object(
            projects_memory.scheduler_service,
            "remove_job",
            side_effect=AssertionError("scheduler must not change"),
        ):
            for method, path, payload in write_requests:
                with self.subTest(path=path):
                    response = self.client.request(method, path, json=payload)
                    self.assertEqual(response.status_code, 403, response.text)

        self._assert_no_generated_memory_side_effects()

    def test_admin_batch_rebuild_passes_the_authenticated_actor(self):
        self.current_user_id = 3
        rebuild = AsyncMock(
            return_value={
                "memory_version": 2,
                "last_updated_at": "2026-08-30T00:00:00",
            }
        )
        with patch.object(
            projects_memory,
            "_rebuild_project_memory",
            new=rebuild,
        ), patch.object(
            projects_memory.scheduler_service,
            "remove_job",
        ), patch.object(
            projects_memory,
            "_schedule_project_memory_summary_warm",
            return_value=False,
        ):
            response = self.client.post(
                "/projects/memory/rebuild-batch",
                json={"project_ids": [self.project_id]},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(rebuild.await_count, 1)
        self.assertEqual(rebuild.await_args.kwargs["actor_user_id"], 3)

    def test_admin_inline_warm_passes_the_authenticated_actor(self):
        self.current_user_id = 3
        warm = AsyncMock(return_value=["overview"])
        with patch.object(
            projects_memory.scheduler_service,
            "is_running",
            return_value=False,
        ), patch.object(
            projects_memory,
            "_warm_project_memory_summary_caches",
            new=warm,
        ):
            response = self.client.post(
                "/projects/memory/warm-summaries-batch",
                json={
                    "project_ids": [self.project_id],
                    "summary_types": ["overview"],
                    "force_refresh": True,
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(warm.await_count, 1)
        self.assertEqual(warm.await_args.kwargs["actor_user_id"], 3)

    def test_streaming_summary_rechecks_active_actor_before_cache_write(self):
        async def deactivate_then_stream(*_args, **_kwargs):
            self._deactivate_owner()
            yield "revoked summary"

        with patch.object(
            projects_memory,
            "stream_with_selected_model",
            new=deactivate_then_stream,
        ), patch.object(database_module, "engine", self.engine):
            response = self.client.post(
                f"/projects/{self.project_id}/memory/summarize",
                json={
                    "summary_type": "risk",
                    "rebuild_if_stale": False,
                    "stream": True,
                    "force_refresh": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn('"type": "error"', response.text)
        self.assertNotIn('"type": "done"', response.text)
        self._assert_no_generated_memory_side_effects()

    def test_streaming_context_failure_after_membership_revocation_writes_no_receipt(self):
        async def revoke_then_fail(*_args, **_kwargs):
            self._delete_owner_membership()
            raise RuntimeError("provider failed after revocation")
            yield  # pragma: no cover

        with patch.object(
            projects_memory,
            "stream_with_selected_model",
            new=revoke_then_fail,
        ), patch.object(database_module, "engine", self.engine):
            response = self.client.post(
                f"/projects/{self.project_id}/generate-context"
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("provider failed after revocation", response.text)
        self.assertNotIn('"type": "done"', response.text)
        self._assert_no_generated_memory_side_effects()

    def test_non_stream_summary_rechecks_membership_before_cache_write(self):
        async def revoke_then_complete(**_kwargs):
            self._delete_owner_membership()
            return "revoked summary"

        with patch.object(
            projects_memory,
            "complete_with_selected_model",
            new=revoke_then_complete,
        ):
            response = self.client.post(
                f"/projects/{self.project_id}/memory/summarize",
                json={
                    "summary_type": "risk",
                    "rebuild_if_stale": False,
                    "stream": False,
                    "force_refresh": True,
                },
            )

        self.assertEqual(response.status_code, 403, response.text)
        self._assert_no_generated_memory_side_effects()

    def test_non_stream_summary_failure_after_deactivation_writes_no_receipt(self):
        async def deactivate_then_fail(**_kwargs):
            self._deactivate_owner()
            raise RuntimeError("summary provider failure")

        with patch.object(
            projects_memory,
            "complete_with_selected_model",
            new=deactivate_then_fail,
        ):
            response = self.client.post(
                f"/projects/{self.project_id}/memory/summarize",
                json={
                    "summary_type": "risk",
                    "rebuild_if_stale": False,
                    "stream": False,
                    "force_refresh": True,
                },
            )

        self.assertEqual(response.status_code, 500)
        self._assert_no_generated_memory_side_effects()

    def test_rebuild_rechecks_membership_before_memory_or_scheduler_write(self):
        with Session(self.engine) as session:
            project = session.get(Project, self.project_id)
            assert project is not None
            project.context_memory_json = "{}"
            project.memory_version = 0
            project.memory_stale = True
            session.add(project)
            session.commit()

        async def revoke_then_complete(**_kwargs):
            self._delete_owner_membership()
            return "{}"

        with patch.object(
            projects_deps,
            "complete_with_selected_model",
            new=revoke_then_complete,
        ), patch.object(projects_memory.scheduler_service, "remove_job") as remove_job:
            response = self.client.post(
                f"/projects/{self.project_id}/memory/rebuild"
            )

        self.assertEqual(response.status_code, 403, response.text)
        remove_job.assert_not_called()
        with Session(self.engine) as session:
            project = session.get(Project, self.project_id)
            assert project is not None
            memory = json.loads(project.context_memory_json or "{}")
            snapshots = session.exec(
                select(ProjectMemorySnapshot).where(
                    ProjectMemorySnapshot.project_id == self.project_id
                )
            ).all()
        self.assertEqual(project.memory_version, 0)
        self.assertTrue(project.memory_stale)
        self.assertNotIn("_last_failure", memory)
        self.assertEqual(len(snapshots), 1)

    def test_rebuild_failure_after_deactivation_writes_no_receipt_or_scheduler_state(self):
        with Session(self.engine) as session:
            project = session.get(Project, self.project_id)
            assert project is not None
            project.context_memory_json = "{}"
            project.memory_version = 0
            project.memory_stale = True
            session.add(project)
            session.commit()

        async def deactivate_then_fail(**_kwargs):
            self._deactivate_owner()
            raise RuntimeError("rebuild provider failure")

        with patch.object(
            projects_deps,
            "complete_with_selected_model",
            new=deactivate_then_fail,
        ), patch.object(projects_memory.scheduler_service, "remove_job") as remove_job:
            response = self.client.post(
                f"/projects/{self.project_id}/memory/rebuild"
            )

        self.assertEqual(response.status_code, 500)
        remove_job.assert_not_called()
        with Session(self.engine) as session:
            project = session.get(Project, self.project_id)
            assert project is not None
            memory = json.loads(project.context_memory_json or "{}")
        self.assertEqual(project.memory_version, 0)
        self.assertTrue(project.memory_stale)
        self.assertNotIn("_last_failure", memory)


if __name__ == "__main__":
    unittest.main()
