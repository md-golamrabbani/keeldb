"""Auto-snapshot / undo: destructive SQL captures affected tables; restore
brings back the exact pre-change contents."""
from __future__ import annotations

import sqlalchemy as sa

from app import snapshots

SEED = """
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO users VALUES (1, 'alice'), (2, 'bob');
"""


def test_affected_tables_parses_destructive_statements():
    sql = """
    UPDATE users SET name = 'x';
    DELETE FROM `orders` WHERE id = 1;
    INSERT INTO logs VALUES (1);
    DROP TABLE IF EXISTS old_stuff;
    TRUNCATE TABLE cache;
    SELECT * FROM ignored;
    """
    assert snapshots.affected_tables(sql) == ["users", "orders", "old_stuff", "cache"]


def test_snapshot_and_restore_roundtrip(make_conn):
    c = make_conn(SEED)
    meta = snapshots.snapshot_for_sql(c, "t", "", "DELETE FROM users WHERE id = 1;")
    assert meta and meta["tables"] == [{"table": "users", "rows": 2}]

    with c.engine.begin() as conn:
        conn.execute(sa.text("DELETE FROM users WHERE id = 1"))
    with c.engine.connect() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM users")).scalar() == 1

    out = snapshots.restore(c, meta["id"])
    assert out["restored"] == ["users"]
    with c.engine.connect() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM users")).scalar() == 2
        assert conn.execute(sa.text("SELECT name FROM users WHERE id = 1")).scalar() == "alice"
    c.dispose()

    assert any(s["id"] == meta["id"] for s in snapshots.list_snapshots("t"))
    assert snapshots.delete(meta["id"])
    assert not any(s["id"] == meta["id"] for s in snapshots.list_snapshots("t"))


def test_non_destructive_sql_takes_no_snapshot(make_conn):
    c = make_conn(SEED)
    assert snapshots.snapshot_for_sql(c, "t", "", "SELECT * FROM users;") is None
    assert snapshots.snapshot_for_sql(c, "t", "", "INSERT INTO users VALUES (9, 'z');") is None
    c.dispose()


def test_restore_refuses_read_only(make_conn):
    c = make_conn(SEED)
    meta = snapshots.snapshot_for_sql(c, "t", "", "DELETE FROM users;")
    c.dispose()
    ro = make_conn(SEED, read_only=True)
    try:
        snapshots.restore(ro, meta["id"])
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "read-only" in str(exc)
    finally:
        ro.dispose()
