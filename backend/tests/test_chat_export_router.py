"""Integration tests for chat_export router."""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import User, Conversation, Message
from app.routers import chat_export as export_module
from app.routers.chat_export import router
from tests.test_database import create_test_engine, drop_all_tables


class ChatExportTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            user = User(email="test@test.com", password_hash="h", display_name="Test")
            session.add(user)
            session.commit()
            session.refresh(user)
            self.user_id = user.id

            conv = Conversation(user_id=user.id, title="Export Test Chat")
            session.add(conv)
            session.commit()
            session.refresh(conv)
            self.conv_id = conv.id

            for i, (role, content) in enumerate([
                ("user", "What is AI strategy?"),
                ("assistant", "AI strategy involves planning how to integrate AI into business operations."),
                ("user", "Can you elaborate?"),
                ("assistant", "Sure! Key areas include data infrastructure, talent acquisition, and use case prioritization."),
            ]):
                msg = Message(conversation_id=conv.id, role=role, content=content)
                session.add(msg)
            session.commit()

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[export_module.get_session] = override_session
        app.dependency_overrides[export_module.get_current_user] = lambda: User(
            id=self.user_id,
            email="test@test.com",
            password_hash="h",
            display_name="Test",
            is_admin=True,
            is_active=True,
        )

        @app.middleware("http")
        def inject_user(request, call_next):
            request.state.user_id = self.user_id
            request.state.is_admin = True
            return call_next(request)

        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_export_markdown(self):
        resp = self.client.post(f"/conversations/{self.conv_id}/export", json={"format": "markdown"})
        self.assertEqual(resp.status_code, 200)
        content = resp.text
        self.assertIn("Export Test Chat", content)
        self.assertIn("What is AI strategy", content)
        self.assertIn("AI strategy involves", content)

    def test_export_nonexistent_conversation(self):
        resp = self.client.post("/conversations/99999/export", json={"format": "markdown"})
        self.assertEqual(resp.status_code, 404)

    def test_export_unsupported_format(self):
        resp = self.client.post(f"/conversations/{self.conv_id}/export", json={"format": "csv"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported format", resp.json().get("detail", ""))

    def test_export_pdf(self):
        resp = self.client.post(f"/conversations/{self.conv_id}/export", json={"format": "pdf"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("content-type"), "application/pdf")
        self.assertIn("attachment", resp.headers.get("content-disposition", ""))

    def test_export_empty_conversation(self):
        with Session(self.engine) as session:
            conv = Conversation(user_id=self.user_id, title="Empty Chat")
            session.add(conv)
            session.commit()
            session.refresh(conv)
            empty_conv_id = conv.id
        resp = self.client.post(f"/conversations/{empty_conv_id}/export", json={"format": "markdown"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("no messages", resp.json().get("detail", "").lower())
