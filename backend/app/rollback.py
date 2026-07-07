"""Migration rollback simulator — a pre-flight risk report you read BEFORE applying.

It never writes. It inspects the target table and the mapping and answers the four
questions the roadmap asks of it: can this load be cleanly undone, what data could
be lost, which tables are touched, and what's the lock/downtime risk from the row
volume. The result drives a "look before you leap" panel in the UI.

Rollback classification:
  clean    — the pre-migration state is fully restorable (drop the created table,
             or truncate a target that started empty).
  partial  — new rows are appended but not distinguishable from existing ones
             without a snapshot or a migration marker; a blind delete is unsafe.
  lossy    — an upsert overwrites existing rows in place; a delete cannot restore
             the overwritten values, so a snapshot is required for true rollback.
"""
from __future__ import annotations

import sqlalchemy as sa

from .connectors.base import Connector
from .models import MappingProfile


def _table_exists(connector: Connector, schema: str, table: str) -> bool:
    insp = sa.inspect(connector.engine)
    return table in insp.get_table_names(schema=schema or None)


def _volume_risk(n: int) -> str:
    """Rough lock/downtime bucket from the number of rows written."""
    if n < 10_000:
        return "negligible"
    if n < 100_000:
        return "low"
    if n < 1_000_000:
        return "moderate"
    return "high"


def simulate_rollback(mapping: MappingProfile, source: Connector, target: Connector) -> dict:
    keys = [m.target_col for m in mapping.column_maps
            if m.enabled and m.is_conflict_key and m.target_col]
    strategy = mapping.conflict_strategy
    tgt = f"{mapping.target_schema}.{mapping.target_table}" if mapping.target_schema else mapping.target_table

    source_rows = source.count_rows(mapping.source_schema, mapping.source_table, mapping.where_filter)
    lock_risk = _volume_risk(source_rows)

    base = {
        "source_rows": source_rows,
        "strategy": strategy,
        "conflict_keys": keys,
        "lock_risk": lock_risk,
        "tables_affected": [tgt],
    }

    # Target table doesn't exist yet — the migration will create it, so undoing is a DROP.
    if not _table_exists(target, mapping.target_schema, mapping.target_table):
        return {
            **base,
            "target_exists": False,
            "target_rows_before": 0,
            "rollback": "clean",
            "data_loss_risk": "none",
            "max_overwrites": 0,
            "plan": [
                f"Target {tgt} does not exist — it will be created by this migration.",
                f"Roll back with a single DROP TABLE {tgt}; no existing data is at risk.",
            ],
            "recommendation": "Fully reversible — rollback is one DROP TABLE.",
        }

    target_rows_before = target.count_rows(mapping.target_schema, mapping.target_table)
    empty = target_rows_before == 0
    result = {**base, "target_exists": True, "target_rows_before": target_rows_before}

    if empty:
        return {
            **result,
            "rollback": "clean",
            "data_loss_risk": "none",
            "max_overwrites": 0,
            "plan": [
                f"Target {tgt} is currently empty ({target_rows_before} rows).",
                "Every migrated row is new, so a TRUNCATE (or DELETE all) restores the empty state.",
            ],
            "recommendation": "Reversible — target starts empty, so truncate to undo.",
        }

    if strategy == "upsert":
        max_overwrites = min(source_rows, target_rows_before)
        return {
            **result,
            "rollback": "lossy",
            "data_loss_risk": "high" if max_overwrites > 0 else "none",
            "max_overwrites": max_overwrites,
            "plan": [
                f"Target {tgt} already holds {target_rows_before:,} rows.",
                f"Upsert overwrites matching rows in place — up to {max_overwrites:,} existing "
                "row(s) may have their values replaced.",
                "A delete cannot restore overwritten values: snapshot the affected rows "
                "(or the whole table) BEFORE running so you can restore them.",
            ],
            "recommendation": "Not cleanly reversible — take a snapshot before running.",
        }

    # insert / skip into a non-empty table: existing rows are untouched (no value
    # loss), but the newly inserted rows can't be told apart from prior ones later.
    verb = "Skip-duplicates only inserts non-conflicting rows" if strategy == "skip" \
        else "Insert appends all rows"
    return {
        **result,
        "rollback": "partial",
        "data_loss_risk": "none",
        "max_overwrites": 0,
        "plan": [
            f"Target {tgt} already holds {target_rows_before:,} rows.",
            f"{verb}; existing values are not overwritten.",
            "To roll back precisely, snapshot the table first or add a migration marker "
            "column so the inserted rows can be identified and removed."
            + (f" Conflict key(s) {', '.join(keys)} can help identify them, but may also "
               "match pre-existing rows." if keys else ""),
        ],
        "recommendation": "Partially reversible — snapshot or add a marker to undo cleanly.",
    }
