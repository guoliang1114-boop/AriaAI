from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.config import VoiceConfig, load_voice_config
from app.services.voice.protocol import AudioFrame, INPUT_FORMAT, OUTPUT_FORMAT, VoiceError, encode_audio_frame, decode_audio_frame
from app.services.voice.session import VoiceSession


class FakeSocket:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.events = []
        self.audio = []
        self.closed = False

    async def receive(self):
        return await self.incoming.get()

    async def send_json(self, event):
        self.events.append(event)

    async def send_bytes(self, data):
        self.audio.append(decode_audio_frame(data, expected_kind=2))

    async def close(self, **kwargs):
        self.closed = True

    async def control(self, event):
        await self.incoming.put({"type": "websocket.receive", "text": json.dumps(event)})

    async def frame(self, utterance, sequence=0, payload=b"\x00" * 640):
        await self.incoming.put({"type": "websocket.receive", "bytes": encode_audio_frame(
            AudioFrame(1, utterance, sequence, payload))})


class FakeASR:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.closed = False
        self.appended = []

    async def append(self, pcm):
        self.appended.append(pcm)
        await self.queue.put(SimpleNamespace(text="hello", final=False))

    async def commit(self):
        await self.queue.put(SimpleNamespace(text="hello world", final=True))
        await self.queue.put(SimpleNamespace(text="hello world", final=True))
        await self.queue.put(None)

    async def events(self):
        while True:
            item = await self.queue.get()
            if item is None:
                return
            yield item

    async def close(self):
        self.closed = True


class FakeTTS:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.text = []
        self.closed = False

    async def append_text(self, text):
        self.text.append(text)
        await self.queue.put(b"\x01\x00" * 480)

    async def finish(self):
        await self.queue.put(None)

    async def audio(self):
        while True:
            item = await self.queue.get()
            if item is None:
                return
            yield item

    async def close(self):
        self.closed = True


class FakeProvider:
    def __init__(self, usage):
        self.usage = usage
        self.asr = []
        self.tts = []

    async def open_asr(self, utterance_id):
        assert self.usage.acquired
        stream = FakeASR()
        self.asr.append(stream)
        return stream

    async def open_tts(self, response_id):
        assert self.usage.acquired
        stream = FakeTTS()
        self.tts.append(stream)
        return stream


class FakeUsage:
    def __init__(self):
        self.acquired = False
        self.closed = []
        self.deny = False

    async def acquire(self, user_id, session_id):
        if self.deny:
            raise VoiceError("rate_limited", fatal=True)
        self.acquired = True
        return self

    async def close(self, **kwargs):
        self.closed.append(kwargs)


class FakeAgent:
    def __init__(self):
        self.auth = []
        self.turns = []
        self.cancelled = []
        self.task = None
        self.block = False
        self.persisted_partial = False
        self.deny = False

    async def authorize(self, conversation_id):
        self.auth.append(conversation_id)
        if self.deny:
            raise VoiceError("permission_denied", fatal=True)
        return SimpleNamespace(user_id=7)

    async def events(self, conversation_id, text, locale):
        self.task = asyncio.current_task()
        self.turns.append((conversation_id, text, locale))
        yield {"type": "run_started", "run_id": "native_run_1"}
        try:
            yield {"type": "text", "content": "Hello."}
            yield {"type": "text_delta", "run_id": "native_run_1", "content": "Hello."}
            if self.block:
                await asyncio.Event().wait()
            yield {"type": "confirmation_required", "run_id": "native_run_1", "action": "review"}
            yield {"type": "run_done", "run_id": "native_run_1", "final_status": "waiting_confirmation"}
        except asyncio.CancelledError:
            self.persisted_partial = True
            yield {"type": "run_done", "run_id": "native_run_1", "final_status": "cancelled"}

    async def cancel(self, run_id, conversation_id):
        self.cancelled.append((run_id, conversation_id))
        self.task.cancel("aria_user_interrupted")


async def wait_until(predicate):
    async with asyncio.timeout(3):
        while not predicate():
            await asyncio.sleep(.001)


def start_message(**updates):
    data = {"type": "session.start", "version": 1, "conversation_id": 23, "locale": "zh-CN",
            "input_audio": INPUT_FORMAT, "output_audio": OUTPUT_FORMAT}
    return {**data, **updates}


async def setup(config=None, agent=None, usage=None):
    ws = FakeSocket()
    usage = usage or FakeUsage()
    agent = agent or FakeAgent()
    provider = FakeProvider(usage)
    session = VoiceSession(ws, config=config or VoiceConfig(), provider=provider, agent=agent, usage=usage)
    await ws.control(start_message())
    task = asyncio.create_task(session.run())
    await wait_until(lambda: ws.events or ws.closed)
    return ws, usage, agent, provider, session, task


async def speak(ws):
    utterance = str(uuid4())
    await ws.frame(utterance)
    await ws.control({"type": "audio.commit", "utterance_id": utterance, "last_sequence": 0})
    return utterance


@pytest.mark.asyncio
async def test_final_once_native_text_once_incremental_tts_and_cleanup():
    ws, usage, agent, provider, session, task = await setup()
    await speak(ws)
    await wait_until(lambda: any(e["type"] == "response.done" for e in ws.events))
    assert len(agent.turns) == 1
    assert agent.task is not task
    assert len([e for e in ws.events if e["type"] == "asr.final"]) == 1
    assert [e["text"] for e in ws.events if e["type"] == "text.delta"] == ["Hello."]
    assert provider.tts[0].text == ["Hello."]
    assert ws.audio[0].sequence == 0
    assert any(e["type"] == "tts.done" and e["last_sequence"] == 0 for e in ws.events)
    assert any(e["type"] == "response.done" and e["status"] == "waiting_confirmation" for e in ws.events)
    assert any(e["type"] == "agent.event" and e["event"]["type"] == "confirmation_required" for e in ws.events)
    assert len(agent.auth) >= 3  # handshake, ASR opening, final turn
    await ws.control({"type": "session.end"})
    await task
    assert provider.asr[0].closed and provider.tts[0].closed
    assert usage.closed == [{"audio_seconds": .02, "tts_characters": 6}]


@pytest.mark.asyncio
async def test_interrupt_uses_native_cancel_waits_persistence_and_drops_late_audio():
    agent = FakeAgent()
    agent.block = True
    ws, usage, _, provider, session, task = await setup(agent=agent)
    await speak(ws)
    await wait_until(lambda: ws.audio)
    response_id = session.response.id
    await ws.control({"type": "response.interrupt", "response_id": response_id})
    await wait_until(lambda: any(e["type"] == "response.interrupted" for e in ws.events))
    assert agent.cancelled == [("native_run_1", 23)]
    assert agent.persisted_partial
    assert session.response.task.done()
    audio_count = len(ws.audio)
    await session.send_audio(session.response, b"\x00\x00" * 480)
    assert len(ws.audio) == audio_count
    assert not task.done()  # Cancelling a turn never cancels its socket owner.
    await ws.control({"type": "session.end"})
    await task


@pytest.mark.asyncio
async def test_usage_reservation_rejects_before_paid_provider():
    usage = FakeUsage()
    usage.deny = True
    ws, _, _, provider, session, task = await setup(usage=usage)
    await task
    assert provider.asr == provider.tts == []
    assert ws.events[-1]["code"] == "rate_limited"


@pytest.mark.asyncio
async def test_acl_revocation_between_audio_and_final_never_starts_agent():
    ws, _, agent, provider, session, task = await setup()
    utterance = str(uuid4())
    await ws.frame(utterance)
    await wait_until(lambda: provider.asr)
    agent.deny = True
    await ws.control({"type": "audio.commit", "utterance_id": utterance, "last_sequence": 0})
    await task
    assert agent.turns == []
    assert any(e.get("code") == "permission_denied" for e in ws.events)


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", [
    {"type": "approval.confirm", "approved": True},
    {"type": "audio.commit", "utterance_id": "not-a-uuid", "last_sequence": 0},
    {"type": "session.start", "version": 1},
])
async def test_disallows_approval_and_invalid_controls(invalid):
    ws, _, agent, provider, session, task = await setup()
    await ws.control(invalid)
    await task
    assert agent.turns == []
    assert ws.events[-1]["fatal"] is True


@pytest.mark.asyncio
async def test_sequence_and_exact_frame_size_are_enforced():
    ws, _, _, provider, session, task = await setup()
    await ws.frame(str(uuid4()), sequence=2)
    await task
    assert provider.asr == []
    assert ws.events[-1]["fatal"]


@pytest.mark.asyncio
async def test_disconnect_cancels_native_stream_and_refunds_measured_usage():
    agent = FakeAgent()
    agent.block = True
    ws, usage, _, provider, session, task = await setup(agent=agent)
    await speak(ws)
    await wait_until(lambda: ws.audio)
    await ws.incoming.put({"type": "websocket.disconnect", "code": 1001})
    await task
    assert agent.persisted_partial
    assert session.response.task.done()
    assert provider.tts[0].closed
    assert usage.closed


def test_configuration_defaults_disabled_and_complete_supplier_required(monkeypatch):
    monkeypatch.delenv("VOICE_ENABLED", raising=False)
    with pytest.raises(ValueError):
        load_voice_config()
    with pytest.raises(ValueError):
        replace(VoiceConfig(), enabled=True).validate()
    configured = replace(VoiceConfig(), enabled=True, api_key="test-only", asr_resource_id="asr",
                         tts_resource_id="tts", speaker="speaker", pcm_layout_confirmed=True)
    configured.validate()
    assert "test-only" not in repr(configured)
    for bad in (replace(configured, asr_url="wss://attacker.example/"),
                replace(configured, pcm_layout_confirmed=False),
                replace(configured, send_timeout=float("nan")),
                replace(configured, max_session_seconds=999999)):
        with pytest.raises(ValueError):
            bad.validate()


@pytest.mark.asyncio
async def test_interrupt_during_final_publication_cannot_start_native_work():
    ws, _, agent, _, session, task = await setup()
    original = ws.send_json
    final_published = asyncio.Event()
    release_final = asyncio.Event()
    async def blocked_send(event):
        await original(event)
        if event["type"] == "asr.final":
            final_published.set()
            await release_final.wait()
    ws.send_json = blocked_send
    await speak(ws)
    await final_published.wait()
    await ws.control({"type": "response.interrupt", "response_id": session.response.id})
    await wait_until(lambda: session.response.interrupted)
    release_final.set()
    await wait_until(lambda: any(e["type"] == "response.interrupted" for e in ws.events))
    assert agent.turns == []
    assert session.response.task.done()
    await ws.control({"type": "session.end"})
    await task


@pytest.mark.asyncio
async def test_disconnect_joins_cleanup_even_when_stop_caller_is_cancelled():
    agent = FakeAgent()
    agent.block = True
    cancel_entered = asyncio.Event()
    release_cancel = asyncio.Event()
    original_cancel = agent.cancel
    async def slow_cancel(run_id, conversation_id):
        cancel_entered.set()
        await release_cancel.wait()
        return await original_cancel(run_id, conversation_id)
    agent.cancel = slow_cancel
    ws, _, _, _, session, task = await setup(agent=agent)
    await speak(ws)
    await wait_until(lambda: ws.audio)
    session._watcher.cancel()
    await asyncio.gather(session._watcher, return_exceptions=True)
    session._watcher = asyncio.create_task(session._stop_response(user_requested=True))
    await cancel_entered.wait()
    await ws.incoming.put({"type": "websocket.disconnect", "code": 1001})
    await asyncio.sleep(.01)
    assert not task.done()
    release_cancel.set()
    await task
    assert agent.persisted_partial
    assert session.response.task.done()
    assert session.response.stop_task.done()


@pytest.mark.asyncio
async def test_denied_durable_cancel_still_closes_own_native_stream():
    agent = FakeAgent()
    agent.block = True
    async def denied_cancel(*args):
        raise VoiceError("permission_denied", fatal=True)
    agent.cancel = denied_cancel
    ws, _, _, _, session, task = await setup(agent=agent)
    await speak(ws)
    await wait_until(lambda: ws.audio)
    await ws.control({"type": "response.interrupt", "response_id": session.response.id})
    await task
    assert agent.persisted_partial
    assert session.response.task.done()
    assert any(e.get("code") == "permission_denied" for e in ws.events)


@pytest.mark.asyncio
async def test_tts_drain_timeout_preserves_persisted_native_terminal_status():
    ws, _, _, provider, session, task = await setup(config=replace(VoiceConfig(), tts_finish_timeout=.01))
    class SlowTTS(FakeTTS):
        async def finish(self):
            await asyncio.Event().wait()
    async def slow_open(response_id):
        stream = SlowTTS()
        provider.tts.append(stream)
        return stream
    provider.open_tts = slow_open
    await speak(ws)
    await wait_until(lambda: any(e["type"] == "response.done" for e in ws.events))
    assert [e["status"] for e in ws.events if e["type"] == "response.done"] == ["waiting_confirmation"]
    assert any(e.get("code") == "tts_unavailable" for e in ws.events)
    await ws.control({"type": "session.end"})
    await task


@pytest.mark.asyncio
async def test_no_pcm_tts_has_minus_one_terminal_sequence():
    ws, _, _, provider, session, task = await setup()
    class EmptyTTS(FakeTTS):
        async def append_text(self, text):
            self.text.append(text)
    async def empty_open(response_id):
        stream = EmptyTTS()
        provider.tts.append(stream)
        return stream
    provider.open_tts = empty_open
    await speak(ws)
    await wait_until(lambda: any(e["type"] == "response.done" for e in ws.events))
    assert ws.audio == []
    assert any(e["type"] == "tts.done" and e["last_sequence"] == -1 for e in ws.events)
    await ws.control({"type": "session.end"})
    await task


@pytest.mark.asyncio
async def test_native_caller_cancel_during_tts_cleanup_is_not_swallowed():
    from app.services.voice.session import Response
    usage = FakeUsage()
    session = VoiceSession(FakeSocket(), config=VoiceConfig(), provider=FakeProvider(usage),
                           agent=FakeAgent(), usage=usage)
    cleanup_entered = asyncio.Event()
    release_cleanup = asyncio.Event()
    continued = []
    async def tts_work():
        try:
            await asyncio.Event().wait()
        finally:
            cleanup_entered.set()
            await release_cleanup.wait()
    turn = Response(str(uuid4()), 1, session.clock())
    turn.tts_task = asyncio.create_task(tts_work())
    await asyncio.sleep(0)
    async def native_caller():
        await session._stop_tts(turn)
        continued.append(True)
    caller = asyncio.create_task(native_caller())
    await cleanup_entered.wait()
    caller.cancel("aria_user_interrupted")
    with pytest.raises(asyncio.CancelledError):
        await caller
    assert continued == []
    release_cleanup.set()
    await asyncio.gather(turn.tts_task, return_exceptions=True)


@pytest.mark.asyncio
async def test_empty_asr_final_does_not_start_native_work():
    ws, _, agent, provider, session, task = await setup()
    utterance = str(uuid4())
    await ws.frame(utterance)
    await wait_until(lambda: provider.asr)
    async def empty_commit():
        await provider.asr[0].queue.put(SimpleNamespace(text="   ", final=True))
    provider.asr[0].commit = empty_commit
    await ws.control({"type": "audio.commit", "utterance_id": utterance, "last_sequence": 0})
    await task
    assert agent.turns == []
    assert any(e.get("code") == "asr_unavailable" for e in ws.events)


@pytest.mark.asyncio
async def test_uncertain_provider_cleanup_retains_full_usage_reservation():
    ws, usage, _, provider, session, task = await setup()
    utterance = str(uuid4())
    await ws.frame(utterance)
    await wait_until(lambda: provider.asr)
    async def failed_close():
        raise OSError("offline close failure")
    provider.asr[0].close = failed_close
    await ws.control({"type": "audio.commit", "utterance_id": utterance, "last_sequence": 0})
    await wait_until(lambda: any(e["type"] == "response.done" for e in ws.events))
    await ws.control({"type": "session.end"})
    await task
    assert usage.closed == []


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["asr", "tts"])
async def test_uncertain_provider_handshake_retains_reservation_before_stream_return(kind):
    ws, usage, _, provider, session, task = await setup()
    async def failed_open(stream_id):
        # The provider owns handshake sockets that never became ASR/TTS streams.
        provider.cleanup_uncertain = True
        raise VoiceError(f"{kind}_unavailable", fatal=kind == "asr")
    if kind == "asr":
        provider.open_asr = failed_open
        await ws.frame(str(uuid4()))
    else:
        provider.open_tts = failed_open
        await speak(ws)
        await wait_until(lambda: any(e["type"] == "response.done" for e in ws.events))
        await ws.control({"type": "session.end"})
    await task
    assert usage.closed == []
    assert any(e.get("code") == f"{kind}_unavailable" for e in ws.events)


@pytest.mark.asyncio
async def test_exhausted_input_budget_rejects_before_another_paid_asr_open():
    ws, usage, _, provider, session, task = await setup(config=replace(VoiceConfig(), max_audio_bytes=640))
    await speak(ws)
    await wait_until(lambda: any(e["type"] == "response.done" for e in ws.events))
    assert len(provider.asr) == 1
    await ws.frame(str(uuid4()))
    await task
    assert len(provider.asr) == 1
    assert any(e.get("code") == "rate_limited" for e in ws.events)
    assert session.input_bytes == 640
