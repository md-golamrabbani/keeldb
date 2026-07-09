"""Bloat / vacuum advisor — dead-tuple and reclaimable-space hygiene.

PostgreSQL: pg_stat_user_tables dead-tuple counts + last (auto)vacuum times,
with a VACUUM ANALYZE suggestion when dead tuples pass an absolute and
relative threshold. MySQL: information_schema DATA_FREE (reclaimable bytes)
with an OPTIMIZE TABLE suggestion. Other dialects report unsupported.
"""
from __future__ import annotations

from typing import Any

import sqlalchemy as sa

from .connectors.base import Connector

DEAD_MIN = 1_000          # ignore tiny tables
DEAD_RATIO = 0.10         # dead > 10% of live ⇒ advise
FREE_MIN_BYTES = 50 * 1024 * 1024  # MySQL: ≥50 MB reclaimable ⇒ advise


def report(connector: Connector, schema: str = "") -> dict[str, Any]:
    d = connector.engine.dialect.name
    if d == "postgresql":
        return _postgres(connector, schema)
    if d == "mysql":
        return _mysql(connector, schema)
    return {"dialect": d, "supported": False, "tables": [], "advice": [],
            "message": "Bloat analysis is available for PostgreSQL and MySQL connections."}


def _postgres(connector: Connector, schema: str) -> dict[str, Any]:
    sql = sa.text("""
        SELECT relname, n_live_tup, n_dead_tup,
               last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
        FROM pg_stat_user_tables
        WHERE (:s = '' OR schemaname = :s)
        ORDER BY n_dead_tup DESC
        LIMIT 100
    """)
    tables: list[dict[str, Any]] = []
    advice: list[dict[str, Any]] = []
    with connector.engine.connect() as conn:
        for r in conn.execute(sql, {"s": schema or ""}).mappings():
            live = int(r["n_live_tup"] or 0)
            dead = int(r["n_dead_tup"] or 0)
            ratio = dead / live if live else (1.0 if dead else 0.0)
            row = {
                "table": r["relname"],
                "live_rows": live,
                "dead_rows": dead,
                "dead_ratio": round(ratio, 3),
                "last_vacuum": str(r["last_vacuum"] or r["last_autovacuum"] or "") or None,
                "last_analyze": str(r["last_analyze"] or r["last_autoanalyze"] or "") or None,
            }
            tables.append(row)
            if dead >= DEAD_MIN and ratio >= DEAD_RATIO:
                advice.append({
                    "table": r["relname"],
                    "severity": "warn" if ratio < 0.3 else "high",
                    "message": f"{dead:,} dead tuples ({ratio:.0%} of live rows)"
                               + ("" if row["last_vacuum"] else " and never vacuumed"),
                    "action": f'VACUUM (ANALYZE) "{r["relname"]}";',
                })
    return {"dialect": "postgresql", "supported": True, "tables": tables, "advice": advice}


def _mysql(connector: Connector, schema: str) -> dict[str, Any]:
    sql = sa.text("""
        SELECT TABLE_NAME AS t, TABLE_ROWS AS rows_est,
               DATA_LENGTH AS data_len, INDEX_LENGTH AS idx_len, DATA_FREE AS free
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = COALESCE(NULLIF(:s, ''), DATABASE())
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY DATA_FREE DESC
        LIMIT 100
    """)
    tables: list[dict[str, Any]] = []
    advice: list[dict[str, Any]] = []
    with connector.engine.connect() as conn:
        for r in conn.execute(sql, {"s": schema or ""}).mappings():
            free = int(r["free"] or 0)
            size = int(r["data_len"] or 0) + int(r["idx_len"] or 0)
            tables.append({
                "table": r["t"],
                "rows_est": int(r["rows_est"] or 0),
                "size_bytes": size,
                "reclaimable_bytes": free,
            })
            if free >= FREE_MIN_BYTES:
                advice.append({
                    "table": r["t"],
                    "severity": "warn",
                    "message": f"{free / (1024 * 1024):,.0f} MB reclaimable (fragmentation after deletes/updates)",
                    "action": f"OPTIMIZE TABLE `{r['t']}`;",
                })
    return {"dialect": "mysql", "supported": True, "tables": tables, "advice": advice}
