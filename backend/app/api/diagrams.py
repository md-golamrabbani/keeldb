"""ER-diagram designer: saved diagrams (DBML + layout) and the AI assistant."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import ai
from ..models import Diagram
from ..store import diagram_store

router = APIRouter(prefix="/diagrams", tags=["diagrams"])


class DiagramIn(BaseModel):
    id: str = ""
    name: str
    dbml: str = ""
    positions: dict[str, dict[str, float]] = {}


class AiDiagramReq(BaseModel):
    dbml: str = ""
    instruction: str


@router.get("")
def list_diagrams():
    # index view: skip the (possibly large) dbml body
    return [{"id": d.id, "name": d.name, "updated_at": d.updated_at} for d in diagram_store.list()]


@router.get("/{diagram_id}")
def get_diagram(diagram_id: str):
    d = diagram_store.get(diagram_id)
    if not d:
        raise HTTPException(404, "diagram not found")
    return d.model_dump()


@router.post("")
def save_diagram(req: DiagramIn):
    if not req.name.strip():
        raise HTTPException(422, "diagram name required")
    d = diagram_store.save(Diagram(id=req.id, name=req.name.strip(), dbml=req.dbml, positions=req.positions))
    return d.model_dump()


@router.delete("/{diagram_id}")
def delete_diagram(diagram_id: str):
    if not diagram_store.delete(diagram_id):
        raise HTTPException(404, "diagram not found")
    return {"ok": True}


@router.post("/ai")
def ai_edit(req: AiDiagramReq):
    """Apply a natural-language instruction to the DBML via the configured AI
    provider (same settings as the SQL editor's Ask-AI)."""
    try:
        return ai.edit_dbml(req.dbml, req.instruction)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
