"""Multi-table migration projects: order mappings by target foreign keys
(parents before children) and run them together with a combined report."""
from __future__ import annotations

from typing import Any, Iterator, Optional

from . import admin
from .connectors import connector_for
from .connectors.base import Connector
from .models import MappingProfile, MigrationProject, SavedConnection
from .runner import run_migration
from .store import connection_store, mapping_store


def order_mappings_by_fk(
    mappings: list[MappingProfile], target: Connector, target_schema: str
) -> list[MappingProfile]:
    """Topologically order mappings so a table is loaded only after every table
    it references (via a target FK) is loaded. Independent tables keep their
    given order; cycles/self-refs fall back to the original order."""
    names = {m.target_table for m in mappings}
    try:
        graph = admin.schema_graph(target, target_schema)
    except Exception:
        return mappings
    deps: dict[str, set[str]] = {}
    for rel in graph.get("relationships", []):
        ft, tt = rel.get("from_table"), rel.get("to_table")
        if ft in names and tt in names and ft != tt:
            deps.setdefault(ft, set()).add(tt)

    ordered: list[MappingProfile] = []
    placed: set[str] = set()
    remaining = list(mappings)
    while remaining:
        progressed = False
        for m in list(remaining):
            if deps.get(m.target_table, set()) <= placed:
                ordered.append(m)
                placed.add(m.target_table)
                remaining.remove(m)
                progressed = True
        if not progressed:  # cycle — append the rest in original order
            ordered.extend(remaining)
            break
    return ordered


def run_project(project: MigrationProject, dry_run: bool = False) -> Iterator[dict[str, Any]]:
    mappings = [m for m in (mapping_store.get(mid) for mid in project.mapping_ids) if m]
    if not mappings:
        yield {"event": "fatal", "message": "This project has no saved mappings."}
        return

    if project.auto_order:
        tgt_profile = connection_store.get(mappings[0].target_conn_id)
        if tgt_profile:
            tc = connector_for(tgt_profile)
            try:
                mappings = order_mappings_by_fk(mappings, tc, mappings[0].target_schema)
            except Exception:
                pass
            finally:
                tc.dispose()

    yield {"event": "project_start", "order": [m.target_table for m in mappings], "count": len(mappings)}

    tables: list[dict[str, Any]] = []
    for m in mappings:
        src = connection_store.get(m.source_conn_id)
        tgt = connection_store.get(m.target_conn_id) if m.target_conn_id else None
        yield {"event": "table_start", "table": m.target_table, "mapping": m.name}
        report: Optional[dict[str, Any]] = None
        try:
            for ev in run_migration(m, src, tgt, dry_run=dry_run):
                ev = {**ev, "table": m.target_table}
                if ev.get("event") == "done":
                    report = ev.get("report")
                yield ev
        except Exception as exc:  # a mapping blowing up shouldn't kill the stream
            yield {"event": "fatal", "table": m.target_table, "message": str(exc)}
        tables.append({"table": m.target_table, "mapping": m.name, "report": report})
        if report and not report.get("ok") and project.stop_on_error:
            yield {"event": "project_aborted", "table": m.target_table}
            break

    totals = {"rows_written": 0, "rows_skipped": 0, "rows_errored": 0}
    for t in tables:
        r = t.get("report") or {}
        totals["rows_written"] += r.get("rows_written", 0)
        totals["rows_skipped"] += r.get("rows_skipped", 0)
        totals["rows_errored"] += r.get("rows_errored", 0)
    ok = all((t.get("report") or {}).get("ok") for t in tables) and len(tables) == len(mappings)
    yield {"event": "project_done", "tables": tables, "totals": totals, "ok": ok}
