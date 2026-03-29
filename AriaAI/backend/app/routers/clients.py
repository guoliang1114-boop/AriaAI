"""Client management router — CRUD for ClientRecord and document linking."""
from typing import Optional
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel

from app.database import get_session
from app.models.db import ClientRecord, KnowledgeDocument, Project
from app.services.claude import complete
from app.services.cache import clients_cache

_CLIENTS_KEY = "all"
_CLIENTS_TTL = 120.0

router = APIRouter(prefix="/clients", tags=["clients"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ClientCreate(BaseModel):
    name: str
    industry: str = ""
    contact: str = ""
    notes: str = ""


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


class AISuggestQuery(BaseModel):
    query: str   # company name or description entered by the user


class AISuggestion(BaseModel):
    name: str
    industry: str
    contact: str
    notes: str


class ClientOut(BaseModel):
    id: int
    name: str
    industry: str
    contact: str
    notes: str
    created_at: str
    document_count: int
    project_names: list[str]

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_client_out(
    client: ClientRecord,
    docs_by_client: dict[int, list],
    projects_by_client_name: dict[str, list[str]],
) -> ClientOut:
    docs = docs_by_client.get(client.id, [])
    matching = projects_by_client_name.get(client.name.strip().lower(), [])
    return ClientOut(
        id=client.id,
        name=client.name,
        industry=client.industry,
        contact=client.contact,
        notes=client.notes,
        created_at=client.created_at.isoformat(),
        document_count=len(docs),
        project_names=matching,
    )


def _client_out(client: ClientRecord, session: Session) -> ClientOut:
    """Single-client helper used by create/update/get endpoints (not list)."""
    docs = session.exec(
        select(KnowledgeDocument).where(KnowledgeDocument.client_id == client.id)
    ).all()
    all_projects = session.exec(select(Project)).all()
    matching = [p.name for p in all_projects if p.client.strip().lower() == client.name.strip().lower()]
    return ClientOut(
        id=client.id,
        name=client.name,
        industry=client.industry,
        contact=client.contact,
        notes=client.notes,
        created_at=client.created_at.isoformat(),
        document_count=len(docs),
        project_names=matching,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ClientOut])
def list_clients(session: Session = Depends(get_session)):
    cached = clients_cache.get(_CLIENTS_KEY)
    if cached is not None:
        return cached
    clients = session.exec(select(ClientRecord).order_by(ClientRecord.name)).all()
    # Batch-load all docs and projects — 3 queries total regardless of client count
    all_docs = session.exec(select(KnowledgeDocument)).all()
    all_projects = session.exec(select(Project)).all()
    docs_by_client: dict[int, list] = {}
    for d in all_docs:
        if d.client_id is not None:
            docs_by_client.setdefault(d.client_id, []).append(d)
    projects_by_name: dict[str, list[str]] = {}
    for p in all_projects:
        key = p.client.strip().lower()
        projects_by_name.setdefault(key, []).append(p.name)
    result = [_build_client_out(c, docs_by_client, projects_by_name) for c in clients]
    clients_cache.set(_CLIENTS_KEY, result, _CLIENTS_TTL)
    return result


@router.post("", response_model=ClientOut)
def create_client(body: ClientCreate, session: Session = Depends(get_session)):
    client = ClientRecord(**body.model_dump())
    session.add(client)
    session.commit()
    session.refresh(client)
    clients_cache.delete(_CLIENTS_KEY)
    return _client_out(client, session)


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return _client_out(client, session)


@router.put("/{client_id}", response_model=ClientOut)
def update_client(client_id: int, body: ClientUpdate, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(client, field, value)
    session.add(client)
    session.commit()
    session.refresh(client)
    clients_cache.delete(_CLIENTS_KEY)
    return _client_out(client, session)


@router.delete("/{client_id}", status_code=204)
def delete_client(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    # Unlink documents before deletion
    docs = session.exec(
        select(KnowledgeDocument).where(KnowledgeDocument.client_id == client_id)
    ).all()
    for doc in docs:
        doc.client_id = None
        session.add(doc)
    session.delete(client)
    session.commit()
    clients_cache.delete(_CLIENTS_KEY)


@router.get("/{client_id}/documents")
def list_client_documents(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    docs = session.exec(
        select(KnowledgeDocument).where(KnowledgeDocument.client_id == client_id)
    ).all()
    return docs


@router.post("/{client_id}/documents/{doc_id}", status_code=200)
def link_document(client_id: int, doc_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    doc = session.get(KnowledgeDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.client_id = client_id
    session.add(doc)
    session.commit()
    return {"ok": True}


@router.delete("/{client_id}/documents/{doc_id}", status_code=200)
def unlink_document(client_id: int, doc_id: int, session: Session = Depends(get_session)):
    doc = session.get(KnowledgeDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.client_id = None
    session.add(doc)
    session.commit()
    return {"ok": True}


# ── AI Suggest ────────────────────────────────────────────────────────────────

@router.post("/ai-suggest", response_model=list[AISuggestion])
async def ai_suggest(body: AISuggestQuery):
    """Ask Claude to infer 1-3 possible client profiles from a name or description."""
    system = (
        "You are an expert business analyst assistant for a consulting firm. "
        "When given a company name or description, return structured client profile suggestions."
    )
    prompt = f"""The user typed: "{body.query}"

Based on this, generate 1 to 3 plausible client profile suggestions for a consulting firm CRM.
If the query is unambiguous (e.g. a well-known company), return 1 suggestion.
If the query could match multiple entities, return up to 3 distinct suggestions.

Return ONLY a valid JSON array (no markdown, no extra text) with this exact schema:
[
  {{
    "name": "Full official company name",
    "industry": "Industry / sector (concise, e.g. Technology, Financial Services, Healthcare)",
    "contact": "",
    "notes": "1-2 sentence background: what the company does, scale, headquarters, notable facts relevant to consulting engagements"
  }}
]

Rules:
- name: official or most commonly used company name
- industry: short and precise
- contact: always empty string (user will fill manually)
- notes: factual, professional, max 2 sentences
- Return pure JSON array only"""

    try:
        raw = await complete(
            messages=[{"role": "user", "content": prompt}],
            system=system,
            max_tokens=800,
        )
        # Strip markdown code fences if present
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        suggestions = json.loads(text)
        return [AISuggestion(**s) for s in suggestions[:3]]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {e}")
