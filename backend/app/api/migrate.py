from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from ..models import MigrateRequest
from ..runner import EXPORT_DIR, run_migration
from ..sinks import EXPORT_EXT, EXPORT_MEDIA
from ..store import connection_store

router = APIRouter(prefix="/migrate", tags=["migrate"])


@router.post("/run")
def migrate(req: MigrateRequest):
    """Run (or dry-run) a migration, streaming NDJSON progress events.

    output_mode='push' writes to the target DB; 'sql'/'csv'/'json' write a
    downloadable file and the final 'done' event carries an export_id.
    """
    source = connection_store.get(req.mapping.source_conn_id)
    if not source:
        raise HTTPException(404, "source connection not found")
    target = connection_store.get(req.mapping.target_conn_id) if req.mapping.target_conn_id else None
    if req.mapping.output_mode == "push" and not target:
        raise HTTPException(404, "target connection not found")
    if not any(m.enabled and m.target_col for m in req.mapping.column_maps):
        raise HTTPException(422, "no enabled column mappings")

    def stream():
        for event in run_migration(req.mapping, source, target, dry_run=req.dry_run):
            yield json.dumps(event, default=str) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@router.get("/export/{export_id}")
def download_export(export_id: str, mode: str):
    """Download a generated export file (sql / csv / json)."""
    if mode not in EXPORT_EXT:
        raise HTTPException(400, "invalid export mode")
    if not export_id.replace("-", "").isalnum():
        raise HTTPException(400, "invalid export id")
    path = EXPORT_DIR / f"{export_id}.{EXPORT_EXT[mode]}"
    if not path.exists():
        raise HTTPException(404, "export not found (it may have expired)")
    return FileResponse(
        path,
        media_type=EXPORT_MEDIA[mode],
        filename=f"migration_export.{EXPORT_EXT[mode]}",
    )
