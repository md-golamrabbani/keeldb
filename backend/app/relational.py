"""Relational debugger — reverse foreign-key navigation ("who references this row").

Given one row (by primary key), find every row in the schema that points at it
through a foreign key, grouped by child table. This is the delete/cascade-impact
view: before you remove a parent, see exactly what depends on it. Self-referencing
tables (e.g. employees.manager_id → employees.id) are handled naturally.
"""
from __future__ import annotations

from typing import Any

import sqlalchemy as sa

from .connectors.base import Connector

_SAMPLE_LIMIT = 5


def dependents(connector: Connector, schema: str, table: str,
               pk: dict[str, Any]) -> dict:
    if not pk:
        raise ValueError("no primary-key values provided")

    insp = sa.inspect(connector.engine)
    sch = schema or None
    parent = connector._table(schema, table)
    unknown = [k for k in pk if k not in parent.c]
    if unknown:
        raise ValueError(f"unknown key column(s): {', '.join(unknown)}")

    with connector.engine.connect() as conn:
        where = sa.and_(*[parent.c[k] == v for k, v in pk.items()])
        prow = conn.execute(sa.select(parent).where(where)).mappings().first()
        if prow is None:
            return {"found": False, "pk": pk, "dependents": [], "total_dependents": 0, "referencing_tables": 0}

        groups: list[dict] = []
        total = 0
        for t in sorted(insp.get_table_names(schema=sch)):
            child = connector._table(schema, t)
            for fk in insp.get_foreign_keys(t, schema=sch):
                if fk.get("referred_table") != table:
                    continue
                cc = fk.get("constrained_columns") or []
                pc = fk.get("referred_columns") or []
                if not cc or len(cc) != len(pc):
                    continue
                # Only navigable when the parent row actually has values for the
                # referenced columns (NULL parents can't be pointed at).
                if any(pcol not in prow or prow[pcol] is None for pcol in pc):
                    continue
                match = sa.and_(*[child.c[c] == prow[p] for c, p in zip(cc, pc)])
                n = int(conn.execute(sa.select(sa.func.count()).select_from(child).where(match)).scalar() or 0)
                sample = [dict(m) for m in conn.execute(sa.select(child).where(match).limit(_SAMPLE_LIMIT)).mappings()]
                total += n
                groups.append({
                    "table": t,
                    "columns": cc,
                    "ref_columns": pc,
                    "on_delete": (fk.get("options") or {}).get("ondelete"),
                    "count": n,
                    "sample": sample,
                })

    return {
        "found": True,
        "pk": pk,
        "dependents": groups,
        "total_dependents": total,
        "referencing_tables": sum(1 for g in groups if g["count"] > 0),
    }
