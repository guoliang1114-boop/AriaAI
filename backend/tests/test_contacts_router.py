"""Integration tests for the cross-client contact lookup endpoint.

Covers the optimisation that replaced the ContactDetail page's
N+1 stakeholder fan-out (one ``/clients/{id}/stakeholders`` call per
client) with a single ``/contacts/{id}`` round-trip.
"""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app.models.db import (
    ClientRecord,
    ClientStakeholder,
    ClientStakeholderHistory,
    KnowledgeDocument,
    Project,
)
from app.routers import contacts as contacts_module
from app.routers.contacts import router as contacts_router
from tests.test_database import create_test_engine, drop_all_tables


def _make_app(engine):
    app = FastAPI()
    app.include_router(contacts_router, prefix="/contacts")

    def override_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[contacts_module.get_session] = override_session
    return app


class ContactsRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            # Two clients so we can verify that GETting a contact bundles
            # only its own client's siblings, projects, and docs.
            client_a = ClientRecord(name="Acme Corp", industry="Insurance", contact="", notes="")
            client_b = ClientRecord(name="Other Inc", industry="Retail", contact="", notes="")
            session.add(client_a)
            session.add(client_b)
            session.commit()
            session.refresh(client_a)
            session.refresh(client_b)
            self.client_a_id = client_a.id
            self.client_b_id = client_b.id

            target = ClientStakeholder(
                client_id=client_a.id,
                name="Vivian",
                role="CTO",
                organization_level="decision",
            )
            sibling = ClientStakeholder(
                client_id=client_a.id,
                name="Other Sibling",
                role="COO",
                organization_level="influence",
            )
            unrelated = ClientStakeholder(
                client_id=client_b.id,
                name="Should Not Appear",
                role="CFO",
                organization_level="decision",
            )
            session.add(target)
            session.add(sibling)
            session.add(unrelated)

            # Project linked by free-text client name (matches the real
            # join used in clients/projects).
            session.add(Project(name="Digital Roadmap", client="Acme Corp", status="active"))
            session.add(Project(name="Wrong Client Project", client="Other Inc", status="active"))

            # A doc attached to the client so document_count comes back > 0.
            session.add(
                KnowledgeDocument(
                    name="acme_brief.pdf",
                    file_type="pdf",
                    path="/tmp/x.pdf",
                    category="general",
                    client_id=client_a.id,
                )
            )

            session.commit()
            session.refresh(target)
            self.target_id = target.id

            # One history entry for the target so we know the bundle
            # carries history through.
            session.add(
                ClientStakeholderHistory(
                    stakeholder_id=target.id,
                    client_id=client_a.id,
                    field_name="role",
                    old_value="VP",
                    new_value="CTO",
                    trigger="manual",
                )
            )
            session.commit()

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_get_contact_returns_bundle(self):
        app = _make_app(self.engine)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get(f"/contacts/{self.target_id}")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()

        self.assertEqual(data["client"]["id"], self.client_a_id)
        self.assertEqual(data["client"]["name"], "Acme Corp")
        # document_count should reflect the one doc we attached.
        self.assertEqual(data["client"]["document_count"], 1)
        # project_names should list the Acme-only project, not Other Inc's.
        self.assertEqual(data["client"]["project_names"], ["Digital Roadmap"])

        self.assertEqual(data["stakeholder"]["id"], self.target_id)
        self.assertEqual(data["stakeholder"]["name"], "Vivian")

        # Sibling rail must include both stakeholders from client A and
        # none from client B.
        sibling_names = {s["name"] for s in data["sibling_stakeholders"]}
        self.assertEqual(sibling_names, {"Vivian", "Other Sibling"})

        # Projects must be scoped to the parent client.
        project_names = {p["name"] for p in data["projects"]}
        self.assertEqual(project_names, {"Digital Roadmap"})

        # History entry for the target should round-trip.
        self.assertEqual(len(data["history"]), 1)
        self.assertEqual(data["history"][0]["field_name"], "role")
        self.assertEqual(data["history"][0]["new_value"], "CTO")

    def test_get_contact_missing_returns_404(self):
        app = _make_app(self.engine)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/contacts/999999")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
