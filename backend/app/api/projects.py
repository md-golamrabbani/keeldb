from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import projects as projects_engine
from ..connectors import connector_for
from ..models import MigrationProject
from ..store import connection_store, mapping_store, project_store

router = APIRouter(prefix="/projects", tags=["projects"])


class RunRequest(BaseModel):
    dry_run: bool = False


@router.get("", response_model=list[MigrationProject])
def list_projects():
    return project_store.list()


@router.get("/{project_id}", response_model=MigrationProject)
def get_project(project_id: str):
    p = project_store.get(project_id)
    if not p:
        raise HTTPException(404, "project not found")
    return p


@router.post("", response_model=MigrationProject)
def save_project(project: MigrationProject):
    return project_store.save(project)


@router.delete("/{project_id}")
def delete_project(project_id: str):
    if not project_store.delete(project_id):
        raise HTTPException(404, "project not found")
    return {"ok": True}


@router.get("/{project_id}/order")
def preview_order(project_id: str):
    """Return the FK-resolved run order (parents before children)."""
    p = project_store.get(project_id)
    if not p:
        raise HTTPException(404, "project not found")
    mappings = [m for m in (mapping_store.get(mid) for mid in p.mapping_ids) if m]
    if not mappings:
        return {"order": []}
    tgt = connection_store.get(mappings[0].target_conn_id)
    if not p.auto_order or not tgt:
        return {"order": [m.target_table for m in mappings]}
    tc = connector_for(tgt)
    try:
        ordered = projects_engine.order_mappings_by_fk(mappings, tc, mappings[0].target_schema)
    finally:
        tc.dispose()
    return {"order": [m.target_table for m in ordered]}


@router.post("/{project_id}/run")
def run_project(project_id: str, req: RunRequest):
    """Run all of a project's mappings in FK order, streaming NDJSON events."""
    p = project_store.get(project_id)
    if not p:
        raise HTTPException(404, "project not found")

    def stream():
        for event in projects_engine.run_project(p, dry_run=req.dry_run):
            yield json.dumps(event, default=str) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
