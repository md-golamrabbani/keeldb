"""Transaction sandbox — run SQL inside a held-open transaction, inspect the
results, then explicitly COMMIT or ROLLBACK from the UI.

Each sandbox owns a live connection + transaction. Statements executed through
it see their own uncommitted changes; nothing is visible to other sessions
until commit. DDL is allowed but flagged: on MySQL it auto-commits and cannot
be rolled back.

Sandboxes are held in-process. An idle sandbox is rolled back and discarded
after TTL_SECONDS so an abandoned tab can't hold row locks forever.
"""
from __future__ import annotations

import time
import uuid
from typing import Any

import sqlalchemy as sa

from .connectors import connector_for
from .connectors.base import Connector
from .dbops import (
    MAX_ROWS_DEFAULT, _apply_schema, _DML_WRITE, clean_error, first_keyword,
    is_write, jsonable,
)
from .models import SavedConnection
from .sqlimport.parser import split_statements

TTL_SECONDS = 30 * 60


class _Sandbox:
    def __init__(self, connector: Connector, schema: str) -> None:
        self.id = uuid.uuid4().hex
        self.connector = connector
        self.schema = schema
        self.conn = connector.engine.connect()
        self.trans = self.conn.begin()
        _apply_schema(self.conn, connector, schema)
        self.created_at = time.time()
        self.last_used = self.created_at
        self.statements = 0
        self.writes = 0

    def close(self, commit: bool) -> None:
        try:
            if commit:
                self.trans.commit()
            else:
                self.trans.rollback()
        finally:
            try:
                self.conn.close()
            finally:
                self.connector.dispose()


_sandboxes: dict[str, _Sandbox] = {}


def _sweep() -> None:
    now = time.time()
    for sid in [s for s, sb in _sandboxes.items() if now - sb.last_used > TTL_SECONDS]:
        try:
            _sandboxes.pop(sid).close(commit=False)
        except Exception:
            pass


def _get(sandbox_id: str) -> _Sandbox:
    _sweep()
    sb = _sandboxes.get(sandbox_id)
    if not sb:
        raise ValueError("Sandbox not found — it may have expired (idle > 30 min) or already ended.")
    return sb


def begin(record: SavedConnection, schema: str = "") -> dict[str, Any]:
    _sweep()
    sb = _Sandbox(connector_for(record), schema)
    _sandboxes[sb.id] = sb
    return {"ok": True, "sandbox_id": sb.id}


def run(sandbox_id: str, sql: str, max_rows: int = MAX_ROWS_DEFAULT) -> dict[str, Any]:
    sb = _get(sandbox_id)
    sb.last_used = time.time()
    statements = [s for s in split_statements(sql) if s.strip()]
    if not statements:
        return {"ok": False, "error": "No SQL statement to run."}
    if getattr(sb.connector.profile, "read_only", False) and any(is_write(s) for s in statements):
        return {"ok": False, "error": "This connection is read-only. Turn off read-only mode on the connection to run writes."}

    columns: list[str] = []
    rows: list[list[Any]] = []
    rowcount = 0
    is_select = False
    truncated = False
    executed = 0
    ddl_warning = ""
    t0 = time.perf_counter()
    try:
        for stmt in statements:
            kw = first_keyword(stmt)
            if is_write(stmt) and kw not in _DML_WRITE:
                ddl_warning = (
                    f"'{kw.upper()}' is DDL — on MySQL it auto-commits immediately "
                    "and cannot be rolled back by the sandbox."
                )
            result = sb.conn.execute(sa.text(stmt))
            executed += 1
            sb.statements += 1
            if is_write(stmt):
                sb.writes += 1
            if result.returns_rows:
                columns = list(result.keys())
                if max_rows and max_rows > 0:
                    fetched = result.fetchmany(max_rows)
                    truncated = result.fetchone() is not None
                else:
                    fetched = result.fetchall()
                    truncated = False
                rows = [[jsonable(v) for v in row] for row in fetched]
                rowcount = len(rows)
                is_select = True
            else:
                rowcount = result.rowcount if result.rowcount is not None else 0
                is_select = False
                columns, rows, truncated = [], [], False
        out: dict[str, Any] = {
            "ok": True,
            "columns": columns,
            "rows": rows,
            "rowcount": rowcount,
            "is_select": is_select,
            "executed": executed,
            "truncated": truncated,
            "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
            "sandbox": status(sandbox_id),
        }
        if ddl_warning:
            out["warning"] = ddl_warning
        return out
    except Exception as exc:
        # The statement failed but the transaction stays open (drivers vary:
        # on PostgreSQL further statements error until rollback — surface that).
        return {"ok": False, "error": clean_error(exc), "executed": executed, "sandbox": status(sandbox_id)}


def commit(sandbox_id: str) -> dict[str, Any]:
    sb = _get(sandbox_id)
    n = sb.writes
    _sandboxes.pop(sb.id, None)
    sb.close(commit=True)
    return {"ok": True, "committed": True, "writes": n}


def rollback(sandbox_id: str) -> dict[str, Any]:
    sb = _get(sandbox_id)
    n = sb.writes
    _sandboxes.pop(sb.id, None)
    sb.close(commit=False)
    return {"ok": True, "committed": False, "writes": n}


def status(sandbox_id: str) -> dict[str, Any]:
    sb = _sandboxes.get(sandbox_id)
    if not sb:
        return {"active": False}
    return {
        "active": True,
        "sandbox_id": sb.id,
        "statements": sb.statements,
        "writes": sb.writes,
        "age_s": round(time.time() - sb.created_at),
    }
