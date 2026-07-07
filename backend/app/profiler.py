"""Data profiler — a one-click column-level summary of a table.

For every column: null count/%, distinct count/%, whether it looks unique, min/max
(and average for numerics), plus lightweight pattern detection (email / uuid / url /
phone / ipv4) inferred from a sample. Column aggregates are computed in a single
pass; pattern detection reads one small sample of rows. Dialect-agnostic via
SQLAlchemy Core.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

import sqlalchemy as sa

from .connectors.base import Connector

_SAMPLE = 500
_PATTERN_THRESHOLD = 0.9  # fraction of sampled non-null values that must match

_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("email", re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")),
    ("uuid", re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")),
    ("url", re.compile(r"^https?://\S+$")),
    ("ipv4", re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")),
    ("phone", re.compile(r"^\+?[\d][\d\s().-]{6,}$")),
]


def _kind(type_str: str) -> str:
    ts = type_str.upper()
    if any(k in ts for k in ("INT", "NUMERIC", "DECIMAL", "REAL", "FLOAT", "DOUBLE", "MONEY")):
        return "numeric"
    if "BOOL" in ts:
        return "bool"
    if any(k in ts for k in ("DATE", "TIME")):
        return "datetime"
    if any(k in ts for k in ("CHAR", "TEXT", "CLOB", "STRING")):
        return "text"
    return "other"


def _num(v: Any) -> Any:
    return float(v) if isinstance(v, Decimal) else v


def _detect_pattern(values: list[str]) -> tuple[str | None, float]:
    vals = [str(v) for v in values if v is not None and str(v) != ""]
    if len(vals) < 3:
        return None, 0.0
    best, best_frac = None, 0.0
    for name, rx in _PATTERNS:
        frac = sum(1 for v in vals if rx.match(v)) / len(vals)
        if frac > best_frac:
            best, best_frac = name, frac
    return (best, round(best_frac, 3)) if best_frac >= _PATTERN_THRESHOLD else (None, 0.0)


def profile_table(connector: Connector, schema: str, table: str,
                  columns: list[str] | None = None) -> dict:
    t = connector._table(schema, table)
    cols = columns or [c.name for c in t.c]
    unknown = [c for c in cols if c not in t.c]
    if unknown:
        raise ValueError(f"unknown column(s): {', '.join(unknown)}")

    kinds = {c: _kind(str(t.c[c].type)) for c in cols}

    # One aggregate pass for all columns (index-labelled to avoid name clashes).
    aggs: list[Any] = [sa.func.count().label("_total")]
    for i, c in enumerate(cols):
        col = t.c[c]
        aggs += [
            sa.func.count(col).label(f"nn_{i}"),
            sa.func.count(sa.distinct(col)).label(f"dc_{i}"),
            sa.func.min(col).label(f"mn_{i}"),
            sa.func.max(col).label(f"mx_{i}"),
        ]
        if kinds[c] == "numeric":
            aggs.append(sa.func.avg(col).label(f"av_{i}"))

    with connector.engine.connect() as conn:
        row = conn.execute(sa.select(*aggs).select_from(t)).one()._mapping
        total = int(row["_total"])
        sample_rows = conn.execute(sa.select(t).limit(_SAMPLE)).mappings().all() if total else []

    out = []
    for i, c in enumerate(cols):
        nn = int(row[f"nn_{i}"])
        dc = int(row[f"dc_{i}"])
        pattern, pattern_pct = (None, 0.0)
        if kinds[c] in ("text", "other"):
            pattern, pattern_pct = _detect_pattern([r[c] for r in sample_rows])
        out.append({
            "name": c,
            "type": str(t.c[c].type),
            "kind": kinds[c],
            "null_count": total - nn,
            "null_pct": round((total - nn) / total * 100, 2) if total else 0.0,
            "distinct": dc,
            "distinct_pct": round(dc / total * 100, 2) if total else 0.0,
            "unique": nn > 0 and dc == nn,
            "min": _num(row[f"mn_{i}"]),
            "max": _num(row[f"mx_{i}"]),
            "avg": round(_num(row[f"av_{i}"]), 4) if kinds[c] == "numeric" and row[f"av_{i}"] is not None else None,
            "pattern": pattern,
            "pattern_pct": pattern_pct,
        })

    return {"table": table, "total_rows": total, "columns": out}
