"""Query performance analyzer — run the engine's EXPLAIN and translate the plan
into plain-language hints (full-table scans, sorts not backed by an index, cost).

Read-only: only SELECT / WITH / EXPLAIN statements are accepted. The plan output
is dialect-specific, so each engine has its own parser that normalizes into a
common shape { dialect, plan[], hints[], scans[] }. SQLite is the reference
implementation exercised by the tests; Postgres and MySQL parse EXPLAIN JSON
defensively and always fall back to the raw plan text.
"""
from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa

from . import dbops
from .connectors.base import Connector

_ALLOWED = {"select", "with", "explain"}


def _hint(level: str, message: str, table: str | None = None) -> dict:
    return {"level": level, "message": message, "table": table}


# ---- SQLite -------------------------------------------------------------
def _analyze_sqlite(conn, sql: str) -> dict:
    rows = conn.execute(sa.text(f"EXPLAIN QUERY PLAN {sql}")).fetchall()
    plan = [{"detail": r[-1]} for r in rows]
    hints: list[dict] = []
    scans: list[str] = []

    for line in (p["detail"] for p in plan):
        up = line.upper()
        if up.startswith("SCAN"):
            toks = line.split()
            i = 1
            if len(toks) > 1 and toks[1].upper() == "TABLE":
                i = 2
            table = toks[i] if len(toks) > i else None
            if table and toks[i].upper() != "SUBQUERY":
                scans.append(table)
                hints.append(_hint("warn",
                    f"Full-table scan on {table}. Add an index on the column(s) used in "
                    "WHERE/JOIN, or narrow the query.", table))
        if "USE TEMP B-TREE FOR ORDER BY" in up:
            hints.append(_hint("warn", "ORDER BY is sorted with a temporary b-tree — an index "
                               "on the sort column(s) would avoid it."))
        if "USE TEMP B-TREE FOR GROUP BY" in up:
            hints.append(_hint("warn", "GROUP BY builds a temporary b-tree — an index on the "
                               "grouped column(s) would avoid it."))

    if not hints:
        hints.append(_hint("info", "No full-table scans or temporary sorts detected."))
    return {"plan": plan, "plan_text": "\n".join(p["detail"] for p in plan),
            "hints": hints, "scans": scans}


# ---- Postgres -----------------------------------------------------------
def _walk_pg(node: dict, hints: list, scans: list) -> None:
    nt = node.get("Node Type", "")
    rel = node.get("Relation Name")
    if nt == "Seq Scan" and rel:
        scans.append(rel)
        hints.append(_hint("warn", f"Sequential scan on {rel}. Consider an index on the "
                           "filtered/joined column(s).", rel))
    if nt == "Sort":
        hints.append(_hint("info", "A Sort node is present — an index matching the ORDER BY "
                           "could remove it."))
    for child in node.get("Plans", []) or []:
        _walk_pg(child, hints, scans)


def _analyze_pg(conn, sql: str) -> dict:
    raw = conn.execute(sa.text(f"EXPLAIN (FORMAT JSON) {sql}")).scalar()
    data = raw if isinstance(raw, (list, dict)) else json.loads(raw)
    root = data[0]["Plan"] if isinstance(data, list) else data["Plan"]
    hints: list[dict] = []
    scans: list[str] = []
    _walk_pg(root, hints, scans)
    if not hints:
        hints.append(_hint("info", "No sequential scans detected."))
    txt = conn.execute(sa.text(f"EXPLAIN {sql}")).fetchall()
    return {"plan": [{"detail": r[0]} for r in txt],
            "plan_text": "\n".join(r[0] for r in txt),
            "hints": hints, "scans": scans,
            "total_cost": root.get("Total Cost")}


# ---- MySQL --------------------------------------------------------------
def _walk_mysql(obj: Any, hints: list, scans: list) -> None:
    if isinstance(obj, dict):
        ta = obj.get("table")
        if isinstance(ta, dict) and ta.get("access_type") == "ALL":
            name = ta.get("table_name")
            if name:
                scans.append(name)
                hints.append(_hint("warn", f"Full scan (access_type ALL) on {name}. Add an "
                                   "index on the filtered/joined column(s).", name))
        for v in obj.values():
            _walk_mysql(v, hints, scans)
    elif isinstance(obj, list):
        for v in obj:
            _walk_mysql(v, hints, scans)


def _analyze_mysql(conn, sql: str) -> dict:
    raw = conn.execute(sa.text(f"EXPLAIN FORMAT=JSON {sql}")).scalar()
    data = json.loads(raw) if isinstance(raw, str) else raw
    hints: list[dict] = []
    scans: list[str] = []
    _walk_mysql(data, hints, scans)
    if not hints:
        hints.append(_hint("info", "No full scans detected."))
    return {"plan": [{"detail": json.dumps(data, indent=2)}],
            "plan_text": json.dumps(data, indent=2), "hints": hints, "scans": scans}


def analyze_query(connector: Connector, sql: str, schema: str = "") -> dict:
    stmt = sql.strip().rstrip(";").strip()
    if not stmt:
        raise ValueError("empty query")
    if dbops.first_keyword(stmt) not in _ALLOWED:
        raise ValueError("only SELECT queries can be analyzed")
    if ";" in stmt:  # trailing ';' already stripped — any left means multiple statements
        raise ValueError("analyze one statement at a time")

    dialect = connector.engine.dialect.name
    with connector.engine.connect() as conn:
        dbops._apply_schema(conn, connector, schema)
        if dialect == "postgresql":
            result = _analyze_pg(conn, stmt)
        elif dialect == "mysql":
            result = _analyze_mysql(conn, stmt)
        else:
            result = _analyze_sqlite(conn, stmt)
    return {"dialect": dialect, "sql": stmt, **result}
