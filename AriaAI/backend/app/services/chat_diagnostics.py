from __future__ import annotations

import httpx


async def test_provider_connection(provider: str, model: str | None = None) -> dict:
    from app.core.security import get_api_key, get_bigmodel_api_key, get_kimi_api_key

    if provider not in ["anthropic", "moonshot", "bigmodel"]:
        return {"success": False, "message": f"Provider not supported: {provider}"}

    try:
        if provider == "anthropic":
            api_key = get_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": model or "claude-3-5-haiku-20241022",
                        "max_tokens": 10,
                        "messages": [{"role": "user", "content": "Hi"}],
                    },
                    timeout=30.0,
                )
        elif provider == "moonshot":
            api_key = get_kimi_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.moonshot.cn/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model or "kimi-k2-0711-preview",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )
        else:
            api_key = get_bigmodel_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model or "glm-4-plus",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )

        if resp.status_code == 200:
            return {"success": True, "message": "Connection successful"}
        return {"success": False, "message": f"API error: {resp.status_code}"}
    except Exception as exc:
        return {"success": False, "message": f"Connection failed: {str(exc)}"}


def resolve_provider_for_model(model: str) -> str | None:
    if model.startswith(("moonshot-", "kimi-")):
        return "moonshot"
    if model.startswith("claude-"):
        return "anthropic"
    if model.startswith(("glm-", "GLM-")):
        return "bigmodel"
    return None


async def run_model_test(
    message: str,
    model: str,
    temperature: float = 0.7,
    max_tokens: int = 100,
) -> dict:
    provider = resolve_provider_for_model(model)
    if not provider:
        return {"success": False, "message": f"Model not supported: {model}"}

    try:
        if provider == "anthropic":
            from app.services import claude as llm
        else:
            from app.services import openai_compat as llm

        response = await llm.complete(
            messages=[{"role": "user", "content": message}],
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return {
            "success": True,
            "message": "Model test successful",
            "response": response[:200] + "..." if len(response) > 200 else response,
        }
    except Exception as exc:
        return {"success": False, "message": f"Model test failed: {str(exc)}"}
