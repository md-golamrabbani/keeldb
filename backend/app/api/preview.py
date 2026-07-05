from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..connectors import connector_for
from ..models import PreviewRequest, TransformPreviewRequest
from ..runner import transform_row
from ..store import connection_store
from ..transform.expr import validate_expr

router = APIRouter(prefix="/preview", tags=["preview"])


def _connector(conn_id: str):
    record = connection_store.get(conn_id)
    if not record:
        raise HTTPException(404, "connection not found")
    return connector_for(record)


def _jsonable(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: (v if v is None or isinstance(v, (int, float, bool)) else str(v)) for k, v in r.items()} for r in rows]


@router.post("/rows")
def preview_rows(req: PreviewRequest):
    c = _connector(req.conn_id)
    try:
        return _jsonable(c.sample_rows(req.schema_name, req.table, req.limit))
    except Exception as exc:
        raise HTTPException(502, f"preview failed: {exc}")
    finally:
        c.dispose()


@router.post("/transformed")
def preview_transformed(req: TransformPreviewRequest):
    """First N source rows exactly as they would be written (post cast/transform)."""
    m = req.mapping
    # Validate expressions up-front so the UI can point at the bad column.
    for cm in m.column_maps:
        if cm.enabled and cm.transform_expr:
            err = validate_expr(cm.transform_expr)
            if err:
                raise HTTPException(422, f"transform for '{cm.source_col}': {err}")
    c = _connector(m.source_conn_id)
    try:
        rows = c.sample_rows(m.source_schema, m.source_table, req.limit)
    except Exception as exc:
        raise HTTPException(502, f"preview failed: {exc}")
    finally:
        c.dispose()
    enabled = [cm for cm in m.column_maps if cm.enabled and cm.target_col]
    out = []
    for i, row in enumerate(rows, start=1):
        transformed, errors = transform_row(row, enabled)
        out.append(
            {
                "row_index": i,
                "data": _jsonable([transformed])[0],
                "errors": [{"column": col, "message": msg} for col, msg in errors],
            }
        )
    return out


@router.post("/validate-expr")
def check_expr(body: dict):
    return {"error": validate_expr(body.get("expr", ""))}
