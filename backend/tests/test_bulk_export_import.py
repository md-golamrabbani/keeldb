"""Bulk table ops, export modes/streaming, and streaming import (roundtrip)."""
import io
import sqlite3

import pytest
import sqlalchemy as sa

from app import admin, backup, importer
from app.connectors import connector_for
from app.models import SavedConnection

SEED = """
CREATE TABLE a (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO a (name) VALUES ('x'), ('y');
CREATE TABLE b (id INTEGER PRIMARY KEY);
INSERT INTO b (id) VALUES (1);
"""


def _conn(tmp_path, name="t.db", sql=""):
    p = str(tmp_path / name)
    con = sqlite3.connect(p)
    if sql:
        con.executescript(sql)
    con.close()
    return connector_for(SavedConnection(id="s", name="s", flavor="sqlite", database="main", sqlite_path=p))


def _count(c, table):
    with c.engine.connect() as conn:
        return conn.execute(sa.text(f"SELECT count(*) FROM {table}")).scalar()


def test_bulk_empty(tmp_path):
    c = _conn(tmp_path, sql=SEED)
    res = admin.bulk_table_op(c, "", ["a", "b"], "empty")
    assert res["ok"] and res["done"] == 2 and res["failed"] == 0
    assert _count(c, "a") == 0 and _count(c, "b") == 0


def test_bulk_drop(tmp_path):
    c = _conn(tmp_path, sql=SEED)
    res = admin.bulk_table_op(c, "", ["a", "b"], "drop")
    assert res["ok"] and res["done"] == 2
    assert sa.inspect(c.engine).get_table_names() == []


def test_bulk_partial_failure_is_reported(tmp_path):
    c = _conn(tmp_path, sql=SEED)
    res = admin.bulk_table_op(c, "", ["a", "nope"], "drop")
    assert not res["ok"] and res["done"] == 1 and res["failed"] == 1


def test_bulk_invalid_action(tmp_path):
    c = _conn(tmp_path, sql=SEED)
    with pytest.raises(ValueError):
        admin.bulk_table_op(c, "", ["a"], "nuke")


def test_bulk_read_only_guard(tmp_path):
    c = _conn(tmp_path, sql=SEED)
    c.profile.read_only = True
    with pytest.raises(ValueError):
        admin.bulk_table_op(c, "", ["a"], "drop")


def test_backup_modes(tmp_path):
    c = _conn(tmp_path, sql=SEED)
    both = backup.backup_table(c, "", "a")
    assert "CREATE TABLE" in both["sql"] and "INSERT" in both["sql"] and both["rows"] == 2
    ddl = backup.backup_table(c, "", "a", include_data=False)
    assert "CREATE TABLE" in ddl["sql"] and "INSERT" not in ddl["sql"] and ddl["rows"] == 0
    data = backup.backup_table(c, "", "a", include_ddl=False)
    assert "CREATE TABLE" not in data["sql"] and "INSERT" in data["sql"]


def test_export_iter_events(tmp_path):
    c = _conn(tmp_path, sql=SEED)
    evs = list(backup.export_iter(c, "", ["a", "b"]))
    assert evs[0]["type"] == "start" and evs[0]["total"] == 2
    tbls = [e for e in evs if e["type"] == "table"]
    assert len(tbls) == 2 and all(e.get("sql") for e in tbls)
    assert evs[-1]["type"] == "done" and evs[-1]["rows"] == 3


def test_export_then_import_roundtrip(tmp_path):
    src = _conn(tmp_path, "src.db", SEED)
    dump = "".join(e["sql"] for e in backup.export_iter(src, "") if e["type"] == "table")
    dst = _conn(tmp_path, "dst.db")  # empty
    evs = list(importer.import_stream(dst, "", dump))
    done = evs[-1]
    assert done["type"] == "done" and done["failed"] == 0 and done["executed"] > 0
    assert _count(dst, "a") == 2 and _count(dst, "b") == 1


class _Trickle(io.BytesIO):
    """Return tiny reads so statements span many chunks (stress the splitter)."""
    def read(self, n=-1):  # noqa: ARG002
        return super().read(5)


def test_import_file_stream_across_chunk_boundaries(tmp_path):
    dst = _conn(tmp_path, "d.db", "CREATE TABLE a (id INTEGER, name TEXT);")
    # A semicolon INSIDE a string literal must not split the statement, even when
    # the statement is fed 5 bytes at a time.
    sql = "INSERT INTO a VALUES (1, 'hello; world'); INSERT INTO a VALUES (2, 'x');"
    data = sql.encode()
    evs = list(importer.import_file_stream(dst, "", _Trickle(data), len(data)))
    done = evs[-1]
    assert done["executed"] == 2 and done["failed"] == 0
    assert _count(dst, "a") == 2


def test_import_reports_and_skips_bad_statements(tmp_path):
    dst = _conn(tmp_path, "d.db", "CREATE TABLE a (id INTEGER);")
    evs = list(importer.import_stream(dst, "", "INSERT INTO a VALUES (1); BAD SQL HERE; INSERT INTO a VALUES (2);"))
    errs = [e for e in evs if e["type"] == "error"]
    assert len(errs) == 1
    assert evs[-1]["executed"] == 2 and evs[-1]["failed"] == 1
    assert _count(dst, "a") == 2
