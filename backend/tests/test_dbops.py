"""Explorer data ops + Guard: filters, row CRUD, run_sql, read-only, preview."""
import pytest

from app import dbops

SEED = """
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, dept TEXT, active INTEGER);
INSERT INTO users VALUES (1,'Alice','Eng',1),(2,'Bob','HR',0),(3,'Cara','Eng',1),(4,'Dan','HR',0),(5,'Eve','Eng',1)
"""


def test_read_table_paginate_sort_search(make_conn):
    c = make_conn(SEED)
    d = dbops.read_table(c, "main", "users", limit=2, offset=0, order_by="id", order_dir="desc")
    c.dispose()
    assert d["total"] == 5 and d["pk_cols"] == ["id"]
    assert [r[0] for r in d["rows"]] == [5, 4]

    c = make_conn(SEED)
    s = dbops.read_table(c, "main", "users", search="Eng")
    c.dispose()
    assert s["total"] == 3


def test_advanced_filters(make_conn):
    c = make_conn(SEED)
    r = dbops.read_table(c, "main", "users", filters=[{"column": "dept", "op": "=", "value": "HR"}])
    c.dispose()
    assert r["total"] == 2

    c = make_conn(SEED)
    r2 = dbops.read_table(c, "main", "users",
                          filters=[{"column": "active", "op": "=", "value": "1"},
                                   {"column": "id", "op": ">", "value": "1"}])
    c.dispose()
    assert r2["total"] == 2  # Cara(3), Eve(5)


def test_numeric_value_coercion(make_conn):
    # '1' (string) must match an INTEGER column (would fail on PG without coercion)
    c = make_conn(SEED)
    r = dbops.read_table(c, "main", "users", filters=[{"column": "id", "op": "=", "value": "3"}])
    c.dispose()
    assert r["total"] == 1 and r["rows"][0][1] == "Cara"


def test_row_crud(make_conn):
    c = make_conn(SEED); dbops.insert_row(c, "main", "users", {"id": 6, "name": "Fay", "dept": "Eng", "active": 1}); c.dispose()
    c = make_conn(SEED); u = dbops.update_row(c, "main", "users", {"id": 6}, {"name": "Faye"}); c.dispose()
    assert u["updated"] == 1
    c = make_conn(SEED); chk = dbops.run_sql(c, "SELECT name FROM users WHERE id=6", schema="main"); c.dispose()
    assert chk["rows"][0][0] == "Faye"
    c = make_conn(SEED); d = dbops.delete_row(c, "main", "users", {"id": 6}); c.dispose()
    assert d["deleted"] == 1
    c = make_conn(SEED); b = dbops.delete_rows(c, "main", "users", [{"id": 1}, {"id": 2}]); c.dispose()
    assert b["deleted"] == 2


def test_run_sql_select_write_error(make_conn):
    c = make_conn(SEED); q = dbops.run_sql(c, "SELECT COUNT(*) FROM users", schema="main"); c.dispose()
    assert q["ok"] and q["is_select"] and q["rows"][0][0] == 5

    c = make_conn(SEED); w = dbops.run_sql(c, "UPDATE users SET active=1 WHERE active=0", schema="main"); c.dispose()
    assert w["ok"] and not w["is_select"] and w["rowcount"] == 2

    c = make_conn(SEED); e = dbops.run_sql(c, "SELECT * FROM nope", schema="main"); c.dispose()
    assert e["ok"] is False and e["error"]


def test_run_sql_row_limit(make_conn):
    c = make_conn(SEED); r = dbops.run_sql(c, "SELECT * FROM users", max_rows=2, schema="main"); c.dispose()
    assert r["rowcount"] == 2 and r["truncated"] is True
    c = make_conn(SEED); a = dbops.run_sql(c, "SELECT * FROM users", max_rows=0, schema="main"); c.dispose()
    assert a["rowcount"] == 5 and a["truncated"] is False


# ---- Guard ----
def test_is_write_detection():
    assert dbops.is_write("DELETE FROM t") and dbops.is_write("  update t set x=1")
    assert dbops.is_write("DROP TABLE t") and not dbops.is_write("SELECT 1")
    assert dbops.first_keyword("\n\t  Update x") == "update"


def test_read_only_blocks_writes_allows_reads(make_conn):
    c = make_conn(SEED, read_only=True); w = dbops.run_sql(c, "DELETE FROM users", schema="main"); c.dispose()
    assert w["ok"] is False and "read-only" in w["error"].lower()
    c = make_conn(SEED, read_only=True); r = dbops.run_sql(c, "SELECT COUNT(*) FROM users", schema="main"); c.dispose()
    assert r["ok"] and r["rows"][0][0] == 5
    c = make_conn(SEED, read_only=True)
    with pytest.raises(ValueError):
        dbops.delete_row(c, "main", "users", {"id": 1})
    c.dispose()


def test_preview_write_rolls_back(make_conn):
    c = make_conn(SEED)
    pv = dbops.preview_write(c, "UPDATE users SET active=1 WHERE active=0", schema="main")
    c.dispose()
    assert pv["ok"] and pv["previews"][0]["affected"] == 2 and pv["previews"][0]["previewable"]
    # nothing changed
    c = make_conn(SEED); after = dbops.run_sql(c, "SELECT SUM(active) FROM users", schema="main"); c.dispose()
    assert after["rows"][0][0] == 3  # unchanged (Alice, Cara, Eve)


def test_preview_write_ddl_not_executed(make_conn):
    c = make_conn(SEED); pv = dbops.preview_write(c, "DROP TABLE users", schema="main"); c.dispose()
    assert pv["previews"][0]["previewable"] is False
    c = make_conn(SEED); still = dbops.run_sql(c, "SELECT COUNT(*) FROM users", schema="main"); c.dispose()
    assert still["ok"] and still["rows"][0][0] == 5  # DROP was NOT executed
