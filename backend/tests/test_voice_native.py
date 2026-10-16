"""Native auth/ACL and adapter wiring tests. No app lifespan or paid clients."""
from __future__ import annotations

import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine, select

from app.models.db import Conversation, ProjectMember, User, UserToken
from app.services.voice.native_agent import NativeVoiceAgent, parse_native_sse
from app.services.voice.protocol import VoiceError
from app.services.time_utils import utc_now_naive


@pytest.fixture
def bind():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (User, UserToken, Conversation, ProjectMember):
        model.__table__.create(engine)
    with Session(engine) as session:
        session.add_all([
            User(id=1, email="owner@example.test", password_hash="unused"),
            User(id=2, email="other@example.test", password_hash="unused"),
            User(id=3, email="admin@example.test", password_hash="unused", is_admin=True),
            UserToken(user_id=1, token="owner-test-token"),
            UserToken(user_id=2, token="other-test-token"),
            UserToken(user_id=3, token="admin-test-token"),
            Conversation(id=10, owner_user_id=1),
            Conversation(id=20, project_id=77, owner_user_id=1),
            ProjectMember(project_id=77, user_id=1, role="editor"),
            ProjectMember(project_id=77, user_id=2, role="viewer"),
        ])
        session.commit()
    yield engine
    engine.dispose()


@pytest.mark.asyncio
async def test_real_native_auth_and_independent_conversation_acl(bind):
    owner = NativeVoiceAgent(bind, "owner-test-token", token_max_age_seconds=3600)
    actor = await owner.authorize(10)
    assert actor.user_id == 1 and actor.conversation_id == 10
    for token in (None, "invalid", "other-test-token", "admin-test-token"):
        with pytest.raises(VoiceError):
            await NativeVoiceAgent(bind, token, token_max_age_seconds=3600).authorize(10)


@pytest.mark.asyncio
async def test_real_project_write_acl_and_revocation(bind):
    agent = NativeVoiceAgent(bind, "owner-test-token", token_max_age_seconds=3600)
    assert (await agent.authorize(20)).project_id == 77
    with pytest.raises(VoiceError) as caught:
        await NativeVoiceAgent(bind, "other-test-token", token_max_age_seconds=3600).authorize(20)
    assert caught.value.code == "permission_denied"
    with Session(bind) as session:
        member = session.exec(select(ProjectMember).where(ProjectMember.user_id == 1)).one()
        member.role = "viewer"
        session.add(member)
        session.commit()
    with pytest.raises(VoiceError):
        await agent.authorize(20)


@pytest.mark.asyncio
async def test_token_expiry_revocation_and_deactivation_are_rechecked(bind):
    agent = NativeVoiceAgent(bind, "owner-test-token", token_max_age_seconds=3600)
    await agent.authorize(10)
    with Session(bind) as session:
        token = session.exec(select(UserToken).where(UserToken.token == "owner-test-token")).one()
        token.created_at = utc_now_naive() - timedelta(hours=2)
        session.add(token)
        session.commit()
    with pytest.raises(VoiceError) as caught:
        await agent.authorize(10)
    assert caught.value.code == "session_expired"
    with Session(bind) as session:
        token = session.exec(select(UserToken).where(UserToken.token == "owner-test-token")).one()
        session.delete(token)
        session.commit()
    with pytest.raises(VoiceError):
        await agent.authorize(10)
    with Session(bind) as session:
        user = session.get(User, 2)
        user.is_active = False
        session.add(user)
        session.commit()
    with pytest.raises(VoiceError):
        await NativeVoiceAgent(bind, "other-test-token", token_max_age_seconds=3600).authorize(None)


def test_sse_parser_preserves_native_event_not_comments():
    assert parse_native_sse(': keepalive\n\ndata: {"type":"text","content":"Hi"}\n\n') == [
        {"type": "text", "content": "Hi"}]
    assert parse_native_sse('data: [DONE]\n\n') == []


@pytest.mark.asyncio
async def test_router_disabled_never_accepts_or_constructs_provider(monkeypatch):
    import app.routers.voice as route
    def disabled():
        raise ValueError("disabled")
    monkeypatch.setattr(route, "load_voice_config", disabled)
    def forbidden_agent(*args, **kwargs):
        raise AssertionError("Disabled voice must not construct auth/provider clients")
    monkeypatch.setattr(route, "NativeVoiceAgent", forbidden_agent)
    called = []
    class Socket:
        async def close(self, **kwargs):
            called.append(kwargs)
        async def accept(self):
            raise AssertionError("Disabled voice must not accept")
    await route.voice_session(Socket())
    assert called[0]["code"] == 1008


@pytest.mark.asyncio
async def test_adapter_uses_native_prepare_owner_scope_and_closes_stream(bind, monkeypatch):
    import app.services.chat as native_chat
    calls = {}
    async def prepare(session, request, *, owner_user_id):
        calls.update(owner=owner_user_id, request=request)
        return SimpleNamespace(conv_id=request.conversation_id)
    async def stream(runtime, request, actual_bind):
        calls["task"] = asyncio.current_task()
        calls["bind"] = actual_bind
        try:
            yield 'data: {"type":"run_started","run_id":"native_test"}\n\n'
            yield 'data: {"type":"text","content":"hello"}\n\n'
        finally:
            calls["closed"] = True
    monkeypatch.setattr(native_chat, "prepare_chat_runtime_async", prepare)
    monkeypatch.setattr(native_chat, "stream_chat_events", stream)
    agent = NativeVoiceAgent(bind, "owner-test-token", token_max_age_seconds=3600)
    stream = agent.events(20, "spoken input", "zh-CN")
    assert (await anext(stream))["run_id"] == "native_test"
    await stream.aclose()
    assert calls["owner"] == 1
    assert calls["request"].project_id == 77
    assert calls["request"].content == "spoken input"
    assert calls["request"].action_confirmations == []
    assert calls["request"].turn_recovery is None
    assert calls["bind"] is bind
    assert calls["closed"]


@pytest.mark.asyncio
async def test_membership_revoked_during_prepare_never_enters_native_stream(bind, monkeypatch):
    import app.services.chat as native_chat
    async def prepare(session, request, *, owner_user_id):
        member = session.exec(select(ProjectMember).where(ProjectMember.user_id == 1)).one()
        member.role = "viewer"
        session.add(member)
        session.commit()
        return SimpleNamespace(conv_id=request.conversation_id)
    async def stream(*args):
        raise AssertionError("Revoked user must not execute native Agent")
        yield
    monkeypatch.setattr(native_chat, "prepare_chat_runtime_async", prepare)
    monkeypatch.setattr(native_chat, "stream_chat_events", stream)
    agent = NativeVoiceAgent(bind, "owner-test-token", token_max_age_seconds=3600)
    with pytest.raises(VoiceError) as caught:
        await anext(agent.events(20, "spoken input", "zh-CN"))
    assert caught.value.code == "permission_denied"


@pytest.mark.asyncio
async def test_adapter_cancel_reuses_durable_authorized_native_route(bind, monkeypatch):
    import app.routers.chat as native_router
    import app.services.agent_harness.durable_run_inputs as durable
    called = []
    monkeypatch.setattr(durable, "resolve_active_durable_run", lambda session, run_id: SimpleNamespace(conversation_id=10))
    async def cancel(*, run_id, session, current_user):
        called.append((run_id, current_user.id))
        return {"status": "cancellation_requested"}
    monkeypatch.setattr(native_router, "cancel_chat_run", cancel)
    agent = NativeVoiceAgent(bind, "owner-test-token", token_max_age_seconds=3600)
    result = await agent.cancel("native_test_run", 10)
    assert result["status"] == "cancellation_requested"
    assert called == [("native_test_run", 1)]
    with pytest.raises(VoiceError):
        await NativeVoiceAgent(bind, "other-test-token", token_max_age_seconds=3600).cancel("native_test_run", 10)
    assert called == [("native_test_run", 1)]
    monkeypatch.setattr(durable, "resolve_active_durable_run", lambda session, run_id: SimpleNamespace(conversation_id=99))
    with pytest.raises(VoiceError):
        await agent.cancel("native_test_run", 10)
    assert called == [("native_test_run", 1)]


@pytest.mark.asyncio
async def test_native_prepare_failure_uses_existing_persistence_helper(bind, monkeypatch):
    import app.services.chat as native_chat
    import app.routers.chat as native_router
    called = []
    async def prepare(*args, **kwargs):
        raise RuntimeError("secret-provider-debug-must-not-cross-transport")
    def persist(actual_bind, request, error):
        called.append((actual_bind, request.conversation_id, request.content))
    monkeypatch.setattr(native_chat, "prepare_chat_runtime_async", prepare)
    monkeypatch.setattr(native_router, "_persist_prepare_error_turn", persist)
    agent = NativeVoiceAgent(bind, "owner-test-token", token_max_age_seconds=3600)
    with pytest.raises(VoiceError) as caught:
        await anext(agent.events(10, "spoken input", "zh-CN"))
    assert caught.value.code == "agent_unavailable"
    assert "secret-provider" not in str(caught.value)
    assert called == [(bind, 10, "spoken input")]


@pytest.mark.parametrize("token,conversation,allowed", [
    ("owner-test-token", 10, True),
    ("other-test-token", 10, False),
    ("other-test-token", 20, False),
    ("admin-test-token", 10, False),
])
def test_real_websocket_handshake_enforces_native_auth_write_acl_and_quota(bind, monkeypatch, token, conversation, allowed):
    from dataclasses import replace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.config import VoiceConfig
    from app.models.db import Setting
    from app.services.voice.protocol import INPUT_FORMAT, OUTPUT_FORMAT
    import app.routers.voice as route
    import app.services.voice.volcengine as provider
    Setting.__table__.create(bind)
    config = replace(VoiceConfig(), enabled=True, api_key="test-only", asr_resource_id="asr",
                     tts_resource_id="tts", speaker="speaker", pcm_layout_confirmed=True)
    monkeypatch.setattr(route, "load_voice_config", lambda: config)
    monkeypatch.setattr(route, "engine", bind)
    class NoNetworkProvider:
        def __init__(self, config):
            pass
        async def open_asr(self, *args):
            raise AssertionError("This handshake test sends no audio")
        async def open_tts(self, *args):
            raise AssertionError("This handshake test starts no Agent")
    monkeypatch.setattr(provider, "VolcengineProvider", NoNetworkProvider)
    app = FastAPI()  # Deliberately not main.app: no migrations/paid warmup.
    app.include_router(route.router)
    with TestClient(app).websocket_connect("/voice/session", headers={"X-Auth-Token": token}) as ws:
        ws.send_json({"type": "session.start", "version": 1, "conversation_id": conversation,
                      "locale": "zh-CN", "input_audio": INPUT_FORMAT, "output_audio": OUTPUT_FORMAT})
        result = ws.receive_json()
        if allowed:
            assert result["type"] == "session.ready"
            assert result["version"] == 1
            ws.send_json({"type": "session.end"})
            assert ws.receive_json()["type"] == "session.ended"
        else:
            assert result["type"] == "error"
            assert result["code"] == "permission_denied"
    with Session(bind) as session:
        rows = session.exec(select(Setting)).all()
        assert bool(rows) is allowed


def test_websocket_does_not_trust_query_token_or_http_middleware(bind, monkeypatch):
    from dataclasses import replace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    from app.config import VoiceConfig
    import app.routers.voice as route
    import app.services.voice.volcengine as provider
    def forbidden_provider(*args, **kwargs):
        raise AssertionError("Unauthenticated sockets must not construct a provider")
    monkeypatch.setattr(provider, "VolcengineProvider", forbidden_provider)
    config = replace(VoiceConfig(), enabled=True, api_key="test-only", asr_resource_id="asr",
                     tts_resource_id="tts", speaker="speaker", pcm_layout_confirmed=True)
    monkeypatch.setattr(route, "load_voice_config", lambda: config)
    monkeypatch.setattr(route, "engine", bind)
    app = FastAPI()
    app.include_router(route.router)
    with pytest.raises(WebSocketDisconnect) as caught:
        with TestClient(app).websocket_connect("/voice/session?token=owner-test-token"):
            pass
    assert caught.value.code == 1008


def test_narrow_websocket_positive_audio_turn_with_fake_provider_only(bind, monkeypatch):
    from dataclasses import replace
    from uuid import uuid4
    import json
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.config import VoiceConfig
    from app.models.db import Setting
    from app.services.voice.protocol import INPUT_FORMAT, OUTPUT_FORMAT, AudioFrame, encode_audio_frame
    from test_voice_session import FakeASR, FakeTTS
    import app.routers.voice as route
    import app.services.voice.volcengine as provider
    Setting.__table__.create(bind)
    config = replace(VoiceConfig(), enabled=True, api_key="test-only", asr_resource_id="asr",
                     tts_resource_id="tts", speaker="speaker", pcm_layout_confirmed=True)
    monkeypatch.setattr(route, "load_voice_config", lambda: config)
    monkeypatch.setattr(route, "engine", bind)
    calls = []
    class OfflineProvider:
        def __init__(self, config):
            pass
        async def open_asr(self, utterance):
            calls.append("asr")
            return FakeASR()
        async def open_tts(self, response):
            calls.append("tts")
            return FakeTTS()
    async def native_events(self, conversation_id, text, locale):
        # Keep real NativeVoiceAgent.authorize; stub only execution boundary.
        calls.append((conversation_id, text, locale))
        yield {"type": "run_started", "run_id": "offline-native-run"}
        yield {"type": "text", "content": "Hello."}
        yield {"type": "text_delta", "run_id": "offline-native-run", "content": "Hello."}
        yield {"type": "run_done", "run_id": "offline-native-run", "final_status": "completed"}
    monkeypatch.setattr(provider, "VolcengineProvider", OfflineProvider)
    monkeypatch.setattr(route.NativeVoiceAgent, "events", native_events)
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app).websocket_connect("/voice/session", headers={"X-Auth-Token": "owner-test-token"}) as ws:
        ws.send_json({"type": "session.start", "version": 1, "conversation_id": 10,
                      "locale": "zh-CN", "input_audio": INPUT_FORMAT, "output_audio": OUTPUT_FORMAT})
        assert ws.receive_json()["type"] == "session.ready"
        utterance = str(uuid4())
        ws.send_bytes(encode_audio_frame(AudioFrame(1, utterance, 0, b"\x00" * 640)))
        ws.send_json({"type": "audio.commit", "utterance_id": utterance, "last_sequence": 0})
        events, audio = [], []
        while True:
            frame = ws.receive()
            if frame.get("bytes"):
                audio.append(frame["bytes"])
            if frame.get("text"):
                event = json.loads(frame["text"])
                events.append(event)
                if event["type"] == "response.done":
                    break
        assert events[-1]["status"] == "completed"
        assert events[-1]["run_id"] == "offline-native-run"
        assert len([e for e in events if e["type"] == "asr.final"]) == 1
        assert len([e for e in events if e["type"] == "text.delta"]) == 1
        assert len(audio) == 1
        ws.send_json({"type": "session.end"})
        while ws.receive_json()["type"] != "session.ended":
            pass
    assert calls == ["asr", (10, "hello world", "zh-CN"), "tts"]
