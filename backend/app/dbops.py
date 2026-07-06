"""Database Explorer operations — a lightweight SQL-client layer over any
Connector: run SQL, browse/filter/sort table data, edit rows (insert/update/
delete by primary key), export a table, and import a CSV.

Everything uses SQLAlchemy Core with reflected Table objects, so identifiers are
dialect-correctly quoted and all row values are passed as bind parameters — no
string interpolation of user data into SQL.
"""
from __future__ import annotations

import csv
import io
import re
import time
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

import sqlalchemy as sa

from .connectors.base import Connector
from .sinks import CSVSink, EXPORT_EXT, JSONSink, SQLFileSink
from .sqlimport.parser import split_statements
from .store.store import DATA_DIR

EXPORT_DIR = DATA_DIR / "exports"
MAX_ROWS_DEFAULT = 1000


def jsonable(v: Any) -> Any:
    """Make a DB value safe to JSON-serialize for the grid."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (bytes, bytearray)):
        return "0x" + bytes(v).hex()
    return str(v)


def clean_error(exc: Exception) -> str:
    """Trim SQLAlchemy's noisy '(Background on this error at: …)' suffix."""
    msg = str(exc)
    i = msg.find("(Background on this error")
    return msg[:i].rstrip() if i != -1 else msg


def _apply_schema(conn, connector: Connector, schema: str) -> None:
    """Make `schema` the active database/search-path for the session, so
    unqualified table names in raw SQL resolve (fixes MySQL 'No database
    selected')."""
    if not schema:
        return
    d = connector.engine.dialect.name
    q = connector.engine.dialect.identifier_preparer.quote(schema)
    if d == "mysql":
        conn.execute(sa.text(f"USE {q}"))
    elif d == "postgresql":
        conn.execute(sa.text(f"SET search_path TO {q}"))


# -- Guard: write detection & read-only enforcement ------------------------
# Verbs that modify data or schema. DML is transactional (safe to preview via
# rollback); the rest is DDL/privilege which auto-commits on MySQL.
_DML_WRITE = {"insert", "update", "delete", "replace", "merge"}
_WRITE_VERBS = _DML_WRITE | {
    "create", "alter", "drop", "truncate", "grant", "revoke", "call", "rename", "comment",
}


def first_keyword(stmt: str) -> str:
    m = re.match(r"\s*([a-zA-Z]+)", stmt)
    return m.group(1).lower() if m else ""


def is_write(stmt: str) -> bool:
    return first_keyword(stmt) in _WRITE_VERBS


def _ensure_writable(connector: Connector) -> None:
    if getattr(connector.profile, "read_only", False):
        raise ValueError("This connection is read-only. Turn off read-only mode on the connection to make changes.")


def preview_write(connector: Connector, sql: str, schema: str = "") -> dict[str, Any]:
    """Estimate the impact of write statements WITHOUT committing: run each DML
    statement inside a transaction, capture its affected-row count, then ROLL
    BACK so nothing actually changes. DDL/TRUNCATE is not executed (it can't be
    rolled back on MySQL) — reported as not-previewable."""
    statements = [s for s in split_statements(sql) if s.strip()]
    if not statements:
        return {"ok": False, "error": "No SQL statement."}
    previews: list[dict[str, Any]] = []
    try:
        with connector.engine.connect() as conn:
            trans = conn.begin()
            try:
                _apply_schema(conn, connector, schema)
                for stmt in statements:
                    kw = first_keyword(stmt)
                    if kw in _DML_WRITE:
                        res = conn.execute(sa.text(stmt))
                        rc = res.rowcount
                        previews.append({"kind": kw, "affected": rc if rc is not None and rc >= 0 else None, "previewable": True})
                    else:
                        previews.append({"kind": kw or "select", "affected": None, "previewable": False})
            finally:
                trans.rollback()  # nothing is persisted
        return {"ok": True, "previews": previews}
    except Exception as exc:
        return {"ok": False, "error": clean_error(exc)}


# -- SQL editor ------------------------------------------------------------
def run_sql(connector: Connector, sql: str, max_rows: int = MAX_ROWS_DEFAULT, schema: str = "") -> dict[str, Any]:
    """Execute one or more statements in a single transaction. Returns the last
    statement's result set (for SELECTs) plus counts. Rolls back on any error."""
    statements = [s for s in split_statements(sql) if s.strip()]
    if not statements:
        return {"ok": False, "error": "No SQL statement to run."}
    if getattr(connector.profile, "read_only", False) and any(is_write(s) for s in statements):
        return {"ok": False, "error": "This connection is read-only. Turn off read-only mode on the connection to run writes."}
    columns: list[str] = []
    rows: list[list[Any]] = []
    rowcount = 0
    is_select = False
    truncated = False
    executed = 0
    t0 = time.perf_counter()
    try:
        with connector.engine.begin() as conn:
            _apply_schema(conn, connector, schema)
            for stmt in statements:
                result = conn.execute(sa.text(stmt))
                executed += 1
                if result.returns_rows:
                    columns = list(result.keys())
                    if max_rows and max_rows > 0:
                        # Workbench-style cap: only pull the selected number of rows.
                        fetched = result.fetchmany(max_rows)
                        truncated = result.fetchone() is not None
                    else:
                        fetched = result.fetchall()  # "All" — no cap
                        truncated = False
                    rows = [[jsonable(v) for v in row] for row in fetched]
                    rowcount = len(rows)
                    is_select = True
                else:
                    rowcount = result.rowcount if result.rowcount is not None else 0
                    is_select = False
                    columns, rows, truncated = [], [], False
        return {
            "ok": True,
            "columns": columns,
            "rows": rows,
            "rowcount": rowcount,
            "is_select": is_select,
            "executed": executed,
            "truncated": truncated,
            "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
        }
    except Exception as exc:
        return {"ok": False, "error": clean_error(exc), "executed": executed}


# -- data browser ----------------------------------------------------------
# phpMyAdmin-style per-column operators. Value is always a bind parameter.
FILTER_OPS: dict[str, Any] = {
    "=": lambda c, v: c == v,
    "!=": lambda c, v: c != v,
    ">": lambda c, v: c > v,
    ">=": lambda c, v: c >= v,
    "<": lambda c, v: c < v,
    "<=": lambda c, v: c <= v,
    "like": lambda c, v: c.like(v),
    "not_like": lambda c, v: ~c.like(v),
    "contains": lambda c, v: sa.cast(c, sa.String).ilike(f"%{v}%"),
    "starts_with": lambda c, v: sa.cast(c, sa.String).ilike(f"{v}%"),
    "ends_with": lambda c, v: sa.cast(c, sa.String).ilike(f"%{v}"),
    "in": lambda c, v: c.in_([x.strip() for x in str(v).split(",") if x.strip() != ""]),
    "is_null": lambda c, v: c.is_(None),
    "not_null": lambda c, v: c.isnot(None),
}


# Comparison ops need a value typed to match the column (a string '1' fails
# against an integer column on PostgreSQL). Text ops keep the raw string.
_TYPED_OPS = {"=", "!=", ">", ">=", "<", "<="}


def _coerce_value(column: sa.Column, v: Any) -> Any:
    if v is None or not isinstance(v, str):
        return v
    try:
        pyt = column.type.python_type
    except Exception:
        return v
    s = v.strip()
    if pyt is int and s.lstrip("+-").isdigit():
        return int(s)
    if pyt is float:
        try:
            return float(s)
        except ValueError:
            return v
    if pyt is bool:
        return s.lower() in ("1", "true", "t", "yes", "y")
    return v


def _build_filters(t: sa.Table, filters: list[dict[str, Any]]) -> list[Any]:
    conds = []
    for f in filters or []:
        col = f.get("column")
        op = f.get("op", "=")
        if col not in t.c or op not in FILTER_OPS:
            continue
        value = f.get("value")
        if op in _TYPED_OPS:
            value = _coerce_value(t.c[col], value)
        conds.append(FILTER_OPS[op](t.c[col], value))
    return conds


def read_table(
    connector: Connector,
    schema: str,
    table: str,
    limit: int = 50,
    offset: int = 0,
    order_by: str = "",
    order_dir: str = "asc",
    search: str = "",
    filters: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    t = connector._table(schema, table)
    cols = list(t.c)
    q = sa.select(t)
    cnt = sa.select(sa.func.count()).select_from(t)
    clauses: list[Any] = []
    if search:
        clauses.append(sa.or_(*[sa.cast(c, sa.String).ilike(f"%{search}%") for c in cols]))
    clauses.extend(_build_filters(t, filters or []))
    if clauses:
        where = sa.and_(*clauses)
        q = q.where(where)
        cnt = cnt.where(where)
    if order_by and order_by in t.c:
        col = t.c[order_by]
        q = q.order_by(col.desc() if order_dir == "desc" else col.asc())
    q = q.limit(max(1, min(limit, 500))).offset(max(0, offset))

    with connector.engine.connect() as conn:
        total = int(conn.execute(cnt).scalar() or 0)
        res = conn.execute(q)
        colnames = list(res.keys())
        data = [[jsonable(v) for v in row] for row in res.fetchall()]

    columns = [c.model_dump() for c in connector.list_columns(schema, table)]
    pk_cols = [c.name for c in t.primary_key.columns]
    return {"columns": columns, "colnames": colnames, "rows": data, "total": total, "pk_cols": pk_cols}


# -- row editing -----------------------------------------------------------
def _clean(values: dict[str, Any], t: sa.Table) -> dict[str, Any]:
    return {k: v for k, v in values.items() if k in t.c}


def insert_row(connector: Connector, schema: str, table: str, values: dict[str, Any]) -> dict[str, Any]:
    _ensure_writable(connector)
    t = connector._table(schema, table)
    clean = _clean(values, t)
    if not clean:
        raise ValueError("no valid columns supplied")
    with connector.engine.begin() as conn:
        conn.execute(sa.insert(t).values(**clean))
    return {"ok": True}


def update_row(
    connector: Connector, schema: str, table: str, pk: dict[str, Any], values: dict[str, Any]
) -> dict[str, Any]:
    _ensure_writable(connector)
    t = connector._table(schema, table)
    pk_clean = _clean(pk, t)
    val_clean = _clean(values, t)
    if not pk_clean:
        raise ValueError("primary key required to update a row")
    if not val_clean:
        raise ValueError("no columns to update")
    where = sa.and_(*[t.c[k] == v for k, v in pk_clean.items()])
    with connector.engine.begin() as conn:
        res = conn.execute(sa.update(t).where(where).values(**val_clean))
    return {"ok": True, "updated": res.rowcount}


def delete_row(connector: Connector, schema: str, table: str, pk: dict[str, Any]) -> dict[str, Any]:
    _ensure_writable(connector)
    t = connector._table(schema, table)
    pk_clean = _clean(pk, t)
    if not pk_clean:
        raise ValueError("primary key required to delete a row")
    where = sa.and_(*[t.c[k] == v for k, v in pk_clean.items()])
    with connector.engine.begin() as conn:
        res = conn.execute(sa.delete(t).where(where))
    return {"ok": True, "deleted": res.rowcount}


def delete_rows(connector: Connector, schema: str, table: str, pks: list[dict[str, Any]]) -> dict[str, Any]:
    """Bulk-delete rows, each identified by its primary key, in one transaction."""
    _ensure_writable(connector)
    t = connector._table(schema, table)
    if not pks:
        raise ValueError("no rows selected")
    deleted = 0
    with connector.engine.begin() as conn:
        for pk in pks:
            pk_clean = _clean(pk, t)
            if not pk_clean:
                raise ValueError("primary key required to delete a row")
            where = sa.and_(*[t.c[k] == v for k, v in pk_clean.items()])
            res = conn.execute(sa.delete(t).where(where))
            deleted += res.rowcount or 0
    return {"ok": True, "deleted": deleted}


# -- export / import -------------------------------------------------------
def export_table(
    connector: Connector,
    schema: str,
    table: str,
    fmt: str,
    where: str = "",
    include_ddl: bool = True,
    batch_size: int = 1000,
) -> dict[str, Any]:
    if fmt not in EXPORT_EXT:
        raise ValueError(f"unsupported format: {fmt}")
    export_id = uuid.uuid4().hex
    path = str(EXPORT_DIR / f"{export_id}.{EXPORT_EXT[fmt]}")
    columns = [c.name for c in connector.list_columns(schema, table)]
    if fmt == "sql":
        target_columns = connector.list_columns(schema, table) if include_ddl else None
        sink = SQLFileSink(path, table, columns, schema=schema, include_ddl=include_ddl, target_columns=target_columns)
    elif fmt == "csv":
        sink = CSVSink(path, columns)
    else:
        sink = JSONSink(path, columns)
    try:
        for batch in connector.read_batches(schema, table, columns, batch_size=batch_size, where=where):
            sink.write_batch(batch)
    finally:
        sink.finalize()
    return {"export_id": export_id, "mode": fmt, "rows": sink.target_count()}


def import_csv(connector: Connector, schema: str, table: str, csv_text: str) -> dict[str, Any]:
    _ensure_writable(connector)
    t = connector._table(schema, table)
    tcols = {c.name for c in t.c}
    reader = csv.DictReader(io.StringIO(csv_text))
    header = [h for h in (reader.fieldnames or []) if h in tcols]
    if not header:
        raise ValueError("CSV header has no columns matching the target table")
    rows: list[dict[str, Any]] = []
    for r in reader:
        rows.append({k: (r[k] if r.get(k) != "" else None) for k in header})

    inserted = 0
    errors: list[str] = []
    for i in range(0, len(rows), 500):
        batch = rows[i : i + 500]
        try:
            with connector.engine.begin() as conn:
                conn.execute(sa.insert(t), batch)
            inserted += len(batch)
        except Exception as exc:
            errors.append(f"rows {i + 1}-{i + len(batch)}: {exc}")
    return {"ok": not errors, "inserted": inserted, "total": len(rows), "errors": errors[:20]}
