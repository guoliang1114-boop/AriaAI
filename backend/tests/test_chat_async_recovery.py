from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.routers.chat_async import send_message_async
from app.routers.chat_schemas import SendMessageRequest


def test_async_recovery_is_rejected_before_runtime_or_durable_writes(monkeypatch) -> None:
    prepare = AsyncMock()
    create_background = Mock()
    monkeypatch.setattr(
        "app.routers.chat_async.require_chat_request_access",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr("app.routers.chat_async.prepare_chat_runtime_async", prepare)
    monkeypatch.setattr("app.routers.chat_async._create_background_chat_run", create_background)
    request = SendMessageRequest(
        conversation_id=7,
        content="continue",
        turn_recovery={
            "schema_version": 2,
            "source_run_id": "run_source",
            "source_message_id": 9,
            "contract_sha256": "a" * 64,
        },
    )

    with pytest.raises(HTTPException) as captured:
        asyncio.run(
            send_message_async(
                request,
                session=SimpleNamespace(),
                current_user=SimpleNamespace(id=3),
            )
        )

    assert captured.value.status_code == 409
    assert captured.value.detail == "Turn recovery requires the interactive /chat/send endpoint"
    prepare.assert_not_awaited()
    create_background.assert_not_called()
