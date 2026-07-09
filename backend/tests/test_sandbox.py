"""Transaction sandbox: writes are invisible until commit, gone after rollback."""
from __future__ import annotations

from app import sandbox
from app.models import SavedConnection

SEED = """
CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO items VALUES (1, 'a'), (2, 'b');
"""


def _record(make_conn, **kw) -> SavedConnection:
    c = make_conn(SEED, **kw)
    rec = c.profile
    c.dispose()
    return rec


def test_sandbox_rollback_discards_writes(make_conn):
    rec = _record(make_conn)
    sid = sandbox.begin(rec)["sandbox_id"]

    r = sandbox.run(sid, "DELETE FROM items WHERE id = 1;")
    assert r["ok"] and r["rowcount"] == 1

    # inside the sandbox the row is gone
    r = sandbox.run(sid, "SELECT COUNT(*) FROM items;")
    assert r["rows"][0][0] == 1

    sandbox.rollback(sid)
    assert sandbox.status(sid) == {"active": False}

    # outside: nothing changed
    c = make_conn(SEED)
    import sqlalchemy as sa
    with c.engine.connect() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM items")).scalar() == 2
    c.dispose()


def test_sandbox_commit_persists_writes(make_conn):
    rec = _record(make_conn)
    sid = sandbox.begin(rec)["sandbox_id"]
    sandbox.run(sid, "INSERT INTO items VALUES (3, 'c');")
    out = sandbox.commit(sid)
    assert out["committed"] and out["writes"] == 1

    c = make_conn(SEED)
    import sqlalchemy as sa
    with c.engine.connect() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM items")).scalar() == 3
    c.dispose()


def test_sandbox_blocks_writes_on_read_only(make_conn):
    rec = _record(make_conn, read_only=True)
    sid = sandbox.begin(rec)["sandbox_id"]
    r = sandbox.run(sid, "DELETE FROM items;")
    assert not r["ok"] and "read-only" in r["error"]
    # reads still fine
    assert sandbox.run(sid, "SELECT 1;")["ok"]
    sandbox.rollback(sid)


def test_sandbox_unknown_id_errors():
    try:
        sandbox.run("nope", "SELECT 1;")
        assert False, "expected ValueError"
    except ValueError:
        pass
