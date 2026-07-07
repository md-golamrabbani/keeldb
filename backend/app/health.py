"""Database health — storage & size overview.

Top tables by size/rows plus database totals. Sizes come from each engine's own
catalog (Postgres pg_total_relation_size, MySQL information_schema); SQLite has no
per-table byte size, so it reports live row counts and leaves size null. The result
is a common shape the Health dashboard renders directly.
"""
from __future__ import annotations

import sqlalchemy as sa

from .connectors.base import Connector


def _sqlite_tables(connector: Connector, schema: str) -> list[dict]:
    insp = sa.inspect(connector.engine)
    out = []
    with connector.engine.connect() as conn:
        for name in insp.get_table_names(schema=schema or None):
            t = connector._table(schema, name)
            rows = int(conn.execute(sa.select(sa.func.count()).select_from(t)).scalar() or 0)
            out.append({"name": name, "rows": rows, "size_bytes": None, "index_bytes": None})
    out.sort(key=lambda r: r["rows"], reverse=True)
    return out


def _pg_tables(connector: Connector, schema: str) -> list[dict]:
    sch = schema or "public"
    q = sa.text(
        "SELECT c.relname AS name, c.reltuples::bigint AS rows, "
        "pg_total_relation_size(c.oid) AS size_bytes, pg_indexes_size(c.oid) AS index_bytes "
        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = :s AND c.relkind = 'r' "
        "ORDER BY pg_total_relation_size(c.oid) DESC"
    )
    with connector.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(q, {"s": sch})]


def _mysql_tables(connector: Connector, schema: str) -> list[dict]:
    sch = schema or connector.profile.database
    q = sa.text(
        "SELECT table_name AS name, table_rows AS rows, "
        "(data_length + index_length) AS size_bytes, index_length AS index_bytes "
        "FROM information_schema.tables "
        "WHERE table_schema = :s AND table_type = 'BASE TABLE' "
        "ORDER BY (data_length + index_length) DESC"
    )
    with connector.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(q, {"s": sch})]


def table_stats(connector: Connector, schema: str) -> list[dict]:
    d = connector.engine.dialect.name
    if d == "postgresql":
        rows = _pg_tables(connector, schema)
    elif d == "mysql":
        rows = _mysql_tables(connector, schema)
    else:
        rows = _sqlite_tables(connector, schema)
    # normalize numeric types (some drivers return Decimal)
    for r in rows:
        for k in ("rows", "size_bytes", "index_bytes"):
            if r.get(k) is not None:
                r[k] = int(r[k])
    return rows


def report(connector: Connector, schema: str) -> dict:
    tables = table_stats(connector, schema)
    sizes = [t["size_bytes"] for t in tables if t["size_bytes"] is not None]
    return {
        "dialect": connector.engine.dialect.name,
        "overview": {
            "table_count": len(tables),
            "total_rows": sum(t["rows"] or 0 for t in tables),
            "total_size_bytes": sum(sizes) if sizes else None,
        },
        "tables": tables,
    }
