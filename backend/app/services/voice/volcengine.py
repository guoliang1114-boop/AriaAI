"""Server-only Volcengine streaming adapters, implemented from official protocol docs.

ASR: https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket
TTS: https://docs.volcengine.com/docs/DoubaoVoice/WebSocketBidirectionalStreaming-V3
No provider requests are made by importing/constructing this module. PCM layout
must be verified against an authorized dedicated-TTS sample before enabling it.
"""
from __future__ import annotations

import asyncio
import gzip
import json
import struct
import zlib
from contextlib import suppress
from dataclasses import dataclass, field
from typing import AsyncIterator
from uuid import uuid4

from websockets.asyncio.client import connect

from .protocol import VoiceError

ASR_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
TTS_URL = "wss://openspeech.bytedance.com/api/v3/tts/bidirection"
MAX_PROVIDER_PAYLOAD = 2 * 1024 * 1024
MAX_TEXT_CHUNK = 1000


@dataclass(frozen=True)
class VolcengineConfig:
    api_key: str = field(repr=False)
    asr_resource_id: str
    tts_resource_id: str
    speaker: str
    pcm_layout_confirmed: bool = False
    asr_url: str = ASR_URL
    tts_url: str = TTS_URL
    connect_timeout: float = 10.0

    def validate(self) -> None:
        if not all(isinstance(value, str) and value.strip() for value in
                   (self.api_key, self.asr_resource_id, self.tts_resource_id, self.speaker)):
            raise VoiceError("asr_unavailable", retryable=False, fatal=True)
        # Restrict supplier destinations; never forward a credential to a configurable arbitrary host.
        if self.asr_url != ASR_URL or self.tts_url != TTS_URL:
            raise VoiceError("asr_unavailable", retryable=False, fatal=True)
        if not self.pcm_layout_confirmed:
            raise VoiceError("tts_unavailable", retryable=False, fatal=True)
        if not 0 < self.connect_timeout <= 30:
            raise VoiceError("network_unavailable", retryable=False, fatal=True)


@dataclass(frozen=True)
class ASREvent:
    text: str
    final: bool
    utterance_key: str = ""


@dataclass(frozen=True)
class ProviderFrame:
    message_type: int
    event: int | None
    session_id: str | None
    payload: bytes
    final: bool = False
    sequence: int | None = None
    error_code: int | None = None


def _u32(data: bytes, offset: int) -> tuple[int, int]:
    if offset + 4 > len(data):
        raise ValueError("truncated field")
    return struct.unpack_from("!I", data, offset)[0], offset + 4


def _sized(data: bytes, offset: int) -> tuple[bytes, int]:
    length, offset = _u32(data, offset)
    if length > MAX_PROVIDER_PAYLOAD or offset + length > len(data):
        raise ValueError("invalid length")
    return data[offset:offset + length], offset + length


def _header(data: bytes) -> tuple[int, int, int, int, int]:
    if len(data) < 4 or data[0] >> 4 != 1:
        raise ValueError("invalid header")
    offset = (data[0] & 15) * 4
    if offset < 4 or offset > len(data) or data[3] != 0:
        raise ValueError("invalid header size")
    return offset, data[1] >> 4, data[1] & 15, data[2] >> 4, data[2] & 15


def _inflate(payload: bytes, compression: int) -> bytes:
    if compression == 0:
        return payload
    if compression != 1:
        raise ValueError("unsupported compression")
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    decoded = decoder.decompress(payload, MAX_PROVIDER_PAYLOAD + 1)
    if len(decoded) > MAX_PROVIDER_PAYLOAD or decoder.unconsumed_tail or not decoder.eof or decoder.unused_data:
        raise ValueError("invalid or excessive compressed payload")
    return decoded


def encode_asr_frame(payload: bytes, sequence: int, *, audio: bool, final: bool = False) -> bytes:
    if sequence <= 0 or len(payload) > MAX_PROVIDER_PAYLOAD:
        raise ValueError("invalid ASR frame")
    compressed = gzip.compress(payload)
    header = bytes((0x11, 0x23 if audio and final else 0x21 if audio else 0x11,
                    0x01 if audio else 0x11, 0))
    signed_sequence = -sequence if final else sequence
    return header + struct.pack("!iI", signed_sequence, len(compressed)) + compressed


def decode_asr_frame(data: bytes) -> ProviderFrame:
    offset, kind, flags, serialization, compression = _header(data)
    if kind not in (9, 15) or flags & ~7 or serialization not in (0, 1):
        raise ValueError("unsupported ASR frame")
    sequence = None
    if flags & 1:
        value, offset = _u32(data, offset)
        sequence = value - 0x100000000 if value & 0x80000000 else value
    event = None
    if flags & 4:
        event, offset = _u32(data, offset)
    error_code = None
    if kind == 15:
        error_code, offset = _u32(data, offset)
    payload, offset = _sized(data, offset)
    if offset != len(data):
        raise ValueError("trailing bytes")
    payload = _inflate(payload, compression)
    if kind == 9 and serialization != 1:
        raise ValueError("ASR response must be JSON")
    return ProviderFrame(kind, event, None, payload, bool(flags & 2), sequence, error_code)


def encode_tts_event(event: int, payload: dict, session_id: str | None = None) -> bytes:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    result = b"\x11\x14\x10\x00" + struct.pack("!I", event)
    if event not in (1, 2):
        if not session_id or len(session_id.encode()) > 128:
            raise ValueError("session required")
        raw_id = session_id.encode()
        result += struct.pack("!I", len(raw_id)) + raw_id
    return result + struct.pack("!I", len(body)) + body


def decode_tts_frame(data: bytes) -> ProviderFrame:
    offset, kind, flags, serialization, compression = _header(data)
    if kind not in (9, 11, 15) or flags not in (0, 4):
        raise ValueError("unsupported TTS frame")
    if kind == 15:
        code, offset = _u32(data, offset)
        payload, offset = _sized(data, offset)
        if offset != len(data):
            raise ValueError("trailing error bytes")
        return ProviderFrame(kind, None, None, _inflate(payload, compression), error_code=code)
    if flags != 4:
        raise ValueError("TTS event required")
    event, offset = _u32(data, offset)
    raw_id, offset = _sized(data, offset)  # connect_id for 50/51/52; session_id otherwise
    if not raw_id or len(raw_id) > 128:
        raise ValueError("invalid stream identity")
    identity = raw_id.decode("utf-8")
    payload, offset = _sized(data, offset)
    if offset != len(data) or serialization not in (0, 1):
        raise ValueError("invalid payload")
    if kind == 11 and (serialization != 0 or event != 352):
        raise ValueError("unexpected audio framing")
    return ProviderFrame(kind, event, identity, _inflate(payload, compression))


async def _send(socket, payload: bytes) -> None:
    await asyncio.wait_for(socket.send(payload), timeout=10)


async def _receive(socket, timeout: float = 30) -> bytes:
    payload = await asyncio.wait_for(socket.recv(), timeout=timeout)
    if not isinstance(payload, bytes) or len(payload) > MAX_PROVIDER_PAYLOAD + 512:
        raise ValueError("invalid provider message")
    return payload


class VolcengineProvider:
    def __init__(self, config: VolcengineConfig, *, connector=connect):
        self.config = config
        self._connect = connector
        self._cleanup_uncertain = False
        self._open_cleanup_pending = 0

    @property
    def cleanup_uncertain(self) -> bool:
        """Sticky accounting signal, including opens that never returned a stream."""
        return self._cleanup_uncertain or self._open_cleanup_pending > 0

    async def _close_failed_open(self, socket) -> None:
        # A caller may be cancelled while a failed handshake is being closed.
        # Pending cleanup cannot be treated as proof that billable work stopped.
        self._open_cleanup_pending += 1
        try:
            await asyncio.wait_for(socket.close(), timeout=2)
        except asyncio.CancelledError:
            self._cleanup_uncertain = True
            raise
        except Exception:
            self._cleanup_uncertain = True
        finally:
            self._open_cleanup_pending -= 1

    async def _socket(self, url: str, resource: str):
        self.config.validate()
        connection_id = str(uuid4())
        headers = {"X-Api-Key": self.config.api_key,
                   "X-Api-Resource-Id": resource, "X-Api-Request-Id": connection_id,
                   "X-Api-Connect-Id": connection_id}
        if url == ASR_URL:
            headers["X-Api-Sequence"] = "-1"
        return await self._connect(
            url, additional_headers=headers,
            open_timeout=self.config.connect_timeout, close_timeout=2,
            max_size=MAX_PROVIDER_PAYLOAD + 512, max_queue=8, ping_interval=15, ping_timeout=10,
        )

    async def open_asr(self, utterance_id: str) -> "ASRStream":
        socket = None
        try:
            socket = await self._socket(self.config.asr_url, self.config.asr_resource_id)
            stream = ASRStream(socket, utterance_id)
            await stream.start()
            return stream
        except asyncio.CancelledError:
            if socket is not None:
                await self._close_failed_open(socket)
            else:
                # A cancelled connector may have completed its remote handshake
                # without returning ownership to us. Retain the full reservation.
                self._cleanup_uncertain = True
            raise
        except Exception as exc:
            if socket is not None:
                await self._close_failed_open(socket)
            if isinstance(exc, VoiceError):
                raise
            status = getattr(getattr(exc, "response", None), "status_code", None)
            raise VoiceError("rate_limited" if status == 429 else "asr_unavailable") from None

    async def open_tts(self, response_id: str) -> "TTSStream":
        socket = None
        try:
            socket = await self._socket(self.config.tts_url, self.config.tts_resource_id)
            stream = TTSStream(socket, response_id, self.config.speaker)
            await stream.start()
            return stream
        except asyncio.CancelledError:
            if socket is not None:
                await self._close_failed_open(socket)
            else:
                self._cleanup_uncertain = True
            raise
        except Exception as exc:
            if socket is not None:
                await self._close_failed_open(socket)
            if isinstance(exc, VoiceError):
                raise
            status = getattr(getattr(exc, "response", None), "status_code", None)
            raise VoiceError("rate_limited" if status == 429 else "tts_unavailable") from None


class ASRStream:
    def __init__(self, socket, utterance_id: str):
        self.socket = socket
        self.utterance_id = utterance_id
        self.sequence = 1
        self.buffer = bytearray()
        self.committed = False
        self.closed = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        body = {"user": {"uid": self.utterance_id},
                "audio": {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1},
                "request": {"model_name": "bigmodel", "show_utterances": True, "enable_itn": True,
                            "enable_punc": True, "enable_nonstream": True, "end_window_size": 800}}
        await _send(self.socket, encode_asr_frame(json.dumps(body).encode(), self.sequence, audio=False))

    async def append(self, pcm: bytes) -> None:
        async with self._lock:
            if self.closed or self.committed or not pcm or len(pcm) % 2 or len(pcm) > 65_536:
                raise VoiceError("asr_unavailable")
            self.buffer.extend(pcm)
            try:
                while len(self.buffer) >= 6400:  # provider recommended 200ms packets
                    chunk = bytes(self.buffer[:6400])
                    del self.buffer[:6400]
                    self.sequence += 1
                    await _send(self.socket, encode_asr_frame(chunk, self.sequence, audio=True))
            except asyncio.CancelledError:
                raise
            except Exception:
                raise VoiceError("asr_unavailable") from None

    async def commit(self) -> None:
        async with self._lock:
            if self.closed or self.committed:
                return
            self.committed = True
            self.sequence += 1
            payload = bytes(self.buffer)
            self.buffer.clear()
            try:
                await _send(self.socket, encode_asr_frame(payload, self.sequence, audio=True, final=True))
            except asyncio.CancelledError:
                raise
            except Exception:
                raise VoiceError("asr_unavailable") from None

    async def events(self) -> AsyncIterator[ASREvent]:
        previous = None
        try:
            while not self.closed:
                frame = decode_asr_frame(await _receive(self.socket))
                if frame.error_code is not None:
                    # 55000031 means upstream overload, not a user's quota.
                    raise VoiceError("asr_unavailable")
                payload = json.loads(frame.payload)
                result = payload.get("result") or {}
                if not isinstance(result, dict):
                    raise ValueError("invalid ASR result")
                text = result.get("text", "")
                if not isinstance(text, str) or len(text) > 12_000:
                    raise ValueError("excessive ASR transcript")
                # Provider text is cumulative/revisable, not a delta. Only the last
                # response after our explicit commit becomes one native Agent turn.
                final = frame.final and self.committed
                if text != previous or final:
                    yield ASREvent(text=text, final=final, utterance_key=self.utterance_id)
                    previous = text
                if frame.final:
                    if not self.committed:
                        raise VoiceError("asr_unavailable")
                    return
        except asyncio.CancelledError:
            raise
        except VoiceError:
            raise
        except Exception:
            raise VoiceError("asr_unavailable") from None

    async def close(self) -> None:
        self.closed = True
        self.buffer.clear()
        try:
            await self.socket.close()
        except Exception:
            raise VoiceError("asr_unavailable", fatal=True) from None


class TTSStream:
    def __init__(self, socket, response_id: str, speaker: str):
        self.socket = socket
        self.session_id = response_id
        self.speaker = speaker
        self.closed = False
        self.finishing = False
        self.started = False
        self.finished = False
        self.connection_id: str | None = None
        self._lock = asyncio.Lock()

    def _body(self, event: int, text: str | None = None) -> dict:
        params = {"speaker": self.speaker, "audio_params": {"format": "pcm", "sample_rate": 24000}}
        if text is not None:
            params["text"] = text
        return {"user": {"uid": self.session_id}, "event": event, "namespace": "BidirectionalTTS",
                "req_params": params}

    async def start(self) -> None:
        await _send(self.socket, encode_tts_event(1, {}))
        frame = decode_tts_frame(await _receive(self.socket, 10))
        if frame.event != 50 or frame.message_type != 9:
            raise VoiceError("tts_unavailable")
        self.connection_id = frame.session_id
        await _send(self.socket, encode_tts_event(100, self._body(100), self.session_id))
        frame = decode_tts_frame(await _receive(self.socket, 10))
        if frame.event != 150 or frame.session_id != self.session_id or frame.message_type != 9:
            raise VoiceError("tts_unavailable")
        self.started = True

    async def append_text(self, text: str) -> None:
        if not text:
            return
        async with self._lock:
            if self.closed or self.finishing or not self.started or len(text) > MAX_TEXT_CHUNK:
                raise VoiceError("tts_unavailable")
            try:
                await _send(self.socket, encode_tts_event(200, self._body(200, text), self.session_id))
            except asyncio.CancelledError:
                raise
            except Exception:
                raise VoiceError("tts_unavailable") from None

    async def finish(self) -> None:
        async with self._lock:
            if self.closed or self.finishing:
                return
            self.finishing = True
            try:
                await _send(self.socket, encode_tts_event(102, {}, self.session_id))
            except asyncio.CancelledError:
                raise
            except Exception:
                raise VoiceError("tts_unavailable") from None

    async def audio(self) -> AsyncIterator[bytes]:
        remainder = b""
        try:
            while not self.closed:
                frame = decode_tts_frame(await _receive(self.socket))
                if frame.error_code is not None or frame.event in (51, 153):
                    raise VoiceError("tts_unavailable")
                if frame.session_id != self.session_id:
                    raise VoiceError("tts_unavailable")
                if frame.message_type == 11 and frame.event == 352:
                    data = remainder + frame.payload
                    boundary = len(data) - len(data) % 2
                    remainder = data[boundary:]
                    # Backend strips supplier framing and forwards bounded PCM16 chunks.
                    for offset in range(0, boundary, 32_768):
                        yield data[offset:min(offset + 32_768, boundary)]
                elif frame.event == 152:
                    if not self.finishing or remainder:
                        raise VoiceError("tts_unavailable")
                    self.finished = True
                    return
                elif frame.event == 151:
                    return
                elif frame.event not in (350, 351, 359, 364):
                    raise VoiceError("tts_unavailable")
        except asyncio.CancelledError:
            raise
        except VoiceError:
            raise
        except Exception:
            raise VoiceError("tts_unavailable") from None

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        # A single connection owns exactly one response. Closing it is the hard
        # cancellation boundary even if FinishSession is already in flight.
        if self.started and not self.finishing and not self.finished:
            with suppress(Exception):
                await asyncio.wait_for(self.socket.send(encode_tts_event(101, {}, self.session_id)), timeout=1)
        elif self.finished:
            # Graceful connection completion only after the audio reader ended.
            # Cancellation/failed synthesis always retains the hard-close path.
            with suppress(Exception):
                async with asyncio.timeout(2):
                    await self.socket.send(encode_tts_event(2, {}))
                    frame = decode_tts_frame(await _receive(self.socket, 2))
                    if frame.event != 52 or frame.session_id != self.connection_id:
                        raise ValueError("unexpected connection completion")
        try:
            await self.socket.close()
        except Exception:
            raise VoiceError("tts_unavailable", fatal=True) from None
