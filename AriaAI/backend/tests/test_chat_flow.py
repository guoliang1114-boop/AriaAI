from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import Conversation, Message, Project, ProjectFolder
from app.routers import chat as chat_router_module
from app.routers import projects as projects_router_module
from app.services.chat_streaming import ChatRuntime, stream_chat_events


class FakeStreamingLLM:
    def __init__(self, responses):
        self._responses = responses
        self.calls = 0

    async def stream_response(self, *args, **kwargs):
        current = self._responses[self.calls]
        self.calls += 1
        if isinstance(current, Exception):
            raise current
        for chunk in current:
            yield chunk

    async def complete(self, *args, **kwargs):
        return "ok"


def collect_async_generator(async_gen):
    async def _collect():
        items = []
        async for item in async_gen:
            items.append(item)
        return items

    return asyncio.run(_collect())


class ChatRouterTestCase(unittest.TestCase):
    def setUp(self):
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.db_path = db_path
        self.engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(self.engine)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app = FastAPI()
        app.include_router(chat_router_module.router)
        app.dependency_overrides[chat_router_module.get_session] = override_session
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()
        Path(self.db_path).unlink(missing_ok=True)

    def test_conversation_crud_and_markdown_export(self):
        create_resp = self.client.post(
            "/chat/conversations",
            json={"title": "Regression Chat"},
        )
        self.assertEqual(create_resp.status_code, 200)
        conv_id = create_resp.json()["id"]

        with Session(self.engine) as session:
            now = datetime.utcnow()
            session.add(Message(conversation_id=conv_id, role="user", content="hello", created_at=now))
            session.add(
                Message(
                    conversation_id=conv_id,
                    role="assistant",
                    content="world",
                    created_at=now + timedelta(seconds=1),
                )
            )
            session.commit()

        list_resp = self.client.get("/chat/conversations")
        self.assertEqual(list_resp.status_code, 200)
        self.assertEqual(len(list_resp.json()), 1)

        messages_resp = self.client.get(f"/chat/conversations/{conv_id}/messages")
        self.assertEqual(messages_resp.status_code, 200)
        self.assertEqual([m["content"] for m in messages_resp.json()], ["hello", "world"])

        export_resp = self.client.post(
            f"/chat/conversations/{conv_id}/export",
            json={"format": "markdown"},
        )
        self.assertEqual(export_resp.status_code, 200)
        self.assertIn("# Regression Chat", export_resp.text)
        self.assertIn("**User**", export_resp.text)
        self.assertIn("**Assistant**", export_resp.text)

    def test_send_route_streams_service_output(self):
        async def fake_stream(*args, **kwargs):
            yield 'data: {"type":"conversation_id","id":99}\n\n'
            yield 'data: {"type":"done"}\n\n'

        with patch.object(chat_router_module, "prepare_chat_runtime", return_value="runtime"), patch.object(
            chat_router_module,
            "stream_chat_events",
            side_effect=lambda runtime, req, bind: fake_stream(),
        ):
            resp = self.client.post("/chat/send", json={"content": "hello"})

        self.assertEqual(resp.status_code, 200)
        self.assertIn('"conversation_id"', resp.text)
        self.assertIn('"done"', resp.text)


class ProjectConversationArchiveTestCase(unittest.TestCase):
    def setUp(self):
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.db_path = db_path
        self.engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(self.engine)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app = FastAPI()
        app.include_router(projects_router_module.router)
        app.dependency_overrides[projects_router_module.get_session] = override_session
        self.client = TestClient(app)

        self.uploads_dir = Path(os.getcwd()) / "test_tmp_uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_patch = patch.object(projects_router_module, "UPLOADS_DIR", self.uploads_dir)
        self.uploads_patch.start()

    def tearDown(self):
        self.client.close()
        self.uploads_patch.stop()
        shutil.rmtree(self.uploads_dir, ignore_errors=True)
        self.engine.dispose()
        Path(self.db_path).unlink(missing_ok=True)

    def test_save_project_conversation_as_markdown_file(self):
        with Session(self.engine) as session:
            project = Project(name="Alpha", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            folder = ProjectFolder(project_id=project.id, name="Deliverables", sort_order=2)
            session.add(folder)
            session.commit()
            session.refresh(folder)

            conv = Conversation(project_id=project.id, title="Weekly Sync")
            session.add(conv)
            session.commit()
            session.refresh(conv)

            session.add(Message(conversation_id=conv.id, role="user", content="Please summarize this week"))
            session.add(Message(conversation_id=conv.id, role="assistant", content="Here is the weekly summary"))
            session.commit()

            project_id = project.id
            folder_id = folder.id
            conv_id = conv.id

        resp = self.client.post(f"/projects/{project_id}/conversations/{conv_id}/save-markdown", json={})
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body["project_id"], project_id)
        self.assertEqual(body["folder_id"], folder_id)
        self.assertEqual(body["file_type"], "md")
        self.assertTrue(body["name"].endswith(".md"))

        saved_path = self.uploads_dir / body["path"]
        self.assertTrue(saved_path.exists())
        content = saved_path.read_text(encoding="utf-8")
        self.assertIn("# Weekly Sync", content)
        self.assertIn("Please summarize this week", content)
        self.assertIn("Here is the weekly summary", content)


class ChatStreamingServiceTestCase(unittest.TestCase):
    def setUp(self):
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.db_path = db_path
        self.engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()
        Path(self.db_path).unlink(missing_ok=True)

    def _create_conversation(self, title: str = "Existing Title") -> int:
        with Session(self.engine) as session:
            conv = Conversation(title=title)
            session.add(conv)
            session.commit()
            session.refresh(conv)
            return conv.id

    def test_stream_chat_events_persists_successful_response(self):
        conv_id = self._create_conversation()
        runtime = ChatRuntime(
            conv_id=conv_id,
            selected_model="claude-sonnet-4-6",
            llm=FakeStreamingLLM([["hello ", "world"]]),
            system="system",
            api_messages=[{"role": "user", "content": "hello"}],
            rag_sources=[],
            tools=None,
            max_tokens=1024,
            temperature=0.7,
        )
        req = chat_router_module.SendMessageRequest(content="hello")

        events = collect_async_generator(stream_chat_events(runtime, req, self.engine))
        joined = "".join(events)
        self.assertIn('"conversation_id"', joined)
        self.assertIn('"done"', joined)

        with Session(self.engine) as session:
            assistant_messages = session.exec(
                select(Message).where(Message.conversation_id == conv_id, Message.role == "assistant")
            ).all()
            self.assertEqual(len(assistant_messages), 1)
            self.assertEqual(assistant_messages[0].content, "hello world")

    def test_stream_chat_events_handles_tool_follow_up(self):
        conv_id = self._create_conversation()
        llm = FakeStreamingLLM(
            [
                [
                    '{"type":"tool_use","id":"tool-1","name":"generate_docx","input":{"title":"Spec"}}',
                ],
                ["follow-up answer"],
            ]
        )
        runtime = ChatRuntime(
            conv_id=conv_id,
            selected_model="claude-sonnet-4-6",
            llm=llm,
            system="system",
            api_messages=[{"role": "user", "content": "make doc"}],
            rag_sources=[],
            tools=[{"name": "generate_docx"}],
            max_tokens=1024,
            temperature=0.7,
        )
        req = chat_router_module.SendMessageRequest(content="make doc")

        with patch("app.services.chat_streaming.registry.execute", new=AsyncMock(return_value={"status": "ok", "output": {"file": "spec.docx"}})):
            events = collect_async_generator(stream_chat_events(runtime, req, self.engine))

        joined = "".join(events)
        self.assertIn('"tool_executing"', joined)
        self.assertIn('"tool_result"', joined)
        self.assertIn("follow-up answer", joined)
        self.assertEqual(llm.calls, 2)

        with Session(self.engine) as session:
            assistant_messages = session.exec(
                select(Message).where(Message.conversation_id == conv_id, Message.role == "assistant")
            ).all()
            self.assertEqual(assistant_messages[0].content, "follow-up answer")

    def test_stream_chat_events_surfaces_friendly_errors(self):
        conv_id = self._create_conversation()
        runtime = ChatRuntime(
            conv_id=conv_id,
            selected_model="claude-sonnet-4-6",
            llm=FakeStreamingLLM([Exception("429 engine_overloaded")]),
            system="system",
            api_messages=[{"role": "user", "content": "hello"}],
            rag_sources=[],
            tools=None,
            max_tokens=1024,
            temperature=0.7,
        )
        req = chat_router_module.SendMessageRequest(content="hello")

        events = collect_async_generator(stream_chat_events(runtime, req, self.engine))
        error_event = json.loads(events[1].replace("data: ", "").strip())
        self.assertEqual(error_event["type"], "error")
        self.assertIn("AI 服务当前繁忙", error_event["message"])

        with Session(self.engine) as session:
            assistant_messages = session.exec(
                select(Message).where(Message.conversation_id == conv_id, Message.role == "assistant")
            ).all()
            self.assertEqual(len(assistant_messages), 0)


if __name__ == "__main__":
    unittest.main()
