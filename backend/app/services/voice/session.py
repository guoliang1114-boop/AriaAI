"""Bounded full-duplex voice transport around the native Agent runtime.

Only final ASR enters the Agent. Audio is kept in memory, never persisted or
logged. A single native turn owns its task; interrupt waits for its native
persistence finally before admitting another turn.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from contextlib import aclosing, suppress
from dataclasses import dataclass, field
from uuid import UUID, uuid4

from starlette.websockets import WebSocketDisconnect

from app.services.voice.protocol import (
    AudioFrame, INPUT_FORMAT, OUTPUT_FORMAT, VoiceError,
    decode_audio_frame, encode_audio_frame,
)

SAFE_MESSAGES = {
    "permission_denied": "You do not have permission to use this conversation.",
    "network_unavailable": "The voice connection is unavailable. Please reconnect.",
    "asr_unavailable": "Speech recognition is unavailable. Please try again.",
    "agent_unavailable": "Aria could not complete this response. Please check the conversation.",
    "tts_unavailable": "Audio playback is unavailable. The text response is still available.",
    "rate_limited": "The voice usage limit has been reached. Please try later.",
    "session_expired": "The voice session has expired. Please reconnect.",
}
PRODUCT_EVENTS = frozenset({
    "run_started", "turn_receipt", "context_receipt", "steering_applied", "status",
    "reference_delta", "step_started", "step_completed", "tool_progress", "task_update",
    "confirmation_required", "artifact_ready", "memory_candidate_ready",
    "message_persisted", "run_done", "run_failed",
})


def protocol_error() -> VoiceError:
    return VoiceError("network_unavailable", retryable=False, fatal=True)


def valid_uuid(value) -> str:
    if not isinstance(value, str):
        raise protocol_error()
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError):
        raise protocol_error() from None
    if str(parsed) != value.lower():
        raise protocol_error()
    return str(parsed)


def exact_format(actual, expected: dict) -> bool:
    return (isinstance(actual, dict) and set(actual) == set(expected)
            and all(type(actual[key]) is type(value) and actual[key] == value
                    for key, value in expected.items()))


def parse_control(raw: str) -> dict:
    if len(raw.encode("utf-8")) > 16_384:
        raise protocol_error()
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        raise protocol_error() from None
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        raise protocol_error()
    return value


@dataclass
class Utterance:
    id: str
    stream: object
    started: float
    sequence: int = -1
    bytes: int = 0
    committed: bool = False
    final_seen: bool = False
    final_text: str | None = None
    task: asyncio.Task | None = None
    commit_time: float | None = None
    first_seen: bool = False
    first_ms: float | None = None


@dataclass
class Response:
    id: str
    generation: int
    started: float
    task: asyncio.Task | None = None
    run_id: str | None = None
    status: str = "failed"
    interrupted: bool = False
    tts_failed: bool = False
    tts_task: asyncio.Task | None = None
    tts_stream: object | None = None
    tts_queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=16))
    native_done: bool = False
    stop_task: asyncio.Task | None = None
    interruption_notified: bool = False
    first_text_seen: bool = False
    first_audio_seen: bool = False
    tts_sequence: int = -1
    audio_started: float | None = None
    audio_bytes: int = 0


class SpeechChunks:
    """Small first chunk, then sentence-sized chunks without unbounded buffering."""
    def __init__(self):
        self.buffer = ""
        self.first = True

    def append(self, text: str) -> list[str]:
        self.buffer += text
        result = []
        while self.buffer:
            threshold = 40 if self.first else 120
            match = re.search(r"[。！？.!?\n]", self.buffer)
            stop = match.end() if match else (threshold if len(self.buffer) >= threshold else 0)
            if not stop:
                break
            result.append(self.buffer[:stop])
            self.buffer = self.buffer[stop:]
            self.first = False
        return result

    def finish(self) -> str:
        result, self.buffer = self.buffer, ""
        return result


class VoiceSession:
    def __init__(self, websocket, *, config, provider, agent, usage, clock=time.monotonic):
        self.ws = websocket
        self.config = config
        self.provider = provider
        self.agent = agent
        self.usage = usage
        self.clock = clock
        self.id = str(uuid4())
        self.conversation_id: int | None = None
        self.locale = "zh-CN"
        self.actor = None
        self.reservation = None
        self.started = clock()
        self.last_activity = self.started
        self.input_bytes = 0
        self.text_characters = 0
        self.tts_characters = 0
        self.output_bytes = 0
        self.generation = 0
        self.utterance: Utterance | None = None
        self.response: Response | None = None
        self.seen_utterances: set[str] = set()
        self._send_lock = asyncio.Lock()
        self._closed = False
        self._cleanup_failed = False
        self._fatal: asyncio.Future | None = None
        self._watcher: asyncio.Task | None = None
        self._asr_tasks: set[asyncio.Task] = set()

    async def send(self, event: dict) -> None:
        if self._closed:
            return
        try:
            async with asyncio.timeout(self.config.send_timeout):
                async with self._send_lock:
                    if not self._closed:
                        await self.ws.send_json(event)
        except (TimeoutError, WebSocketDisconnect, RuntimeError, OSError):
            raise VoiceError("network_unavailable", fatal=True) from None

    async def send_audio(self, turn: Response, pcm: bytes) -> None:
        if not self._current(turn) or turn.interrupted:
            return
        if not pcm or len(pcm) % 2:
            if pcm:
                raise VoiceError("tts_unavailable")
            return
        # Bound generated audio independently of input and text limits.
        self.output_bytes += len(pcm)
        if self.output_bytes > self.config.max_session_seconds * 24_000 * 2:
            raise VoiceError("rate_limited", fatal=True)
        # Keep each WS frame small even when a supplier returns a large chunk.
        for start in range(0, len(pcm), 9600):
            part = pcm[start:start + 9600]
            if turn.audio_started is None:
                turn.audio_started = self.clock()
            # Suppliers can synthesize faster than playback. Keep at most
            # 200 ms ahead so the client's bounded player never grows forever.
            delay = turn.audio_bytes / 48_000 - (self.clock() - turn.audio_started) - .2
            if delay > 0:
                await asyncio.sleep(delay)
            async with asyncio.timeout(self.config.send_timeout):
                async with self._send_lock:
                    # Recheck after the await/lock: stale queued audio must die.
                    if not self._current(turn) or turn.interrupted or self._closed:
                        return
                    turn.tts_sequence += 1
                    turn.audio_bytes += len(part)
                    await self.ws.send_bytes(encode_audio_frame(AudioFrame(
                        kind=2, stream_id=turn.id, sequence=turn.tts_sequence, payload=part,
                    )))
            if not turn.first_audio_seen:
                turn.first_audio_seen = True
                await self.send({"type": "latency", "response_id": turn.id,
                                 "tts_first_ms": round((self.clock() - turn.started) * 1000, 2)})

    async def error(self, error: VoiceError, response_id: str | None = None) -> None:
        event = {"type": "error", "code": error.code,
                 "message": SAFE_MESSAGES.get(error.code, SAFE_MESSAGES["network_unavailable"]),
                 "retryable": error.retryable, "fatal": error.fatal}
        if response_id:
            event["response_id"] = response_id
        await self.send(event)

    def _fail(self, error: VoiceError) -> None:
        if self._fatal is not None and not self._fatal.done():
            self._fatal.set_result(error)

    def _current(self, turn: Response) -> bool:
        return self.response is turn and turn.generation == self.generation

    def _busy(self) -> bool:
        return self.response is not None and self.response.task is not None and not self.response.task.done()

    async def _receive(self) -> dict:
        receive = asyncio.create_task(self.ws.receive())
        try:
            done, _ = await asyncio.wait({receive, self._fatal}, return_when=asyncio.FIRST_COMPLETED)
            if self._fatal in done:
                raise self._fatal.result()
            message = receive.result()
            if message["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))
            return message
        finally:
            if not receive.done():
                receive.cancel()
                with suppress(asyncio.CancelledError):
                    await receive

    async def run(self) -> None:
        self._fatal = asyncio.get_running_loop().create_future()
        try:
            first = await asyncio.wait_for(self._receive(), timeout=self.config.connect_timeout)
            if first.get("text") is None:
                raise protocol_error()
            await self._start(parse_control(first["text"]))
            self._watcher = asyncio.create_task(self._watch(), name="voice-session-watch")
            while not self._closed:
                message = await self._receive()
                self.last_activity = self.clock()
                if message.get("bytes") is not None:
                    await self._audio(message["bytes"])
                elif message.get("text") is not None:
                    control = parse_control(message["text"])
                    if control["type"] == "session.end":
                        if set(control) != {"type"}:
                            raise protocol_error()
                        await self._stop_response(user_requested=True)
                        await self.send({"type": "session.ended", "session_id": self.id})
                        break
                    await self._control(control)
                else:
                    raise protocol_error()
        except WebSocketDisconnect:
            pass
        except VoiceError as exc:
            with suppress(Exception):
                await self.error(exc)
        except (TimeoutError, OSError):
            with suppress(Exception):
                await self.error(VoiceError("network_unavailable", fatal=True))
        except Exception:
            # Never forward provider errors, transcripts, tokens or tracebacks.
            with suppress(Exception):
                await self.error(VoiceError("agent_unavailable", fatal=True))
        finally:
            await self.close()

    async def _start(self, message: dict) -> None:
        allowed = {"type", "version", "conversation_id", "locale", "input_audio", "output_audio"}
        if (set(message) != allowed or message.get("type") != "session.start"
                or type(message.get("version")) is not int or message["version"] != 1
                or type(message.get("conversation_id")) is not int or message["conversation_id"] <= 0
                or not exact_format(message.get("input_audio"), INPUT_FORMAT)
                or not exact_format(message.get("output_audio"), OUTPUT_FORMAT)
                or not isinstance(message.get("locale"), str)
                or not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}", message["locale"])):
            raise protocol_error()
        self.conversation_id = message["conversation_id"]
        self.locale = message["locale"]
        self.actor = await self.agent.authorize(self.conversation_id)
        # A durable per-user reservation is committed before any provider opens.
        self.reservation = await self.usage.acquire(self.actor.user_id, self.id)
        await self.send({"type": "session.ready", "version": 1, "session_id": self.id,
                         "input_audio": INPUT_FORMAT, "output_audio": OUTPUT_FORMAT,
                         "limits": self.config.public_limits()})

    async def _audio(self, data: bytes) -> None:
        frame = decode_audio_frame(data, expected_kind=1)
        # One exact 20 ms input frame: 16 kHz * 1 channel * 2 bytes * .020.
        if len(frame.payload) != 640:
            raise protocol_error()
        if self._busy():
            raise VoiceError("rate_limited", retryable=True, fatal=True)
        # Check aggregate budget before opening another billable ASR stream.
        if self.input_bytes + len(frame.payload) > min(
                self.config.max_audio_bytes, self.config.max_session_seconds * 32_000):
            raise VoiceError("rate_limited", fatal=True)
        utterance = self.utterance
        if utterance is None:
            if frame.sequence != 0 or frame.stream_id in self.seen_utterances:
                raise protocol_error()
            if len(self.seen_utterances) >= 60:
                raise VoiceError("rate_limited", fatal=True)
            # Recheck before paid recognition, not only before the final Agent.
            await self.agent.authorize(self.conversation_id)
            try:
                stream = await asyncio.wait_for(self.provider.open_asr(frame.stream_id), self.config.connect_timeout)
            except VoiceError:
                raise
            except Exception:
                raise VoiceError("asr_unavailable", fatal=True) from None
            utterance = Utterance(frame.stream_id, stream, self.clock())
            self.utterance = utterance
            self.seen_utterances.add(frame.stream_id)
            utterance.task = asyncio.create_task(self._asr_events(utterance), name="voice-asr")
            self._asr_tasks.add(utterance.task)
            utterance.task.add_done_callback(self._asr_tasks.discard)
        if (utterance.id != frame.stream_id or utterance.committed
                or frame.sequence != utterance.sequence + 1):
            raise protocol_error()
        if utterance.bytes + len(frame.payload) > self.config.max_utterance_seconds * 32_000:
            raise VoiceError("rate_limited", fatal=True)
        utterance.sequence = frame.sequence
        utterance.bytes += len(frame.payload)
        self.input_bytes += len(frame.payload)
        try:
            await asyncio.wait_for(utterance.stream.append(frame.payload), self.config.send_timeout)
        except VoiceError:
            raise
        except Exception:
            raise VoiceError("asr_unavailable", fatal=True) from None

    async def _control(self, message: dict) -> None:
        if message["type"] == "audio.commit":
            if set(message) != {"type", "utterance_id", "last_sequence"}:
                raise protocol_error()
            utterance_id = valid_uuid(message["utterance_id"])
            utterance = self.utterance
            if (utterance is None or utterance.id != utterance_id or utterance.committed
                    or type(message["last_sequence"]) is not int
                    or utterance.sequence != message["last_sequence"]):
                raise protocol_error()
            utterance.committed = True
            utterance.commit_time = self.clock()
            try:
                await asyncio.wait_for(utterance.stream.commit(), self.config.send_timeout)
            except VoiceError:
                raise
            except Exception:
                raise VoiceError("asr_unavailable", fatal=True) from None
            if utterance.final_text is not None:
                await self._final(utterance, utterance.final_text)
        elif message["type"] == "response.interrupt":
            if set(message) != {"type", "response_id"}:
                raise protocol_error()
            response_id = valid_uuid(message["response_id"])
            if self.response is None or self.response.id != response_id:
                raise protocol_error()
            await self._stop_response(user_requested=True)
        else:
            # No voice approval, recovery, arbitrary text or tool execution path.
            raise protocol_error()

    async def _asr_events(self, utterance: Utterance) -> None:
        try:
            async for event in utterance.stream.events():
                if self.utterance is not utterance or utterance.final_seen or self._closed:
                    break
                text = event.text
                if not isinstance(text, str) or len(text) > min(8000, self.config.max_text_characters):
                    raise VoiceError("rate_limited", fatal=True)
                if not utterance.first_seen:
                    utterance.first_seen = True
                    utterance.first_ms = round((self.clock() - utterance.started) * 1000, 2)
                if event.final:
                    if utterance.committed:
                        await self._final(utterance, text)
                        break
                    utterance.final_text = text
                else:
                    await self.send({"type": "asr.partial", "utterance_id": utterance.id, "text": text})
            if not utterance.final_seen and not self._closed and utterance.final_text is None:
                raise VoiceError("asr_unavailable", fatal=True)
        except asyncio.CancelledError:
            raise
        except VoiceError as exc:
            self._fail(exc)
        except Exception:
            self._fail(VoiceError("asr_unavailable", fatal=True))
        finally:
            try:
                await asyncio.wait_for(utterance.stream.close(), self.config.cleanup_timeout)
            except Exception:
                self._cleanup_failed = True

    async def _final(self, utterance: Utterance, text: str) -> None:
        if utterance.final_seen or self.utterance is not utterance:
            return
        utterance.final_seen = True  # Mark before auth awaits: one turn per final.
        await self.agent.authorize(self.conversation_id)
        text = text.strip()
        if not text:
            raise VoiceError("asr_unavailable", retryable=True, fatal=True)
        if self._busy():
            raise VoiceError("rate_limited", fatal=True)
        self.utterance = None
        self.generation += 1
        turn = Response(str(uuid4()), self.generation, self.clock())
        self.response = turn
        start_gate = asyncio.Event()
        # Own the task before publishing response_id. A stop/disconnect during
        # either send below must cancel this waiting task, never launch a turn.
        turn.task = asyncio.create_task(self._respond(turn, text, start_gate), name="voice-native-turn")
        await self.send({"type": "asr.final", "utterance_id": utterance.id, "text": text,
                         "response_id": turn.id})
        await self.send({"type": "latency", "response_id": turn.id,
                         "asr_first_ms": utterance.first_ms or 0.0,
                         "asr_final_ms": round((self.clock() - (utterance.commit_time or utterance.started)) * 1000, 2)})
        start_gate.set()

    async def _respond(self, turn: Response, text: str, start_gate: asyncio.Event) -> None:
        chunks = SpeechChunks()
        try:
            await start_gate.wait()
            if turn.interrupted or self._closed:
                turn.status = "cancelled"
                return
            async with aclosing(self.agent.events(self.conversation_id, text, self.locale)) as events:
                async for event in events:
                    event_type = event.get("type")
                    if event.get("run_id"):
                        turn.run_id = str(event["run_id"])
                    if event_type in PRODUCT_EVENTS:
                        await self.send({"type": "agent.event", "response_id": turn.id, "event": event})
                    if event_type == "run_done":
                        turn.status = event.get("final_status", "failed")
                        turn.native_done = True
                    elif event_type in {"run_failed", "error"}:
                        turn.status = "failed"
                        turn.native_done = True
                    elif event_type == "text" and not turn.interrupted:
                        content = event.get("content", "")
                        if not isinstance(content, str):
                            continue
                        self.text_characters += len(content)
                        if self.text_characters > self.config.max_text_characters:
                            raise VoiceError("rate_limited", fatal=True)
                        if not turn.first_text_seen:
                            turn.first_text_seen = True
                            await self.send({"type": "latency", "response_id": turn.id,
                                             "agent_first_ms": round((self.clock() - turn.started) * 1000, 2)})
                        await self.send({"type": "text.delta", "response_id": turn.id, "text": content})
                        for chunk in chunks.append(content):
                            await self._queue_speech(turn, chunk)
                    # Product text_delta mirrors legacy text. Never consume it.
            if not turn.native_done:
                raise VoiceError("agent_unavailable")
            if not turn.interrupted:
                await self._queue_speech(turn, chunks.finish())
                if turn.tts_task is not None and not turn.tts_failed:
                    await asyncio.wait_for(turn.tts_queue.put(None), self.config.send_timeout)
                    await asyncio.wait_for(asyncio.shield(turn.tts_task), self.config.tts_finish_timeout)
                elif turn.tts_task is None:
                    await self.send({"type": "tts.done", "response_id": turn.id, "last_sequence": -1})
        except asyncio.CancelledError:
            if not turn.native_done:
                turn.status = "cancelled"
            raise
        except VoiceError as exc:
            if not turn.native_done:
                turn.status = "failed"
            await self.error(exc, turn.id)
            if exc.fatal:
                self._fail(exc)
        except Exception:
            if not turn.native_done:
                turn.status = "failed"
            await self.error(VoiceError("tts_unavailable" if turn.native_done else "agent_unavailable"), turn.id)
        finally:
            await self._stop_tts(turn)
            self.last_activity = self.clock()
            if not self._closed:
                with suppress(Exception):
                    await self.send({"type": "response.done", "response_id": turn.id,
                                     "run_id": turn.run_id, "status": turn.status})

    async def _queue_speech(self, turn: Response, text: str) -> None:
        if not text or turn.interrupted or turn.tts_failed:
            return
        if turn.tts_task is None:
            turn.tts_task = asyncio.create_task(self._tts(turn), name="voice-tts")
        try:
            await asyncio.wait_for(turn.tts_queue.put(text), self.config.send_timeout)
        except TimeoutError:
            turn.tts_failed = True
            await self._stop_tts(turn)
            await self.error(VoiceError("tts_unavailable"), turn.id)

    async def _tts(self, turn: Response) -> None:
        audio_task = None
        try:
            turn.tts_stream = await asyncio.wait_for(self.provider.open_tts(turn.id), self.config.connect_timeout)

            async def consume():
                async for pcm in turn.tts_stream.audio():
                    if turn.interrupted or not self._current(turn):
                        break
                    await self.send_audio(turn, pcm)
            audio_task = asyncio.create_task(consume(), name="voice-tts-audio")
            while not turn.interrupted:
                item = await turn.tts_queue.get()
                if item is None:
                    break
                self.tts_characters += len(item)
                await asyncio.wait_for(turn.tts_stream.append_text(item), self.config.send_timeout)
            if turn.interrupted:
                return
            await asyncio.wait_for(turn.tts_stream.finish(), self.config.send_timeout)
            await asyncio.wait_for(asyncio.shield(audio_task), self.config.tts_finish_timeout)
            if self._current(turn) and not turn.interrupted:
                await self.send({"type": "tts.done", "response_id": turn.id,
                                 "last_sequence": turn.tts_sequence})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            turn.tts_failed = True
            error = exc if isinstance(exc, VoiceError) else VoiceError("tts_unavailable")
            with suppress(Exception):
                await self.error(error, turn.id)
            if error.fatal:
                self._fail(error)
        finally:
            if audio_task is not None and not audio_task.done():
                audio_task.cancel()
            if audio_task is not None:
                with suppress(asyncio.CancelledError, Exception):
                    await audio_task
            if turn.tts_stream is not None:
                try:
                    await asyncio.wait_for(turn.tts_stream.close(), self.config.cleanup_timeout)
                except Exception:
                    self._cleanup_failed = True

    async def _stop_tts(self, turn: Response) -> None:
        if turn.tts_task is not None and not turn.tts_task.done() and not turn.tts_task.cancelling():
            turn.tts_task.cancel()
        if turn.tts_task is not None:
            caller = asyncio.current_task()
            cancelling_before = caller.cancelling() if caller else 0
            try:
                await asyncio.shield(turn.tts_task)
            except asyncio.CancelledError:
                # Child cancellation is expected; cancellation of this caller
                # belongs to the native harness and must reach its persistence
                # finally instead of resuming execution after a voice stop.
                if caller is not None and caller.cancelling() > cancelling_before:
                    raise
            except Exception:
                pass
        while not turn.tts_queue.empty():
            with suppress(asyncio.QueueEmpty):
                turn.tts_queue.get_nowait()

    async def _stop_response(self, *, user_requested: bool) -> None:
        turn = self.response
        if turn is None:
            return
        turn.interrupted = True  # Audio gate, not a claim cleanup has finished.
        if turn.stop_task is None:
            turn.stop_task = asyncio.create_task(
                self._finish_stop(turn, user_requested=user_requested), name="voice-stop-turn")
        # A disconnect can cancel the watchdog/receive caller. It must not
        # cancel the one cleanup owner midway through native persistence.
        await asyncio.shield(turn.stop_task)
        if user_requested and not turn.interruption_notified:
            turn.interruption_notified = True
            await self.send({"type": "response.interrupted", "response_id": turn.id})
        self.last_activity = self.clock()

    async def _finish_stop(self, turn: Response, *, user_requested: bool) -> None:
        # Stop audio now; supplier close runs alongside native cancellation so a
        # slow provider socket cannot leave native tools running for 15 seconds.
        if turn.tts_task is not None and not turn.tts_task.done() and not turn.tts_task.cancelling():
            turn.tts_task.cancel()
        failure = None
        if turn.task is not None and not turn.task.done():
            if turn.run_id and user_requested and not turn.native_done:
                try:
                    await self.agent.cancel(turn.run_id, self.conversation_id)
                except Exception as exc:
                    # An ACL/token revocation denies the user action, but the
                    # transport must still release its own execution task.
                    # This is stream closure, not an authorization bypass.
                    failure = exc
                    if not turn.task.cancelling():
                        turn.task.cancel()
            elif not turn.task.cancelling():
                # Before run_started there is no durable run. After native
                # completion this only closes speech, preserving actual status.
                turn.task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(turn.task), self.config.cleanup_timeout)
            except asyncio.CancelledError:
                pass
            except TimeoutError:
                # Never hard-cancel twice through the native persistence finally.
                raise VoiceError("agent_unavailable", retryable=False, fatal=True) from None
        await self._stop_tts(turn)
        if failure is not None:
            raise failure

    async def _watch(self) -> None:
        last_auth = self.clock()
        try:
            while not self._closed:
                await asyncio.sleep(min(1.0, self.config.auth_check_seconds))
                now = self.clock()
                if now - self.started >= self.config.max_session_seconds:
                    raise VoiceError("session_expired", retryable=False, fatal=True)
                if not self._busy() and now - self.last_activity >= self.config.max_idle_seconds:
                    raise VoiceError("session_expired", retryable=True, fatal=True)
                if now - last_auth >= self.config.auth_check_seconds:
                    await self.agent.authorize(self.conversation_id)
                    last_auth = now
                utterance = self.utterance
                if utterance:
                    if utterance.committed and now - utterance.commit_time >= self.config.asr_final_timeout:
                        raise VoiceError("asr_unavailable", fatal=True)
                    if not utterance.committed and now - utterance.started >= self.config.max_utterance_seconds:
                        raise VoiceError("rate_limited", fatal=True)
                if self._busy() and now - self.response.started >= self.config.max_response_seconds:
                    await self._stop_response(user_requested=True)
                    await self.error(VoiceError("tts_unavailable" if self.response.native_done
                                                else "agent_unavailable"), self.response.id)
        except asyncio.CancelledError:
            raise
        except VoiceError as exc:
            self._fail(exc)
        except Exception:
            self._fail(VoiceError("agent_unavailable", fatal=True))

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._watcher is not None:
            self._watcher.cancel()
            with suppress(asyncio.CancelledError):
                await self._watcher
        utterance = self.utterance
        if utterance is not None:
            if utterance.task is not None:
                utterance.task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await utterance.task
            try:
                await asyncio.wait_for(utterance.stream.close(), self.config.cleanup_timeout)
            except Exception:
                self._cleanup_failed = True
        for task in list(self._asr_tasks):
            task.cancel()
        if self._asr_tasks:
            await asyncio.gather(*self._asr_tasks, return_exceptions=True)
        with suppress(Exception):
            await self._stop_response(user_requested=False)
        if self.reservation is not None:
            # A failed cleanup stays fully reserved: never refund work that may
            # still be executing after its serving process/socket disappeared.
            if (not self._busy() and not self._cleanup_failed
                    and not getattr(self.provider, "cleanup_uncertain", False)):
                with suppress(Exception):
                    await self.reservation.close(audio_seconds=self.input_bytes / 32_000,
                                                 tts_characters=self.tts_characters)
        with suppress(Exception):
            await self.ws.close(code=1000)
