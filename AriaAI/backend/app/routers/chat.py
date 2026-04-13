"""Chat router — SSE chat entrypoints and diagnostics."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.database import get_session
from app.routers.chat_conversations import router as conversations_router
from app.routers.chat_export import router as export_router
from app.routers.chat_schemas import SendMessageRequest, TestConnectionRequest, TestModelRequest
from app.services.chat_streaming import prepare_chat_runtime, stream_chat_events

router = APIRouter(prefix="/chat", tags=["chat"])
router.include_router(conversations_router)
router.include_router(export_router)


@router.post("/send")
async def send_message(req: SendMessageRequest, session: Session = Depends(get_session)):
    """Stream Claude response via SSE. Creates conversation if needed."""
    runtime = prepare_chat_runtime(session, req)
    return StreamingResponse(
        stream_chat_events(runtime, req, session.get_bind()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ---------------------------------------------------------------------------
# Test Connection Endpoints
# ---------------------------------------------------------------------------


@router.post("/test-connection")
async def test_connection(req: TestConnectionRequest):
    """Test API key connectivity for a provider."""
    from app.core.security import get_api_key, get_kimi_api_key, get_bigmodel_api_key
    
    provider = req.provider
    
    # Support anthropic, moonshot, and bigmodel
    if provider not in ["anthropic", "moonshot", "bigmodel"]:
        return {"success": False, "message": f"Provider not supported: {provider}"}
    
    try:
        if provider == "anthropic":
            api_key = get_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            # Test with a simple request
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": req.model or "claude-3-5-haiku-20241022",
                        "max_tokens": 10,
                        "messages": [{"role": "user", "content": "Hi"}],
                    },
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    return {"success": True, "message": "Connection successful"}
                else:
                    return {"success": False, "message": f"API error: {resp.status_code}"}
                    
        elif provider == "moonshot":
            api_key = get_kimi_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.moonshot.cn/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": req.model or "kimi-k2-0711-preview",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    return {"success": True, "message": "Connection successful"}
                else:
                    return {"success": False, "message": f"API error: {resp.status_code}"}
                    
        elif provider == "bigmodel":
            api_key = get_bigmodel_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": req.model or "glm-4-plus",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    return {"success": True, "message": "Connection successful"}
                else:
                    return {"success": False, "message": f"API error: {resp.status_code}"}
        else:
            return {"success": False, "message": f"Unknown provider: {provider}"}
            
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


@router.post("/test-model")
async def test_model(req: TestModelRequest):
    """Test a model with a simple message."""
    try:
        # Determine provider from model
        provider = "anthropic"
        if req.model.startswith("moonshot-") or req.model.startswith("kimi-"):
            provider = "moonshot"
        elif req.model.startswith("claude-"):
            provider = "anthropic"
        elif req.model.startswith("glm-") or req.model.startswith("GLM-"):
            provider = "bigmodel"
        else:
            return {"success": False, "message": f"Model not supported: {req.model}"}
        
        # Support anthropic, moonshot, and bigmodel
        if provider not in ["anthropic", "moonshot", "bigmodel"]:
            return {"success": False, "message": f"Provider not supported: {provider}"}
        
        # Get the appropriate LLM client
        if provider == "anthropic":
            from app.services import claude as llm
        elif provider == "moonshot":
            from app.services import openai_compat as llm
        elif provider == "bigmodel":
            from app.services import openai_compat as llm
        else:
            return {"success": False, "message": f"Unsupported provider: {provider}"}
        
        # Moonshot models have fixed parameters - let the service handle it
        # The openai_compat.complete() will override temperature for Moonshot models
        messages = [{"role": "user", "content": req.message}]
        response = await llm.complete(
            messages=messages,
            model=req.model,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
        
        return {
            "success": True,
            "message": "Model test successful",
            "response": response[:200] + "..." if len(response) > 200 else response,
        }
    except Exception as e:
        return {"success": False, "message": f"Model test failed: {str(e)}"}



