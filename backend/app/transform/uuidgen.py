"""Deterministic UUIDs so re-runs converge and related migrations link up.

uuid5(namespace-derived-from-label, str(source_key)) — the same (label, key)
pair always yields the same UUID, e.g. det_uuid('people', legacy employee_id)
used by both the people and employees migrations produces matching ids.
"""
from __future__ import annotations

import uuid

# Fixed project root namespace — never change this once migrations have run.
_ROOT = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # uuid.NAMESPACE_DNS


def det_uuid(label: str, key: object) -> str:
    if key is None or str(key) == "":
        raise ValueError("det_uuid: source key is null/empty")
    ns = uuid.uuid5(_ROOT, f"db-migration-studio:{label}")
    return str(uuid.uuid5(ns, str(key)))
