from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .. import dbops, duplicates, profiler, relational, verify
from ..connectors import connector_for
from ..store import connection_store

router = APIRouter(prefix="/db", tags=["explorer"])


class OrphanRequest(BaseModel):
    schema_name: str = ""
    table: str = ""  # empty = scan whole schema


class DuplicatesRequest(BaseModel):
    schema_name: str = ""
    table: str
    columns: list[str]
    limit: int = 100


class DependentsRequest(BaseModel):
    schema_name: str = ""
    table: str
    pk: dict[str, Any]


class ProfileRequest(BaseModel):
    schema_name: str = ""
    table: str
    columns: Optional[list[str]] = None


def _connector(conn_id: str):
    record = connection_store.get(conn_id)
    if not record:
        raise HTTPException(404, "connection not found")
    return connector_for(record)


class QueryRequest(BaseModel):
    sql: str
    max_rows: int = dbops.MAX_ROWS_DEFAULT
    schema_name: str = ""


class TableDataRequest(BaseModel):
    schema_name: str = ""
    table: str
    limit: int = 50
    offset: int = 0
    order_by: str = ""
    order_dir: str = "asc"
    search: str = ""
    filters: list[dict[str, Any]] = []


class RowDeleteBulkRequest(BaseModel):
    schema_name: str = ""
    table: str
    pks: list[dict[str, Any]]


class RowInsertRequest(BaseModel):
    schema_name: str = ""
    table: str
    values: dict[str, Any]


class RowUpdateRequest(BaseModel):
    schema_name: str = ""
    table: str
    pk: dict[str, Any]
    values: dict[str, Any]


class RowDeleteRequest(BaseModel):
    schema_name: str = ""
    table: str
    pk: dict[str, Any]


class ExportRequest(BaseModel):
    schema_name: str = ""
    table: str
    format: str = "csv"
    where: str = ""
    include_ddl: bool = True


@router.post("/{conn_id}/query")
def run_query(conn_id: str, req: QueryRequest):
    c = _connector(conn_id)
    try:
        return dbops.run_sql(c, req.sql, req.max_rows, req.schema_name)
    finally:
        c.dispose()


@router.post("/{conn_id}/orphans")
def orphan_scan(conn_id: str, req: OrphanRequest):
    """Post-migration integrity: find rows whose FK has no matching parent."""
    c = _connector(conn_id)
    try:
        return verify.orphan_scan(c, req.schema_name, req.table or None)
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/duplicates")
def find_duplicates(conn_id: str, req: DuplicatesRequest):
    """Find rows sharing the same value(s) in the chosen column(s)."""
    c = _connector(conn_id)
    try:
        return duplicates.find_duplicates(c, req.schema_name, req.table, req.columns, req.limit)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/dependents")
def dependents(conn_id: str, req: DependentsRequest):
    """Reverse-FK: find every row that references the given row."""
    c = _connector(conn_id)
    try:
        return relational.dependents(c, req.schema_name, req.table, req.pk)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/profile")
def profile_table(conn_id: str, req: ProfileRequest):
    """Per-column data profile: nulls, distinct, min/max, patterns."""
    c = _connector(conn_id)
    try:
        return profiler.profile_table(c, req.schema_name, req.table, req.columns)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/preview-write")
def preview_write(conn_id: str, req: QueryRequest):
    """Guard: estimate affected rows for write statements without committing."""
    c = _connector(conn_id)
    try:
        return dbops.preview_write(c, req.sql, req.schema_name)
    finally:
        c.dispose()


@router.post("/{conn_id}/table-data")
def table_data(conn_id: str, req: TableDataRequest):
    c = _connector(conn_id)
    try:
        return dbops.read_table(
            c, req.schema_name, req.table, req.limit, req.offset,
            req.order_by, req.order_dir, req.search, req.filters,
        )
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/row/insert")
def row_insert(conn_id: str, req: RowInsertRequest):
    c = _connector(conn_id)
    try:
        return dbops.insert_row(c, req.schema_name, req.table, req.values)
    except Exception as exc:
        raise HTTPException(422, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/row/update")
def row_update(conn_id: str, req: RowUpdateRequest):
    c = _connector(conn_id)
    try:
        return dbops.update_row(c, req.schema_name, req.table, req.pk, req.values)
    except Exception as exc:
        raise HTTPException(422, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/row/delete")
def row_delete(conn_id: str, req: RowDeleteRequest):
    c = _connector(conn_id)
    try:
        return dbops.delete_row(c, req.schema_name, req.table, req.pk)
    except Exception as exc:
        raise HTTPException(422, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/row/delete-bulk")
def row_delete_bulk(conn_id: str, req: RowDeleteBulkRequest):
    c = _connector(conn_id)
    try:
        return dbops.delete_rows(c, req.schema_name, req.table, req.pks)
    except Exception as exc:
        raise HTTPException(422, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/export")
def export(conn_id: str, req: ExportRequest):
    c = _connector(conn_id)
    try:
        return dbops.export_table(c, req.schema_name, req.table, req.format, req.where, req.include_ddl)
    except Exception as exc:
        raise HTTPException(422, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/import-csv")
async def import_csv(conn_id: str, file: UploadFile = File(...), schema_name: str = Form(""), table: str = Form(...)):
    c = _connector(conn_id)
    try:
        raw = await file.read()
        text = raw.decode("utf-8", errors="replace")
        return dbops.import_csv(c, schema_name, table, text)
    except ValueError as exc:
        raise HTTPException(422, dbops.clean_error(exc))
    finally:
        c.dispose()
