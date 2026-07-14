"""Migration runner: batched read -> transform -> write with streamed progress.

The write destination is a Sink (target DB, or a downloadable SQL/CSV/JSON file),
so the same read+transform pipeline serves "push" and "download" alike.

Yields NDJSON-able event dicts:
    {"event": "start", "source_count": N, "dry_run": .., "output_mode": ..}
    {"event": "progress", "rows_read": .., "rows_written": .., "rows_skipped": .., "rows_errored": ..}
    {"event": "row_error", "row_index": .., "column": .., "message": ..}
    {"event": "done", "report": {...}, "export_id": ..?}
Dry-run performs the full read + transform + validation but never writes.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Iterator, Optional

from .connectors import connector_for
from .models import ColumnMap, MappingProfile, Report, RowError, SavedConnection
from .sinks import CSVSink, DBSink, EXPORT_EXT, JSONSink, SQLFileSink, Sink
from .store.store import DATA_DIR
from .supabase_auth import enricher_for
from .transform.expr import eval_expr
from .transform.registry import apply_cast

MAX_LOGGED_ERRORS = 200
EXPORT_DIR = DATA_DIR / "exports"
CHECKPOINT_FILE = DATA_DIR / "checkpoints.json"


# -- checkpoint / resume -----------------------------------------------------
# After every fully-written batch the runner records how many source rows are
# safely persisted, keyed by mapping id. An interrupted push migration can then
# resume by skipping that many source rows. Resume assumes the source read
# order is stable between runs (same table, no concurrent reordering writes) —
# pair it with the "skip" conflict strategy for belt-and-braces safety.
def _load_checkpoints() -> dict[str, dict[str, Any]]:
    if not CHECKPOINT_FILE.exists():
        return {}
    try:
        data = json.loads(CHECKPOINT_FILE.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_checkpoints(items: dict[str, dict[str, Any]]) -> None:
    CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CHECKPOINT_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, indent=2, default=str))
    tmp.replace(CHECKPOINT_FILE)


def get_checkpoint(mapping_id: str) -> Optional[dict[str, Any]]:
    return _load_checkpoints().get(mapping_id)


def set_checkpoint(mapping_id: str, rows_read: int, done: bool = False) -> None:
    if not mapping_id:
        return
    items = _load_checkpoints()
    if done:
        items.pop(mapping_id, None)
    else:
        items[mapping_id] = {"rows_read": rows_read}
    _save_checkpoints(items)


def _short_db_error(exc: Exception) -> str:
    """Trim the driver's echoed SQL/parameters so the message names the problem
    (constraint, bad value) instead of the full multi-row INSERT statement."""
    msg = str(exc)
    idx = msg.find("[SQL:")
    if idx != -1:
        msg = msg[:idx]
    return " ".join(msg.split()).strip()


def _resilient_write(
    sink: Sink, rows: list[dict[str, Any]], indices: list[int]
) -> Iterator[tuple]:
    """Write `rows` (parallel to source `indices`), isolating bad rows so the
    good ones still land, yielding outcomes as they happen so the caller can
    stream progress instead of waiting for the whole batch.

    A multi-row INSERT is all-or-nothing: one bad row (duplicate key, bad value,
    NOT NULL / FK violation) rejects the whole batch. Since each write_batch runs
    in its own transaction, a rejected batch leaves nothing written, so we split
    and retry the halves; a lone row that still fails is a genuine offender. The
    happy path writes in one shot.

    Yields ("written", count) / ("skipped", count) / ("error", row_index, msg)."""
    try:
        r = sink.write_batch(rows)
    except Exception as exc:
        if len(rows) == 1:
            yield ("error", indices[0], _short_db_error(exc))
            return
        mid = len(rows) // 2
        yield from _resilient_write(sink, rows[:mid], indices[:mid])
        yield from _resilient_write(sink, rows[mid:], indices[mid:])
        return
    if r["written"]:
        yield ("written", r["written"])
    if r["skipped"]:
        yield ("skipped", r["skipped"])


def transform_row(
    row: dict[str, Any], maps: list[ColumnMap]
) -> tuple[dict[str, Any], list[tuple[str, str]]]:
    """Apply enabled column maps to one source row.
    Returns (target_row, [(column, error_message), ...])."""
    out: dict[str, Any] = {}
    errors: list[tuple[str, str]] = []
    for m in maps:
        if not m.enabled or not m.target_col:
            continue
        value = row.get(m.source_col)
        try:
            if m.transform_expr:
                value = eval_expr(m.transform_expr, value, row)
            if m.cast_type:
                value = apply_cast(value, m.cast_type, m.cast_format)
            if (value is None or value == "") and m.default_value is not None:
                value = apply_cast(m.default_value, m.cast_type, m.cast_format) if m.cast_type else m.default_value
            out[m.target_col] = value
        except Exception as exc:
            errors.append((m.source_col, str(exc)))
            out[m.target_col] = None
    return out, errors


def _build_sink(
    mapping: MappingProfile,
    target: "object",
    target_cols: list[str],
    export_id: Optional[str],
) -> tuple[Sink, Optional[str]]:
    """Return (sink, export_path). export_path is set for download modes."""
    mode = mapping.output_mode
    conflict_keys = [m.target_col for m in mapping.column_maps if m.enabled and m.is_conflict_key]
    if mode == "push":
        return (
            DBSink(target, mapping.target_schema, mapping.target_table, mapping.conflict_strategy, conflict_keys),
            None,
        )
    path = str(EXPORT_DIR / f"{export_id}.{EXPORT_EXT[mode]}")
    if mode == "sql":
        target_columns = None
        if mapping.include_ddl:
            try:
                target_columns = target.list_columns(mapping.target_schema, mapping.target_table)
            except Exception:
                target_columns = None
        return (
            SQLFileSink(path, mapping.target_table, target_cols, schema=mapping.target_schema,
                        include_ddl=mapping.include_ddl, target_columns=target_columns),
            path,
        )
    if mode == "csv":
        return CSVSink(path, target_cols), path
    return JSONSink(path, target_cols), path


def run_migration(
    mapping: MappingProfile,
    source_profile: SavedConnection,
    target_profile: Optional[SavedConnection],
    dry_run: bool = False,
    resume_offset: int = 0,
) -> Iterator[dict[str, Any]]:
    source = connector_for(source_profile)
    target = connector_for(target_profile) if target_profile else None
    report = Report()
    enabled = [m for m in mapping.column_maps if m.enabled and m.target_col]
    target_cols = [m.target_col for m in enabled]
    source_cols = sorted({m.source_col for m in mapping.column_maps if m.enabled})
    # Opt-in Supabase auth.users enrichment — None for every ordinary migration.
    auth_enricher = enricher_for(mapping.supabase_auth)

    export_id = uuid.uuid4().hex if (mapping.output_mode != "push" and not dry_run) else None
    sink: Optional[Sink] = None

    try:
        report.source_count = source.count_rows(
            mapping.source_schema, mapping.source_table, mapping.where_filter
        )
        yield {
            "event": "start",
            "source_count": report.source_count,
            "dry_run": dry_run,
            "output_mode": mapping.output_mode,
            "resume_offset": resume_offset,
        }

        if not dry_run:
            sink, _ = _build_sink(mapping, target, target_cols, export_id)

        row_index = 0
        for batch in source.read_batches(
            mapping.source_schema,
            mapping.source_table,
            source_cols,
            batch_size=max(1, mapping.batch_size),
            where=mapping.where_filter,
        ):
            good_rows: list[dict[str, Any]] = []
            good_indices: list[int] = []
            for row in batch:
                row_index += 1
                if row_index <= resume_offset:
                    continue  # already persisted by the interrupted run
                report.rows_read += 1
                transformed, row_errors = transform_row(row, enabled)
                if row_errors:
                    report.rows_errored += 1
                    for col, msg in row_errors:
                        if len(report.errors) < MAX_LOGGED_ERRORS:
                            report.errors.append(RowError(row_index=row_index, column=col, message=msg))
                        yield {"event": "row_error", "row_index": row_index, "column": col, "message": msg}
                    if mapping.stop_on_error:
                        report.aborted = True
                        break
                    continue
                if auth_enricher is not None:
                    transformed = auth_enricher.enrich(transformed)
                good_rows.append(transformed)
                good_indices.append(row_index)

            if good_rows and not dry_run and sink is not None:
                # Isolate any bad rows so one duplicate/invalid value doesn't sink
                # the whole batch — good rows still land and we report the culprits.
                # Consume outcomes as they stream so a slow row-by-row fallback
                # (e.g. re-run into a table with existing rows) stays visible.
                batch_written = batch_skipped = batch_errored = 0
                first_error = ""
                for outcome in _resilient_write(sink, good_rows, good_indices):
                    if outcome[0] == "written":
                        report.rows_written += outcome[1]
                        batch_written += outcome[1]
                    elif outcome[0] == "skipped":
                        report.rows_skipped += outcome[1]
                        batch_skipped += outcome[1]
                    else:  # ("error", row_index, msg)
                        idx, msg = outcome[1], outcome[2]
                        report.rows_errored += 1
                        batch_errored += 1
                        first_error = first_error or msg
                        if len(report.errors) < MAX_LOGGED_ERRORS:
                            report.errors.append(RowError(row_index=idx, message=msg))
                        yield {"event": "row_error", "row_index": idx, "column": "", "message": msg}
                    yield {
                        "event": "progress",
                        "rows_read": report.rows_read,
                        "rows_written": report.rows_written,
                        "rows_skipped": report.rows_skipped,
                        "rows_errored": report.rows_errored,
                    }
                if mapping.output_mode == "push":
                    set_checkpoint(mapping.id, row_index)
                # A whole batch failing while nothing has ever been written means the
                # target is structurally incompatible (missing/renamed column, type or
                # table mismatch) — every remaining batch would fail identically, so
                # stop now instead of grinding the entire table row by row.
                whole_batch_failed = batch_written == 0 and batch_skipped == 0 and batch_errored == len(good_rows)
                if whole_batch_failed and report.rows_written == 0:
                    report.aborted = True
                    yield {
                        "event": "fatal",
                        "message": "aborted: the entire first batch failed to write — the target "
                                   "table looks incompatible with the mapping (check that column "
                                   "names and types match, and the table exists). "
                                   f"First error: {first_error}",
                    }
                elif batch_errored and mapping.stop_on_error:
                    report.aborted = True
            elif good_rows and dry_run:
                report.rows_written += len(good_rows)  # "would write"

            yield {
                "event": "progress",
                "rows_read": report.rows_read,
                "rows_written": report.rows_written,
                "rows_skipped": report.rows_skipped,
                "rows_errored": report.rows_errored,
            }
            if report.aborted:
                break

        if sink is not None:
            sink.finalize()
            report.target_count_after = sink.target_count()

        report.ok = report.rows_errored == 0 and not report.aborted
        if report.ok and not dry_run and mapping.output_mode == "push":
            set_checkpoint(mapping.id, 0, done=True)  # finished — no resume point
        done: dict[str, Any] = {"event": "done", "report": report.model_dump()}
        if export_id and not report.aborted:
            done["export_id"] = export_id
            done["output_mode"] = mapping.output_mode
        yield done
    except Exception as exc:
        report.ok = False
        report.aborted = True
        if len(report.errors) < MAX_LOGGED_ERRORS:
            report.errors.append(RowError(row_index=0, message=str(exc)))
        yield {"event": "fatal", "message": str(exc)}
        yield {"event": "done", "report": report.model_dump()}
    finally:
        if sink is not None:
            try:
                sink.finalize()
            except Exception:
                pass
        source.dispose()
        if target is not None:
            target.dispose()
