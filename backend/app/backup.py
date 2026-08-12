"""Table backup — dump a table's schema + data as a portable .sql script.

Emits a CREATE TABLE followed by one INSERT per row, with values rendered as
dialect-correct literals by SQLAlchemy (no hand-rolled escaping). Restoring is
just running the script back through the SQL editor / import.
"""
from __future__ import annotations

import json

import sqlalchemy as sa

from .connectors.base import Connector


def _literal_safe(t: sa.Table, col: str, v: object) -> object:
    """SQLAlchemy has no literal renderer for JSON (and some exotic) column
    types, so `literal_binds` compilation blows up on them. Serialize those
    values and bind them as plain TEXT literals — valid INSERT syntax on
    MySQL, PostgreSQL and SQLite alike."""
    if v is None:
        return v
    if isinstance(v, (dict, list)):
        return sa.literal(json.dumps(v, ensure_ascii=False, default=str), sa.Text())
    ctype = t.c[col].type if col in t.c else None
    if isinstance(ctype, sa.JSON) or type(ctype).__name__.upper().startswith("JSON"):
        return sa.literal(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str), sa.Text())
    return v


def backup_database(connector: Connector, schema: str) -> dict:
    """Dump every table in the schema (schema + data) into one .sql script."""
    insp = sa.inspect(connector.engine)
    tables = sorted(insp.get_table_names(schema=schema or None))
    parts, total = [], 0
    for t in tables:
        b = backup_table(connector, schema, t)
        parts.append(f"-- ---- {t} ({b['rows']} rows) ----")
        parts.append(b["sql"])
        total += b["rows"]
    header = f"-- KeelDB database backup — {len(tables)} table(s), {total} row(s)\n"
    return {"schema": schema or "", "tables": len(tables), "rows": total,
            "sql": header + "\n".join(parts) + ("\n" if parts else "")}


def backup_table(connector: Connector, schema: str, table: str,
                 include_ddl: bool = True, include_data: bool = True) -> dict:
    t = connector._table(schema, table)
    lines: list[str] = []
    if include_ddl:
        ddl = str(sa.schema.CreateTable(t).compile(connector.engine)).strip()
        lines += [ddl.rstrip(";") + ";", ""]

    count = 0
    if include_data:
        with connector.engine.connect() as conn:
            for row in conn.execute(sa.select(t)).mappings():
                values = {k: _literal_safe(t, k, v) for k, v in dict(row).items()}
                stmt = t.insert().values(**values)
                sql = str(stmt.compile(connector.engine, compile_kwargs={"literal_binds": True}))
                lines.append(sql.rstrip(";") + ";")
                count += 1

    return {"table": table, "rows": count, "sql": "\n".join(lines) + ("\n" if lines else "")}


def export_iter(connector: Connector, schema: str, tables=None,
                include_ddl: bool = True, include_data: bool = True):
    """Stream a .sql export table-by-table so the UI can show progress. Yields
    a "start" event, one "table" event per table (carrying that table's SQL),
    then a "done" summary."""
    if tables is None:
        insp = sa.inspect(connector.engine)
        tables = sorted(insp.get_table_names(schema=schema or None))
    n = len(tables)
    yield {"type": "start", "total": n, "schema": schema or ""}
    total_rows = 0
    for i, t in enumerate(tables, 1):
        b = backup_table(connector, schema, t, include_ddl, include_data)
        total_rows += b["rows"]
        yield {"type": "table", "index": i, "total": n, "table": t, "rows": b["rows"],
               "sql": f"-- ---- {t} ({b['rows']} rows) ----\n{b['sql']}"}
    yield {"type": "done", "tables": n, "rows": total_rows}
