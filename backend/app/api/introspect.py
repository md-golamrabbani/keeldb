from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..connectors import connector_for
from ..models import ColumnInfo, TableInfo
from ..store import connection_store

router = APIRouter(prefix="/introspect", tags=["introspect"])


def _connector(conn_id: str):
    record = connection_store.get(conn_id)
    if not record:
        raise HTTPException(404, "connection not found")
    return connector_for(record)


@router.get("/{conn_id}/schemas", response_model=list[str])
def list_schemas(conn_id: str):
    c = _connector(conn_id)
    try:
        return c.list_schemas()
    except Exception as exc:
        raise HTTPException(502, f"introspection failed: {exc}")
    finally:
        c.dispose()


@router.get("/{conn_id}/tables", response_model=list[TableInfo])
def list_tables(conn_id: str, schema: str = ""):
    c = _connector(conn_id)
    try:
        return c.list_tables(schema)
    except Exception as exc:
        raise HTTPException(502, f"introspection failed: {exc}")
    finally:
        c.dispose()


@router.get("/{conn_id}/columns", response_model=list[ColumnInfo])
def list_columns(conn_id: str, table: str, schema: str = ""):
    c = _connector(conn_id)
    try:
        return c.list_columns(schema, table)
    except Exception as exc:
        raise HTTPException(502, f"introspection failed: {exc}")
    finally:
        c.dispose()


@router.get("/{conn_id}/count", response_model=int)
def count_rows(conn_id: str, table: str, schema: str = "", where: str = ""):
    c = _connector(conn_id)
    try:
        return c.count_rows(schema, table, where)
    except Exception as exc:
        raise HTTPException(502, f"count failed: {exc}")
    finally:
        c.dispose()
