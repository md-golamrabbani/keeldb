from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import portable

router = APIRouter(prefix="/portable", tags=["portable"])


class ImportRequest(BaseModel):
    bundle: dict[str, Any]


@router.get("/export")
def export_bundle():
    return portable.export_bundle()


@router.post("/import")
def import_bundle(req: ImportRequest):
    try:
        return portable.import_bundle(req.bundle)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
