from __future__ import annotations

from fastapi import APIRouter

from app.routers.chat_schemas import TestConnectionRequest, TestModelRequest
from app.services.chat_diagnostics import run_model_test, test_provider_connection

router = APIRouter()


@router.post("/test-connection")
async def test_connection(req: TestConnectionRequest):
    """Test API key connectivity for a provider."""
    return await test_provider_connection(req.provider, req.model)


@router.post("/test-model")
async def test_model(req: TestModelRequest):
    """Test a model with a simple message."""
    return await run_model_test(
        message=req.message,
        model=req.model,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    )
