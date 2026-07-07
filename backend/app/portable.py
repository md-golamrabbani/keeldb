"""Portable project files — export/import reusable definitions to share setups.

Bundles connection definitions (WITHOUT secrets), mapping profiles, migration
projects, saved snippets, and alert rules into one JSON document. Secrets
(passwords, keys, SSH creds) and machine-local paths are never exported; on
import, connections are recreated without secrets so the recipient re-enters
them. sqlfile connections (local .sql imports) are skipped — they can't be shared.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .models import AlertRule, MappingProfile, MigrationProject, SavedConnection, Snippet
from .store import (
    alert_store,
    connection_store,
    mapping_store,
    project_store,
    snippet_store,
)

BUNDLE_VERSION = 1
_STRIP = ("password", "connection_string", "service_role_key",
          "ssh_password", "ssh_private_key", "sqlite_path")


def _sanitize_conn(c: SavedConnection) -> dict:
    d = c.model_dump()
    for f in _STRIP:
        d[f] = ""
    d["table_count"] = 0
    d["source_filename"] = ""
    return d


def export_bundle() -> dict:
    conns = [_sanitize_conn(c) for c in connection_store.list() if c.flavor != "sqlfile"]
    return {
        "version": BUNDLE_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "connections": conns,
        "mappings": [m.model_dump() for m in mapping_store.list()],
        "projects": [p.model_dump() for p in project_store.list()],
        "snippets": [s.model_dump() for s in snippet_store.list()],
        "alerts": [a.model_dump() for a in alert_store.list()],
    }


def _import_items(items: list[dict], existing_ids: set[str], save, Model) -> int:
    added = 0
    for raw in items:
        if raw.get("id") in existing_ids:
            continue  # never clobber an existing local definition
        try:
            save(Model(**raw))
            added += 1
        except Exception:
            pass
    return added


def import_bundle(data: Any) -> dict:
    if not isinstance(data, dict) or "version" not in data:
        raise ValueError("not a valid Migration Studio bundle")

    conn_ids = {c.id for c in connection_store.list()}
    added_conns = 0
    for raw in data.get("connections", []):
        if raw.get("flavor") == "sqlfile" or raw.get("id") in conn_ids:
            continue
        d = dict(raw)
        for f in _STRIP:
            d[f] = ""
        try:
            connection_store.add(SavedConnection(**d))
            added_conns += 1
        except Exception:
            pass

    return {"imported": {
        "connections": added_conns,
        "mappings": _import_items(data.get("mappings", []),
                                  {m.id for m in mapping_store.list()}, mapping_store.save, MappingProfile),
        "projects": _import_items(data.get("projects", []),
                                  {p.id for p in project_store.list()}, project_store.save, MigrationProject),
        "snippets": _import_items(data.get("snippets", []),
                                  {s.id for s in snippet_store.list()}, snippet_store.save, Snippet),
        "alerts": _import_items(data.get("alerts", []),
                                {a.id for a in alert_store.list()}, alert_store.save, AlertRule),
    }}
