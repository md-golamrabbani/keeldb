"""Post-migration verification: foreign-key orphan scan + row-count reconcile.

Orphan scan finds rows whose foreign-key value has no matching parent row — the
classic breakage after loading tables in the wrong order or dropping data.
Reconcile compares source vs target row counts. Both are dialect-agnostic
(SQLAlchemy Core), so they work on MySQL / Postgres / SQLite alike.
"""
from __future__ import annotations

from typing import Any, Optional

import sqlalchemy as sa

from .connectors.base import Connector


def _orphan_count(conn, connector: Connector, schema: str, child_table: str,
                  child_cols: list[str], parent_table: str, parent_cols: list[str]) -> int:
    child = connector._table(schema, child_table)
    parent = connector._table(schema, parent_table)
    # FK semantics: a NULL in any FK column means "no reference" — not an orphan.
    not_null = sa.and_(*[child.c[c].isnot(None) for c in child_cols])
    match = sa.and_(*[parent.c[p] == child.c[c] for p, c in zip(parent_cols, child_cols)])
    exists_parent = sa.exists(sa.select(parent.c[parent_cols[0]]).where(match))
    q = sa.select(sa.func.count()).select_from(child).where(sa.and_(not_null, ~exists_parent))
    return int(conn.execute(q).scalar() or 0)


def orphan_scan(connector: Connector, schema: str, table: Optional[str] = None) -> dict[str, Any]:
    """Scan one table (or every table in the schema) for FK orphans."""
    insp = sa.inspect(connector.engine)
    sch = schema or None
    tables = [table] if table else sorted(insp.get_table_names(schema=sch))
    results: list[dict[str, Any]] = []
    total = 0
    with connector.engine.connect() as conn:
        for t in tables:
            checks = []
            for fk in insp.get_foreign_keys(t, schema=sch):
                cc = fk.get("constrained_columns") or []
                pc = fk.get("referred_columns") or []
                pt = fk.get("referred_table")
                if not cc or not pt or len(cc) != len(pc):
                    continue
                try:
                    n = _orphan_count(conn, connector, schema, t, cc, pt, pc)
                except Exception as exc:
                    checks.append({"columns": cc, "ref_table": pt, "ref_columns": pc, "error": str(exc)})
                    continue
                total += n
                checks.append({"columns": cc, "ref_table": pt, "ref_columns": pc, "orphans": n})
            if checks:
                results.append({"table": t, "checks": checks})
    return {"tables": results, "total_orphans": total, "scanned": len(tables)}


def reconcile_counts(
    source: Connector, source_schema: str, source_table: str,
    target: Connector, target_schema: str, target_table: str, where: str = "",
) -> dict[str, Any]:
    s = source.count_rows(source_schema, source_table, where)
    t = target.count_rows(target_schema, target_table)
    return {"source": s, "target": t, "diff": t - s, "match": s == t}
