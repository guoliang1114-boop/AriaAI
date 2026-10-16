"""WebSocket voice route. HTTP auth middleware does not cover this endpoint."""
from fastapi import APIRouter, WebSocket
from contextlib import suppress

from app.config import load_voice_config
from app.database import engine
from app.services.voice.native_agent import NativeVoiceAgent
from app.services.voice.protocol import VoiceError
from app.services.voice.session import SAFE_MESSAGES, VoiceSession

router = APIRouter(prefix="/voice", tags=["voice"])


@router.websocket("/session")
async def voice_session(websocket: WebSocket):
    try:
        config = load_voice_config()
    except ValueError:
        # Disabled/misconfigured never constructs a supplier or touches a quota.
        await websocket.close(code=1008, reason="Voice is unavailable")
        return
    agent = NativeVoiceAgent(engine, websocket.headers.get("x-auth-token"),
                             token_max_age_seconds=config.token_max_age_seconds)
    try:
        await agent.authorize(None)
    except VoiceError:
        await websocket.close(code=1008, reason="Authentication required")
        return
    except Exception:
        await websocket.close(code=1011, reason="Voice is unavailable")
        return
    await websocket.accept()
    try:
        from app.services.voice.limits import VoiceUsageLedger
        from app.services.voice.volcengine import VolcengineConfig, VolcengineProvider
        provider = VolcengineProvider(VolcengineConfig(
            api_key=config.api_key, asr_resource_id=config.asr_resource_id,
            tts_resource_id=config.tts_resource_id, speaker=config.speaker,
            pcm_layout_confirmed=config.pcm_layout_confirmed,
            asr_url=config.asr_url, tts_url=config.tts_url, connect_timeout=config.connect_timeout,
        ))
        await VoiceSession(websocket, config=config, provider=provider, agent=agent,
                           usage=VoiceUsageLedger(engine, config)).run()
    except Exception:
        with suppress(Exception):
            await websocket.send_json({"type": "error", "code": "network_unavailable",
                                       "message": SAFE_MESSAGES["network_unavailable"],
                                       "retryable": False, "fatal": True})
            await websocket.close(code=1011)
