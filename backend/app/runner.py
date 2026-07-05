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

import uuid
from pathlib import Path
from typing import Any, Iterator, Optional

from .connectors import connector_for
from .models import ColumnMap, MappingProfile, Report, RowError, SavedConnection
from .sinks import CSVSink, DBSink, EXPORT_EXT, JSONSink, SQLFileSink, Sink
from .store.store import DATA_DIR
from .transform.expr import eval_expr
from .transform.registry import apply_cast

MAX_LOGGED_ERRORS = 200
EXPORT_DIR = DATA_DIR / "exports"


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
) -> Iterator[dict[str, Any]]:
    source = connector_for(source_profile)
    target = connector_for(target_profile) if target_profile else None
    report = Report()
    enabled = [m for m in mapping.column_maps if m.enabled and m.target_col]
    target_cols = [m.target_col for m in enabled]
    source_cols = sorted({m.source_col for m in mapping.column_maps if m.enabled})

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
            for row in batch:
                row_index += 1
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
                good_rows.append(transformed)

            if good_rows and not dry_run and sink is not None:
                try:
                    result = sink.write_batch(good_rows)
                    report.rows_written += result["written"]
                    report.rows_skipped += result["skipped"]
                except Exception as exc:
                    report.rows_errored += len(good_rows)
                    msg = f"batch write failed: {exc}"
                    if len(report.errors) < MAX_LOGGED_ERRORS:
                        report.errors.append(RowError(row_index=row_index, message=msg))
                    yield {"event": "row_error", "row_index": row_index, "column": "", "message": msg}
                    if mapping.stop_on_error:
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
