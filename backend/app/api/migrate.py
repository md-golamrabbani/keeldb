from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from .. import schemagen
from ..connectors import connector_for
from ..dbops import clean_error
from ..models import MigrateRequest
from ..runner import EXPORT_DIR, run_migration
from ..sinks import EXPORT_EXT, EXPORT_MEDIA
from ..store import connection_store

router = APIRouter(prefix="/migrate", tags=["migrate"])


class GenerateTargetRequest(BaseModel):
    source_conn_id: str
    source_schema: str = ""
    source_table: str
    target_conn_id: str
    target_schema: str = ""
    target_table: str
    execute: bool = False


@router.post("/generate-target")
def generate_target(req: GenerateTargetRequest):
    """Generate (and optionally create) a target table matching the source's
    columns, with types translated to the target dialect."""
    src = connection_store.get(req.source_conn_id)
    tgt = connection_store.get(req.target_conn_id)
    if not src or not tgt:
        raise HTTPException(404, "source or target connection not found")
    sc = connector_for(src)
    tc = connector_for(tgt)
    try:
        return schemagen.create_target_table(
            sc, req.source_schema, req.source_table,
            tc, req.target_schema, req.target_table or req.source_table,
            execute=req.execute,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        raise HTTPException(400, clean_error(exc))
    finally:
        sc.dispose()
        tc.dispose()


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
