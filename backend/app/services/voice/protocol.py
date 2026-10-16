"""Version 1 Aria voice wire contract; no provider keys, raw audio logs or files."""
from __future__ import annotations

import struct
from dataclasses import dataclass
from uuid import UUID

VERSION = 1
INPUT_FORMAT = {"encoding": "pcm_s16le", "sample_rate": 16000, "channels": 1, "frame_ms": 20}
OUTPUT_FORMAT = {"encoding": "pcm_s16le", "sample_rate": 24000, "channels": 1}
MAX_FRAME_BYTES = 65_536
_HEADER = struct.Struct("!4sBBH16sI")
ERROR_MESSAGES = {
    "permission_denied": "没有麦克风或此会话的访问权限。",
    "network_unavailable": "连接已中断，请检查网络后重试。",
    "asr_unavailable": "语音识别暂不可用，请稍后重试。",
    "agent_unavailable": "Aria 暂时无法完成这次回复。",
    "tts_unavailable": "语音播放暂不可用，文字回复仍可查看。",
    "rate_limited": "已达到语音使用限制，请稍后再试。",
    "session_expired": "语音会话已结束，请重新登录或开始。",
}


class VoiceError(Exception):
    def __init__(self, code: str, *, retryable: bool = True, fatal: bool = False):
        if code not in ERROR_MESSAGES:
            code = "network_unavailable"
        self.code = code
        self.retryable = retryable
        self.fatal = fatal
        super().__init__(code)

    def event(self, response_id: str | None = None) -> dict:
        result = {"type": "error", "code": self.code, "message": ERROR_MESSAGES[self.code],
                  "retryable": self.retryable, "fatal": self.fatal}
        if response_id is not None:
            result["response_id"] = response_id
        return result


@dataclass(frozen=True)
class AudioFrame:
    kind: int
    stream_id: str
    sequence: int
    payload: bytes


def encode_audio_frame(frame: AudioFrame) -> bytes:
    if frame.kind not in (1, 2) or not 0 <= frame.sequence <= 0xFFFFFFFF:
        raise VoiceError("network_unavailable", fatal=True)
    if not frame.payload or len(frame.payload) % 2 or len(frame.payload) > MAX_FRAME_BYTES:
        raise VoiceError("network_unavailable", fatal=True)
    try:
        stream = UUID(str(frame.stream_id)).bytes
    except (ValueError, TypeError, AttributeError) as exc:
        raise VoiceError("network_unavailable", fatal=True) from exc
    return _HEADER.pack(b"ARV1", frame.kind, 0, 0, stream, frame.sequence) + frame.payload


def decode_audio_frame(data: bytes, expected_kind: int = 1) -> AudioFrame:
    if len(data) <= _HEADER.size or len(data) > _HEADER.size + MAX_FRAME_BYTES:
        raise VoiceError("network_unavailable", fatal=True)
    magic, kind, flags, reserved, stream, sequence = _HEADER.unpack_from(data)
    payload = data[_HEADER.size:]
    if magic != b"ARV1" or kind != expected_kind or flags != 0 or reserved != 0 or len(payload) % 2:
        raise VoiceError("network_unavailable", fatal=True)
    return AudioFrame(kind, str(UUID(bytes=stream)), sequence, payload)
