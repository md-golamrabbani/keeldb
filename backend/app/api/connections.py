from __future__ import annotations

import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..connectors import connector_for
from ..models import ConnectionProfileIn, ConnectionProfileOut, SavedConnection, TestResult
from ..sqlimport import load_sql_dump
from ..store import connection_store
from ..store.store import DATA_DIR

router = APIRouter(prefix="/connections", tags=["connections"])


@router.get("", response_model=list[ConnectionProfileOut])
def list_connections():
    return [c.public() for c in connection_store.list()]


@router.post("", response_model=ConnectionProfileOut)
def create_connection(profile: ConnectionProfileIn):
    return connection_store.create(profile).public()


@router.put("/{conn_id}", response_model=ConnectionProfileOut)
def update_connection(conn_id: str, profile: ConnectionProfileIn):
    record = connection_store.update(conn_id, profile)
    if not record:
        raise HTTPException(404, "connection not found")
    return record.public()


@router.delete("/{conn_id}")
def delete_connection(conn_id: str):
    if not connection_store.delete(conn_id):
        raise HTTPException(404, "connection not found")
    return {"ok": True}


@router.post("/upload-sql", response_model=ConnectionProfileOut)
async def upload_sql(file: UploadFile = File(...), name: str = Form("")):
    """Import a .sql dump (mysqldump / pg_dump) as a read-only source. The dump
    is parsed into a local SQLite database that behaves like any connection."""
    raw = await file.read()
    if len(raw) > 200 * 1024 * 1024:
        raise HTTPException(413, "SQL file too large (limit 200 MB)")
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(400, f"could not read file: {exc}")

    conn_id = str(uuid.uuid4())
    sqlite_path = str(DATA_DIR / "sqlfiles" / f"{conn_id}.db")
    try:
        result = load_sql_dump(text, sqlite_path)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    record = SavedConnection(
        id=conn_id,
        name=name or (file.filename or "imported.sql"),
        flavor="sqlfile",
        database="main",
        sqlite_path=sqlite_path,
        source_filename=file.filename or "",
        table_count=result.table_count,
    )
    connection_store.add(record)
    return record.public()


@router.post("/{conn_id}/test", response_model=TestResult)
def test_connection(conn_id: str):
    record = connection_store.get(conn_id)
    if not record:
        raise HTTPException(404, "connection not found")
    connector = connector_for(record)
    try:
        return connector.test_connection()
    finally:
        connector.dispose()


@router.post("/test", response_model=TestResult)
def test_unsaved_connection(profile: ConnectionProfileIn):
    """Test a connection before saving it (the form's Test button)."""
    from ..models import SavedConnection

    record = SavedConnection(id="unsaved", **profile.model_dump())
    connector = connector_for(record)
    try:
        return connector.test_connection()
    finally:
        connector.dispose()
