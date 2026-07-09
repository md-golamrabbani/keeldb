"""Views listing/definition, routines graceful fallback, multi-statement
result sets, and JSON-safe .sql backup."""
from __future__ import annotations

import sqlalchemy as sa

from app import admin, backup, dbops, users

SEED = """
CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, meta TEXT);
INSERT INTO items VALUES (1, 'a', NULL), (2, 'b', NULL);
CREATE VIEW item_names AS SELECT name FROM items;
"""


def test_list_views_and_definition(make_conn):
    c = make_conn(SEED)
    views = admin.list_views(c, "")
    assert views == [{"name": "item_names"}]
    d = admin.view_definition(c, "", "item_names")
    assert "SELECT name FROM items".lower() in d["definition"].lower()
    c.dispose()


def test_routines_and_users_unsupported_dialect(make_conn):
    c = make_conn(SEED)
    assert admin.list_routines(c, "") == {"supported": False, "routines": []}
    assert users.list_users(c) == {"supported": False, "users": []}
    c.dispose()


def test_multi_statement_result_sets(make_conn):
    c = make_conn(SEED)
    r = dbops.run_sql(c, "SELECT id FROM items; SELECT name FROM items WHERE id = 1;")
    assert r["ok"] and len(r["result_sets"]) == 2
    assert r["result_sets"][0]["columns"] == ["id"]
    assert r["result_sets"][1]["rows"] == [["a"]]
    # legacy top-level fields carry the last set
    assert r["columns"] == ["name"]
    # single SELECT: no result_sets key
    r1 = dbops.run_sql(c, "SELECT 1;")
    assert r1["ok"] and "result_sets" not in r1
    c.dispose()


def test_backup_handles_json_like_values(make_conn):
    c = make_conn(SEED)
    # simulate a JSON column value arriving as a Python list (as PG/MySQL do)
    import app.backup as B
    t = c._table("", "items")
    lit = B._literal_safe(t, "meta", [{"name": "সার্কুলার", "text": "ওয়েবসাইটে"}])
    stmt = t.insert().values(id=9, name="j", meta=lit)
    sql = str(stmt.compile(c.engine, compile_kwargs={"literal_binds": True}))
    assert "সার্কুলার" in sql and "INSERT INTO items" in sql

    out = backup.backup_table(c, "", "items")
    assert out["rows"] == 2 and "CREATE TABLE" in out["sql"]
    c.dispose()
