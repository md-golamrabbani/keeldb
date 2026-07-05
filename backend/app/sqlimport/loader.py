"""Load a SQL dump file into a local SQLite database so it can be used as a
migration source exactly like a live connection (introspect, sample, read)."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .parser import (
    ParsedInsert,
    ParsedTable,
    parse_create_table,
    parse_insert,
    split_statements,
)


@dataclass
class LoadResult:
    tables: dict[str, int] = field(default_factory=dict)  # table -> row count
    warnings: list[str] = field(default_factory=list)

    @property
    def table_count(self) -> int:
        return len(self.tables)


def _quote(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def load_sql_dump(sql_text: str, sqlite_path: str) -> LoadResult:
    """Parse `sql_text` and materialize it into a fresh SQLite file at
    `sqlite_path`. Returns per-table row counts and any warnings."""
    path = Path(sqlite_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()

    result = LoadResult()
    schemas: dict[str, ParsedTable] = {}
    conn = sqlite3.connect(sqlite_path)
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA journal_mode=MEMORY")
    try:
        cur = conn.cursor()
        for stmt in split_statements(sql_text):
            head = stmt.lstrip()[:12].upper()
            if head.startswith("CREATE TABLE"):
                table = parse_create_table(stmt)
                if not table:
                    continue
                schemas[table.name] = table
                col_names = {c.name for c in table.columns}
                defs = [f"{_quote(c.name)} {c.affinity}" for c in table.columns]
                if table.primary_key:
                    defs.append("PRIMARY KEY (" + ", ".join(_quote(p) for p in table.primary_key) + ")")
                for fk in table.foreign_keys:
                    # Only emit FKs whose local columns are real; SQLite tolerates
                    # a forward reference to a table defined later in the dump.
                    if not fk.columns or not all(c in col_names for c in fk.columns):
                        continue
                    ref = f" ({', '.join(_quote(c) for c in fk.ref_columns)})" if fk.ref_columns else ""
                    defs.append(
                        "FOREIGN KEY (" + ", ".join(_quote(c) for c in fk.columns) + ") "
                        f"REFERENCES {_quote(fk.ref_table)}{ref}"
                    )
                cur.execute(f"CREATE TABLE IF NOT EXISTS {_quote(table.name)} ({', '.join(defs)})")
                result.tables.setdefault(table.name, 0)
            elif head.startswith("INSERT"):
                ins = parse_insert(stmt)
                if not ins:
                    continue
                try:
                    _apply_insert(cur, ins, schemas, result)
                except Exception as exc:  # keep going; report the table
                    result.warnings.append(f"insert into {ins.table} failed: {exc}")
        conn.commit()
        # Final authoritative counts.
        for name in list(result.tables):
            try:
                result.tables[name] = cur.execute(f"SELECT COUNT(*) FROM {_quote(name)}").fetchone()[0]
            except sqlite3.Error:
                pass
    finally:
        conn.close()

    if not result.tables:
        raise ValueError(
            "No CREATE TABLE or INSERT statements were found. "
            "Is this a SQL data dump (mysqldump / pg_dump)?"
        )
    return result


def _apply_insert(cur, ins: ParsedInsert, schemas: dict[str, ParsedTable], result: LoadResult) -> None:
    table = schemas.get(ins.table)
    if ins.columns:
        columns = ins.columns
    elif table:
        columns = [c.name for c in table.columns]
    else:
        columns = [f"col{i + 1}" for i in range(len(ins.rows[0]))]

    # Create a table on the fly if the dump had INSERTs without a CREATE TABLE.
    if table is None:
        cols_sql = ", ".join(f"{_quote(c)} TEXT" for c in columns)
        cur.execute(f"CREATE TABLE IF NOT EXISTS {_quote(ins.table)} ({cols_sql})")
        schemas[ins.table] = ParsedTable(name=ins.table)
        result.tables.setdefault(ins.table, 0)

    placeholders = ", ".join(["?"] * len(columns))
    col_sql = ", ".join(_quote(c) for c in columns)
    sql = f"INSERT INTO {_quote(ins.table)} ({col_sql}) VALUES ({placeholders})"
    # Only keep rows whose arity matches the column list.
    good = [r for r in ins.rows if len(r) == len(columns)]
    if len(good) != len(ins.rows):
        result.warnings.append(
            f"{ins.table}: skipped {len(ins.rows) - len(good)} rows with mismatched column count"
        )
    cur.executemany(sql, good)
    result.tables[ins.table] = result.tables.get(ins.table, 0) + len(good)
