from __future__ import annotations

from typing import Any, Optional

import csv
import io
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from .. import (
    activity, admin, advisor, ai, alerts, backup, bloat, dbops, duplicates, explain,
    health, importer, metrics, profiler, relational, sandbox, snapshots, verify,
)
from ..connectors import connector_for
from ..models import HistoryEntry
from ..store import alert_store, connection_store, history_store

router = APIRouter(prefix="/db", tags=["explorer"])


class OrphanRequest(BaseModel):
    schema_name: str = ""
    table: str = ""  # empty = scan whole schema


class DuplicatesRequest(BaseModel):
    schema_name: str = ""
    table: str
    columns: list[str]
    limit: int = 100


class KillRequest(BaseModel):
    session_id: str


class AiSqlRequest(BaseModel):
    schema_name: str = ""
    question: str


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
    timeout_s: int = 0        # 0 = no statement timeout
    auto_snapshot: bool = False  # snapshot affected tables before destructive SQL


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
        snap = None
        if req.auto_snapshot and not getattr(c.profile, "read_only", False):
            try:
                snap = snapshots.snapshot_for_sql(c, conn_id, req.schema_name, req.sql)
            except Exception:
                snap = None  # snapshotting must never block the query itself
        result = dbops.run_sql(c, req.sql, req.max_rows, req.schema_name, req.timeout_s)
        if snap:
            result["snapshot"] = snap
        _record_history(conn_id, req.sql, result)
        return result
    finally:
        c.dispose()


# -- transaction sandbox -----------------------------------------------------
class SandboxRunRequest(BaseModel):
    sql: str
    max_rows: int = dbops.MAX_ROWS_DEFAULT


@router.post("/{conn_id}/sandbox/begin")
def sandbox_begin(conn_id: str, req: OrphanRequest):
    record = connection_store.get(conn_id)
    if not record:
        raise HTTPException(404, "connection not found")
    try:
        return sandbox.begin(record, req.schema_name)
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))


@router.post("/{conn_id}/sandbox/{sandbox_id}/run")
def sandbox_run(conn_id: str, sandbox_id: str, req: SandboxRunRequest):
    try:
        result = sandbox.run(sandbox_id, req.sql, req.max_rows)
        _record_history(conn_id, req.sql, result)
        return result
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@router.post("/{conn_id}/sandbox/{sandbox_id}/commit")
def sandbox_commit(conn_id: str, sandbox_id: str):
    try:
        return sandbox.commit(sandbox_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))


@router.post("/{conn_id}/sandbox/{sandbox_id}/rollback")
def sandbox_rollback(conn_id: str, sandbox_id: str):
    try:
        return sandbox.rollback(sandbox_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))


# -- snapshots (undo) ---------------------------------------------------------
@router.get("/{conn_id}/snapshots")
def list_snapshots(conn_id: str):
    return snapshots.list_snapshots(conn_id)


@router.post("/{conn_id}/snapshots/{snap_id}/restore")
def restore_snapshot(conn_id: str, snap_id: str):
    c = _connector(conn_id)
    try:
        return snapshots.restore(c, snap_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.delete("/{conn_id}/snapshots/{snap_id}")
def delete_snapshot(conn_id: str, snap_id: str):
    if not snapshots.delete(snap_id):
        raise HTTPException(404, "snapshot not found")
    return {"ok": True}


# -- bloat / vacuum advisor ----------------------------------------------------
@router.post("/{conn_id}/bloat")
def bloat_report(conn_id: str, req: OrphanRequest):
    """Dead tuples / reclaimable space + VACUUM / OPTIMIZE advice."""
    c = _connector(conn_id)
    try:
        return bloat.report(c, req.schema_name)
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.get("/{conn_id}/history/export")
def export_history(conn_id: str):
    """Audit log: the connection's query history as a CSV download."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ran_at", "conn_id", "ok", "rowcount", "elapsed_ms", "sql"])
    for h in history_store.list(conn_id, limit=history_store.MAX):
        w.writerow([h.ran_at, h.conn_id, h.ok, h.rowcount, h.elapsed_ms, h.sql])
    return PlainTextResponse(
        buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="query-audit-log.csv"'},
    )


def _record_history(conn_id: str, sql: str, result: dict) -> None:
    try:
        history_store.record(HistoryEntry(
            conn_id=conn_id, sql=sql, ok=bool(result.get("ok")),
            rowcount=result.get("rowcount"), elapsed_ms=result.get("elapsed_ms"),
        ))
    except Exception:
        pass  # history is best-effort; never fail a query over it


@router.get("/{conn_id}/history")
def query_history(conn_id: str, limit: int = 100):
    return [h.model_dump() for h in history_store.list(conn_id, limit)]


@router.delete("/{conn_id}/history")
def clear_history(conn_id: str):
    return {"cleared": history_store.clear(conn_id)}


@router.post("/{conn_id}/health")
def health_report(conn_id: str, req: OrphanRequest):
    """Storage & size overview: database totals + top tables by size/rows."""
    c = _connector(conn_id)
    try:
        return health.report(c, req.schema_name)
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.get("/{conn_id}/metrics")
def server_metrics(conn_id: str):
    """Live server KPI tiles (PostgreSQL / MySQL)."""
    c = _connector(conn_id)
    try:
        return metrics.server_metrics(c)
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/alerts/check")
def check_alerts(conn_id: str, req: OrphanRequest):
    """Evaluate every saved alert rule against this connection."""
    c = _connector(conn_id)
    try:
        return alerts.evaluate_all(c, alert_store.list(), req.schema_name)
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.get("/{conn_id}/activity")
def list_activity(conn_id: str):
    """Live server sessions / running queries (PostgreSQL / MySQL)."""
    c = _connector(conn_id)
    try:
        return activity.list_activity(c)
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/kill")
def kill_session(conn_id: str, req: KillRequest):
    """Terminate a server session by id (PostgreSQL / MySQL)."""
    c = _connector(conn_id)
    try:
        return activity.kill_session(c, req.session_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


class AiExplainErrorRequest(BaseModel):
    schema_name: str = ""
    sql: str
    error: str


@router.post("/{conn_id}/ai/explain-error")
def ai_explain_error(conn_id: str, req: AiExplainErrorRequest):
    """Explain a failed query in plain language (uses the shared AI settings)."""
    c = _connector(conn_id)
    try:
        return ai.explain_error(c, req.schema_name, req.sql, req.error)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/ai/sql")
def ai_sql(conn_id: str, req: AiSqlRequest):
    """Natural-language → SQL (returns SQL for review; never executes)."""
    c = _connector(conn_id)
    try:
        return ai.nl_to_sql(c, req.schema_name, req.question)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/backup")
def backup_table(conn_id: str, req: OrphanRequest):
    """Dump a table's schema + data as a .sql script."""
    c = _connector(conn_id)
    try:
        if not req.table:
            raise HTTPException(400, "table is required")
        return backup.backup_table(c, req.schema_name, req.table)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/backup-database")
def backup_database(conn_id: str, req: OrphanRequest):
    """Dump every table in the schema (schema + data) as one .sql script."""
    c = _connector(conn_id)
    try:
        return backup.backup_database(c, req.schema_name)
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


class BulkTablesReq(BaseModel):
    schema_name: str = ""
    tables: list[str]
    action: str  # "drop" | "empty"


class ExportReq(BaseModel):
    schema_name: str = ""
    tables: Optional[list[str]] = None  # None = whole database
    include_ddl: bool = True
    include_data: bool = True


class ImportReq(BaseModel):
    schema_name: str = ""
    sql: str
    stop_on_error: bool = False


@router.post("/{conn_id}/tables/bulk")
def tables_bulk(conn_id: str, req: BulkTablesReq):
    """Drop or empty several tables at once (FK checks relaxed for the batch)."""
    c = _connector(conn_id)
    try:
        return admin.bulk_table_op(c, req.schema_name, req.tables, req.action)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
    finally:
        c.dispose()


@router.post("/{conn_id}/export/stream")
def export_stream(conn_id: str, req: ExportReq):
    """Stream a .sql export table-by-table (NDJSON) so the UI shows progress."""
    c = _connector(conn_id)

    def gen():
        try:
            for ev in backup.export_iter(c, req.schema_name, req.tables,
                                         req.include_ddl, req.include_data):
                yield json.dumps(ev, default=str) + "\n"
        except Exception as exc:  # noqa: BLE001 — surface as a stream event
            yield json.dumps({"type": "fatal", "message": dbops.clean_error(exc)}) + "\n"
        finally:
            c.dispose()

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.post("/{conn_id}/import/stream")
def import_stream(conn_id: str, req: ImportReq):
    """Run an in-memory .sql string, streaming per-statement progress."""
    c = _connector(conn_id)

    def gen():
        try:
            for ev in importer.import_stream(c, req.schema_name, req.sql, req.stop_on_error):
                yield json.dumps(ev, default=str) + "\n"
        except Exception as exc:  # noqa: BLE001 — surface as a stream event
            yield json.dumps({"type": "fatal", "message": dbops.clean_error(exc)}) + "\n"
        finally:
            c.dispose()

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.post("/{conn_id}/import/upload")
def import_upload(conn_id: str, file: UploadFile = File(...),
                  schema_name: str = Form(""), stop_on_error: bool = Form(False)):
    """Run an uploaded .sql file, processed incrementally so multi-GB dumps work.
    The upload spools to a temp file (not RAM); we read it in chunks and stream
    per-chunk byte progress."""
    c = _connector(conn_id)
    fh = file.file  # SpooledTemporaryFile — on disk for large uploads
    fh.seek(0, 2)
    total = fh.tell()
    fh.seek(0)

    def gen():
        try:
            for ev in importer.import_file_stream(c, schema_name, fh, total, stop_on_error):
                yield json.dumps(ev, default=str) + "\n"
        except Exception as exc:  # noqa: BLE001 — surface as a stream event
            yield json.dumps({"type": "fatal", "message": dbops.clean_error(exc)}) + "\n"
        finally:
            c.dispose()

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.post("/{conn_id}/index-advice")
def index_advice(conn_id: str, req: OrphanRequest):
    """Index hygiene: duplicate/redundant/unused indexes + missing primary keys."""
    c = _connector(conn_id)
    try:
        return advisor.index_advice(c, req.schema_name)
    except Exception as exc:
        raise HTTPException(502, dbops.clean_error(exc))
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


@router.post("/{conn_id}/explain")
def explain_query(conn_id: str, req: QueryRequest):
    """Run EXPLAIN and translate the plan into performance hints."""
    c = _connector(conn_id)
    try:
        return explain.analyze_query(c, req.sql, req.schema_name)
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
