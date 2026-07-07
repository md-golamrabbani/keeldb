from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models import Snippet
from ..store import snippet_store

router = APIRouter(prefix="/snippets", tags=["snippets"])


class SnippetIn(BaseModel):
    name: str
    sql: str


@router.get("")
def list_snippets():
    return [s.model_dump() for s in snippet_store.list()]


@router.post("")
def create_snippet(req: SnippetIn):
    if not req.name.strip():
        raise HTTPException(400, "name is required")
    # sql may be empty — a fresh "Untitled" query is created and auto-saved as typed.
    return snippet_store.save(Snippet(name=req.name.strip(), sql=req.sql)).model_dump()


@router.put("/{snippet_id}")
def update_snippet(snippet_id: str, req: SnippetIn):
    existing = snippet_store.get(snippet_id)
    if not existing:
        raise HTTPException(404, "snippet not found")
    existing.name = req.name.strip() or existing.name
    existing.sql = req.sql  # created_at preserved by the store
    return snippet_store.save(existing).model_dump()


@router.delete("/{snippet_id}")
def delete_snippet(snippet_id: str):
    if not snippet_store.delete(snippet_id):
        raise HTTPException(404, "snippet not found")
    return {"deleted": snippet_id}
