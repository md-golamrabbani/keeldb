"""Duplicate record detector — find rows that share the same value(s) in a chosen
set of columns (email, phone, SKU, external id, …).

Dialect-agnostic via SQLAlchemy Core: it groups by the selected columns, keeps the
groups with more than one member, and reports the worst offenders plus totals. The
UI drills into a group by reusing the Explorer's existing column filters, so no row
identifiers need to be shipped here.
"""
from __future__ import annotations

import sqlalchemy as sa

from .connectors.base import Connector


def find_duplicates(connector: Connector, schema: str, table: str,
                    columns: list[str], limit: int = 100) -> dict:
    if not columns:
        raise ValueError("pick at least one column to match on")

    t = connector._table(schema, table)
    missing = [c for c in columns if c not in t.c]
    if missing:
        raise ValueError(f"unknown column(s): {', '.join(missing)}")

    keycols = [t.c[c] for c in columns]
    count = sa.func.count().label("_count")

    # Worst offenders first, capped so a pathological table can't flood the client.
    top = (sa.select(*keycols, count)
           .group_by(*keycols)
           .having(count > 1)
           .order_by(count.desc())
           .limit(limit))

    # Unbounded totals: how many duplicate groups exist and how many rows are
    # redundant copies (sum(count) - groups).
    grouped = (sa.select(count.label("c"))
               .select_from(t)
               .group_by(*keycols)
               .having(count > 1)
               .subquery())
    agg = sa.select(
        sa.func.count().label("groups"),
        sa.func.coalesce(sa.func.sum(grouped.c.c), 0).label("rows"),
    )

    with connector.engine.connect() as conn:
        groups = []
        for row in conn.execute(top):
            m = row._mapping
            groups.append({
                "values": {c: m[c] for c in columns},
                "count": int(m["_count"]),
            })
        a = conn.execute(agg).one()._mapping
        group_count = int(a["groups"])
        total_in_groups = int(a["rows"])

    return {
        "columns": columns,
        "groups": groups,
        "group_count": group_count,            # total duplicate groups (unbounded)
        "redundant_rows": total_in_groups - group_count,  # rows beyond the first in each group
        "truncated": group_count > len(groups),
    }
