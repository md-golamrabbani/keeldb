"""First-class SQLite connections: connect, browse, write, and stay writable
(unlike the read-only sqlfile import source)."""
from __future__ import annotations

import sqlite3

from app import dbops
from app.connectors import connector_for
from app.models import SavedConnection


def _make(tmp_path):
    p = str(tmp_path / "mydata.db")
    con = sqlite3.connect(p)
    con.executescript("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t VALUES (1,'a');")
    con.commit(); con.close()
    return connector_for(SavedConnection(id="s", name="s", flavor="sqlite", database="main", sqlite_path=p))


def test_sqlite_connect_and_read(tmp_path):
    c = _make(tmp_path)
    r = c.test_connection()
    assert r.ok and "SQLite" in r.server_version
    assert c.list_schemas() == ["main"]
    out = dbops.run_sql(c, "SELECT name FROM t;")
    assert out["ok"] and out["rows"] == [["a"]]
    c.dispose()


def test_sqlite_is_writable(tmp_path):
    c = _make(tmp_path)
    out = dbops.run_sql(c, "INSERT INTO t VALUES (2, 'b');")
    assert out["ok"] and out["rowcount"] == 1
    assert c.write_batch("", "t", [{"id": 3, "name": "c"}])["written"] == 1
    assert c.count_rows("", "t", "") == 3
    c.dispose()


def test_sqlite_missing_file_reports_cleanly(tmp_path):
    c = connector_for(SavedConnection(id="x", name="x", flavor="sqlite", database="main",
                                      sqlite_path=str(tmp_path / "nope.db")))
    r = c.test_connection()
    assert not r.ok and "not found" in r.error
    c.dispose()
