from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class SendMessageRequest(BaseModel):
    conversation_id: Optional[int] = None
    content: str
    project_id: Optional[int] = None
    skill_id: Optional[int] = None
    force_skill: bool = False
    knowledge_scope: str = "project"
    rag_doc_ids: List[int] = []
    file_ids: List[int] = []


class ConversationOut(BaseModel):
    id: int
    title: str
    project_id: Optional[int]
    skill_id: Optional[int]
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    metadata_json: str = "{}"
    created_at: datetime

    @property
    def metadata(self) -> dict:
        try:
            import json

            return json.loads(self.metadata_json)
        except Exception:
            return {}


class CreateConversationRequest(BaseModel):
    project_id: Optional[int] = None
    skill_id: Optional[int] = None
    title: Optional[str] = None


class TestConnectionRequest(BaseModel):
    provider: str
    model: Optional[str] = None


class TestModelRequest(BaseModel):
    message: str
    model: str
    temperature: float = 0.7
    max_tokens: int = 100


class ExportConversationRequest(BaseModel):
    format: str
