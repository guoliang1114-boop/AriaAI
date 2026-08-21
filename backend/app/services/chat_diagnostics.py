from __future__ import annotations

import httpx

from app.config import DEEPSEEK_BASE_URL, KIMI_BASE_URL, MIMO_BASE_URL, MIMO_TOKEN_PLAN_BASE_URL


async def test_provider_connection(provider: str, model: str | None = None) -> dict:
    from app.core.security import get_api_key, get_bigmodel_api_key, get_deepseek_api_key, get_kimi_api_key, get_mimo_api_key

    if provider not in ["anthropic", "moonshot", "deepseek", "bigmodel", "mimo", "xiaomi"]:
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
                        "model": model if model and model.startswith("claude-") else "claude-3-5-haiku-20241022",
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
                    f"{KIMI_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model if model and model.startswith(("moonshot-", "kimi-")) else "kimi-k3",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 10,
                        "temperature": 1.0,
                        "top_p": 0.95,
                    },
                    timeout=30.0,
                )
        elif provider == "deepseek":
            api_key = get_deepseek_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{DEEPSEEK_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model if model and model.startswith("deepseek-") else "deepseek-v4-pro",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )
        elif provider == "bigmodel":
            api_key = get_bigmodel_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model if model and model.startswith(("glm-", "GLM-")) else "glm-5.3",
                        "messages": [{"role": "user", "content": "Hi"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )
        else:
            api_key = get_mimo_api_key()
            if not api_key:
                return {"success": False, "message": "No API key configured"}
            base_url = MIMO_TOKEN_PLAN_BASE_URL if api_key.strip().lower().startswith("tp-") else MIMO_BASE_URL
            resolved_model = model or "mimo-v2.5-flash"
            if resolved_model.startswith("xiaomi/"):
                resolved_model = resolved_model.split("/", 1)[1]
            legacy_aliases = {
                "mimo-v2-flash": "mimo-v2.5-flash",
                "mimo-v2-pro": "mimo-v2.5-pro",
                "mimo-v2-omni": "mimo-v2.5-omni",
            }
            resolved_model = legacy_aliases.get(resolved_model.lower(), resolved_model)
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": resolved_model if resolved_model.startswith("mimo-") else "mimo-v2.5-flash",
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
    if model.startswith("deepseek-"):
        return "deepseek"
    if model.startswith(("glm-", "GLM-")):
        return "bigmodel"
    if model.startswith(("mimo-", "xiaomi/mimo-")):
        return "mimo"
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
