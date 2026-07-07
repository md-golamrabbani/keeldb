"""Index advisor — schema-wide index hygiene findings.

Works on every engine from reflection alone:
  * duplicate indexes   — two non-unique indexes on the same column list
  * redundant indexes   — a non-unique index whose columns are a leading prefix
                          of another (the longer one already covers it)
  * missing primary key — a table with no PK (rows can't be safely addressed)

On Postgres/MySQL it also adds *unused* indexes from the engine's usage stats
(pg_stat_user_indexes / sys.schema_unused_indexes). SQLite keeps no usage stats,
so `usage_available` is false there.
"""
from __future__ import annotations

from collections import defaultdict

import sqlalchemy as sa

from .connectors.base import Connector


def _finding(level: str, kind: str, table: str, message: str,
             index: str | None = None, covered_by: str | None = None) -> dict:
    return {"level": level, "kind": kind, "table": table, "message": message,
            "index": index, "covered_by": covered_by}


def _reflect_findings(connector: Connector, schema: str) -> list[dict]:
    insp = sa.inspect(connector.engine)
    sch = schema or None
    findings: list[dict] = []
    for t in sorted(insp.get_table_names(schema=sch)):
        pk = insp.get_pk_constraint(t, schema=sch) or {}
        if not (pk.get("constrained_columns")):
            findings.append(_finding("warn", "no_primary_key", t,
                                     "Table has no primary key — rows can't be safely addressed or de-duplicated."))

        entries = [{"name": ix.get("name"), "cols": tuple(ix.get("column_names") or []),
                    "unique": bool(ix.get("unique"))}
                   for ix in insp.get_indexes(t, schema=sch) if ix.get("column_names")]

        # duplicates: same column signature (don't suggest dropping a unique one)
        groups: dict[tuple, list] = defaultdict(list)
        for e in entries:
            groups[e["cols"]].append(e)
        dup_names: set[str] = set()
        for cols, es in groups.items():
            if len(es) > 1:
                keeper = es[0]
                for extra in es[1:]:
                    if extra["unique"]:
                        continue
                    dup_names.add(extra["name"])
                    findings.append(_finding("warn", "duplicate_index", t,
                        f"Index {extra['name']} duplicates {keeper['name']} (both on {', '.join(cols)}).",
                        index=extra["name"], covered_by=keeper["name"]))

        # redundant: a's columns are a strict leading prefix of some longer index b
        for a in entries:
            if a["unique"] or a["name"] in dup_names:
                continue
            for b in entries:
                if b["name"] == a["name"]:
                    continue
                if len(b["cols"]) > len(a["cols"]) and b["cols"][:len(a["cols"])] == a["cols"]:
                    findings.append(_finding("info", "redundant_index", t,
                        f"Index {a['name']} on ({', '.join(a['cols'])}) is covered by {b['name']} "
                        f"on ({', '.join(b['cols'])}).", index=a["name"], covered_by=b["name"]))
                    break
    return findings


def _pg_unused(connector: Connector, schema: str) -> list[dict]:
    sch = schema or "public"
    q = sa.text(
        "SELECT relname AS table, indexrelname AS index FROM pg_stat_user_indexes "
        "WHERE schemaname = :s AND idx_scan = 0 "
        "AND indexrelname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p','u'))"
    )
    with connector.engine.connect() as conn:
        return [_finding("info", "unused_index", r._mapping["table"],
                         f"Index {r._mapping['index']} has never been scanned — consider dropping it.",
                         index=r._mapping["index"])
                for r in conn.execute(q, {"s": sch})]


def _mysql_unused(connector: Connector, schema: str) -> list[dict]:
    sch = schema or connector.profile.database
    q = sa.text(
        "SELECT object_name AS `table`, index_name AS `index` FROM sys.schema_unused_indexes "
        "WHERE object_schema = :s"
    )
    with connector.engine.connect() as conn:
        return [_finding("info", "unused_index", r._mapping["table"],
                         f"Index {r._mapping['index']} is reported unused — consider dropping it.",
                         index=r._mapping["index"])
                for r in conn.execute(q, {"s": sch})]


def index_advice(connector: Connector, schema: str) -> dict:
    d = connector.engine.dialect.name
    findings = _reflect_findings(connector, schema)
    usage_available = d in ("postgresql", "mysql")
    if d == "postgresql":
        try:
            findings += _pg_unused(connector, schema)
        except Exception:
            usage_available = False
    elif d == "mysql":
        try:
            findings += _mysql_unused(connector, schema)
        except Exception:
            usage_available = False
    return {"dialect": d, "usage_available": usage_available, "findings": findings}
